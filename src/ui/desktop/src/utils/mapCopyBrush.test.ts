import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  brushPathPatternPlacements,
  brushDragRect,
  brushOriginAt,
  brushRectAt,
  normalizeInclusiveCellRect,
  patternPlacements,
  rasterMapCellLine,
  type RectBrushFootprint,
} from './mapCopyBrush.ts';

const footprint: RectBrushFootprint = { width: 3, height: 2, hotspotX: 2, hotspotY: 1 };

describe('map copy brush geometry', () => {
  test('normalizes right-drag selection in all directions while keeping an inclusive range', () => {
    const expected = { minX: 2, minY: 3, maxX: 5, maxY: 7, width: 4, height: 5 };
    assert.deepEqual(normalizeInclusiveCellRect({ x: 2, y: 3 }, { x: 5, y: 7 }), expected);
    assert.deepEqual(normalizeInclusiveCellRect({ x: 5, y: 7 }, { x: 2, y: 3 }), expected);
    assert.deepEqual(normalizeInclusiveCellRect({ x: 2, y: 7 }, { x: 5, y: 3 }), expected);
    assert.deepEqual(normalizeInclusiveCellRect({ x: 5, y: 3 }, { x: 2, y: 7 }), expected);
  });

  test('keeps the release cell as the brush hotspot so the frame remains over its source', () => {
    assert.deepEqual(brushOriginAt({ x: 9, y: 6 }, footprint), { x: 7, y: 5 });
    assert.deepEqual(brushRectAt({ x: 9, y: 6 }, footprint), {
      minX: 7, minY: 5, maxX: 9, maxY: 6, width: 3, height: 2,
    });
  });

  test('treats a click as one complete multi-cell stamp', () => {
    const placements = patternPlacements({ x: 9, y: 6 }, { x: 9, y: 6 }, footprint, 'ellipse');
    assert.equal(placements.length, 6);
    assert.deepEqual(placements.map(({ x, y, sourceDx, sourceDy }) => [x, y, sourceDx, sourceDy]), [
      [7, 5, 0, 0], [8, 5, 1, 0], [9, 5, 2, 0],
      [7, 6, 0, 1], [8, 6, 1, 1], [9, 6, 2, 1],
    ]);
  });

  test('repeats the source pattern across rectangle drags without overlapping whole stamps', () => {
    const placements = patternPlacements({ x: 2, y: 1 }, { x: 4, y: 2 }, footprint, 'rect');
    assert.deepEqual(brushDragRect({ x: 2, y: 1 }, { x: 4, y: 2 }, footprint), {
      minX: 0, minY: 0, maxX: 4, maxY: 2, width: 5, height: 3,
    });
    assert.equal(placements.length, 15);
    assert.deepEqual(placements.filter((cell) => cell.y === 0).map((cell) => cell.sourceDx), [0, 1, 2, 0, 1]);
    assert.deepEqual(placements.filter((cell) => cell.x === 0).map((cell) => cell.sourceDy), [0, 1, 0]);
  });

  test('keeps pattern phase stable for reverse drags and clips ellipse cells to the shared bounds', () => {
    const forward = patternPlacements({ x: 2, y: 1 }, { x: 4, y: 3 }, footprint, 'rect');
    const reverse = patternPlacements({ x: 4, y: 3 }, { x: 2, y: 1 }, footprint, 'rect');
    assert.deepEqual(
      forward.map(({ x, y, sourceDx, sourceDy }) => [x, y, sourceDx, sourceDy]),
      reverse.map(({ x, y, sourceDx, sourceDy }) => [x, y, sourceDx, sourceDy]),
    );
    const ellipse = patternPlacements({ x: 2, y: 1 }, { x: 5, y: 4 }, footprint, 'ellipse');
    const bounds = brushDragRect({ x: 2, y: 1 }, { x: 5, y: 4 }, footprint);
    assert.ok(ellipse.length > 0);
    assert.ok(ellipse.length < bounds.width * bounds.height);
    assert.ok(ellipse.every((cell) => cell.x >= bounds.minX && cell.x <= bounds.maxX && cell.y >= bounds.minY && cell.y <= bounds.maxY));
  });

  test('extends a 4 by 2 copied brush as a non-overlapping repeated matrix while dragging', () => {
    const matrixFootprint: RectBrushFootprint = { width: 4, height: 2, hotspotX: 3, hotspotY: 1 };
    const placements = brushPathPatternPlacements(
      rasterMapCellLine({ x: 3, y: 1 }, { x: 3, y: 3 }),
      { x: 3, y: 1 },
      matrixFootprint,
    );
    const sourceMatrix = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ];
    const renderedRows = [0, 1, 2, 3].map((y) => placements
      .filter((cell) => cell.y === y)
      .map((cell) => sourceMatrix[cell.sourceDy][cell.sourceDx]));

    assert.deepEqual(renderedRows, [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  test('keeps the copied pattern phase while dragging horizontally and in reverse', () => {
    const matrixFootprint: RectBrushFootprint = { width: 4, height: 2, hotspotX: 3, hotspotY: 1 };
    const horizontal = brushPathPatternPlacements(
      rasterMapCellLine({ x: 3, y: 1 }, { x: 7, y: 1 }),
      { x: 3, y: 1 },
      matrixFootprint,
    );
    assert.deepEqual(
      horizontal.filter((cell) => cell.y === 0).map((cell) => cell.sourceDx),
      [0, 1, 2, 3, 0, 1, 2, 3],
    );

    const reverse = brushPathPatternPlacements(
      rasterMapCellLine({ x: 3, y: 3 }, { x: 3, y: 1 }),
      { x: 3, y: 3 },
      matrixFootprint,
    );
    assert.deepEqual(
      [0, 1, 2, 3].map((y) => reverse.find((cell) => cell.x === 0 && cell.y === y)?.sourceDy),
      [0, 1, 0, 1],
    );
  });

  test('fills fast pointer gaps and clips only the out-of-map portion without shifting the pattern', () => {
    assert.deepEqual(rasterMapCellLine({ x: 1, y: 1 }, { x: 1, y: 5 }), [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
      { x: 1, y: 5 },
    ]);

    const clipped = brushPathPatternPlacements(
      [{ x: 0, y: 0 }],
      { x: 0, y: 0 },
      { width: 4, height: 2, hotspotX: 3, hotspotY: 1 },
      { width: 3, height: 2 },
    );
    assert.deepEqual(clipped.map(({ x, y, sourceDx, sourceDy }) => [x, y, sourceDx, sourceDy]), [
      [0, 0, 3, 1],
    ]);
  });
});
