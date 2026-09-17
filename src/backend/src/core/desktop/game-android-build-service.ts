import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import type {
  AndroidAbi,
  AndroidToolchainStatus,
  GameBuildArtifact,
  GameBuildPreset,
  GameBuildRequest,
  GameReleaseProjectSettings,
} from '../../../../contract/game-release.ts';
import { resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import {
  gameArtifactBaseName,
  isInside,
  sha256File,
  writeJsonAtomically,
} from './game-build-file-service.ts';
import { runGameBuildProcess } from './game-build-process-service.ts';
import { copyAndroidShellProject, assertAndroidShellTemplate } from './game-android-shell-service.ts';
import {
  ANDROID_TOOLCHAIN_VERSIONS,
  inspectAndroidToolchain,
} from './game-android-toolchain-service.ts';

const ABI_VERSION_OFFSETS: Record<AndroidAbi, number> = {
  'armeabi-v7a': 2,
  x86_64: 3,
  'arm64-v8a': 4,
};
const MAX_BASE_VERSION_CODE = 210_000_000;
const MINIMUM_SHELL_SDK = 23;

export interface AndroidBuildOutput {
  artifacts: GameBuildArtifact[];
  runtime: Record<string, string | null>;
  certificateSha256: string;
  versionCodes: Record<string, number>;
}

export function preflightAndroidBuild(
  workflowRoot: string,
  project: string,
  settings: GameReleaseProjectSettings,
  preset: GameBuildPreset,
): { blockers: string[]; warnings: string[]; toolchain: AndroidToolchainStatus } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const toolchain = inspectAndroidToolchain(workflowRoot, settings.androidToolchainRoot);
  if (!toolchain.configured) {
    blockers.push(`Install the managed Android toolchain before building. Missing: ${toolchain.missing.join(', ')}.`);
  }
  try {
    assertAndroidShellTemplate(workflowRoot);
  } catch (error) {
    blockers.push(message(error));
  }
  const android = preset.android;
  if (!android) {
    blockers.push('The Android packaging preset is missing its Android configuration.');
    return { blockers, warnings, toolchain };
  }
  if (android.minSdk < MINIMUM_SHELL_SDK) {
    blockers.push(`The fixed Android shell requires minSdk ${MINIMUM_SHELL_SDK} or newer.`);
  }
  if (android.targetSdk > ANDROID_TOOLCHAIN_VERSIONS.compileSdk) {
    blockers.push(`targetSdk cannot exceed the managed compile SDK ${ANDROID_TOOLCHAIN_VERSIONS.compileSdk}.`);
  }
  if (android.versionCode > MAX_BASE_VERSION_CODE) {
    blockers.push(`Android base versionCode must not exceed ${MAX_BASE_VERSION_CODE} because ABI outputs reserve one decimal digit.`);
  }
  try {
    resolveArtwork(project, android.iconRelativePath, 'Android icon');
  } catch (error) {
    blockers.push(message(error));
  }
  if (android.splashRelativePath) {
    try {
      resolveArtwork(project, android.splashRelativePath, 'Android splash image');
    } catch (error) {
      blockers.push(message(error));
    }
  }
  if (android.signing === 'release') {
    const keystore = path.resolve(android.keystorePath || '');
    if (!android.keystorePath || !fs.existsSync(keystore) || !fs.statSync(keystore).isFile()) {
      blockers.push('Select an existing Android release keystore before building.');
    }
  } else {
    warnings.push('This APK uses the RPG Agent MV managed debug identity and is not a production release package.');
  }
  const historyKey = androidHistoryKey(preset);
  const cachedVersionCode = settings.lastSuccessfulAndroidVersionCodes?.[historyKey];
  const recordedVersionCode = readLastSuccessfulBaseVersionCode(project, preset);
  const lastVersionCode = Math.max(cachedVersionCode || 0, recordedVersionCode || 0) || undefined;
  if (lastVersionCode !== undefined && android.versionCode <= lastVersionCode && android.newApplication !== true) {
    blockers.push(`Android versionCode must be greater than the last successful value ${lastVersionCode} for this application and preset.`);
  }
  if (android.newApplication === true) {
    warnings.push('This preset is marked as a new application. It is not promised to replace an already installed app or preserve that app\'s private saves.');
  }
  return { blockers, warnings, toolchain };
}

