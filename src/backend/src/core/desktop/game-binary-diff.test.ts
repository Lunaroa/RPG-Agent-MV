import assert from 'node:assert/strict';
import test from 'node:test';

import { applyBinaryPatch, createBinaryPatch, readBinaryPatchHeader } from './game-binary-diff.ts';

test('reconstructs changed, added, truncated, and empty binary targets', () => {
  for (const [base, target] of [
    [Buffer.from('before content'), Buffer.from('after content')],
    [null, Buffer.from('new file')],
    [Buffer.from('long content that becomes short'), Buffer.from('short')],
    [Buffer.from('removed'), Buffer.alloc(0)],
  ] as Array<[Buffer | null, Buffer]>) {
    const patch = createBinaryPatch(base, target);
    assert.deepEqual(applyBinaryPatch(base, patch), target);
    assert.equal(readBinaryPatchHeader(patch).targetBytes, target.byteLength);
  }
});

test('refuses a patch when the exact baseline does not match', () => {
  const patch = createBinaryPatch(Buffer.from('baseline'), Buffer.from('target'));
  assert.throws(() => applyBinaryPatch(Buffer.from('other'), patch), /baseline SHA-256/);
});
