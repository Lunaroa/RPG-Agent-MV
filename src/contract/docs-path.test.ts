import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { resolveUserDocsEntry } from './docs-path.ts';

describe('resolveUserDocsEntry', () => {
  it('opens Chinese docs at workflowRoot/docs', () => {
    assert.equal(
      resolveUserDocsEntry('/workspace/RPG-Agent-MV', 'zh-CN'),
      path.join('/workspace/RPG-Agent-MV', 'docs'),
    );
  });

  it('opens English docs at workflowRoot/docs/en', () => {
    assert.equal(
      resolveUserDocsEntry('/workspace/RPG-Agent-MV', 'en-US'),
      path.join('/workspace/RPG-Agent-MV', 'docs', 'en'),
    );
  });
});
