import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  patchRequiresAgentGuard,
  runPatchCore,
  runRmmvPatch,
} from '../src/core/rmmv/rmmv-handlers.ts';

describe('runPatchCore', () => {
  test('patch handler rejects full apply action', () => {
    assert.throws(
      () => runRmmvPatch({ action: 'apply', project: '.', spec: 'x.json' }),
      /Patch handler only supports dryRun or applyEventCommandOps/,
    );
  });

  test('patchRequiresAgentGuard is false for dry-run', () => {
    assert.equal(patchRequiresAgentGuard({ action: 'dry-run', dryRun: true }), false);
  });

  test('runPatchCore dry-run requires existing spec file', () => {
    assert.throws(
      () => runPatchCore({ action: 'dry-run', project: '.', spec: 'missing-spec.json', workflowRoot: process.cwd() }),
      /ENOENT|Missing|no such file/i,
    );
  });
});