export async function buildAndroidApks(input: {
  workflowRoot: string;
  project: string;
  settings: GameReleaseProjectSettings;
  preset: GameBuildPreset;
  request: GameBuildRequest;
  completeContent: string;
  outputContainer: string;
  gameName: string;
  version: string;
  releaseId: string;
  allowCleartext: boolean;
  isCanceled?: () => boolean;
}): Promise<AndroidBuildOutput> {
  const android = input.preset.android;
  if (!android) throw new Error('The Android build configuration is missing.');
  const checked = preflightAndroidBuild(input.workflowRoot, input.project, input.settings, input.preset);
  if (checked.blockers.length) throw new Error(checked.blockers.join('\n'));
  const toolchain = checked.toolchain;
  const projectDirectory = path.join(path.dirname(input.outputContainer), 'android-gradle-project');
  copyAndroidShellProject(projectDirectory, input.workflowRoot);
  const verificationDirectory = path.join(projectDirectory, 'gradle');
  fs.mkdirSync(verificationDirectory, { recursive: true });
  fs.copyFileSync(
    path.join(toolchain.root, 'gradle-verification-metadata.xml'),
    path.join(verificationDirectory, 'verification-metadata.xml'),
  );
  const gameAssets = path.join(projectDirectory, 'app', 'src', 'main', 'assets', 'game');
  fs.cpSync(input.completeContent, gameAssets, { recursive: true, force: false, errorOnExist: true });
  writeJsonAtomically(path.join(projectDirectory, 'app', 'src', 'main', 'assets', 'rpg-agent-runtime.json'), {
    schemaVersion: 1,
    releaseId: input.releaseId,
    applicationId: android.applicationId,
    versionName: input.version,
  });
  writeJsonAtomically(path.join(projectDirectory, 'app', 'rpg-agent-build.json'), {
    schemaVersion: 1,
    applicationId: android.applicationId,
    versionName: input.version,
    versionCode: android.versionCode,
    minSdk: android.minSdk,
    targetSdk: android.targetSdk,
    orientation: android.orientation,
    allowCleartext: input.allowCleartext,
    abis: android.abis,
    abiVersionOffsets: ABI_VERSION_OFFSETS,
  });
  writeLocalProperties(projectDirectory, toolchain.sdkRoot!);
  writeStringResources(projectDirectory, android.displayName);
  await writeArtworkResources(input.project, projectDirectory, android.iconRelativePath, android.splashRelativePath);

  const signing = prepareSigning(toolchain, android, input.request.signingCredential);
  const buildType = android.signing === 'release' ? 'Release' : 'Debug';
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    JAVA_HOME: path.dirname(path.dirname(toolchain.javaExecutable!)),
    ANDROID_HOME: toolchain.sdkRoot!,
    ANDROID_SDK_ROOT: toolchain.sdkRoot!,
    GRADLE_USER_HOME: path.join(toolchain.root, 'gradle-cache'),
    RPG_AGENT_ANDROID_STORE_FILE: signing.keystore,
    RPG_AGENT_ANDROID_STORE_PASSWORD: signing.storePassword,
    RPG_AGENT_ANDROID_KEY_ALIAS: signing.alias,
    RPG_AGENT_ANDROID_KEY_PASSWORD: signing.keyPassword,
  };
  await runTool(
    toolchain.javaExecutable!,
    [
      '-Dorg.gradle.appname=gradle', '-classpath', toolchain.gradleLauncherJar!, 'org.gradle.launcher.GradleMain',
      `:app:assemble${buildType}`, '--offline', '--no-daemon', '--console=plain', '--stacktrace',
    ],
    environment,
    projectDirectory,
    'Android Gradle build',
    input.isCanceled,
  );
  const outputDirectory = path.join(projectDirectory, 'app', 'build', 'outputs', 'apk', buildType.toLowerCase());
  const metadata = readGradleOutputMetadata(outputDirectory);
  const requested = [...android.abis].sort();
  const produced = metadata.map((entry) => entry.abi).sort();
  if (JSON.stringify(produced) !== JSON.stringify(requested)) {
    throw new Error(`Gradle did not produce exactly the requested ABI outputs. Expected ${requested.join(', ')}, received ${produced.join(', ') || 'none'}.`);
  }
  fs.mkdirSync(input.outputContainer, { recursive: true });
  const artifacts: GameBuildArtifact[] = [];
  const versionCodes: Record<string, number> = {};
  let certificateSha256 = '';
  for (const entry of metadata) {
    const source = path.join(outputDirectory, entry.outputFile);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`Gradle output is missing: ${entry.outputFile}.`);
    const expectedCode = android.versionCode * 10 + ABI_VERSION_OFFSETS[entry.abi];
    if (entry.versionCode !== expectedCode) throw new Error(`Gradle recorded an unexpected versionCode for ${entry.abi}.`);
    const destination = path.join(
      input.outputContainer,
      `${gameArtifactBaseName(input.gameName, input.version, 'android', entry.abi)}.apk`,
    );
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    const badging = await runTool(
      toolchain.aapt2Executable!,
      ['dump', 'badging', destination],
      environment,
      projectDirectory,
      'APK identity check',
      input.isCanceled,
    );
    assertApkBadging(badging, android.applicationId, input.version, expectedCode);
    const verification = await runTool(
      toolchain.javaExecutable!,
      ['-Xmx1024M', '-Xss1m', '-jar', toolchain.apkSignerJar!, 'verify', '--verbose', '--print-certs', destination],
      environment,
      projectDirectory,
      'APK signature check',
      input.isCanceled,
    );
    const certificate = readCertificateSha256(verification);
    if (certificateSha256 && certificateSha256 !== certificate) throw new Error('The ABI APKs were signed by different certificates.');
    certificateSha256 = certificate;
    versionCodes[entry.abi] = expectedCode;
    artifacts.push({
      kind: 'apk',
      platform: 'android',
      architecture: entry.abi,
      path: destination,
      bytes: fs.statSync(destination).size,
      sha256: sha256File(destination),
      packageType: 'full',
      versionName: input.version,
      versionCode: expectedCode,
      certificateSha256: certificate,
      applicationId: android.applicationId,
    });
  }
  return {
    artifacts,
    certificateSha256,
    versionCodes,
    runtime: {
      platformRuntime: 'managed-android-webview-shell',
      androidApplicationId: android.applicationId,
      androidSigning: android.signing,
      androidSigningCertificateSha256: certificateSha256,
      androidVersionCodes: JSON.stringify(versionCodes),
      androidBaseVersionCode: String(android.versionCode),
      jdk: ANDROID_TOOLCHAIN_VERSIONS.jdk,
      androidCommandLineTools: ANDROID_TOOLCHAIN_VERSIONS.commandLineTools,
      androidBuildTools: ANDROID_TOOLCHAIN_VERSIONS.buildTools,
      androidCompileSdk: String(ANDROID_TOOLCHAIN_VERSIONS.compileSdk),
      androidGradlePlugin: ANDROID_TOOLCHAIN_VERSIONS.androidGradlePlugin,
      gradle: ANDROID_TOOLCHAIN_VERSIONS.gradle,
      androidXWebkit: ANDROID_TOOLCHAIN_VERSIONS.webkit,
    },
  };
}

