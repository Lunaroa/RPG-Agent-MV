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

const MOCK_CATALOG = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-4.1', label: 'GPT-4.1', limit: { context: 1047576, output: 32768 } }],
    envVar: 'OPENAI_API_KEY',
    source: 'opencode',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [{ id: 'claude-sonnet-4', label: 'Claude Sonnet 4', limit: { context: 200000 } }],
    envVar: 'ANTHROPIC_API_KEY',
    source: 'opencode',
  },
];

describe('provider seed sync', () => {
  test('bundled provider seed ships only product Ark supplements without any key', () => {
    const seed = readProviderSeedFile(repoWorkspace);
    assert.equal(seed.version, 1);
    assert.deepEqual(
      seed.providers.map((provider) => provider.id).sort(),
      ['agentplan', 'byteplus', 'codingplan', 'doubaoseed'],
    );
    for (const provider of seed.providers) {
      assert.equal('credentialValue' in provider, false, `seed ${provider.id} must not carry credentialValue`);
      assert.ok(provider.baseUrl, `seed ${provider.id} must carry baseUrl`);
    }
    const agentplan = seed.providers.find((provider) => provider.id === 'agentplan');
    assert.equal(agentplan?.disableModelFetch, true);
  });

  test('syncProviderSeeds imports catalog and seeds, clears unkeyed residue outside keep-set', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, OPENCODE_SEED);

      // Unkeyed leftover outside catalog∪seed — should be cleared.
      await providerRegistry.upsertProvider(tmpRoot, 'legacy-empty', {
        label: 'Legacy Empty',
        protocol: 'openai-compatible',
        baseUrl: 'https://legacy.test/v1',
        credentialValue: '',
        models: [],
        opencodeAuth: { enabled: true, envVar: 'OPENAI_API_KEY' },
      });
      // User-configured provider with a key — must be kept.
      await providerRegistry.upsertProvider(tmpRoot, 'my-claude', {
        label: 'My Claude',
        protocol: 'anthropic',
        baseUrl: 'https://my.claude',
        credentialValue: 'sk-user-keep',
        models: [{ id: 'claude', label: 'Claude' }],
      });

      const result = await syncProviderSeeds(tmpRoot, {
        listCatalog: async () => MOCK_CATALOG,
      });
      assert.equal(result.catalogCount, 2);
      assert.equal(result.seedCount, 2);
      assert.ok(result.imported.includes('openai'));
      assert.ok(result.imported.includes('env-deepseek-openai'));
      assert.equal(result.clearedCount, 1);
      assert.deepEqual(result.errors, []);

      const providers = await providerRegistry.listProviders(tmpRoot);
      assert.deepEqual(
        providers.map((provider) => provider.id).sort(),
        ['anthropic', 'env-deepseek-openai', 'env-kimi-openai', 'my-claude', 'openai'],
      );

      const openai = await providerRegistry.getProvider(tmpRoot, 'openai');
      assert.equal(openai?.protocol, 'openai-compatible');
      assert.equal(openai?.credentialPresent, false);
      assert.equal(openai?.presetKind, 'opencode');
      assert.equal(openai?.models[0]?.limit?.context, 1047576);

      const kept = await providerRegistry.getProvider(tmpRoot, 'my-claude');
      assert.equal(kept?.credentialPresent, true);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('syncProviderSeeds seed overlay preserves disableModelFetch and merges model limits', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, [
        {
          id: 'agentplan',
          label: '火山方舟 Agent Plan',
          protocol: 'openai-compatible',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
          models: [{ id: 'glm-5.2', label: 'GLM 5.2', limit: { context: 262144, output: 131072 } }],
          opencodeAuth: { enabled: true, envVar: 'ARK_API_KEY' },
          disableModelFetch: true,
          supportedEngines: ['opencode'],
        },
      ]);

      // Pre-existing user model should survive merge.
      await providerRegistry.upsertProvider(tmpRoot, 'agentplan', {
        label: 'Agent Plan',
        protocol: 'openai-compatible',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        credentialValue: 'sk-agent',
        models: [{ id: 'user-custom', label: 'User Custom' }],
      });

      const result = await syncProviderSeeds(tmpRoot, {
        listCatalog: async () => ([
          {
            id: 'openai',
            label: 'OpenAI',
            protocol: 'openai-compatible',
            baseUrl: 'https://api.openai.com/v1',
            models: [{ id: 'gpt-4.1', label: 'GPT-4.1', limit: { context: 1000 } }],
            envVar: 'OPENAI_API_KEY',
            source: 'opencode',
          },
        ]),
      });
      assert.equal(result.errors.length, 0);

      const agentplan = await providerRegistry.getProvider(tmpRoot, 'agentplan');
      assert.equal(agentplan?.credentialPresent, true);
      assert.equal(agentplan?.disableModelFetch, true);
      assert.equal(agentplan?.opencodeAuth?.envVar, 'ARK_API_KEY');
      assert.equal(agentplan?.presetKind, 'product-seed');
      const modelIds = agentplan?.models.map((model) => model.id).sort();
      assert.deepEqual(modelIds, ['glm-5.2', 'user-custom']);
      const glm = agentplan?.models.find((model) => model.id === 'glm-5.2');
      assert.equal(glm?.limit?.context, 262144);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('syncProviderSeeds imports catalog providers resolved from model.api.url', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, [
        {
          id: 'agentplan',
          label: '火山方舟 Agent Plan',
          protocol: 'openai-compatible',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
          models: [{ id: 'glm-5.2', label: 'GLM 5.2', limit: { context: 262144 } }],
          opencodeAuth: { enabled: true, envVar: 'ARK_API_KEY' },
          disableModelFetch: true,
          supportedEngines: ['opencode'],
        },
      ]);

      const result = await syncProviderSeeds(tmpRoot, {
        listCatalog: async () => {
          // Simulate mapped catalog after inferBaseUrl fix (URL from models[*].api.url).
          const { mapOpencodeProviderList } = await import('../src/core/workflow/agent/opencode/catalog.ts');
          return mapOpencodeProviderList({
            all: [
              {
                id: 'openai',
                name: 'OpenAI',
                env: ['OPENAI_API_KEY'],
                options: {},
                models: {
                  'gpt-4.1': {
                    name: 'GPT-4.1',
                    api: { id: 'gpt-4.1', url: 'https://api.openai.com/v1', npm: '@ai-sdk/openai' },
                    limit: { context: 1047576 },
                  },
                },
              },
            ],
          });
        },
      });

      assert.equal(result.catalogCount, 1);
      assert.equal(result.seedCount, 1);
      assert.deepEqual(result.errors, []);
      const openai = await providerRegistry.getProvider(tmpRoot, 'openai');
      assert.equal(openai?.baseUrl, 'https://api.openai.com/v1');
      assert.equal(openai?.models[0]?.limit?.context, 1047576);
    } finally {
      closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('syncProviderSeeds fails fast when catalog cannot be listed', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-provider-seeds-'));
    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      writeProviderSeedFile(tmpRoot, OPENCODE_SEED);
      await assert.rejects(
        () => syncProviderSeeds(tmpRoot, {
          listCatalog: async () => {
            throw new Error('opencode provider catalog unavailable: boom');
          },
        }),
        /opencode provider catalog unavailable/,
      );
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

      const result = await syncProviderSeeds(tmpRoot, {
        listCatalog: async () => [],
      });
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
