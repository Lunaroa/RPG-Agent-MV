import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MV_REGION_ALPHA,
  MV_REGION_PALETTE_COLS,
  MV_REGION_PALETTE_ROWS,
  MV_REGION_SOURCE_COLORS,
  paintModeForPaletteTab,
  regionLabelFontSize,
  regionIdForPaletteCell,
  regionPaletteLayout,
  regionPaletteCellForId,
  regionSourceColor,
  shouldShowRegionOverlay,
  tileTabForShadow,
  visibleRegionViewport,
} from './mvRegionPalette.ts';

describe('MV region palette mapping', () => {
  test('maps the original eight by thirty-two R grid from 0 through 255', () => {
    assert.equal(MV_REGION_PALETTE_COLS, 8);
    assert.equal(MV_REGION_PALETTE_ROWS, 32);
    assert.equal(regionIdForPaletteCell(0, 0), 0);
    assert.equal(regionIdForPaletteCell(1, 0), 1);
    assert.equal(regionIdForPaletteCell(7, 0), 7);
    assert.equal(regionIdForPaletteCell(0, 1), 8);
    assert.equal(regionIdForPaletteCell(4, 1), 12);
    assert.equal(regionIdForPaletteCell(3, 15), 123);
    assert.equal(regionIdForPaletteCell(7, 31), 255);
    assert.equal(regionIdForPaletteCell(8, 0), null);
    assert.equal(regionIdForPaletteCell(0, 32), null);
  });

  test('round-trips representative region ids and keeps zero as the blank eraser cell', () => {
    for (const regionId of [0, 1, 7, 8, 12, 123, 255]) {
      const cell = regionPaletteCellForId(regionId);
      assert.ok(cell);
      assert.equal(regionIdForPaletteCell(cell.col, cell.row), regionId);
    }
    assert.equal(regionSourceColor(0), null);
    assert.equal(regionPaletteCellForId(256), null);
  });

  test('uses one twelve-color source cycle and one alpha rule', () => {
    assert.equal(MV_REGION_SOURCE_COLORS.length, 12);
    assert.equal(MV_REGION_ALPHA, .5);
    assert.equal(regionSourceColor(1), '#830000');
    assert.equal(regionSourceColor(12), '#830037');
    assert.equal(regionSourceColor(13), '#830000');
    assert.equal(regionSourceColor(255), MV_REGION_SOURCE_COLORS[(255 - 1) % 12]);
  });

  test('derives tile versus region editing from the selected palette tab', () => {
    assert.equal(paintModeForPaletteTab('A'), 'tile');
    assert.equal(paintModeForPaletteTab('E'), 'tile');
    assert.equal(paintModeForPaletteTab('R'), 'region');
    assert.equal(tileTabForShadow('R', 'C'), 'C');
    assert.equal(tileTabForShadow('B', 'C'), 'B');
  });

  test('keeps region preview independent while R always shows its editing overlay', () => {
    assert.equal(shouldShowRegionOverlay('map', 'tile', 'A', false), false);
    assert.equal(shouldShowRegionOverlay('map', 'tile', 'A', true), true);
    assert.equal(shouldShowRegionOverlay('map', 'shadow', 'C', true), true);
    assert.equal(shouldShowRegionOverlay('map', 'region', 'R', false), true);
    assert.equal(shouldShowRegionOverlay('event', 'region', 'R', true), false);
  });

  test('renders the R palette at its final CSS size and device pixel ratio', () => {
    for (const width of [320, 354, 384]) {
      for (const ratio of [1, 1.25, 1.5, 2]) {
        const layout = regionPaletteLayout(width, ratio);
        assert.equal(layout.cssWidth, width);
        assert.equal(layout.cssHeight, width * 4);
        assert.equal(layout.cellSize, width / 8);
        assert.equal(layout.pixelWidth, Math.round(width * ratio));
        assert.equal(layout.pixelHeight, Math.round(width * 4 * ratio));
        assert.equal(layout.scaleX, layout.pixelWidth / layout.cssWidth);
        assert.equal(layout.scaleY, layout.pixelHeight / layout.cssHeight);
      }
    }
  });

  test('scales the regular-weight region label from the final displayed cell size', () => {
    assert.equal(regionLabelFontSize(12), 4.5);
    assert.equal(regionLabelFontSize(48), 18);
    assert.equal(regionLabelFontSize(72), 27);
    assert.equal(regionLabelFontSize(96), 36);
  });

  test('limits region labels to the visible viewport plus one overscan cell', () => {
    const expectedTileSizes = new Map([
      [.25, 12], [.5, 24], [.75, 36], [1, 48], [1.25, 60], [1.5, 72], [1.75, 84], [2, 96],
    ]);
    for (const [zoom, displayTileSize] of expectedTileSizes) {
      const viewport = visibleRegionViewport({
        mapWidth: 100,
        mapHeight: 80,
        tileSize: 48,
        zoom,
        scrollLeft: displayTileSize * 10,
        scrollTop: displayTileSize * 5,
        viewportWidth: displayTileSize * 8,
        viewportHeight: displayTileSize * 6,
      });
      assert.equal(viewport.displayTileSize, displayTileSize);
      assert.deepEqual(
        { startCol: viewport.startCol, endCol: viewport.endCol, startRow: viewport.startRow, endRow: viewport.endRow },
        { startCol: 9, endCol: 19, startRow: 4, endRow: 12 },
      );
    }
  });

  test('clamps viewport label work to map boundaries', () => {
    assert.deepEqual(visibleRegionViewport({
      mapWidth: 4,
      mapHeight: 3,
      tileSize: 48,
      zoom: 2,
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 800,
      viewportHeight: 600,
    }), {
      startCol: 0,
      endCol: 4,
      startRow: 0,
      endRow: 3,
      displayTileSize: 96,
    });
  });
});
