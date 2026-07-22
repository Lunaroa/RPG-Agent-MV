import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { mapCellViewportTarget } from './mapCanvasViewport.ts';

const base = {
  tileSize: 48,
  zoom: 1,
  safeMargin: 64,
  scrollLeft: 240,
  scrollTop: 160,
  viewportWidth: 800,
  viewportHeight: 600,
  contentWidth: 2400,
  contentHeight: 1800,
};

describe('map cell viewport target', () => {
  test('keeps the current position when the complete cell is inside the safety margin', () => {
    assert.deepEqual(mapCellViewportTarget({ ...base, cellX: 10, cellY: 7 }), {
      scrollLeft: 240,
      scrollTop: 160,
      moved: false,
    });
  });

  test('centers a cell outside the visible area without changing the zoom calculation', () => {
    assert.deepEqual(mapCellViewportTarget({ ...base, zoom: 1.5, cellX: 24, cellY: 18 }), {
      scrollLeft: 1364,
      scrollTop: 1032,
      moved: true,
    });
  });

  test('clamps centering to the map edges', () => {
    assert.deepEqual(mapCellViewportTarget({
      ...base,
      scrollLeft: 500,
      scrollTop: 500,
      cellX: 0,
      cellY: 0,
    }), {
      scrollLeft: 0,
      scrollTop: 0,
      moved: true,
    });
    assert.deepEqual(mapCellViewportTarget({ ...base, cellX: 49, cellY: 37 }), {
      scrollLeft: 1600,
      scrollTop: 1200,
      moved: true,
    });
  });

  test('does not invent scrolling when the map is smaller than the viewport', () => {
    assert.deepEqual(mapCellViewportTarget({
      ...base,
      cellX: 2,
      cellY: 1,
      scrollLeft: 90,
      scrollTop: 60,
      contentWidth: 240,
      contentHeight: 144,
    }), {
      scrollLeft: 0,
      scrollTop: 0,
      moved: false,
    });
  });
});
