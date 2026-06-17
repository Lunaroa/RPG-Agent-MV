import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  defaultSupportedEngines,
  providerSupportsEngine,
  canonicalProfileProviderId,
  profileIdFromBinding,
  resolveInvocationCore,
} from '../src/core/llm/invocation/index.ts';
import { resolveAgentProfile } from '../src/core/workflow/agent/profile-resolver.ts';

const agent = {
  id: 'default',
  runtime: { defaultProfile: 'opencode-default' },
};

const profiles = {
  'opencode-default': {
    runtime: 'opencode',
    provider: 'deepseek',
    model: 'deepseek-chat',
  },
  'opencode-deepseek-claude--deepseek-v4-flash': {
    runtime: 'opencode',
    provider: 'deepseek-claude',
    model: 'deepseek-v4-flash',
    sourceProviderId: 'deepseek-claude',
    sourceModelId: 'deepseek-v4-flash',
  },
  'opencode-deepseek-claude--deepseek-v4-pro': {
    runtime: 'opencode',
    dynamic: true,
    sourceProviderId: 'deepseek-claude',
    sourceModelId: 'deepseek-v4-pro',
    provider: 'deepseek-claude',
    model: 'deepseek-v4-pro',
  },
};

describe('invocation layer', () => {
  test('profileIdFromBinding sanitizes model id', () => {
    assert.equal(profileIdFromBinding('deepseek-claude', 'deepseek/v4-pro'), 'deepseek-claude--deepseek-v4-pro');
  });

  test('profileIdFromBinding keeps provider id direct', () => {
    assert.equal(canonicalProfileProviderId('deepseek-claude', 'deepseek-v4-pro'), 'deepseek-claude');
    assert.equal(
      profileIdFromBinding('deepseek-claude', 'deepseek-v4-pro'),
      'deepseek-claude--deepseek-v4-pro',
    );
  });

  test('resolveInvocationCore uses opencode engine binding as explicit profile', () => {
    const result = resolveInvocationCore({
      workflowRoot: '.',
      engine: 'opencode',
      agent,
      profiles,
      agentExecutionSettings: {
        bindings: {
          opencode: { providerId: 'deepseek-claude', modelId: 'deepseek-v4-pro' },
        },
      },
    });
    assert.equal(result.profileId, 'opencode-deepseek-claude--deepseek-v4-pro');
    assert.equal(result.blocker, null);
  });

  test('resolveInvocationCore ignores legacy execution bindings', () => {
    for (const bindings of [
      { 'local-agent': { providerId: 'deepseek-claude', modelId: 'deepseek-v4-pro' } },
      { claude: { providerId: 'deepseek-claude', modelId: 'deepseek-v4-pro' } },
    ]) {
      const result = resolveInvocationCore({
        workflowRoot: '.',
        engine: 'opencode',
        agent,
        profiles,
        agentExecutionSettings: { bindings },
      });
      assert.equal(result.profileId, 'opencode-default');
      assert.equal(result.binding, null);
      assert.equal(result.blocker, null);
    }
  });

  test('opencode engine resolves explicit opencode profile', () => {
    const result = resolveInvocationCore({
      workflowRoot: '.',
      engine: 'opencode',
      profileId: 'opencode-default',
      agent,
      profiles,
    });
    assert.equal(result.blocker, null);
    assert.equal(result.profileId, 'opencode-default');
  });

  test('providerSupportsEngine allows only explicit opencode or compatible protocol defaults', () => {
    assert.equal(
      providerSupportsEngine({ supportedEngines: ['opencode'], opencodeAuth: { enabled: true } }, 'opencode'),
      true,
    );
    assert.equal(providerSupportsEngine({ supportedEngines: ['local-agent'], opencodeAuth: { enabled: true } }, 'opencode'), false);
    assert.equal(providerSupportsEngine({ opencodeAuth: { enabled: true } }, 'opencode'), true);
    assert.equal(providerSupportsEngine({ protocol: 'anthropic' }, 'opencode'), true);
    assert.equal(providerSupportsEngine({ protocol: 'openai-compatible' }, 'opencode'), true);
    assert.deepEqual(defaultSupportedEngines({ opencodeAuth: { enabled: true } }), ['opencode']);
    assert.equal(providerSupportsEngine({ supportedEngines: ['legacy'] }, 'opencode'), false);
    assert.equal(providerSupportsEngine({}, 'opencode'), false);
  });

  test('profile-resolver delegates to invocation rules', () => {
    const result = resolveAgentProfile({
      executionEngine: 'opencode',
      profileId: 'opencode-default',
      agent,
      profiles,
    });
    assert.equal(result.blocker, null);
    assert.equal(result.profileId, 'opencode-default');
  });
});
