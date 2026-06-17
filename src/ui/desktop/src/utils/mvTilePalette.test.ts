/**
 * Run: node --experimental-strip-types --test src/utils/mvTilePalette.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TILE_ID_A1, TILE_ID_A2, TILE_ID_A3, TILE_ID_A4, TILE_ID_A5 } from '../composables/useMapRenderer.ts';
import {
  MV_PALETTE_COLS,
  palettePickForCell,
  tileIdForPalettePreview,
  tileIdToPaletteCell,
} from './mvTilePalette.ts';

const allSlots = () => true;

describe('mv tile palette mapping', () => {
  test('packs B-E tabs into eight columns without changing tile ids', () => {
    assert.deepEqual(palettePickForCell('B', 0, 0, allSlots), { tileId: 0 });
    assert.deepEqual(palettePickForCell('B', 7, 0, allSlots), { tileId: 7 });
    assert.deepEqual(palettePickForCell('B', 0, 16, allSlots), { tileId: 128 });
    assert.deepEqual(palettePickForCell('C', 3, 17, allSlots), { tileId: 256 + 128 + 8 + 3 });
    assert.deepEqual(tileIdToPaletteCell(128, 'B'), { col: 0, row: 16 });
    assert.deepEqual(tileIdToPaletteCell(256 + 128 + 8 + 3, 'C'), { col: 3, row: 17 });
  });

  test('maps A tab sections across A1-A5', () => {
    assert.deepEqual(palettePickForCell('A', 0, 0, allSlots), { autotileKind: 0 });
    assert.deepEqual(tileIdForPalettePreview(palettePickForCell('A', 0, 0, allSlots)!), TILE_ID_A1);
    assert.deepEqual(palettePickForCell('A', 0, 2, allSlots), { autotileKind: 16 });
    assert.deepEqual(tileIdForPalettePreview(palettePickForCell('A', 0, 2, allSlots)!), TILE_ID_A2);
    assert.deepEqual(palettePickForCell('A', 0, 6, allSlots), { autotileKind: 48 });
    assert.deepEqual(palettePickForCell('A', 0, 10, allSlots), { autotileKind: 80 });
    assert.deepEqual(palettePickForCell('A', 0, 16, allSlots), { tileId: TILE_ID_A5 });
  });

  test('round-trips A5 and autotile cells for highlight selection', () => {
    assert.deepEqual(tileIdToPaletteCell(TILE_ID_A1 + 16 * 48, 'A'), { col: 0, row: 2 });
    assert.deepEqual(tileIdToPaletteCell(TILE_ID_A5 + 15, 'A'), { col: 7, row: 17 });
    assert.deepEqual(tileIdToPaletteCell(128, 'A'), null);
  });

  test('respects missing tileset image slots', () => {
    const onlyA5 = (slot: number) => slot === 4;
    assert.equal(palettePickForCell('A', 0, 0, onlyA5), null);
    assert.deepEqual(palettePickForCell('A', 0, 16, onlyA5), { tileId: TILE_ID_A5 });
    assert.equal(palettePickForCell('B', 0, 0, () => false), null);
  });

  test('rejects cells outside the fixed MV palette grid', () => {
    assert.equal(palettePickForCell('B', MV_PALETTE_COLS, 0, allSlots), null);
    assert.equal(palettePickForCell('B', 0, 32, allSlots), null);
  });
});
