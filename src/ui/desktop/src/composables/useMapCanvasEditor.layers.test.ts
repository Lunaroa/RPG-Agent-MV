import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyRmmvMapBrushEdits } from '@contract/rmmv-map-brush';
import {
  buildLayerStackEdits,
  buildMapRangeBrush,
  buildStackFloodFillEdits,
  type LayerBrushSample,
} from './useMapCanvasEditor.ts';
import { patternPlacements } from '../utils/mapCopyBrush.ts';

const emptyMapData = (width: number, height: number) => new Array(width * height * 6).fill(0);

describe('MV and MZ four-layer canvas operations', () => {
  test('keeps ordinary and empty layers exact while automatic tiles reconnect unless exact mode is requested', () => {
    const layerStack: LayerBrushSample[] = [
      { tileId: 2049, autotileKind: 0 },
      { tileId: 2098, preserveAutotileShape: true },
      { tileId: 4 },
      { tileId: 0 },
    ];

    assert.deepEqual(buildLayerStackEdits(2, 3, 'auto', layerStack), [
      { kind: 'autotile', x: 2, y: 3, layer: 0, autotileKind: 0 },
      { kind: 'tile', x: 2, y: 3, layer: 1, tileId: 2098, preserveAutotileShape: true },
      { kind: 'tile', x: 2, y: 3, layer: 2, tileId: 4, preserveAutotileShape: false },
      { kind: 'tile', x: 2, y: 3, layer: 3, tileId: 0, preserveAutotileShape: false },
    ]);
    assert.deepEqual(buildLayerStackEdits(2, 3, 'auto', layerStack, true)[0], {
      kind: 'tile',
      x: 2,
      y: 3,
      layer: 0,
      tileId: 2049,
      preserveAutotileShape: true,
    });
    assert.deepEqual(buildLayerStackEdits(2, 3, 2, layerStack), [{
      kind: 'tile',
      x: 2,
      y: 3,
      layer: 2,
      tileId: 4,
      preserveAutotileShape: false,
    }]);
  });

  test('flood-fills only cells whose complete four-layer stack matches', () => {
    const map = {
      width: 3,
      height: 1,
      data: [
        1, 1, 1,
        2, 2, 2,
        3, 3, 3,
        4, 4, 9,
        0, 0, 0,
        0, 0, 0,
      ],
    };
    const replacement = [10, 11, 12, 13].map((tileId) => ({ tileId }));

    const edits = buildStackFloodFillEdits(map, { x: 0, y: 0 }, replacement);
    assert.equal(edits.length, 8);
    assert.deepEqual([...new Set(edits.map((edit) => `${edit.x},${edit.y}`))].sort(), ['0,0', '1,0']);
    assert.deepEqual(edits.slice(0, 4).map((edit) => [edit.layer, edit.tileId]), [[0, 10], [1, 11], [2, 12], [3, 13]]);
    assert.deepEqual(buildStackFloodFillEdits(map, { x: 0, y: 0 }, [1, 2, 3, 4].map((tileId) => ({ tileId }))), []);
  });

  test('samples an automatic-layer rectangle as four layers with adaptive autotile kinds', () => {
    const map = {
      width: 2,
      height: 2,
      data: [
        2048, 2049, 2096, 2097,
        0, 8, 0, 9,
        12, 0, 13, 0,
        0, 0, 0, 14,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ],
    };
    const brush = buildMapRangeBrush(map, { x: 0, y: 0 }, { x: 1, y: 1 }, 'auto');
    assert.equal(brush.type, 'stackRect');
    if (brush.type !== 'stackRect') return;
    assert.deepEqual([brush.width, brush.height, brush.hotspotX, brush.hotspotY], [2, 2, 1, 1]);
    assert.deepEqual(brush.cells.map((cell) => cell.layerStack), [
      [{ tileId: 2048, autotileKind: 0 }, { tileId: 0 }, { tileId: 12 }, { tileId: 0 }],
      [{ tileId: 2049, autotileKind: 0 }, { tileId: 8 }, { tileId: 0 }, { tileId: 0 }],
      [{ tileId: 2096, autotileKind: 1 }, { tileId: 0 }, { tileId: 13 }, { tileId: 0 }],
      [{ tileId: 2097, autotileKind: 1 }, { tileId: 9 }, { tileId: 0 }, { tileId: 14 }],
    ]);
  });

  test('uses adaptive kinds for normal manual ranges and exact tile ids for Shift ranges', () => {
    const map = {
      width: 2,
      height: 1,
      data: [0, 0, 2048, 2049, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const range = buildMapRangeBrush(map, { x: 1, y: 0 }, { x: 0, y: 0 }, 1);
    assert.equal(range.type, 'tileRect');
    if (range.type !== 'tileRect') return;
    assert.deepEqual([range.hotspotX, range.hotspotY], [0, 0]);
    assert.deepEqual(range.cells.map((cell) => [cell.tileId, cell.autotileKind, cell.preserveAutotileShape]), [
      [2048, 0, undefined],
      [2049, 0, undefined],
    ]);

    const exact = buildMapRangeBrush(map, { x: 1, y: 0 }, { x: 0, y: 0 }, 1, true);
    assert.equal(exact.type, 'tileRect');
    assert.deepEqual(exact.cells.map((cell) => [cell.tileId, cell.autotileKind, cell.preserveAutotileShape]), [
      [2048, undefined, true],
      [2049, undefined, true],
    ]);
  });

  test('normal map sampling reconnects a copied water corner exactly like a palette autotile brush', () => {
    const width = 6;
    const sampledMap = { width, height: 1, data: emptyMapData(width, 1) };
    sampledMap.data[0] = 2048;
    const directMap = { width, height: 1, data: sampledMap.data.slice() };
    const brush = buildMapRangeBrush(sampledMap, { x: 0, y: 0 }, { x: 0, y: 0 }, 'auto');
    assert.equal(brush.type, 'stackRect');
    if (brush.type !== 'stackRect') return;
    const layerStack = brush.cells[0]?.layerStack;
    assert.ok(layerStack);

    const sampledEdits = [1, 2, 3, 4, 5].flatMap((x) => buildLayerStackEdits(x, 0, 'auto', layerStack));
    const paletteEdits = [1, 2, 3, 4, 5].map((x) => ({ kind: 'autotile' as const, x, y: 0, layer: 0, autotileKind: 0 }));
    const sampled = applyRmmvMapBrushEdits(sampledMap, sampledEdits, { engine: 'rpg-maker-mv', tilesetMode: 1 });
    const direct = applyRmmvMapBrushEdits(directMap, paletteEdits, { engine: 'rpg-maker-mv', tilesetMode: 1 });
    assert.deepEqual(sampled.data, direct.data);
  });

  test('Shift map sampling preserves the copied water corner while normal upper layers still copy exactly', () => {
    const map = { width: 4, height: 1, data: emptyMapData(4, 1) };
    map.data[0] = 2048;
    map.data[map.width * 2] = 12;
    const brush = buildMapRangeBrush(map, { x: 0, y: 0 }, { x: 0, y: 0 }, 'auto', true);
    assert.equal(brush.type, 'stackRect');
    if (brush.type !== 'stackRect') return;
    const layerStack = brush.cells[0]?.layerStack;
    assert.ok(layerStack);

    const edits = [1, 2, 3].flatMap((x) => buildLayerStackEdits(x, 0, 'auto', layerStack));
    const result = applyRmmvMapBrushEdits(map, edits, { engine: 'rpg-maker-mv', tilesetMode: 1 });
    assert.deepEqual(result.data.slice(1, 4), [2048, 2048, 2048]);
    assert.deepEqual(result.data.slice(map.width * 2 + 1, map.width * 3), [12, 12, 12]);
  });

  test('pastes adaptive autotiles and exact ordinary or empty upper layers with one fixed pattern phase', () => {
    const map = {
      width: 4,
      height: 1,
      data: [
        2048, 2049, 300, 301,
        0, 8, 9, 10,
        12, 0, 13, 14,
        0, 0, 15, 16,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ],
    };
    const brush = buildMapRangeBrush(map, { x: 0, y: 0 }, { x: 1, y: 0 }, 'auto');
    assert.equal(brush.type, 'stackRect');
    if (brush.type !== 'stackRect') return;
    const sourceCells = new Map(brush.cells.map((cell) => [`${cell.dx},${cell.dy}`, cell]));
    const edits = patternPlacements(
      { x: 3, y: 0 },
      { x: 3, y: 0 },
      { width: brush.width, height: brush.height, hotspotX: brush.hotspotX, hotspotY: brush.hotspotY },
      'rect',
    ).flatMap((placement) => {
      const source = sourceCells.get(`${placement.sourceDx},${placement.sourceDy}`);
      return source?.layerStack ? buildLayerStackEdits(placement.x, placement.y, 'auto', source.layerStack) : [];
    });
    const result = applyRmmvMapBrushEdits(map, edits, { engine: 'rpg-maker-mv', tilesetMode: 1 });
    const layerSize = map.width * map.height;
    assert.deepEqual([2, 3].map((x) => [1, 2, 3].map((layer) => result.data[layer * layerSize + x])), [
      [0, 12, 0],
      [8, 0, 0],
    ]);
    assert.equal(Math.floor((result.data[2] - 2048) / 48), 0);
    assert.equal(Math.floor((result.data[3] - 2048) / 48), 0);
  });
});
