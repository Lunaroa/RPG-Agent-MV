import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseBindingFromProfileId,
  resolveSessionBinding,
  deserializeProfileModelId,
  bindingMatchesProfileId,
} from '../src/core/llm/invocation/parse-profile-id.ts';
import { profileIdFromBinding } from '../src/core/llm/invocation/resolve.ts';

describe('parse-profile-id', () => {
  test('parseBindingFromProfileId reverses deepseek binding', () => {
    const binding = { providerId: 'deepseek-claude', modelId: 'deepseek-v4-flash' };
    const profileId = profileIdFromBinding(binding.providerId, binding.modelId);
    assert.deepEqual(parseBindingFromProfileId(profileId), binding);
  });

  test('resolveSessionBinding prefers explicit provider/model over settings', () => {
    const resolved = resolveSessionBinding({
      providerId: 'deepseek-claude',
      modelId: 'deepseek-v4-flash',
      profileId: 'deepseek-claude--deepseek-v4-pro',
      settingsBinding: { providerId: 'deepseek-claude', modelId: 'deepseek-v4-pro' },
    });
    assert.deepEqual(resolved, {
      providerId: 'deepseek-claude',
      modelId: 'deepseek-v4-flash',
    });
  });

  test('resolveSessionBinding uses profileId when explicit fields missing', () => {
    const resolved = resolveSessionBinding({
      profileId: 'deepseek-claude--deepseek-v4-flash',
      settingsBinding: { providerId: 'deepseek-claude', modelId: 'deepseek-v4-pro' },
    });
    assert.deepEqual(resolved, {
      providerId: 'deepseek-claude',
      modelId: 'deepseek-v4-flash',
    });
  });

  test('deserializeProfileModelId keeps sanitized model id', () => {
    assert.equal(
      deserializeProfileModelId('deepseek-claude', 'deepseek-v4-pro'),
      'deepseek-v4-pro',
    );
  });

  test('bindingMatchesProfileId rejects legacy claude-bridge prefix', () => {
    const binding = { providerId: 'deepseek-claude', modelId: 'deepseek-v4-flash' };
    const profileId = profileIdFromBinding(binding.providerId, binding.modelId);
    assert.equal(bindingMatchesProfileId(binding, `claude-bridge-${profileId}`), false);
  });
});
