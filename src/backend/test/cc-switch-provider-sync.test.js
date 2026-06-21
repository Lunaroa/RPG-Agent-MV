import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildCandidatesFromOpencodePresets,
  readCcSwitchOpencodeProviderCandidates,
  resolveCcSwitchRoot,
  writeOpencodeProviderSeedFile,
} from '../src/core/llm/cc-switch-provider-sync.ts';
import { readProviderSeedFile } from '../src/core/llm/provider-seeds.ts';

const deepseekPreset = {
  name: 'DeepSeek',
  websiteUrl: 'https://platform.deepseek.com',
  settingsConfig: {
    npm: '@ai-sdk/openai-compatible',
    name: 'DeepSeek',
    options: { baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-deepseek' },
    models: {
      'deepseek-v4-pro': { name: 'DeepSeek V4 Pro' },
      'deepseek-v4-flash': { name: 'DeepSeek V4 Flash' },
    },
  },
};

describe('buildCandidatesFromOpencodePresets', () => {
  test('maps openai-compatible presets with baseUrl and models (no api key in patch)', () => {
    const result = buildCandidatesFromOpencodePresets([deepseekPreset]);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.errors.length, 0);

    const deepseek = result.candidates[0];
    assert.equal(deepseek.providerId, 'deepseek');
    assert.equal(deepseek.patch.label, 'DeepSeek');
    assert.equal(deepseek.patch.protocol, 'openai-compatible');
    assert.equal(deepseek.patch.baseUrl, 'https://api.deepseek.com/v1');
    assert.equal(deepseek.patch.credentialValue, undefined);
    assert.deepEqual(deepseek.patch.supportedEngines, ['opencode']);
    assert.equal(deepseek.patch.presetKind, 'cc-switch-opencode-preset');
    assert.equal(deepseek.patch.opencodeAuth?.envVar, 'OPENAI_API_KEY');
    assert.deepEqual(
      deepseek.patch.models.map((model) => model.id),
      ['deepseek-v4-pro', 'deepseek-v4-flash'],
    );
  });

  test('skips unsupported npm, missing baseURL, and omo category', () => {
    const result = buildCandidatesFromOpencodePresets([
      {
        name: 'Gemini',
        settingsConfig: {
          npm: '@ai-sdk/google',
          name: 'Gemini',
          options: { baseURL: 'https://g/v1', apiKey: 'k' },
        },
      },
      {
        name: 'NoBase',
        settingsConfig: {
          npm: '@ai-sdk/openai-compatible',
          name: 'NoBase',
          options: { apiKey: 'k' },
        },
      },
      {
        name: 'Oh My OpenCode',
        category: 'omo',
        settingsConfig: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Oh My OpenCode',
          options: { baseURL: 'https://omo.example/v1' },
        },
      },
    ]);

    assert.equal(result.candidates.length, 0);
    assert.deepEqual(
      result.skipped.map((item) => item.providerId).sort(),
      ['gemini', 'nobase', 'oh-my-opencode'],
    );
    assert.ok(result.skipped.find((item) => item.providerId === 'gemini')?.reason.startsWith('unsupported-npm:'));
    assert.equal(result.skipped.find((item) => item.providerId === 'nobase')?.reason, 'missing-baseURL');
    assert.equal(
      result.skipped.find((item) => item.providerId === 'oh-my-opencode')?.reason,
      'unsupported-category:omo',
    );
  });
});

describe('readCcSwitchOpencodeProviderCandidates', () => {
  test('accepts inline presets without touching cc-switch filesystem', async () => {
    const result = await readCcSwitchOpencodeProviderCandidates({ presets: [deepseekPreset] });
    assert.equal(result.sourcePath, 'inline-presets');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].providerId, 'deepseek');
  });

  test('fails fast when cc-switch preset source is missing', () => {
  const missing = path.join(os.tmpdir(), 'rmmv-ccswitch-missing-root');
  assert.throws(() => resolveCcSwitchRoot(missing), /provider preset file was not found/);
  });
});

describe('writeOpencodeProviderSeedFile (offline import)', () => {
  test('writes opencode presets into local seed file WITHOUT any key', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-seed-root-'));
    try {
      const result = await writeOpencodeProviderSeedFile(root, { presets: [deepseekPreset] });
      assert.equal(result.written, 1);
      assert.equal(result.sourcePath, 'inline-presets');

      const seed = readProviderSeedFile(root);
      assert.equal(seed.providers.length, 1);
      const deepseek = seed.providers[0];
      assert.equal(deepseek.id, 'deepseek');
      assert.equal(deepseek.protocol, 'openai-compatible');
      assert.equal(deepseek.baseUrl, 'https://api.deepseek.com/v1');
      assert.deepEqual(deepseek.supportedEngines, ['opencode']);
      assert.equal(deepseek.opencodeAuth?.envVar, 'OPENAI_API_KEY');

      const raw = fs.readFileSync(result.seedPath, 'utf8');
      assert.equal(raw.includes('sk-deepseek'), false);
      assert.equal(raw.includes('credentialValue'), false);
      assert.equal(raw.includes('apiKey'), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