export function recordAndroidBuildSuccess(
  settings: GameReleaseProjectSettings,
  preset: GameBuildPreset,
): GameReleaseProjectSettings {
  const android = preset.android;
  if (!android) return settings;
  const next = structuredClone(settings);
  const history = { ...(next.lastSuccessfulAndroidVersionCodes || {}) };
  history[androidHistoryKey(preset)] = android.versionCode;
  next.lastSuccessfulAndroidVersionCodes = history;
  const savedPreset = next.presets.find((candidate) => candidate.id === preset.id);
  if (savedPreset?.android && savedPreset.android.versionCode === android.versionCode
    && android.versionCode < MAX_BASE_VERSION_CODE) {
    savedPreset.android.versionCode += 1;
  }
  return next;
}

function prepareSigning(
  toolchain: AndroidToolchainStatus,
  android: NonNullable<GameBuildPreset['android']>,
  credential: GameBuildRequest['signingCredential'],
): { keystore: string; alias: string; storePassword: string; keyPassword: string } {
  const keytool = path.join(path.dirname(toolchain.javaExecutable!), 'keytool.exe');
  if (!fs.existsSync(keytool)) throw new Error('The managed JDK keytool is missing. Reinstall the Android toolchain.');
  if (android.signing === 'debug') {
    const identityDirectory = path.join(toolchain.root, 'identities');
    const keystore = path.join(identityDirectory, 'debug.keystore');
    const password = 'android';
    const alias = 'rpg-agent-debug';
    fs.mkdirSync(identityDirectory, { recursive: true });
    if (!fs.existsSync(keystore)) {
      const temporary = `${keystore}.${process.pid}.tmp`;
      const environment = { ...process.env, RPG_AGENT_DEBUG_KEYSTORE_PASSWORD: password };
      try {
        runToolSync(keytool, [
          '-genkeypair', '-noprompt', '-keystore', temporary, '-storepass:env', 'RPG_AGENT_DEBUG_KEYSTORE_PASSWORD',
          '-keypass:env', 'RPG_AGENT_DEBUG_KEYSTORE_PASSWORD', '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048',
          '-validity', '10000', '-dname', 'CN=RPG Agent MV Debug,O=RPG Agent MV,C=XX',
        ], environment, toolchain.root, 'Android debug signing identity creation');
        fs.renameSync(temporary, keystore);
      } finally {
        if (fs.existsSync(temporary)) fs.rmSync(temporary);
      }
    }
    return { keystore, alias, storePassword: password, keyPassword: password };
  }
  const storePassword = credential?.storePassword || '';
  const keyPassword = credential?.keyPassword || '';
  if (!storePassword || !keyPassword) {
    throw new Error('Enter the release keystore password and key password for this build. They are not stored in the project or report.');
  }
  const keystore = path.resolve(android.keystorePath!);
  const alias = android.keyAlias!;
  runToolSync(keytool, [
    '-list', '-keystore', keystore, '-storepass:env', 'RPG_AGENT_ANDROID_STORE_PASSWORD', '-alias', alias,
  ], { ...process.env, RPG_AGENT_ANDROID_STORE_PASSWORD: storePassword }, toolchain.root, 'Android release signing identity check');
  return { keystore, alias, storePassword, keyPassword };
}

