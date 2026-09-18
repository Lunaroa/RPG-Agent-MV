import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ANDROID_MINIMUM_SDK } from '../../../../contract/game-release.ts';

import type {
  AndroidKeystoreCreateRequest,
  AndroidKeystoreCreateResult,
  AndroidToolchainInstallRequest,
  AndroidToolchainStatus,
} from '../../../../contract/game-release.ts';
import { writeJsonAtomically } from './game-build-file-service.ts';
import { copyAndroidShellProject } from './game-android-shell-service.ts';
import { extractZipArchive } from './zip-extraction-service.ts';

export const ANDROID_TOOLCHAIN_VERSIONS = Object.freeze({
  jdk: '17.0.20.1',
  commandLineTools: '15859902',
  gradle: '9.4.1',
  buildTools: '36.0.0',
  compileSdk: 36,
  androidGradlePlugin: '9.2.1',
  webkit: '1.17.0',
});

const MANIFEST_NAME = 'rpg-agent-android-toolchain.json';
const TOOLCHAIN_SOURCES = [
  {
    id: 'jdk',
    fileName: 'microsoft-jdk-17.0.20.1-windows-x64.zip',
    url: 'https://aka.ms/download-jdk/microsoft-jdk-17.0.20.1-windows-x64.zip',
    sha256: '3d9006956fc8af5601cd24ffc4f468bef48279c7ebd8171b9bdf90d0aabfbf1f',
    licenseUrl: 'https://learn.microsoft.com/java/openjdk/faq#what-is-the-license-for-the-microsoft-build-of-openjdk',
  },
  {
    id: 'command-line-tools',
    fileName: 'commandlinetools-win-15859902_latest.zip',
    url: 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip',
    sha256: '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a',
    licenseUrl: 'https://developer.android.com/studio/terms',
  },
  {
    id: 'gradle',
    fileName: 'gradle-9.4.1-bin.zip',
    url: 'https://services.gradle.org/distributions/gradle-9.4.1-bin.zip',
    sha256: '2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb',
    licenseUrl: 'https://gradle.com/legal/terms-of-service/',
  },
] as const;

interface ToolchainManifest {
  schemaVersion: 1;
  installedAt: string;
  versions: typeof ANDROID_TOOLCHAIN_VERSIONS;
  sources: Array<{ id: string; url: string; sha256: string; licenseUrl: string }>;
  repositories: string[];
}

export function defaultAndroidToolchainRoot(workflowRoot: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'game-build', 'android');
}

