import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildLayerStackEdits, buildStackFloodFillEdits } from './useMapCanvasEditor.ts';

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
});