async function writeArtworkResources(
  project: string,
  androidProject: string,
  iconRelativePath: string,
  splashRelativePath?: string,
): Promise<void> {
  const icon = resolveArtwork(project, iconRelativePath, 'Android icon');
  const resources = path.join(androidProject, 'app', 'src', 'main', 'res');
  const densities: Array<[string, number]> = [
    ['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96], ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192],
  ];
  for (const [directory, size] of densities) {
    const targetDirectory = path.join(resources, directory);
    fs.mkdirSync(targetDirectory, { recursive: true });
    await sharp(icon).resize(size, size, { fit: 'cover' }).png().toFile(path.join(targetDirectory, 'app_icon.png'));
  }
  const splash = splashRelativePath ? resolveArtwork(project, splashRelativePath, 'Android splash image') : icon;
  const splashDirectory = path.join(resources, 'drawable-nodpi');
  fs.mkdirSync(splashDirectory, { recursive: true });
  await sharp(splash).png().toFile(path.join(splashDirectory, 'splash.png'));
}

function writeStringResources(projectDirectory: string, displayName: string): void {
  const directory = path.join(projectDirectory, 'app', 'src', 'main', 'res', 'values');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'strings.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">${escapeXml(displayName)}</string>\n</resources>\n`,
    'utf8',
  );
}

function writeLocalProperties(projectDirectory: string, sdkRoot: string): void {
  const escaped = path.resolve(sdkRoot).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  fs.writeFileSync(path.join(projectDirectory, 'local.properties'), `sdk.dir=${escaped}\n`, 'utf8');
}

