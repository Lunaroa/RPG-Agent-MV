import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findCommandSpanIndices, nextCommandFindCursor } from './command-list-find';

describe('command list find state', () => {
  test('matches the complete rendered span, including continuation lines, case-insensitively', () => {
    const views = [
      { head: 'Show Message', lines: ['The hidden key is here.'] },
      { head: 'Play SE: Door', lines: [] },
      { head: 'Comment', lines: ['Unrelated'] },
    ];
    assert.deepEqual(findCommandSpanIndices(views, 'HIDDEN KEY'), [0]);
    assert.deepEqual(findCommandSpanIndices(views, '  door '), [1]);
    assert.deepEqual(findCommandSpanIndices(views, 'missing'), []);
  });

  test('cycles matches in both directions and wraps at either end', () => {
    assert.equal(nextCommandFindCursor(3, -1, 1), 0);
    assert.equal(nextCommandFindCursor(3, 0, -1), 2);
    assert.equal(nextCommandFindCursor(3, 2, 1), 0);
    assert.equal(nextCommandFindCursor(3, 0, 1), 1);
    assert.equal(nextCommandFindCursor(0, 0, 1), -1);
  });
});
