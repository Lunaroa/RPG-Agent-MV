import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { validateUpdatePublishState } from './update-publish-guard.ts';

const validState = {
  dirtyPaths: [] as string[],
  hasGitHubToken: true,
  versions: {
    product: '1.2.3',
    desktop: '1.2.3',
    backend: '1.2.3',
  },
};

describe('secure update publish guard', () => {
  test('accepts a clean, authenticated, version-aligned release', () => {
    assert.deepEqual(validateUpdatePublishState(validState), []);
  });

  test('blocks publishing from a dirty worktree', () => {
    const errors = validateUpdatePublishState({
      ...validState,
      dirtyPaths: ['src/example.ts'],
    });
    assert.ok(errors.some((message) => /clean Git worktree/.test(message)));
  });

  test('blocks publishing without a GitHub token', () => {
    const errors = validateUpdatePublishState({
      ...validState,
      hasGitHubToken: false,
    });
    assert.ok(errors.some((message) => /GitHub release token/.test(message)));
  });

  test('blocks publishing when package versions differ', () => {
    const errors = validateUpdatePublishState({
      ...validState,
      versions: {
        ...validState.versions,
        desktop: '1.2.4',
      },
    });
    assert.ok(errors.some((message) => /package versions must match/.test(message)));
  });
});
