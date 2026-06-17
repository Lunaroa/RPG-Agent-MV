/**
 * Run: node --experimental-strip-types --test src/utils/clone-draft.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cloneDraft } from './clone-draft.ts';

describe('cloneDraft', () => {
  it('deep clones plain objects', () => {
    const source = { id: 1, name: 'Hero', traits: [{ code: 21, dataId: 2 }] };
    const cloned = cloneDraft(source);
    assert.notEqual(cloned, source);
    assert.deepEqual(cloned, source);
    cloned.name = 'Lead';
    assert.equal(source.name, 'Hero');
  });
});