export function inspectAndroidToolchain(workflowRoot: string, configuredRoot?: string): AndroidToolchainStatus {
  const root = path.resolve(configuredRoot || defaultAndroidToolchainRoot(workflowRoot));
  const javaExecutable = existingFile(path.join(root, 'jdk', 'bin', 'java.exe'));
  const sdkRootCandidate = path.join(root, 'sdk');
  const sdkRoot = fs.existsSync(sdkRootCandidate) && fs.statSync(sdkRootCandidate).isDirectory() ? sdkRootCandidate : null;
  const gradleExecutable = existingFile(path.join(root, 'gradle', 'bin', 'gradle.bat'));
  const gradleLauncherJar = existingFile(path.join(
    root, 'gradle', 'lib', `gradle-gradle-cli-main-${ANDROID_TOOLCHAIN_VERSIONS.gradle}.jar`,
  ));
  const adbExecutable = existingFile(path.join(sdkRootCandidate, 'platform-tools', 'adb.exe'));
  const sdkManagerExecutable = existingFile(path.join(
    sdkRootCandidate, 'cmdline-tools', ANDROID_TOOLCHAIN_VERSIONS.commandLineTools, 'bin', 'sdkmanager.bat',
  ));
  const sdkManagerClasspathJar = existingFile(path.join(
    sdkRootCandidate, 'cmdline-tools', ANDROID_TOOLCHAIN_VERSIONS.commandLineTools, 'lib', 'sdkmanager-classpath.jar',
  ));
  const buildTools = path.join(sdkRootCandidate, 'build-tools', ANDROID_TOOLCHAIN_VERSIONS.buildTools);
  const apkSignerExecutable = existingFile(path.join(buildTools, 'apksigner.bat'));
  const apkSignerJar = existingFile(path.join(buildTools, 'lib', 'apksigner.jar'));
  const aapt2Executable = existingFile(path.join(buildTools, 'aapt2.exe'));
  const platformJar = existingFile(path.join(
    sdkRootCandidate, 'platforms', `android-${ANDROID_TOOLCHAIN_VERSIONS.compileSdk}`, 'android.jar',
  ));
  const dependencyVerification = existingFile(path.join(root, 'gradle-verification-metadata.xml'));
  const debugIdentity = existingFile(path.join(root, 'identities', 'debug.keystore'));
  const missing: string[] = [];
  const manifest = readManifest(path.join(root, MANIFEST_NAME));
  if (!manifest) missing.push('managed toolchain manifest');
  else if (JSON.stringify(manifest.versions) !== JSON.stringify(ANDROID_TOOLCHAIN_VERSIONS)) {
    missing.push('expected managed toolchain versions');
  }
  if (!javaExecutable) missing.push(`JDK ${ANDROID_TOOLCHAIN_VERSIONS.jdk}`);
  if (!sdkManagerExecutable || !sdkManagerClasspathJar) missing.push(`Android command-line tools ${ANDROID_TOOLCHAIN_VERSIONS.commandLineTools}`);
  if (!platformJar) missing.push(`Android platform ${ANDROID_TOOLCHAIN_VERSIONS.compileSdk}`);
  if (!apkSignerExecutable || !apkSignerJar || !aapt2Executable) missing.push(`Android build tools ${ANDROID_TOOLCHAIN_VERSIONS.buildTools}`);
  if (!gradleExecutable || !gradleLauncherJar) missing.push(`Gradle ${ANDROID_TOOLCHAIN_VERSIONS.gradle}`);
  if (!adbExecutable) missing.push('Android platform tools (adb)');
  if (!dependencyVerification) missing.push('verified Android Gradle dependency cache');
  if (!debugIdentity) missing.push('managed Android debug signing identity');
  return {
    configured: missing.length === 0,
    root,
    javaExecutable,
    sdkRoot,
    gradleExecutable,
    gradleLauncherJar,
    adbExecutable,
    sdkManagerExecutable,
    sdkManagerClasspathJar,
    apkSignerExecutable,
    apkSignerJar,
    aapt2Executable,
    versions: { ...ANDROID_TOOLCHAIN_VERSIONS },
    missing,
  };
}

