import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDraftHistory } from './draft-history.ts';

describe('draft history', () => {
  test('merges continuous text changes from one focus edit into one undo step', () => {
    const history = createDraftHistory({ name: '' });

    history.record({ name: 'A' }, 'text:1');
    history.record({ name: 'AB' }, 'text:1');
    history.record({ name: 'ABC' }, 'text:1');

    assert.equal(history.undoCount, 1);
    assert.deepEqual(history.undo(), { name: '' });
    assert.deepEqual(history.redo(), { name: 'ABC' });
  });

  test('records selectors, arrays, images, and command commits as discrete steps', () => {
    const history = createDraftHistory({ selection: 0, values: [], image: '', commands: [] });

    history.record({ selection: 1, values: [], image: '', commands: [] });
    history.record({ selection: 1, values: ['one'], image: '', commands: [] });
    history.record({ selection: 1, values: ['one'], image: 'Portrait', commands: [] });
    history.record({ selection: 1, values: ['one'], image: 'Portrait', commands: [{ code: 101 }] });

    assert.equal(history.undoCount, 4);
    assert.deepEqual(history.undo(), { selection: 1, values: ['one'], image: 'Portrait', commands: [] });
    assert.deepEqual(history.undo(), { selection: 1, values: ['one'], image: '', commands: [] });
  });

  test('clears the redo branch after editing an undone draft', () => {
    const history = createDraftHistory({ name: 'before' });
    history.record({ name: 'first' });
    history.record({ name: 'second' });

    assert.deepEqual(history.undo(), { name: 'first' });
    assert.equal(history.redoCount, 1);

    history.record({ name: 'replacement' });

    assert.equal(history.redoCount, 0);
    assert.equal(history.redo(), null);
    assert.deepEqual(history.current(), { name: 'replacement' });
  });

  test('reset establishes a new saved baseline and clears both stacks', () => {
    const history = createDraftHistory({ name: 'source' });
    history.record({ name: 'draft' });
    history.undo();

    history.reset({ name: 'staged' });

    assert.equal(history.undoCount, 0);
    assert.equal(history.redoCount, 0);
    assert.equal(history.dirty, false);
    assert.deepEqual(history.current(), { name: 'staged' });
  });

  test('dirty state compares against the saved baseline instead of undo availability', () => {
    const history = createDraftHistory({ name: 'saved', detail: { value: 1 } }, 2);

    history.record({ name: 'first', detail: { value: 1 } });
    history.record({ name: 'second', detail: { value: 1 } });
    history.record({ name: 'third', detail: { value: 1 } });
    assert.equal(history.dirty, true);

    history.undo();
    history.undo();
    assert.equal(history.undoCount, 0);
    assert.equal(history.dirty, true, 'truncated history must not masquerade as a saved draft');

    history.record({ detail: { value: 1 }, name: 'saved' });
    assert.equal(history.dirty, false, 'structurally equal data is saved even when key order differs');
    assert.equal(history.undoCount > 0, true);
  });

  test('stores isolated snapshots instead of retaining caller-owned objects', () => {
    const initial = { values: ['source'] };
    const history = createDraftHistory(initial);
    const next = { values: ['draft'] };
    history.record(next);

    initial.values[0] = 'mutated source';
    next.values[0] = 'mutated draft';

    assert.deepEqual(history.undo(), { values: ['source'] });
    assert.deepEqual(history.redo(), { values: ['draft'] });
  });
});
