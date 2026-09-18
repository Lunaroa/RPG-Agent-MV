import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { GameBuildPreset, GameReleaseProjectSettings } from '../../../../contract/game-release.ts';
import { preflightAndroidBuild, recordAndroidBuildSuccess } from './game-android-build-service.ts';
import { defaultProcessing, validateGameReleaseProjectSettings } from './game-build-preset.ts';
import { readGameBuildSettings, saveGameBuildSettings } from './game-build-service.ts';
import { ANDROID_TOOLCHAIN_VERSIONS } from './game-android-toolchain-service.ts';

test('Android preflight enforces managed toolchain, artwork, and monotonically increasing base versionCode', () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-android-preflight-'));
  const project = path.join(workflowRoot, 'projects', 'sample');
  const toolchain = path.join(workflowRoot, 'runtime', 'game-build', 'android');
  try {
    write(project, 'data/System.json', '{}');
    write(project, 'icon.png', 'image fixture');
    createToolchain(toolchain);
    const preset = androidPreset(project);
    const settings: GameReleaseProjectSettings = {
      presets: [preset],
      selectedPresetId: preset.id,
      androidToolchainRoot: toolchain,
    };
    const first = preflightAndroidBuild(workflowRoot, project, settings, preset);
    assert.deepEqual(first.blockers, []);

    write(project, '.luna_rpg/release-history/release-1.json', `${JSON.stringify({
      schemaVersion: 1,
      status: 'success',
      target: 'android',
      presetId: preset.id,
      runtime: {
        androidApplicationId: preset.android!.applicationId,
        androidBaseVersionCode: String(preset.android!.versionCode),
      },
    })}\n`);
    const repeated = preflightAndroidBuild(workflowRoot, project, settings, preset);
    assert.ok(repeated.blockers.some((item) => item.includes('must be greater than')));

    preset.android!.newApplication = true;
    const newApplication = preflightAndroidBuild(workflowRoot, project, settings, preset);
    assert.equal(newApplication.blockers.some((item) => item.includes('versionCode')), false);
    assert.ok(newApplication.warnings.some((item) => item.includes('new application')));
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test('successful Android build history advances the preset default without changing the completed build value', () => {
  const preset = androidPreset(os.tmpdir());
  preset.android!.versionCode = 12;
  const settings: GameReleaseProjectSettings = { presets: [preset], selectedPresetId: preset.id };
  const next = recordAndroidBuildSuccess(settings, preset);
  assert.equal(preset.android!.versionCode, 12);
  assert.equal(next.presets[0]!.android!.versionCode, 13);
  assert.equal(next.lastSuccessfulAndroidVersionCodes?.[`${preset.id}:${preset.android!.applicationId}`], 12);
});

test('Android preflight rejects legacy minimum SDK without rewriting the preset', () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-android-minimum-'));
  const project = path.join(workflowRoot, 'projects', 'sample');
  try {
    write(project, 'data/System.json', '{}');
    write(project, 'icon.png', 'image fixture');
    createToolchain(path.join(workflowRoot, 'runtime', 'game-build', 'android'));
    const preset = androidPreset(project);
    const settings: GameReleaseProjectSettings = { presets: [preset], selectedPresetId: preset.id };
    preset.android!.minSdk = 23;
    const legacy = preflightAndroidBuild(workflowRoot, project, settings, preset);
    assert.ok(legacy.blockers.some(item => item.includes('minSdk 24')));
    assert.equal(preset.android!.minSdk, 23);
    preset.android!.minSdk = 24;
    assert.deepEqual(preflightAndroidBuild(workflowRoot, project, settings, preset).blockers, []);
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test('successful Android build history persists and reloads its next versionCode', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-android-history-'));
  try {
    const preset = androidPreset(project);
    const settings = { presets: [preset], selectedPresetId: preset.id };
    const next = recordAndroidBuildSuccess(settings, preset);
    saveGameBuildSettings(project, next);
    const reloaded = readGameBuildSettings(project);
    assert.equal(reloaded.presets[0]!.android!.versionCode, preset.android!.versionCode + 1);
    assert.deepEqual(reloaded.lastSuccessfulAndroidVersionCodes, next.lastSuccessfulAndroidVersionCodes);
    for (const key of ['missing-separator', 'preset:org.example.game:extra', '../preset:org.example.game', 'preset:invalid']) {
      assert.throws(() => validateGameReleaseProjectSettings({ ...settings, lastSuccessfulAndroidVersionCodes: { [key]: 1 } }));
    }
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

function androidPreset(project: string): GameBuildPreset {
  return {
    id: 'android-release',
    name: 'Android release',
    target: 'android',
    architecture: 'per-abi',
    channel: 'stable',
    outputDirectory: path.join(project, '.luna_rpg', 'builds'),
    zip: false,
    packageType: 'full',
    processing: defaultProcessing(),
    android: {
      applicationId: 'org.example.game',
      displayName: 'Sample Game',
      versionCode: 7,
      orientation: 'landscape',
      minSdk: 24,
      targetSdk: 36,
      abis: ['arm64-v8a'],
      iconRelativePath: 'icon.png',
      signing: 'debug',
    },
  };
}

function createToolchain(root: string): void {
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
}

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
