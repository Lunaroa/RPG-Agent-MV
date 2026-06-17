import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MV_FACE_HEIGHT,
  MV_FACE_WIDTH,
  mvFaceIndexFromCanvasPoint,
  mvFaceSourceRect,
  normalizeMvFaceIndex,
} from './rmmvFace.ts';

describe('rmmvFace helpers', () => {
  test('uses fixed RPG Maker MV 144px face cells for standard sheets', () => {
    assert.deepEqual(mvFaceSourceRect(0), { sx: 0, sy: 0, sw: MV_FACE_WIDTH, sh: MV_FACE_HEIGHT });
    assert.deepEqual(mvFaceSourceRect(1), { sx: 144, sy: 0, sw: MV_FACE_WIDTH, sh: MV_FACE_HEIGHT });
    assert.deepEqual(mvFaceSourceRect(4), { sx: 0, sy: 144, sw: MV_FACE_WIDTH, sh: MV_FACE_HEIGHT });
    assert.deepEqual(mvFaceSourceRect(7), { sx: 432, sy: 144, sw: MV_FACE_WIDTH, sh: MV_FACE_HEIGHT });
  });

  test('keeps single-image face assets on the same fixed MV source cell', () => {
    const source = mvFaceSourceRect(0);

    assert.equal(source.sw, 144);
    assert.equal(source.sh, 144);
  });

  test('normalizes non-integer and out-of-range face indexes to MV bounds', () => {
    assert.equal(normalizeMvFaceIndex(Number.NaN), 0);
    assert.equal(normalizeMvFaceIndex(-1), 0);
    assert.equal(normalizeMvFaceIndex(2.9), 2);
    assert.equal(normalizeMvFaceIndex(99), 7);
  });

  test('maps picker clicks using fixed MV face grid cells', () => {
    assert.equal(mvFaceIndexFromCanvasPoint(0, 0), 0);
    assert.equal(mvFaceIndexFromCanvasPoint(143, 143), 0);
    assert.equal(mvFaceIndexFromCanvasPoint(144, 0), 1);
    assert.equal(mvFaceIndexFromCanvasPoint(0, 144), 4);
    assert.equal(mvFaceIndexFromCanvasPoint(999, 999), 7);
  });
});
