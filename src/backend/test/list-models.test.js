import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, mock } from 'node:test';

import { bootstrapDatabase } from '../src/core/db/bootstrap.ts';
import { closeDatabase } from '../src/core/db/pool.ts';
import { listModelsForProvider } from '../src/core/llm/index.ts';
import * as providerRegistry from '../src/core/llm/provider-registry.ts';

import {
  resolveListModelsClient,
  resolveTestClient,
  buildModelsUrlCandidates,
  resolveListModelsBaseUrl,
  listModelsWithCandidates,
} from '../src/core/llm/list-models-resolve.ts';
import * as openaiCompatibleClient from '../src/core/llm/client/openai-compatible.ts';
import * as anthropicClient from '../src/core/llm/client/anthropic.ts';

describe('listModels URL resolution', () => {
  test('modelsUrl override takes precedence over candidate list', () => {
    const c = buildModelsUrlCandidates('https://api.deepseek.com/anthropic', 'https://api.deepseek.com/models');
    assert.deepEqual(c, ['https://api.deepseek.com/models']);
  });

  test('DeepSeek anthropic baseUrl generates strip-anthropic candidates', () => {
    const c = buildModelsUrlCandidates('https://api.deepseek.com/anthropic', null);
    assert.deepEqual(c, [
      'https://api.deepseek.com/anthropic/v1/models',
      'https://api.deepseek.com/v1/models',
      'https://api.deepseek.com/models',
    ]);
  });

  test('Kimi anthropic subpath generates moonshot root candidates', () => {
    const c = buildModelsUrlCandidates('https://api.moonshot.cn/anthropic', null);
    assert.ok(c.includes('https://api.moonshot.cn/models'));
    assert.ok(c.includes('https://api.moonshot.cn/v1/models'));
  });

  test('volcengine agentplan /api/coding/v3 uses /models before /v1/models', () => {
    const c = buildModelsUrlCandidates('https://ark.cn-beijing.volces.com/api/coding/v3', null);
    assert.deepEqual(c, [
      'https://ark.cn-beijing.volces.com/api/coding/v3/models',
      'https://ark.cn-beijing.volces.com/api/coding/v3/v1/models',
    ]);
  });

  test('zhipu coding paas v4 uses /models before /v1/models', () => {
    const c = buildModelsUrlCandidates('https://open.bigmodel.cn/api/coding/paas/v4', null);
    assert.deepEqual(c, [
      'https://open.bigmodel.cn/api/coding/paas/v4/models',
      'https://open.bigmodel.cn/api/coding/paas/v4/v1/models',
    ]);
  });

  test('endsWithVersionSegment via candidate order for /v1 base', () => {
    const c = buildModelsUrlCandidates('https://api.example.com/v1', null);
    assert.deepEqual(c, ['https://api.example.com/v1/models']);
  });

  test('resolveListModelsBaseUrl uses modelsUrl when set on provider', () => {
    const url = resolveListModelsBaseUrl({
      baseUrl: 'https://api.deepseek.com/anthropic',
      modelsUrl: 'https://api.deepseek.com/models',
    });
    assert.equal(url, 'https://api.deepseek.com/models');
  });

  test('normalizeApiKey strips Bearer prefix and whitespace', async () => {
    const { normalizeApiKey } = await import('../src/core/llm/list-models-resolve.ts');
    assert.equal(normalizeApiKey('  sk-test  '), 'sk-test');
    assert.equal(normalizeApiKey('Bearer sk-test'), 'sk-test');
    assert.equal(normalizeApiKey('bearer sk-test'), 'sk-test');
  });

  test('listModelsWithCandidates uses modelsUrl for DeepSeek (mocked fetch)', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = mock.fn(async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: 'deepseek-chat', display_name: 'DeepSeek Chat' }],
          }),
      };
    });

    try {
      const result = await listModelsWithCandidates({
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-test',
        modelsUrl: 'https://api.deepseek.com/models',
      });
      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0], 'https://api.deepseek.com/models');
      assert.equal(result.models[0].id, 'deepseek-chat');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('listModelsWithCandidates retries on 404 until success (mocked fetch)', async () => {
    const originalFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = mock.fn(async (url) => {
      n += 1;
      if (String(url).includes('/anthropic/v1/models')) {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 'kimi-latest' }] }),
      };
    });

    try {
      const result = await listModelsWithCandidates({
        baseUrl: 'https://api.moonshot.cn/anthropic',
        apiKey: 'sk-test',
      });
      assert.equal(result.ok, true);
      assert.ok(n >= 2);
      assert.equal(result.models[0].id, 'kimi-latest');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('model list clients', () => {
  test('resolveListModelsClient uses openai-compatible for anthropic protocol model listing', () => {
    const client = resolveListModelsClient({
      label: 'DeepSeek Claude',
      protocol: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      modelsUrl: 'https://api.deepseek.com/models',
      credentialValue: 'x',
      models: [],
    });
    assert.equal(client, openaiCompatibleClient);
  });

  test('resolveTestClient uses anthropic for opencode provider checks', () => {
    const provider = {
      label: 'DeepSeek Claude',
      protocol: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      credentialValue: 'x',
      models: [{ id: 'deepseek-v4-flash', label: 'flash' }],
      presetKind: 'official',
    };
    const client = resolveTestClient(provider, {
      baseUrl: provider.baseUrl,
      providerId: 'deepseek-claude',
    });
    assert.equal(client, anthropicClient);
  });
});

describe('listModelsForProvider', () => {
  test('does not fall back to seed models when remote returns 401', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-list-models-fail-'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }));

    try {
      await bootstrapDatabase(tmpRoot, { importLegacyJson: false });
      await providerRegistry.upsertProvider(tmpRoot, 'agentplan', {
        label: '火山Agentplan',
        protocol: 'openai-compatible',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        modelsUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3/models',
        credentialValue: 'bad-key',
        models: [{ id: 'ark-code-latest', label: 'Ark Code Latest' }],
        opencodeAuth: { enabled: true, envVar: 'ARK_API_KEY' },
      });

      const result = await listModelsForProvider(tmpRoot, 'agentplan');
      assert.equal(result.ok, false);
      assert.match(result.error || '', /401/);
      assert.equal(result.models, undefined);
    } finally {
      globalThis.fetch = originalFetch;
      await closeDatabase();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
