import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeUiControlCommand } from './ui-control-command.ts';

describe('UI control click command modifiers', () => {
  test('keeps a legal ctrl modifier on click after normalization', () => {
    const command = normalizeUiControlCommand({
      type: 'click',
      testId: 'project-assets-cell-demo',
      modifiers: ['ctrl'],
    });
    assert.equal(command.type, 'click');
    assert.equal(command.testId, 'project-assets-cell-demo');
    assert.deepEqual(command.modifiers, ['ctrl']);
  });

  test('normalizes double-click targets and modifiers', () => {
    const command = normalizeUiControlCommand({
      type: 'dblclick',
      testId: 'database-entry-demo',
      modifiers: ['shift'],
    });
    assert.equal(command.type, 'dblclick');
    assert.equal(command.testId, 'database-entry-demo');
    assert.deepEqual(command.modifiers, ['shift']);
  });

  test('rejects an unsupported click modifier instead of dropping it', () => {
    assert.throws(
      () => normalizeUiControlCommand({
        type: 'click',
        testId: 'project-assets-cell-demo',
        modifiers: ['super'],
      }),
      /Unsupported key modifier: super/,
    );
  });
});
