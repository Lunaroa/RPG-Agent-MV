import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyRmmvMapBrushEdits } from '@contract/rmmv-map-brush';
import { buildLayerStackEdits, buildMapRangeBrush, buildStackFloodFillEdits } from './useMapCanvasEditor.ts';
import { patternPlacements } from '../utils/mapCopyBrush.ts';

describe('MV and MZ four-layer canvas operations', () => {
  test('writes a copied stack to all layers in auto mode and only the selected manual layer', () => {
    const layerTiles = [1536, 2048, 4, 5];

    assert.deepEqual(
      buildLayerStackEdits(2, 3, 'auto', layerTiles).map((edit) => [edit.layer, edit.tileId, edit.preserveAutotileShape]),
      [[0, 1536, false], [1, 2048, true], [2, 4, false], [3, 5, false]],
    );
    assert.deepEqual(buildLayerStackEdits(2, 3, 2, layerTiles), [{
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

    const edits = buildStackFloodFillEdits(map, { x: 0, y: 0 }, [10, 11, 12, 13]);
    assert.equal(edits.length, 8);
    assert.deepEqual([...new Set(edits.map((edit) => `${edit.x},${edit.y}`))].sort(), ['0,0', '1,0']);
    assert.deepEqual(edits.slice(0, 4).map((edit) => [edit.layer, edit.tileId]), [[0, 10], [1, 11], [2, 12], [3, 13]]);
    assert.deepEqual(buildStackFloodFillEdits(map, { x: 0, y: 0 }, [1, 2, 3, 4]), []);
  });

  test('copies an automatic-layer rectangle exactly, including empty layers and the release hotspot', () => {
    const map = {
      width: 2,
      height: 2,
      data: [
        2048, 2096, 2144, 2192,
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
    assert.deepEqual(brush.cells.map((cell) => cell.layerTiles), [
      [2048, 0, 12, 0],
      [2096, 8, 0, 0],
      [2144, 0, 13, 0],
      [2192, 9, 0, 14],
    ]);
  });

  test('copies only the selected manual layer and preserves exact autotile shapes for ranges', () => {
    const map = {
      width: 2,
      height: 1,
      data: [0, 0, 2048, 2096, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    const range = buildMapRangeBrush(map, { x: 1, y: 0 }, { x: 0, y: 0 }, 1);
    assert.equal(range.type, 'tileRect');
    if (range.type !== 'tileRect') return;
    assert.deepEqual([range.hotspotX, range.hotspotY], [0, 0]);
    assert.deepEqual(range.cells.map((cell) => [cell.tileId, cell.autotileKind, cell.preserveAutotileShape]), [
      [2048, undefined, true],
      [2096, undefined, true],
    ]);

    const sampled = buildMapRangeBrush(map, { x: 0, y: 0 }, { x: 0, y: 0 }, 1);
    assert.equal(sampled.type, 'autotile');
    const exact = buildMapRangeBrush(map, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, true);
    assert.equal(exact.type, 'tile');
    assert.equal(exact.cells[0]?.preserveAutotileShape, true);
  });

  test('pastes the copied four-layer result exactly and clears old destination upper layers', () => {
    const map = {
      width: 4,
      height: 1,
      data: [
        2048, 2096, 300, 301,
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
      return source?.layerTiles ? buildLayerStackEdits(placement.x, placement.y, 'auto', source.layerTiles) : [];
    });
    const result = applyRmmvMapBrushEdits(map, edits, { engine: 'rpg-maker-mv', tilesetMode: 1 });
    const layerSize = map.width * map.height;
    const targetStacks = [2, 3].map((x) => [0, 1, 2, 3].map((layer) => result.data[layer * layerSize + x]));
    assert.deepEqual(targetStacks, [
      [2048, 0, 12, 0],
      [2096, 8, 0, 0],
    ]);
  });
});
