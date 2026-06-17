import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { bootstrapDatabase } from '../src/core/db/bootstrap.ts';
import { closeDatabase } from '../src/core/db/pool.ts';
import {
  ensureProviderSeedsInitialized,
  readProviderSeedFile,
  refreshProviderSeedCatalogFields,
  syncProviderSeeds,
  writeProviderSeedFile,
} from '../src/core/llm/provider-seeds.ts';
import * as providerRegistry from '../src/core/llm/provider-registry.ts';

const repoWorkspace = path.resolve(import.meta.dirname, '..', '..', '..');

const OPENCODE_SEED = [
  {
    id: 'env-deepseek-openai',
    label: 'DeepSeek',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }],
    supportedEngines: ['opencode'],
    opencodeAuth: { enabled: true, envVar: 'OPENAI_API_KEY' },
  },
  {
    id: 'env-kimi-openai',
    label: 'Kimi',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [{ id: 'kimi-k2.6', label: 'Kimi K2.6' }],
    supportedEngines: ['opencode'],
    opencodeAuth: { enabled: true, envVar: 'OPENAI_API_KEY' },
  },
];

describe('provider seed sync', () => {
  test('bundled provider seed ships opencode templates without any key', () => {
    const seed = readProviderSeedFile(repoWorkspace);
    assert.equal(seed.version, 1);
    assert.ok(seed.providers.length >= 1, `expected >=1 providers, got ${seed.providers.length}`);
    for (const provider of seed.providers) {
      assert.equal('credentialValue' in provider, false, `seed ${provider.id} must not carry credentialValue`);
      assert.ok(provider.baseUrl, `seed ${provider.id} must carry baseUrl`);
    }
  });

  test('syncProviderSeeds imports from local seed library and clears legacy claude residue (offline)', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, OPENCODE_SEED);

      // 旧 Claude 格式残留（anthropic 且无 Key）——应被清理。
      await providerRegistry.upsertProvider(tmpRoot, 'deepseek', {
        label: 'DeepSeek old',
        protocol: 'anthropic',
        baseUrl: 'https://api.deepseek.com/anthropic',
        credentialValue: '',
        models: [],
        opencodeAuth: { enabled: true, envVar: 'ANTHROPIC_API_KEY' },
      });
      // 用户已配置 Key 的供应商——必须保留。
      await providerRegistry.upsertProvider(tmpRoot, 'my-claude', {
        label: 'My Claude',
        protocol: 'anthropic',
        baseUrl: 'https://my.claude',
        credentialValue: 'sk-user-keep',
        models: [{ id: 'claude', label: 'Claude' }],
      });

      const result = await syncProviderSeeds(tmpRoot);
      assert.deepEqual(result.imported, ['env-deepseek-openai', 'env-kimi-openai']);
      assert.equal(result.clearedCount, 1);
      assert.deepEqual(result.errors, []);
      assert.equal(result.seedPath, path.join(tmpRoot, 'config', 'provider-seeds', 'providers.json'));

      const providers = await providerRegistry.listProviders(tmpRoot);
      assert.deepEqual(
        providers.map((provider) => provider.id).sort(),
        ['env-deepseek-openai', 'env-kimi-openai', 'my-claude'],
      );

      const imported = await providerRegistry.getProvider(tmpRoot, 'env-deepseek-openai');
      assert.equal(imported?.protocol, 'openai-compatible');
      assert.equal(imported?.credentialPresent, false);

      const kept = await providerRegistry.getProvider(tmpRoot, 'my-claude');
      assert.equal(kept?.credentialPresent, true);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('refreshProviderSeedCatalogFields updates modelsUrl without touching key', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, [
        {
          id: 'agentplan',
          label: '火山Agentplan',
          protocol: 'openai-compatible',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          modelsUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3/models',
          models: [{ id: 'ark-code-latest', label: 'Ark Code Latest' }],
          opencodeAuth: { enabled: true, envVar: 'ARK_API_KEY' },
        },
      ]);

      await providerRegistry.upsertProvider(tmpRoot, 'agentplan', {
        credentialValue: 'agent-plan-key',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        opencodeAuth: { enabled: true, envVar: 'OPENAI_API_KEY' },
      });

      const result = await refreshProviderSeedCatalogFields(tmpRoot);
      assert.deepEqual(result.updated, ['agentplan']);

      const provider = await providerRegistry.getProvider(tmpRoot, 'agentplan');
      assert.equal(provider?.modelsUrl, 'https://ark.cn-beijing.volces.com/api/coding/v3/models');
      assert.equal(provider?.opencodeAuth?.envVar, 'ARK_API_KEY');
      assert.equal(provider?.credentialPresent, true);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('syncProviderSeeds keeps existing key when re-importing keyless seed', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, OPENCODE_SEED);

      await providerRegistry.upsertProvider(tmpRoot, 'env-deepseek-openai', {
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        credentialValue: 'sk-user-typed',
      });

      const result = await syncProviderSeeds(tmpRoot);
      assert.ok(result.imported.includes('env-deepseek-openai'));

      const provider = await providerRegistry.getProvider(tmpRoot, 'env-deepseek-openai');
      assert.equal(provider?.credentialPresent, true);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('ensureProviderSeedsInitialized imports bundled providers only for empty databases', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, OPENCODE_SEED);

      const first = await ensureProviderSeedsInitialized(tmpRoot);
      assert.equal(first.initialized, true);
      assert.deepEqual(first.imported, ['env-deepseek-openai', 'env-kimi-openai']);

      await providerRegistry.upsertProvider(tmpRoot, 'env-deepseek-openai', {
        credentialValue: 'sk-user',
        models: [{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' }],
      });

      const second = await ensureProviderSeedsInitialized(tmpRoot);
      assert.equal(second.initialized, false);
      assert.equal(second.existingCount, 2);

      const deepseek = await providerRegistry.getProvider(tmpRoot, 'env-deepseek-openai');
      assert.equal(deepseek?.credentialPresent, true);
      assert.deepEqual(deepseek?.models.map((model) => model.id), ['deepseek-v4-flash']);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
