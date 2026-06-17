import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { materializeOpencodeEnv } from '../src/core/llm/opencode/materialize-env.ts';
import { buildEphemeralOpencodeProfile, DEFAULT_OPENCODE_TOOLS } from '../src/core/llm/opencode/build-profile.ts';

const deepseekRelay = {
  label: 'DeepSeek 官方 API（opencode）',
  protocol: 'anthropic',
  baseUrl: 'https://api.deepseek.com/anthropic',
  credentialValue: 'sk-deepseek-xxx',
  models: [{ id: 'deepseek-chat', label: 'deepseek-chat' }],
  opencodeAuth: { enabled: true, envVar: 'ANTHROPIC_AUTH_TOKEN' },
};

const anthropicOfficial = {
  label: 'Anthropic 官方 API（opencode）',
  protocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  credentialValue: 'sk-ant-xxx',
  models: [{ id: 'claude-sonnet-4-20250514', label: 'Sonnet' }],
  opencodeAuth: { enabled: true, envVar: 'ANTHROPIC_API_KEY' },
};

const customOpenAI = {
  label: 'Custom OpenAI-compatible',
  protocol: 'openai-compatible',
  baseUrl: 'https://llm.example.invalid/v1',
  credentialValue: 'sk-custom-openai-xxx',
  models: [{ id: 'custom/deepseek-v4-pro', label: 'DeepSeek V4 Pro' }],
  opencodeAuth: { enabled: true, envVar: 'ANTHROPIC_API_KEY' },
};

describe('opencode materialize-env', () => {
  test('third-party relay maps to anthropic base url and token env', () => {
    const out = materializeOpencodeEnv(deepseekRelay);
    assert.equal(out.blocker, null);
    assert.equal(out.env.OPENCODE_PROVIDER_MANAGED_BY_HOST, '1');
    assert.equal(out.env.OPENCODE_DISABLE_AUTOUPDATE, 'true');
    assert.equal(out.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
    assert.equal(out.env.ANTHROPIC_AUTH_TOKEN, 'sk-deepseek-xxx');
    assert.ok(out.envKeys.includes('ANTHROPIC_BASE_URL'));
    assert.ok(out.envKeys.includes('ANTHROPIC_AUTH_TOKEN'));
  });

  test('official anthropic honors preset x-api-key env var', () => {
    const out = materializeOpencodeEnv(anthropicOfficial);
    assert.equal(out.blocker, null);
    assert.equal(out.env.ANTHROPIC_API_KEY, 'sk-ant-xxx');
    assert.equal(out.env.ANTHROPIC_AUTH_TOKEN, undefined);
  });

  test('missing opencodeAuth.envVar defaults to ANTHROPIC_API_KEY', () => {
    const out = materializeOpencodeEnv({ ...deepseekRelay, opencodeAuth: { enabled: true } });
    assert.equal(out.env.ANTHROPIC_API_KEY, 'sk-deepseek-xxx');
  });

  test('openai-compatible provider maps through OpenAI env', () => {
    const out = materializeOpencodeEnv(customOpenAI, { modelId: 'custom/deepseek-v4-pro' });
    assert.equal(out.blocker, null);
    assert.equal(out.env.OPENCODE_PROVIDER_MANAGED_BY_HOST, '1');
    assert.equal(out.env.OPENAI_BASE_URL, 'https://llm.example.invalid/v1');
    assert.equal(out.env.OPENAI_API_KEY, 'sk-custom-openai-xxx');
    assert.equal(out.env.OPENAI_MODEL, 'custom/deepseek-v4-pro');
    assert.equal(out.env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(out.env.ANTHROPIC_API_KEY, 'sk-custom-openai-xxx');
  });

  test('openai-compatible volcengine also mirrors ARK_API_KEY', () => {
    const out = materializeOpencodeEnv({
      label: '火山Agentplan',
      protocol: 'openai-compatible',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      credentialValue: 'ark-key',
      models: [{ id: 'ark-code-latest', label: 'Ark Code Latest' }],
      opencodeAuth: { enabled: true, envVar: 'ARK_API_KEY' },
    });
    assert.equal(out.env.OPENAI_API_KEY, 'ark-key');
    assert.equal(out.env.ARK_API_KEY, 'ark-key');
  });

  test('missing credential returns blocker without provider env', () => {
    const out = materializeOpencodeEnv({ ...deepseekRelay, credentialValue: '' });
    assert.ok(out.blocker && out.blocker.includes('API Key'));
    assert.deepEqual(out.envKeys, []);
  });

  test('missing base url returns blocker', () => {
    const out = materializeOpencodeEnv({ ...deepseekRelay, baseUrl: '' });
    assert.ok(out.blocker && out.blocker.includes('Base URL'));
  });

  test('null provider returns blocker', () => {
    const out = materializeOpencodeEnv(null);
    assert.ok(out.blocker);
    assert.deepEqual(out.env, {});
  });
});

describe('opencode build-profile', () => {
  test('synthesizes opencode profile straight from binding', () => {
    const profile = buildEphemeralOpencodeProfile(deepseekRelay, 'deepseek-claude', 'deepseek-chat');
    assert.equal(profile.runtime, 'opencode');
    assert.equal(profile.protocol, 'anthropic');
    assert.equal(profile.model, 'deepseek-chat');
    assert.equal(profile.baseUrl, 'https://api.deepseek.com/anthropic');
    assert.equal(profile.sourceProviderId, 'deepseek-claude');
    assert.equal(profile.sourceModelId, 'deepseek-chat');
    assert.deepEqual(profile.tools, DEFAULT_OPENCODE_TOOLS);
  });

  test('keeps selected provider model id unchanged', () => {
    const profile = buildEphemeralOpencodeProfile(deepseekRelay, 'deepseek-claude', 'deepseek-v4-pro');
    assert.equal(profile.model, 'deepseek-v4-pro');
  });

  test('marks openai-compatible provider profiles honestly', () => {
    const profile = buildEphemeralOpencodeProfile(customOpenAI, 'custom-openai', 'custom/deepseek-v4-pro');
    assert.equal(profile.protocol, 'openai-compatible');
    assert.equal(profile.model, 'custom/deepseek-v4-pro');
  });
});
