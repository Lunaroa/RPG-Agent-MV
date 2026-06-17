/**
 * Run: node --experimental-strip-types --test src/utils/placementCellValidity.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTileStackPassable, validatePlacementCell } from './placementCellValidity.ts';
import type { MvMap } from '../composables/useMapRenderer.ts';

function blankMap(w = 3, h = 3): MvMap {
  return {
    width: w,
    height: h,
    tilesetId: 1,
    data: new Array(w * h * 5).fill(0),
    events: [],
  };
}

describe('placementCellValidity', () => {
  it('rejects out of bounds and occupied cells', () => {
    const map = blankMap();
    map.events = [{ id: 1, x: 1, y: 1, pages: [] }];
    assert.equal(validatePlacementCell(map, [], 3, 0).valid, false);
    assert.match(validatePlacementCell(map, [], 1, 1).reason || '', /已有事件/);
    assert.equal(validatePlacementCell(map, [], 0, 0).valid, true);
  });

  it('allows placement on impassable tiles (e.g. chairs)', () => {
    const map = blankMap(1, 1);
    const flags = new Array(8192).fill(0);
    flags[1] = 0x0f;
    for (let z = 0; z < 4; z += 1) {
      map.data[z] = 1;
    }
    assert.equal(isTileStackPassable(map, flags, 0, 0), false);
    assert.equal(validatePlacementCell(map, flags, 0, 0).valid, true);
  });
});
