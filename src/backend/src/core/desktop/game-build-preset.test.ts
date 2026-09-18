import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createDefaultGameReleaseProjectSettings,
  validateGameBuildPreset,
  validateGameReleaseProjectSettings,
} from './game-build-preset.ts';

test('creates a valid simple Web preset without copying the game version', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-preset-'));
  try {
    const settings = createDefaultGameReleaseProjectSettings(project);
    assert.deepEqual(validateGameReleaseProjectSettings(settings), settings);
    assert.equal(settings.presets[0]?.target, 'web');
    assert.equal('version' in (settings.presets[0] as object), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('rejects incomplete delta, encryption, upload, and Android configurations', () => {
  const base = {
    id: 'web-release',
    name: 'Web release',
    target: 'web',
    architecture: 'web',
    channel: 'stable',
    outputDirectory: 'builds',
    zip: true,
    packageType: 'full',
    processing: { images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'none', ui: 'none' },
  };
  assert.throws(() => validateGameBuildPreset({ ...base, packageType: 'file-delta' }), /baseReleaseId/);
  assert.throws(() => validateGameBuildPreset({
    ...base,
    processing: { ...base.processing, data: 'encrypt' },
  }), /encryptionKeyId/);
  assert.throws(() => validateGameBuildPreset({
    ...base,
    upload: { enabled: true, adapter: 'webdav', baseUrl: '', authorization: 'none' },
  }), /baseUrl/);
  assert.throws(() => validateGameBuildPreset({
    ...base,
    target: 'android',
    architecture: 'per-abi',
  }), /android is required/);
});

test('validates per-ABI Android release signing without accepting secrets', () => {
  const preset = validateGameBuildPreset({
    id: 'android-release',
    name: 'Android release',
    target: 'android',
    architecture: 'per-abi',
    channel: 'stable',
    outputDirectory: 'builds',
    zip: false,
    packageType: 'full',
    processing: { images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'none', ui: 'none' },
    android: {
      applicationId: 'com.example.sample',
      displayName: 'Sample',
      versionCode: 12,
      orientation: 'landscape',
      minSdk: 24,
      targetSdk: 35,
      abis: ['arm64-v8a', 'x86_64'],
      iconRelativePath: 'icon/icon.png',
      signing: 'release',
      keystorePath: 'signing/release.jks',
      keyAlias: 'release',
      signingCredentialId: 'android-release',
    },
  });
  assert.deepEqual(preset.android?.abis, ['arm64-v8a', 'x86_64']);
  assert.equal(JSON.stringify(preset).includes('password'), false);
});

test('keeps inactive Android configuration and an incomplete publication draft when switching targets', () => {
  const settings = validateGameReleaseProjectSettings({
    presets: [{
      id: 'web-release',
      name: 'Web release',
      target: 'web',
      architecture: 'web',
      channel: 'stable',
      outputDirectory: 'builds',
      zip: false,
      packageType: 'full',
      processing: { images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'none', ui: 'none' },
      android: {
        applicationId: 'com.example.sample',
        displayName: 'Sample',
        versionCode: 3,
        orientation: 'landscape',
        minSdk: 23,
        targetSdk: 35,
        abis: ['arm64-v8a'],
        iconRelativePath: 'icon/icon.png',
        signing: 'debug',
      },
    }],
    selectedPresetId: 'web-release',
    publicationDraft: {
      defaultLanguage: 'en-US',
      locales: [{ language: 'en-US', title: 'Sample', summary: '', maintenance: '' }],
      required: false,
    },
  });
  assert.equal(settings.presets[0]?.android?.versionCode, 3);
  assert.equal(settings.publicationDraft?.locales[0]?.summary, '');
  const preset = settings.presets[0]!;
  preset.android!.iconRelativePath = '';
  preset.android!.signing = 'release';
  assert.equal(validateGameBuildPreset(preset).android?.iconRelativePath, '');
  assert.throws(() => validateGameBuildPreset({ ...preset, target: 'android', architecture: 'per-abi' }), /iconRelativePath/);
  preset.android!.iconRelativePath = 'icon/icon.png';
  assert.throws(() => validateGameBuildPreset({ ...preset, target: 'android', architecture: 'per-abi' }), /release signing requires/);
});
