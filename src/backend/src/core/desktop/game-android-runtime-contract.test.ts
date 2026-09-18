import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ANDROID_SHELL_REQUIRED_FILES, assertAndroidShellTemplate } from './game-android-shell-service.ts';
import {
  ANDROID_TOOLCHAIN_VERSIONS,
  inspectAndroidToolchain,
  installAndroidToolchain,
} from './game-android-toolchain-service.ts';

test('managed Android shell fixes one WebView stack and contains content and APK update bridges', () => {
  assert.doesNotThrow(() => assertAndroidShellTemplate());
  assert.ok(ANDROID_SHELL_REQUIRED_FILES.length >= 10);
  const root = path.join(import.meta.dirname, 'game-android-runtime');
  const gradle = fs.readFileSync(path.join(root, 'app', 'build.gradle'), 'utf8');
  assert.match(gradle, /androidx\.webkit:webkit:1\.17\.0/);
  assert.match(gradle, /androidComponents/);
  assert.doesNotMatch(gradle, /applicationVariants/);
  assert.doesNotMatch(gradle, /outputFileName/);
  assert.doesNotMatch(gradle, /cordova|capacitor/i);
  const state = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'org', 'rpgagent', 'runtime', 'ContentStateStore.java'), 'utf8');
  assert.match(state, /Os\.rename/);
  assert.match(state, /pending/);
  assert.match(state, /boolean isPackagedContentActive\(\)/);
  const pathHandler = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'org', 'rpgagent', 'runtime', 'ActiveContentPathHandler.java'), 'utf8');
  assert.match(pathHandler, /else if \(state\.isPackagedContentActive\(\)\)/);
  assert.match(pathHandler, /else return null;/);
  const apk = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'org', 'rpgagent', 'runtime', 'ApkUpdateManager.java'), 'utf8');
  assert.match(apk, /PackageInstaller/);
  assert.match(apk, /signingCertificateSha256/);
  assert.match(apk, /progress\.onProgress\("downloading"/);
  const content = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'org', 'rpgagent', 'runtime', 'ContentUpdateManager.java'), 'utf8');
  assert.match(content, /progress\.onProgress\("verifying"/);
  assert.match(content, /progress\.onProgress\("complete"/);
  const activity = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'org', 'rpgagent', 'runtime', 'GameActivity.java'), 'utf8');
  assert.match(activity, /RPGAgentUpdater\.handleNativeEvent/);
  const receiver = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'org', 'rpgagent', 'runtime', 'InstallResultReceiver.java'), 'utf8');
  assert.match(receiver, /dispatchInstallResult\("error"/);
  const bridge = fs.readFileSync(path.join(root, 'app', 'src', 'main', 'java', 'org', 'rpgagent', 'runtime', 'RPGAgentBridge.java'), 'utf8');
  assert.match(bridge, /PROGRESS_INTERVAL_MS/);
  assert.match(bridge, /received < total/);
});

test('Android asset packaging preserves release metadata and game asset directories', () => {
  const gradle = fs.readFileSync(path.join(import.meta.dirname, 'game-android-runtime', 'app', 'build.gradle'), 'utf8');
  const configured = gradle.match(/ignoreAssetsPattern\s+'([^']+)'/);
  assert.ok(configured, 'The shell must explicitly preserve its hidden release metadata.');
  const patterns = configured[1]!.split(':');
  assert.ok(patterns.includes('!.git'));
  assert.ok(patterns.includes('!.svn'));
  assert.ok(!patterns.includes('.*'));
  assert.ok(!patterns.includes('<dir>_*'));
});