export async function installAndroidToolchain(
  workflowRoot: string,
  request: AndroidToolchainInstallRequest,
): Promise<AndroidToolchainStatus> {
  if (!request || request.acceptAndroidSdkLicense !== true) {
    throw new Error('Accept the Android SDK license before installing the managed Android toolchain.');
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('The managed Android toolchain installer currently supports Windows x64 only.');
  }
  const root = path.resolve(request.root || defaultAndroidToolchainRoot(workflowRoot));
  assertReplaceableToolchainRoot(root);
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const staging = `${root}.install-${crypto.randomUUID()}`;
  const downloads = path.join(staging, 'downloads');
  const extracted = path.join(staging, 'extracted');
  fs.mkdirSync(downloads, { recursive: true });
  try {
    for (const source of TOOLCHAIN_SOURCES) {
      const archive = path.join(downloads, source.fileName);
      await downloadVerified(source.url, archive, source.sha256);
      extractZipArchive(archive, path.join(extracted, source.id));
    }
    moveSingleRoot(path.join(extracted, 'jdk'), path.join(staging, 'jdk'));
    moveSingleRoot(path.join(extracted, 'gradle'), path.join(staging, 'gradle'));
    const commandToolsSource = path.join(extracted, 'command-line-tools', 'cmdline-tools');
    if (!fs.existsSync(path.join(commandToolsSource, 'bin', 'sdkmanager.bat'))) {
      throw new Error('The Android command-line tools archive has an unexpected directory layout.');
    }
    const commandToolsTarget = path.join(
      staging, 'sdk', 'cmdline-tools', ANDROID_TOOLCHAIN_VERSIONS.commandLineTools,
    );
    fs.mkdirSync(path.dirname(commandToolsTarget), { recursive: true });
    fs.renameSync(commandToolsSource, commandToolsTarget);
    fs.rmSync(downloads, { recursive: true, force: true });
    fs.rmSync(extracted, { recursive: true, force: true });

    const javaHome = path.join(staging, 'jdk');
    const sdkRoot = path.join(staging, 'sdk');
    const sdkManagerClasspath = path.join(commandToolsTarget, 'lib', 'sdkmanager-classpath.jar');
    const environment = {
      ...process.env,
      JAVA_HOME: javaHome,
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
    };
    const sdkManagerPrefix = [
      `-Dcom.android.sdklib.toolsdir=${commandToolsTarget}`,
      '-classpath', sdkManagerClasspath,
      'com.android.sdklib.tool.sdkmanager.SdkManagerCli',
    ];
    runTool(path.join(javaHome, 'bin', 'java.exe'), [...sdkManagerPrefix, `--sdk_root=${sdkRoot}`, '--licenses'], environment, 'y\n'.repeat(100));
    runTool(path.join(javaHome, 'bin', 'java.exe'), [...sdkManagerPrefix,
      `--sdk_root=${sdkRoot}`,
      'platform-tools',
      `platforms;android-${ANDROID_TOOLCHAIN_VERSIONS.compileSdk}`,
      `build-tools;${ANDROID_TOOLCHAIN_VERSIONS.buildTools}`,
    ], environment);
    const java = path.join(javaHome, 'bin', 'java.exe');
    assertOutput(runTool(java, ['-version'], environment), /version "17\./, 'managed JDK 17');
    assertOutput(runGradle(staging, java, ['--version', '--no-daemon'], environment), /Gradle 9\.4\.1/, 'Gradle 9.4.1');
    prepareGradleDependencies(staging, environment);
    const manifest: ToolchainManifest = {
      schemaVersion: 1,
      installedAt: new Date().toISOString(),
      versions: { ...ANDROID_TOOLCHAIN_VERSIONS },
      sources: TOOLCHAIN_SOURCES.map(({ id, url, sha256, licenseUrl }) => ({ id, url, sha256, licenseUrl })),
      repositories: [
        'https://dl.google.com/dl/android/maven2/',
        'https://repo.maven.apache.org/maven2/',
        'https://plugins.gradle.org/m2/',
      ],
    };
    writeJsonAtomically(path.join(staging, MANIFEST_NAME), manifest);
    publishToolchain(staging, root);
    const status = inspectAndroidToolchain(workflowRoot, root);
    if (!status.configured) throw new Error(`Managed Android toolchain installation is incomplete: ${status.missing.join(', ')}.`);
    return status;
  } catch (error) {
    // Keep a fully verified installation if publication fails; it can be recovered without downloading again.
    if (fs.existsSync(staging) && !fs.existsSync(path.join(staging, MANIFEST_NAME))) {
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Android toolchain installation failed: ${error instanceof Error ? error.message : String(error)}. Temporary file cleanup also failed.`);
      }
    }
    throw error;
  }
}

export function createAndroidReleaseKeystore(
  workflowRoot: string,
  configuredRoot: string | undefined,
  project: string,
  destination: string,
  request: AndroidKeystoreCreateRequest,
): AndroidKeystoreCreateResult {
  const toolchain = inspectAndroidToolchain(workflowRoot, configuredRoot);
  if (!toolchain.configured || !toolchain.javaExecutable) {
    throw new Error(`Install the complete managed Android toolchain before creating a release signing file. Missing: ${toolchain.missing.join(', ')}.`);
  }
  const keytool = path.join(path.dirname(toolchain.javaExecutable), 'keytool.exe');
  if (!fs.existsSync(keytool) || !fs.statSync(keytool).isFile()) {
    throw new Error('The managed JDK keytool is missing. Reinstall the Android toolchain.');
  }
  const alias = requireKeystoreAlias(request?.alias);
  const storePassword = requireKeystorePassword(request?.storePassword, 'keystore password');
  const keyPassword = requireKeystorePassword(request?.keyPassword, 'key password');
  const commonName = requireCommonName(request?.commonName);
  const target = path.resolve(destination);
  if (!['.jks', '.keystore'].includes(path.extname(target).toLowerCase())) {
    throw new Error('A new Android signing file must use the .jks or .keystore extension.');
  }
  const projectRoot = fs.realpathSync.native(path.resolve(project));
  if (isInside(projectRoot, target)) {
    throw new Error('Choose a signing-file location outside the game project so the private key cannot enter the game or its Git history.');
  }
  if (fs.existsSync(target)) {
    throw new Error('The selected signing file already exists. Choose a new file name; RPG Agent MV will not overwrite a signing identity.');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  const environment = {
    ...process.env,
    RPG_AGENT_ANDROID_STORE_PASSWORD: storePassword,
    RPG_AGENT_ANDROID_KEY_PASSWORD: keyPassword,
  };
  try {
    runTool(keytool, [
      '-genkeypair', '-noprompt', '-storetype', 'JKS', '-keystore', temporary,
      '-storepass:env', 'RPG_AGENT_ANDROID_STORE_PASSWORD',
      '-keypass:env', 'RPG_AGENT_ANDROID_KEY_PASSWORD',
      '-alias', alias, '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA',
      '-validity', '10000', '-dname', `CN=${escapeDistinguishedNameValue(commonName)},O=RPG Agent MV,C=XX`,
    ], environment);
    const exported = runTool(keytool, [
      '-exportcert', '-rfc', '-keystore', temporary,
      '-storepass:env', 'RPG_AGENT_ANDROID_STORE_PASSWORD', '-alias', alias,
    ], environment);
    const pem = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(exported)?.[0];
    if (!pem) throw new Error('The new Android signing certificate could not be verified.');
    const certificateSha256 = new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(certificateSha256)) {
      throw new Error('The new Android signing certificate has an invalid SHA-256 fingerprint.');
    }
    fs.renameSync(temporary, target);
    return { path: target, alias, certificateSha256 };
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function prepareGradleDependencies(root: string, environment: NodeJS.ProcessEnv): void {
  const project = path.join(root, 'dependency-bootstrap');
  copyAndroidShellProject(project);
  const app = path.join(project, 'app');
  writeJsonAtomically(path.join(app, 'rpg-agent-build.json'), {
    schemaVersion: 1,
    applicationId: 'org.rpgagent.bootstrap',
    versionName: '1.0.0',
    versionCode: 1,
    minSdk: ANDROID_MINIMUM_SDK,
    targetSdk: ANDROID_TOOLCHAIN_VERSIONS.compileSdk,
    orientation: 'landscape',
    allowCleartext: false,
    abis: ['arm64-v8a'],
    abiVersionOffsets: { 'armeabi-v7a': 2, x86_64: 3, 'arm64-v8a': 4 },
  });
  const escapedSdk = path.join(root, 'sdk').replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  fs.writeFileSync(path.join(project, 'local.properties'), `sdk.dir=${escapedSdk}\n`, 'utf8');
  writeBootstrapResources(project);
  const identityDirectory = path.join(root, 'identities');
  const debugKeystore = path.join(identityDirectory, 'debug.keystore');
  fs.mkdirSync(identityDirectory, { recursive: true });
  const debugEnvironment = { ...environment, RPG_AGENT_DEBUG_KEYSTORE_PASSWORD: 'android' };
  runTool(path.join(root, 'jdk', 'bin', 'keytool.exe'), [
    '-genkeypair', '-noprompt', '-keystore', debugKeystore,
    '-storepass:env', 'RPG_AGENT_DEBUG_KEYSTORE_PASSWORD', '-keypass:env', 'RPG_AGENT_DEBUG_KEYSTORE_PASSWORD',
    '-alias', 'rpg-agent-debug', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-dname', 'CN=RPG Agent MV Debug,O=RPG Agent MV,C=XX',
  ], debugEnvironment);
  const gradleEnvironment = {
    ...environment,
    GRADLE_USER_HOME: path.join(root, 'gradle-cache'),
    RPG_AGENT_ANDROID_STORE_FILE: debugKeystore,
    RPG_AGENT_ANDROID_STORE_PASSWORD: 'android',
    RPG_AGENT_ANDROID_KEY_ALIAS: 'rpg-agent-debug',
    RPG_AGENT_ANDROID_KEY_PASSWORD: 'android',
  };
  const java = path.join(root, 'jdk', 'bin', 'java.exe');
  const launcher = path.join(root, 'gradle', 'lib', `gradle-gradle-cli-main-${ANDROID_TOOLCHAIN_VERSIONS.gradle}.jar`);
  const result = spawnSync(java, [
    '-Dorg.gradle.appname=gradle', '-classpath', launcher, 'org.gradle.launcher.GradleMain',
    ':app:assembleDebug', '--no-daemon', '--console=plain', '--write-verification-metadata', 'sha256',
  ], {
    cwd: project,
    encoding: 'utf8',
    env: gradleEnvironment,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error || result.status !== 0) {
    throw new Error(`Android build dependencies could not be prepared: ${result.error?.message || output || `exit ${result.status}`}`);
  }
  const verification = path.join(project, 'gradle', 'verification-metadata.xml');
  if (!fs.existsSync(verification)) throw new Error('Gradle did not generate dependency verification metadata.');
  fs.copyFileSync(verification, path.join(root, 'gradle-verification-metadata.xml'));
  // A single-use daemon can still be shutting down after its launcher exits on Windows.
  runGradle(root, java, ['--stop'], gradleEnvironment);
  fs.rmSync(project, { recursive: true, force: false });
}

function runGradle(root: string, java: string, args: string[], environment: NodeJS.ProcessEnv): string {
  const launcher = path.join(root, 'gradle', 'lib', `gradle-gradle-cli-main-${ANDROID_TOOLCHAIN_VERSIONS.gradle}.jar`);
  return runTool(java, [
    '-Dorg.gradle.appname=gradle', '-classpath', launcher, 'org.gradle.launcher.GradleMain', ...args,
  ], environment);
}

function writeBootstrapResources(project: string): void {
  const values = path.join(project, 'app', 'src', 'main', 'res', 'values');
  fs.mkdirSync(values, { recursive: true });
  fs.writeFileSync(path.join(values, 'strings.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources><string name="app_name">RPG Agent Bootstrap</string></resources>\n', 'utf8');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  for (const directory of ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi']) {
    const target = path.join(project, 'app', 'src', 'main', 'res', directory);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'app_icon.png'), png);
  }
  const drawable = path.join(project, 'app', 'src', 'main', 'res', 'drawable-nodpi');
  fs.mkdirSync(drawable, { recursive: true });
  fs.writeFileSync(path.join(drawable, 'splash.png'), png);
  const game = path.join(project, 'app', 'src', 'main', 'assets', 'game');
  fs.mkdirSync(path.join(game, '.rpg-agent'), { recursive: true });
  fs.writeFileSync(path.join(game, 'index.html'), '<!doctype html><title>bootstrap</title>\n', 'utf8');
  writeJsonAtomically(path.join(game, '.rpg-agent', 'current-release.json'), {
    schemaVersion: 1,
    releaseId: 'bootstrap',
    gameId: 'bootstrap',
    version: '1.0.0',
    channel: 'bootstrap',
  });
}

async function downloadVerified(url: string, destination: string, expectedSha256: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Toolchain download failed with HTTP ${response.status}: ${url}.`);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const output = fs.createWriteStream(temporary, { flags: 'wx' });
  const hash = crypto.createHash('sha256');
  let streamError: Error | null = null;
  output.once('error', (error) => { streamError = error; });
  try {
    for await (const chunk of response.body) {
      if (streamError) throw streamError;
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      if (!output.write(buffer)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            output.off('error', onError);
            resolve();
          };
          const onError = (error: Error) => {
            output.off('drain', onDrain);
            reject(error);
          };
          output.once('drain', onDrain);
          output.once('error', onError);
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      output.once('error', onError);
      output.end(() => {
        output.off('error', onError);
        resolve();
      });
    });
    if (streamError) throw streamError;
    const actual = hash.digest('hex');
    if (actual !== expectedSha256) throw new Error(`Toolchain download SHA-256 mismatch for ${url}.`);
    fs.renameSync(temporary, destination);
  } finally {
    output.destroy();
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function runTool(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  input?: string,
): string {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: environment,
    input,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error || result.status !== 0) {
    throw new Error(`Android toolchain command failed: ${result.error?.message || output || `exit ${result.status}`}`);
  }
  return output;
}

function assertOutput(value: string, expected: RegExp, label: string): void {
  if (!expected.test(value)) throw new Error(`${label} validation returned unexpected output.`);
}

function moveSingleRoot(source: string, target: string): void {
  const entries = fs.readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) throw new Error(`Toolchain archive has an unexpected root layout: ${source}.`);
  fs.renameSync(path.join(source, entries[0]!.name), target);
}

function publishToolchain(staging: string, root: string): void {
  const backup = `${root}.previous-${crypto.randomUUID()}`;
  if (fs.existsSync(root)) fs.renameSync(root, backup);
  try {
    fs.renameSync(staging, root);
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: false });
  } catch (error) {
    if (!fs.existsSync(root) && fs.existsSync(backup)) fs.renameSync(backup, root);
    throw error;
  }
}

