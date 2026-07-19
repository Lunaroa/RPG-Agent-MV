import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TileEdit } from './types.ts';
import {
  applyRmmvMapBrushEdits,
  RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
  RMMV_MAP_LAYERS,
  RMMV_TILE_ID_A1,
  type RmmvBrushMap,
} from './rmmv-map-brush.ts';

function blankMap(width = 4, height = 4): RmmvBrushMap {
  return { width, height, data: Array(width * height * RMMV_MAP_LAYERS).fill(0) };
}

function tileAt(map: RmmvBrushMap, layer: number, x: number, y: number): number {
  return map.data[layer * map.width * map.height + y * map.width + x] || 0;
}

function setTile(map: RmmvBrushMap, layer: number, x: number, y: number, tileId: number): void {
  map.data[layer * map.width * map.height + y * map.width + x] = tileId;
}

const representativeAutotiles = [
  { label: 'A1 floor', kind: 0, exactShape: 47 },
  { label: 'A1 waterfall', kind: 5, exactShape: 3 },
  { label: 'A2 floor', kind: 16, exactShape: 47 },
  { label: 'A3 wall', kind: 48, exactShape: 15 },
  { label: 'A4 floor', kind: 80, exactShape: 47 },
  { label: 'A4 wall', kind: 88, exactShape: 15 },
] as const;