test('Android toolchain status requires the pinned managed layout and verified dependency cache', () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-android-toolchain-'));
  const root = path.join(workflowRoot, 'managed-android');
  try {
    const missing = inspectAndroidToolchain(workflowRoot, root);
    assert.equal(missing.configured, false);
    assert.ok(missing.missing.includes('verified Android Gradle dependency cache'));
    for (const relativePath of [
      'jdk/bin/java.exe',
      'sdk/platform-tools/adb.exe',
      `sdk/cmdline-tools/${ANDROID_TOOLCHAIN_VERSIONS.commandLineTools}/bin/sdkmanager.bat`,
      `sdk/platforms/android-${ANDROID_TOOLCHAIN_VERSIONS.compileSdk}/android.jar`,
      `sdk/build-tools/${ANDROID_TOOLCHAIN_VERSIONS.buildTools}/apksigner.bat`,
      `sdk/build-tools/${ANDROID_TOOLCHAIN_VERSIONS.buildTools}/lib/apksigner.jar`,
      `sdk/build-tools/${ANDROID_TOOLCHAIN_VERSIONS.buildTools}/aapt2.exe`,
      'gradle/bin/gradle.bat',
      `gradle/lib/gradle-gradle-cli-main-${ANDROID_TOOLCHAIN_VERSIONS.gradle}.jar`,
      `sdk/cmdline-tools/${ANDROID_TOOLCHAIN_VERSIONS.commandLineTools}/lib/sdkmanager-classpath.jar`,
      'gradle-verification-metadata.xml',
      'identities/debug.keystore',
    ]) write(root, relativePath, 'fixture');
    write(root, 'rpg-agent-android-toolchain.json', `${JSON.stringify({
      schemaVersion: 1,
      installedAt: new Date(0).toISOString(),
      versions: ANDROID_TOOLCHAIN_VERSIONS,
      sources: [],
      repositories: [],
    })}\n`);
    const ready = inspectAndroidToolchain(workflowRoot, root);
    assert.equal(ready.configured, true, ready.missing.join(', '));
    assert.equal(ready.versions.androidGradlePlugin, '9.2.1');
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test('APK update session closes write streams before committing installation', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'game-android-runtime', 'app', 'src', 'main',
    'java', 'org', 'rpgagent', 'runtime', 'ApkUpdateManager.java'), 'utf8');
  const commit = source.slice(source.indexOf('    private void commit('), source.indexOf('    private PackageInfo packageArchiveInfo('));
  assert.match(commit, /try \(PackageInstaller\.Session session = installer\.openSession\(sessionId\)\) \{\s*try \(InputStream input = new FileInputStream\(apk\);/);
  assert.match(commit, /session\.fsync\(output\);\s*\}\s*Intent result =/);
  assert.ok(commit.indexOf('session.commit(') > commit.indexOf('session.fsync(output);'));
});

test('APK installation status stays mutable on every supported Android API', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'game-android-runtime', 'app', 'src', 'main',
    'java', 'org', 'rpgagent', 'runtime', 'ApkUpdateManager.java'), 'utf8');
  const commit = source.slice(source.indexOf('    private void commit('), source.indexOf('    private PackageInfo packageArchiveInfo('));
  assert.match(commit, /new Intent\(activity, InstallResultReceiver\.class\)/);
  assert.match(commit, /int flags = PendingIntent\.FLAG_UPDATE_CURRENT;/);
  assert.match(commit, /if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S\) flags \|= PendingIntent\.FLAG_MUTABLE;/);
  assert.doesNotMatch(commit, /FLAG_IMMUTABLE/);
});

test('Android toolchain publication stops its isolated Gradle daemon and retains verified failures', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'game-android-toolchain-service.ts'), 'utf8');
  const preparation = source.slice(source.indexOf('function prepareGradleDependencies('), source.indexOf('function runGradle('));
  assert.match(preparation, /GRADLE_USER_HOME: path\.join\(root, 'gradle-cache'\)/);
  assert.match(preparation, /runGradle\(root, java, \['--stop'\], gradleEnvironment\);\s*fs\.rmSync\(project/);
  assert.match(source, /!fs\.existsSync\(path\.join\(staging, MANIFEST_NAME\)\)/);
  assert.match(source, /new AggregateError\(\[error, cleanupError\]/);
});

test('managed toolchain installation refuses to start without explicit Android SDK license acceptance', async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-android-license-'));
  try {
    await assert.rejects(
      installAndroidToolchain(workflowRoot, { acceptAndroidSdkLicense: false }),
      /Accept the Android SDK license/,
    );
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
