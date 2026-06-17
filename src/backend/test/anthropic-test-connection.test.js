import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';

import {
  buildAnthropicMessagesUrl,
  testConnection,
} from '../src/core/llm/client/anthropic.ts';

describe('buildAnthropicMessagesUrl', () => {
  test('DeepSeek anthropic baseUrl appends /v1/messages', () => {
    assert.equal(
      buildAnthropicMessagesUrl('https://api.deepseek.com/anthropic'),
      'https://api.deepseek.com/anthropic/v1/messages',
    );
  });

  test('baseUrl ending with /v1 uses /messages only', () => {
    assert.equal(
      buildAnthropicMessagesUrl('https://api.anthropic.com/v1'),
      'https://api.anthropic.com/v1/messages',
    );
  });

  test('trailing slashes are trimmed', () => {
    assert.equal(
      buildAnthropicMessagesUrl('https://api.deepseek.com/anthropic/'),
      'https://api.deepseek.com/anthropic/v1/messages',
    );
  });
});

describe('anthropic testConnection', () => {
  test('200 returns ok with sample text', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/anthropic/v1/messages');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['x-api-key'], 'sk-test');
      assert.equal(init.headers.authorization, 'Bearer sk-test');
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            model: 'deepseek-v4-flash',
            content: [{ type: 'text', text: 'pong' }],
          }),
      };
    });

    try {
      const result = await testConnection({
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-test',
        model: 'deepseek-v4-flash',
      });
      assert.equal(result.ok, true);
      assert.equal(result.model, 'deepseek-v4-flash');
      assert.equal(result.sample, 'pong');
      assert.equal(result.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('400 treated as connectivity ok (auth accepted)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: 'invalid request' } }),
    }));

    try {
      const result = await testConnection({
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro',
      });
      assert.equal(result.ok, true);
      assert.equal(result.status, 400);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('401 returns Chinese credential error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));

    try {
      const result = await testConnection({
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'bad-key',
        model: 'deepseek-v4-flash',
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, 401);
      assert.match(result.error, /密钥无效/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('403 returns Chinese permission error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    }));

    try {
      const result = await testConnection({
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-test',
        model: 'deepseek-v4-flash',
      });
      assert.equal(result.ok, false);
      assert.match(result.error, /无权访问/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('network failure returns Chinese unreachable message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      throw new Error('fetch failed');
    });

    try {
      const result = await testConnection({
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-test',
        model: 'deepseek-v4-flash',
        timeoutMs: 5000,
      });
      assert.equal(result.ok, false);
      assert.match(result.error, /无法连接服务器/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
