import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  usesOpencodeProviderBinding,
  resolveBindingStorageKey,
} from '../src/core/workflow/agent/runtime-adapters/index.ts';
import { resolveBinding } from '../src/core/llm/invocation/resolve.ts';
import {
  resolveOpencodeConfigDir,
} from '../src/core/workspace-paths.ts';
import { DEFAULT_OPENCODE_TOOLS } from '../src/core/llm/opencode/build-profile.ts';

describe('opencode engine helpers', () => {
  test('usesOpencodeProviderBinding identifies the active engine', () => {
    assert.equal(usesOpencodeProviderBinding('opencode'), true);
  });

  test('resolveBindingStorageKey returns engine directly', () => {
    assert.equal(resolveBindingStorageKey('opencode'), 'opencode');
  });

  test('resolveBinding ignores legacy local-agent binding key', () => {
    const settings = {
      bindings: {
        'local-agent': { providerId: 'deepseek-claude', modelId: 'deepseek-v4-flash' },
      },
    };
    const binding = resolveBinding('opencode', settings);
    assert.equal(binding, null);
  });

  test('config dirs anchor under workflow root', () => {
    assert.match(resolveOpencodeConfigDir('/tmp/workspace').replace(/\\/g, '/'), /\/tmp\/workspace\/\.opencode$/);
  });

  test('DEFAULT_OPENCODE_TOOLS keeps RMMV business tools out of builtins', () => {
    assert.deepEqual(DEFAULT_OPENCODE_TOOLS, [
      'read',
      'write',
      'edit',
      'bash',
      'grep',
      'glob',
      'todowrite',
      'todoread',
      'task',
      'question',
    ]);
    assert.equal(DEFAULT_OPENCODE_TOOLS.some((name) => name.startsWith('rmmv_')), false);
  });
});
