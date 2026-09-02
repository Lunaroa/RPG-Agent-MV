import { describe, expect, it } from 'vitest';

import {
  EXTENDED_TILESET_FIRST_TILE_ID,
  buildExtendedTilesetDescriptors,
  decodeExtendedAutotileId,
  encodeExtendedAutotileId,
  normalizeExtendedTilesetTypes,
  validateExtendedTilesetImageDimensions,
} from '@contract/extended-tileset';
import { applyRmmvMapBrushEdits, RMMV_MAP_LAYERS } from '@contract/rmmv-map-brush';

const stockNames = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];

describe('extended tileset protocol', () => {
  it('keeps stock ids intact and allocates all extended sheet types continuously', () => {
    const types = ['A1', 'A2', 'A3', 'A4', 'A5', 'normal'] as const;
    const descriptors = buildExtendedTilesetDescriptors([...stockNames, ...types], types);
    expect(descriptors.map((sheet) => sheet.label)).toEqual(['F', 'G', 'H', 'I', 'J', 'K']);
    expect(descriptors.map((sheet) => sheet.firstTileId)).toEqual([8192, 8960, 10496, 12032, 14336, 14464]);
    expect(descriptors.map((sheet) => sheet.capacity)).toEqual([768, 1536, 1536, 2304, 128, 256]);
    expect(descriptors[0].firstTileId).toBe(EXTENDED_TILESET_FIRST_TILE_ID);
  });

  it('continues labels after Z and migrates missing metadata as normal sheets', () => {
    const names = [...stockNames, ...Array.from({ length: 23 }, (_, index) => `Sheet${index}`)];
    const descriptors = buildExtendedTilesetDescriptors(names, undefined);
    expect(descriptors[20].label).toBe('Z');
    expect(descriptors[21].label).toBe('F1');
    expect(descriptors[22].label).toBe('F2');
    expect(normalizeExtendedTilesetTypes(names, undefined)).toEqual(Array(23).fill('normal'));
  });

  it('encodes and decodes extended autotiles without changing their sheet identity', () => {
    const [sheet] = buildExtendedTilesetDescriptors([...stockNames, 'Ground'], ['A2']);
    const tileId = encodeExtendedAutotileId(sheet, 7, 31);
    expect(decodeExtendedAutotileId([sheet], tileId)).toEqual({ descriptor: sheet, localKind: 7, shape: 31 });
  });

  it('validates the selected image against the exact sheet layout', () => {
    expect(() => validateExtendedTilesetImageDimensions('A4', 768, 720, 48)).not.toThrow();
    expect(() => validateExtendedTilesetImageDimensions('A4', 768, 768, 48)).toThrow(/requires 768x720/);
  });

  it('resolves extended A2 neighbours and automatic layers with stock-compatible rules', () => {
    const [sheet] = buildExtendedTilesetDescriptors([...stockNames, 'Ground'], ['A2']);
    const map = { width: 3, height: 3, data: Array(3 * 3 * RMMV_MAP_LAYERS).fill(0) };
    const lower = applyRmmvMapBrushEdits(map, [{
      kind: 'autotile', x: 1, y: 1, layer: 'auto', autotileKind: 0, tilesetSlot: 9, extendedTilesetType: 'A2',
    }], { engine: 'rpg-maker-mv', tilesetMode: 1, extendedTilesetSheets: [sheet] });
    const stock = applyRmmvMapBrushEdits(map, [
      { kind: 'autotile', x: 1, y: 1, layer: 'auto', autotileKind: 16 },
    ], { engine: 'rpg-maker-mv', tilesetMode: 1 });
    const stockShape = stock.data[1 * 3 + 1] - 2816;
    expect(lower.data[1 * 3 + 1]).toBe(sheet.firstTileId + stockShape);

    const upper = applyRmmvMapBrushEdits(map, [{
      kind: 'autotile', x: 1, y: 1, layer: 'auto', autotileKind: 4, tilesetSlot: 9, extendedTilesetType: 'A2',
    }], { engine: 'rpg-maker-mv', tilesetMode: 1, extendedTilesetSheets: [sheet] });
    const stockUpper = applyRmmvMapBrushEdits(map, [
      { kind: 'autotile', x: 1, y: 1, layer: 'auto', autotileKind: 20 },
    ], { engine: 'rpg-maker-mv', tilesetMode: 1 });
    const stockUpperShape = stockUpper.data[9 + 1 * 3 + 1] - (2816 + 4 * 48);
    expect(upper.data[9 + 1 * 3 + 1]).toBe(sheet.firstTileId + 4 * 48 + stockUpperShape);
  });

  it('places every extended autotile family in its stock-compatible automatic layer', () => {
    const cases = [
      { type: 'A1', localKind: 0, layer: 0 },
      { type: 'A2', localKind: 4, layer: 1 },
      { type: 'A3', localKind: 0, layer: 0 },
      { type: 'A4', localKind: 0, layer: 0 },
    ] as const;
    for (const item of cases) {
      const [sheet] = buildExtendedTilesetDescriptors([...stockNames, `Extra${item.type}`], [item.type]);
      const map = { width: 1, height: 1, data: Array(RMMV_MAP_LAYERS).fill(0) };
      const result = applyRmmvMapBrushEdits(map, [{
        kind: 'autotile', x: 0, y: 0, layer: 'auto', autotileKind: item.localKind,
        tilesetSlot: sheet.slotIndex, extendedTilesetType: item.type,
      }], { engine: 'rpg-maker-mz', tilesetMode: 1, extendedTilesetSheets: [sheet] });
      const tileId = result.data[item.layer];
      const decoded = decodeExtendedAutotileId([sheet], tileId);
      expect(decoded?.descriptor.type).toBe(item.type);
      expect(decoded?.localKind).toBe(item.localKind);
    }
  });

  it('treats extended A5 as a lower tile and normal sheets as upper tiles', () => {
    const names = [...stockNames, 'ExtraA5', 'ExtraNormal'];
    const [a5, normal] = buildExtendedTilesetDescriptors(names, ['A5', 'normal']);
    const map = { width: 1, height: 1, data: Array(RMMV_MAP_LAYERS).fill(0) };
    const lower = applyRmmvMapBrushEdits(map, [{
      kind: 'tile', x: 0, y: 0, layer: 'auto', tileId: a5.firstTileId,
    }], { engine: 'rpg-maker-mv', tilesetMode: 1, extendedTilesetSheets: [a5, normal] });
    expect(lower.data[0]).toBe(a5.firstTileId);

    const upper = applyRmmvMapBrushEdits({ ...map, data: lower.data }, [{
      kind: 'tile', x: 0, y: 0, layer: 'auto', tileId: normal.firstTileId,
    }], { engine: 'rpg-maker-mv', tilesetMode: 1, extendedTilesetSheets: [a5, normal] });
    expect(upper.data[2]).toBe(normal.firstTileId);
  });
});
