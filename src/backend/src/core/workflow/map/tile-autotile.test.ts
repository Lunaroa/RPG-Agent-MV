import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  classifyAutotileKind,
  isFloorAutotileKind,
  makeAutotileId,
  resolveAutotileLayer,
  resolveFloorLayer,
  wallAutotileShape,
  waterfallAutotileShape,
} from './tile-autotile.ts';

describe('RPG Maker MV autotile kind classification', () => {
  test('classifies A1-A4 autotiles into safe floor support or explicit rejection', () => {
    assert.deepEqual(
      pick(classifyAutotileKind(0)),
      { tab: 'A1', strategy: 'floor', supported: true },
    );
    assert.deepEqual(
      pick(classifyAutotileKind(5)),
      { tab: 'A1', strategy: 'waterfall', supported: true },
    );
    assert.deepEqual(
      pick(classifyAutotileKind(16)),
      { tab: 'A2', strategy: 'floor', supported: true },
    );
    assert.deepEqual(
      pick(classifyAutotileKind(48)),
      { tab: 'A3', strategy: 'wall', supported: true },
    );
    assert.deepEqual(
      pick(classifyAutotileKind(80)),
      { tab: 'A4', strategy: 'floor', supported: true },
    );
    assert.deepEqual(
      pick(classifyAutotileKind(88)),
      { tab: 'A4', strategy: 'wall', supported: true },
    );
  });

  test('resolves supported A4 floor autotiles through the floor table', () => {
    assert.equal(isFloorAutotileKind(80), true);
    assert.deepEqual(resolveFloorLayer([80], 1, 1), [makeAutotileId(80, 0)]);
  });

  test('resolves MV wall and waterfall shape ids from neighbour connectivity', () => {
    assert.equal(wallAutotileShape({ n: true, e: true, s: true, w: true }), 0);
    assert.equal(wallAutotileShape({ n: true, e: true, s: true, w: false }), 1);
    assert.equal(wallAutotileShape({ n: false, e: true, s: true, w: true }), 2);
    assert.equal(wallAutotileShape({ n: true, e: false, s: true, w: true }), 4);
    assert.equal(wallAutotileShape({ n: true, e: true, s: false, w: true }), 8);
    assert.equal(wallAutotileShape({ n: false, e: false, s: false, w: false }), 15);
    assert.equal(waterfallAutotileShape({ e: true, w: true }), 0);
    assert.equal(waterfallAutotileShape({ e: true, w: false }), 1);
    assert.equal(waterfallAutotileShape({ e: false, w: true }), 2);
    assert.equal(waterfallAutotileShape({ e: false, w: false }), 3);
  });

  test('resolves A1 waterfall, A3 wall and A4 wall autotile ids', () => {
    assert.deepEqual(
      resolveAutotileLayer([-1, -1, -1, -1, 5, -1, -1, -1, -1], 3, 3),
      [0, 0, 0, 0, makeAutotileId(5, 3), 0, 0, 0, 0],
    );
    assert.deepEqual(
      resolveAutotileLayer([-1, -1, -1, -1, 48, -1, -1, -1, -1], 3, 3),
      [0, 0, 0, 0, makeAutotileId(48, 15), 0, 0, 0, 0],
    );
    assert.deepEqual(
      resolveAutotileLayer([-1, -1, -1, -1, 88, -1, -1, -1, -1], 3, 3),
      [0, 0, 0, 0, makeAutotileId(88, 15), 0, 0, 0, 0],
    );
  });
});

function pick(result: ReturnType<typeof classifyAutotileKind>) {
  return { tab: result.tab, strategy: result.strategy, supported: result.supported };
}
