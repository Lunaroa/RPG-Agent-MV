import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyShadowStrokeAction,
  rasterShadowQuarterLine,
  shadowQuarterStrokeEdits,
  shadowQuarterAtCanvasPoint,
  shadowStrokeAction,
} from './shadowPen.ts';

describe('MV shadow pen quarter geometry', () => {
  test('maps the four quarters to the RPG Maker shadow bits', () => {
    assert.equal(shadowQuarterAtCanvasPoint(0, 0, 48, 2, 2)?.bit, 1);
    assert.equal(shadowQuarterAtCanvasPoint(24, 0, 48, 2, 2)?.bit, 2);
    assert.equal(shadowQuarterAtCanvasPoint(0, 24, 48, 2, 2)?.bit, 4);
    assert.equal(shadowQuarterAtCanvasPoint(24, 24, 48, 2, 2)?.bit, 8);
    assert.equal(shadowQuarterAtCanvasPoint(47.9, 47.9, 48, 2, 2)?.bit, 8);
    assert.equal(shadowQuarterAtCanvasPoint(96, 0, 48, 2, 2), null);
  });

  test('uses canvas coordinates so zoom and device scaling do not change the target quarter', () => {
    assert.deepEqual(shadowQuarterAtCanvasPoint(72, 24, 48, 4, 4), {
      quarterX: 3,
      quarterY: 1,
      x: 1,
      y: 0,
      bit: 8,
    });
  });

  test('fills fast horizontal, vertical, and diagonal quarter-grid movement', () => {
    const horizontal = rasterShadowQuarterLine(
      { quarterX: 0, quarterY: 0 },
      { quarterX: 5, quarterY: 0 },
      4,
      4,
    );
    assert.deepEqual(horizontal.map((point) => point.quarterX), [0, 1, 2, 3, 4, 5]);

    const vertical = rasterShadowQuarterLine(
      { quarterX: 1, quarterY: 0 },
      { quarterX: 1, quarterY: 5 },
      4,
      4,
    );
    assert.deepEqual(vertical.map((point) => point.quarterY), [0, 1, 2, 3, 4, 5]);

    const diagonal = rasterShadowQuarterLine(
      { quarterX: 0, quarterY: 0 },
      { quarterX: 3, quarterY: 3 },
      4,
      4,
    );
    assert.deepEqual(diagonal.map((point) => [point.quarterX, point.quarterY]), [[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  test('locks one stroke to add or remove instead of repeatedly toggling', () => {
    assert.equal(shadowStrokeAction(0, 1), 'add');
    assert.equal(shadowStrokeAction(1, 1), 'remove');
    assert.equal(applyShadowStrokeAction(0, 1, 'add'), 1);
    assert.equal(applyShadowStrokeAction(1, 2, 'add'), 3);
    assert.equal(applyShadowStrokeAction(15, 4, 'remove'), 11);
    assert.equal(applyShadowStrokeAction(11, 4, 'remove'), 11);
  });

  test('merges several quarters in one map cell and ignores repeated visits', () => {
    const quarters = [
      shadowQuarterAtCanvasPoint(0, 0, 48, 2, 2)!,
      shadowQuarterAtCanvasPoint(24, 0, 48, 2, 2)!,
      shadowQuarterAtCanvasPoint(0, 24, 48, 2, 2)!,
      shadowQuarterAtCanvasPoint(0, 0, 48, 2, 2)!,
    ];
    const visited = new Set<string>();
    assert.deepEqual(shadowQuarterStrokeEdits(quarters, 'add', () => 0, visited), [
      { x: 0, y: 0, shadowBits: 7 },
    ]);
    assert.deepEqual(shadowQuarterStrokeEdits(quarters, 'add', () => 7, visited), []);
  });

  test('keeps removal stable across empty and occupied quarters', () => {
    const quarters = [
      shadowQuarterAtCanvasPoint(0, 0, 48, 2, 2)!,
      shadowQuarterAtCanvasPoint(24, 0, 48, 2, 2)!,
    ];
    assert.deepEqual(shadowQuarterStrokeEdits(quarters, 'remove', () => 2, new Set()), [
      { x: 0, y: 0, shadowBits: 0 },
    ]);
  });
});