function resolveArtwork(project: string, relativePath: string, label: string): string {
  const resourceRoot = fs.realpathSync.native(resolveRmmvLayout(project).resourceRoot);
  const candidate = path.resolve(resourceRoot, ...relativePath.replace(/\\/g, '/').split('/'));
  if (!isInside(resourceRoot, candidate) || candidate === resourceRoot) throw new Error(`${label} path must stay inside the game resource directory.`);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile() || fs.lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`${label} does not exist as a regular project file: ${relativePath}.`);
  }
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(candidate).toLowerCase())) {
    throw new Error(`${label} must be a PNG, JPEG, or WebP image.`);
  }
  return candidate;
}

function readGradleOutputMetadata(directory: string): Array<{ abi: AndroidAbi; outputFile: string; versionCode: number }> {
  const file = path.join(directory, 'output-metadata.json');
  if (!fs.existsSync(file)) throw new Error('Gradle did not produce output-metadata.json for the ABI APKs.');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    elements?: Array<{ filters?: Array<{ filterType?: string; value?: string }>; outputFile?: string; versionCode?: number }>;
  };
  if (!Array.isArray(value.elements)) throw new Error('Gradle APK output metadata is invalid.');
  return value.elements.map((element) => {
    const abi = element.filters?.find((filter) => filter.filterType === 'ABI')?.value;
    if (!abi || !Object.hasOwn(ABI_VERSION_OFFSETS, abi) || typeof element.outputFile !== 'string'
      || !Number.isSafeInteger(element.versionCode)) {
      throw new Error('Gradle produced an APK without a supported ABI and integer version mapping.');
    }
    return { abi: abi as AndroidAbi, outputFile: element.outputFile, versionCode: element.versionCode! };
  });
}

function assertApkBadging(output: string, applicationId: string, versionName: string, versionCode: number): void {
  const match = /package:\s+name='([^']+)'\s+versionCode='([^']+)'\s+versionName='([^']+)'/.exec(output);
  if (!match || match[1] !== applicationId || match[2] !== String(versionCode) || match[3] !== versionName) {
    throw new Error('aapt2 reported APK identity or version metadata that does not match the build preset.');
  }
}

function readCertificateSha256(output: string): string {
  const match = /Signer #1 certificate SHA-256 digest:\s*([A-Fa-f0-9:]+)/.exec(output);
  const digest = match?.[1]?.replace(/:/g, '').toLowerCase() || '';
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('apksigner did not report a valid signing certificate SHA-256 digest.');
  return digest;
}

async function runTool(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
  label: string,
  isCanceled?: () => boolean,
): Promise<string> {
  const result = await runGameBuildProcess(executable, args, {
    cwd,
    env: environment,
    maxBuffer: 64 * 1024 * 1024,
    isCanceled,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${redactGradleOutput(output) || `exit ${result.status}`}`);
  }
  return output;
}

function runToolSync(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
  label: string,
): string {
  const result = spawnSync(executable, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || redactGradleOutput(output) || `exit ${result.status}`}`);
  }
  return output;
}

function redactGradleOutput(value: string): string {
  return value.replace(/(storePassword|keyPassword|RPG_AGENT_ANDROID_[A-Z_]+)\s*[=:]\s*\S+/gi, '$1=[redacted]');
}

function androidHistoryKey(preset: GameBuildPreset): string {
  return `${preset.id}:${preset.android?.applicationId || ''}`;
}

function readLastSuccessfulBaseVersionCode(project: string, preset: GameBuildPreset): number | undefined {
  const directory = path.join(path.resolve(project), '.luna_rpg', 'release-history');
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return undefined;
  let maximum = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const report = JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8')) as {
        status?: unknown;
        target?: unknown;
        presetId?: unknown;
        runtime?: Record<string, unknown>;
      };
      const runtime = report.runtime;
      if (report.status !== 'success' || report.target !== 'android' || report.presetId !== preset.id
        || !runtime || runtime.androidApplicationId !== preset.android?.applicationId) continue;
      const value = Number(runtime.androidBaseVersionCode);
      if (Number.isSafeInteger(value) && value > maximum) maximum = value;
    } catch {
      // A malformed unrelated history record is handled when that specific report is opened.
    }
  }
  return maximum || undefined;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
