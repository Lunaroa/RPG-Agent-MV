import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

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

describe('profile-resolver', () => {
  test('opencode engine + matching static profile', () => {
    const result = resolveAgentProfile({
      executionEngine: 'opencode',
      profileId: 'opencode-default',
      agent,
      profiles,
    });
    assert.equal(result.blocker, null);
    assert.equal(result.profileId, 'opencode-default');
    assert.equal(result.profile?.runtime, 'opencode');
  });

  test('opencode engine resolves dynamic deepseek profile directly', () => {
    const result = resolveAgentProfile({
      executionEngine: 'opencode',
      profileId: 'opencode-deepseek-claude--deepseek-v4-pro',
      agent,
      profiles,
    });
    assert.equal(result.blocker, null);
    assert.equal(result.profileId, 'opencode-deepseek-claude--deepseek-v4-pro');
    assert.equal(result.profile?.runtime, 'opencode');
  });

  test('opencode engine resolves binding-matched profile', () => {
    const result = resolveAgentProfile({
      executionEngine: 'opencode',
      profileId: null,
      agent,
      profiles,
      agentExecutionSettings: {
        bindings: {
          opencode: { providerId: 'deepseek-claude', modelId: 'deepseek-v4-flash' },
        },
      },
    });
    assert.equal(result.blocker, null);
    assert.equal(result.profileId, 'opencode-deepseek-claude--deepseek-v4-flash');
  });

  test('opencode ignores legacy local-agent binding key', () => {
    const result = resolveAgentProfile({
      executionEngine: 'opencode',
      profileId: null,
      agent,
      profiles,
      agentExecutionSettings: {
        bindings: {
          'local-agent': { providerId: 'deepseek-claude', modelId: 'deepseek-v4-flash' },
        },
      },
    });
    assert.equal(result.blocker, null);
    assert.equal(result.profileId, 'opencode-default');
  });

  test('opencode engine resolves default agent profile', () => {
    const result = resolveAgentProfile({
      executionEngine: 'opencode',
      profileId: null,
      agent,
      profiles,
    });
    assert.equal(result.blocker, null);
    assert.equal(result.profileId, 'opencode-default');
  });
});