describe('shared RMMV map brush core', () => {
  test('previews automatic upper-layer stacking in the same order as the final batch', () => {
    const map = blankMap(2, 1);
    map.data[2 * 2] = 10;
    map.data[3 * 2] = 11;

    const result = applyRmmvMapBrushEdits(map, [
      { kind: 'tile', x: 0, y: 0, layer: 'auto', tileId: 12 },
      { kind: 'tile', x: 1, y: 0, layer: 'auto', tileId: 13 },
    ], { engine: 'rpg-maker-mv', tilesetMode: 1 });

    assert.equal(tileAt({ ...map, data: result.data }, 2, 0, 0), 11);
    assert.equal(tileAt({ ...map, data: result.data }, 3, 0, 0), 12);
    assert.equal(tileAt({ ...map, data: result.data }, 2, 1, 0), 13);
    assert.equal(result.changes.length, 3);
  });

  test('keeps affected-neighbour preview identical to full autotile resolution on a valid map', () => {
    const seed = blankMap(5, 3);
    const initial = applyRmmvMapBrushEdits(seed, [
      { kind: 'autotile', x: 1, y: 1, layer: 'auto', autotileKind: 16 },
      { kind: 'autotile', x: 2, y: 1, layer: 'auto', autotileKind: 16 },
    ], { engine: 'rpg-maker-mv', tilesetMode: 1 });
    const valid = { ...seed, data: initial.data };
    const edits: TileEdit[] = [
      { kind: 'autotile', x: 3, y: 1, layer: 'auto', autotileKind: 16 },
      { kind: 'autotile', x: 3, y: 2, layer: 'auto', autotileKind: 16 },
    ];

    const full = applyRmmvMapBrushEdits(valid, edits, { engine: 'rpg-maker-mv', tilesetMode: 1 });
    const affected = applyRmmvMapBrushEdits(valid, edits, {
      engine: 'rpg-maker-mv', tilesetMode: 1, autotileResolution: 'affected',
    });

    assert.deepEqual(affected.data, full.data);
    assert.ok(affected.touchedIndices.length <= 18);
    assert.ok(affected.data.some((tileId) => tileId >= RMMV_TILE_ID_A1));
  });

  test('keeps affected-neighbour resolution identical to a full pass for canonical A1-A4 maps', () => {
    for (const engine of ['rpg-maker-mv', 'rpg-maker-mz'] as const) {
      for (const autotile of representativeAutotiles) {
        const seed = blankMap(7, 5);
        const initial = applyRmmvMapBrushEdits(seed, [
          { kind: 'autotile', x: 1, y: 1, layer: 0, autotileKind: autotile.kind },
          { kind: 'autotile', x: 2, y: 1, layer: 0, autotileKind: autotile.kind },
          { kind: 'autotile', x: 1, y: 2, layer: 0, autotileKind: autotile.kind },
        ], { engine, tilesetMode: 1, autotileResolution: 'full' });
        const valid = { ...seed, data: initial.data };
        const edits: TileEdit[] = [
          { kind: 'autotile', x: 2, y: 2, layer: 0, autotileKind: autotile.kind },
          { kind: 'autotile', x: 3, y: 2, layer: 0, autotileKind: autotile.kind },
        ];

        const full = applyRmmvMapBrushEdits(valid, edits, {
          engine,
          tilesetMode: 1,
          autotileResolution: 'full',
        });
        const affected = applyRmmvMapBrushEdits(valid, edits, {
          engine,
          tilesetMode: 1,
          autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
        });

        assert.deepEqual(affected.data, full.data, `${engine} ${autotile.label}`);
      }
    }
  });

  test('does not rewrite distant exact A1-A4 shapes during an interactive stroke', () => {
    for (const engine of ['rpg-maker-mv', 'rpg-maker-mz'] as const) {
      for (const autotile of representativeAutotiles) {
        const map = blankMap(9, 5);
        const distantTileId = RMMV_TILE_ID_A1 + autotile.kind * 48 + autotile.exactShape;
        setTile(map, 0, 7, 3, distantTileId);

        const result = applyRmmvMapBrushEdits(map, [
          { kind: 'autotile', x: 1, y: 1, layer: 0, autotileKind: autotile.kind },
        ], {
          engine,
          tilesetMode: 1,
          autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
        });
        const rendered = { ...map, data: result.data };

        assert.equal(tileAt(rendered, 0, 7, 3), distantTileId, `${engine} ${autotile.label}`);
        assert.ok(
          result.changes.every((change) => Math.abs(change.x - 1) <= 1 && Math.abs(change.y - 1) <= 1),
          `${engine} ${autotile.label} changed a distant cell`,
        );
      }
    }
  });

  test('produces the same final data for incremental preview and one persisted batch', () => {
    const path: TileEdit[] = [
      { kind: 'autotile', x: 1, y: 1, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 2, y: 1, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 3, y: 1, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 3, y: 2, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 3, y: 3, layer: 0, autotileKind: 16 },
    ];
    const seed = blankMap(7, 5);
    const preview = { ...seed, data: seed.data.slice() };
    for (const edit of path) {
      applyRmmvMapBrushEdits(preview, [edit], {
        engine: 'rpg-maker-mv',
        tilesetMode: 1,
        autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
        mutate: true,
        collectChanges: false,
      });
    }
    const persisted = applyRmmvMapBrushEdits(seed, path, {
      engine: 'rpg-maker-mv',
      tilesetMode: 1,
      autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
    });

    assert.deepEqual(preview.data, persisted.data);
  });

  test('keeps incremental erase preview identical to the persisted erase batch', () => {
    const seed = blankMap(7, 5);
    const painted = applyRmmvMapBrushEdits(seed, [
      { kind: 'autotile', x: 1, y: 1, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 2, y: 1, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 3, y: 1, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 1, y: 2, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 2, y: 2, layer: 0, autotileKind: 16 },
      { kind: 'autotile', x: 3, y: 2, layer: 0, autotileKind: 16 },
    ], { engine: 'rpg-maker-mv', tilesetMode: 1, autotileResolution: 'full' });
    const valid = { ...seed, data: painted.data };
    const erases: TileEdit[] = [
      { kind: 'tile', x: 2, y: 1, layer: 0, tileId: 0 },
      { kind: 'tile', x: 2, y: 2, layer: 0, tileId: 0 },
    ];
    const preview = { ...valid, data: valid.data.slice() };
    for (const edit of erases) {
      applyRmmvMapBrushEdits(preview, [edit], {
        engine: 'rpg-maker-mv',
        tilesetMode: 1,
        autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
        mutate: true,
        collectChanges: false,
      });
    }
    const persisted = applyRmmvMapBrushEdits(valid, erases, {
      engine: 'rpg-maker-mv',
      tilesetMode: 1,
      autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION,
    });

    assert.deepEqual(preview.data, persisted.data);
  });

  test('mutates only the current preview map and skips whole-map change collection', () => {
    const map = blankMap(100, 100);
    const original = map.data;
    const result = applyRmmvMapBrushEdits(map, [
      { kind: 'tile', x: 50, y: 50, layer: 'auto', tileId: 8 },
    ], {
      engine: 'rpg-maker-mv', tilesetMode: 1, autotileResolution: 'affected', mutate: true, collectChanges: false,
    });

    assert.equal(result.data, original);
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.touchedIndices, [2 * 100 * 100 + 50 * 100 + 50]);
  });

  test('applies region, shadow and MZ autoshadow changes through the shared rules', () => {
    const map = blankMap(3, 3);
    const edits: TileEdit[] = [
      { kind: 'region', x: 0, y: 0, layer: 5, regionId: 123 },
      { kind: 'shadow', x: 0, y: 1, layer: 4, shadowBits: 9 },
      { kind: 'autotile', x: 0, y: 1, layer: 0, autotileKind: 48 },
      { kind: 'autotile', x: 0, y: 0, layer: 0, autotileKind: 48 },
    ];
    const result = applyRmmvMapBrushEdits(map, edits, { engine: 'rpg-maker-mz', tilesetMode: 1 });
    const rendered = { ...map, data: result.data };

    assert.equal(tileAt(rendered, 5, 0, 0), 123);
    assert.equal(tileAt(rendered, 4, 0, 1), 9);
    assert.equal(tileAt(rendered, 4, 1, 1), 5);
    assert.ok(tileAt(rendered, 0, 0, 1) >= RMMV_TILE_ID_A1);
  });
});