function assertReplaceableToolchainRoot(root: string): void {
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || resolved === path.dirname(resolved)) throw new Error('Android toolchain root is too broad.');
  if (!fs.existsSync(resolved)) return;
  if (!fs.statSync(resolved).isDirectory() || !readManifest(path.join(resolved, MANIFEST_NAME))) {
    throw new Error('The selected Android toolchain folder already exists and is not managed by RPG Agent MV.');
  }
}

function readManifest(file: string): ToolchainManifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ToolchainManifest;
    return value?.schemaVersion === 1 && value.versions && Array.isArray(value.sources) ? value : null;
  } catch {
    return null;
  }
}

function existingFile(file: string): string | null {
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function requireKeystoreAlias(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(value)) {
    throw new Error('The Android key alias must use 1-128 ASCII letters, numbers, dots, underscores, or hyphens.');
  }
  return value;
}

function requireKeystorePassword(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 6 || value.length > 1024 || /[\r\n\0]/.test(value)) {
    throw new Error(`The Android ${label} must contain 6-1024 characters without line breaks.`);
  }
  return value;
}

function requireCommonName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\r\n\0]/.test(value)) {
    throw new Error('The Android signing identity name must contain 1-128 characters without line breaks.');
  }
  return value.trim();
}

function escapeDistinguishedNameValue(value: string): string {
  return value.replace(/([\\,+"<>;=])/g, '\\$1').replace(/^ /, '\\ ').replace(/ $/, '\\ ');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
