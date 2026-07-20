import { describe, expect, it } from 'vitest';

import {
  clampPreviewPan,
  clampPreviewPanOffset,
  PREVIEW_MIN_VISIBLE_EDGE,
  previewVisibleRegion,
} from './mapPreviewViewport';

describe('map preview viewport panning', () => {
  it('allows fitted and smaller maps to move while keeping a visible edge', () => {
    expect(clampPreviewPanOffset(10_000, 1_000, 800)).toBe(852);
    expect(clampPreviewPanOffset(-10_000, 1_000, 800)).toBe(-852);
    expect(PREVIEW_MIN_VISIBLE_EDGE).toBe(48);
  });

  it('allows maps equal to or larger than the viewport to reach every edge', () => {
    expect(clampPreviewPanOffset(10_000, 800, 800)).toBe(752);
    expect(clampPreviewPanOffset(-10_000, 800, 1_600)).toBe(-1_152);
  });

  it('allows panning at 50%, 75%, 100%, and enlarged display scales', () => {
    for (const displayScale of [.5, .75, 1, 1.25]) {
      const renderedSize = 1_600 * displayScale;
      expect(clampPreviewPanOffset(10_000, 1_000, renderedSize)).toBeGreaterThan(0);
      expect(clampPreviewPanOffset(-10_000, 1_000, renderedSize)).toBeLessThan(0);
    }
  });

  it('keeps the whole map visible when its rendered size is smaller than the visible edge', () => {
    expect(clampPreviewPanOffset(10_000, 600, 32)).toBe(284);
    expect(clampPreviewPanOffset(-10_000, 600, 32)).toBe(-284);
  });

  it('clamps both axes after zoom, resize, or map-size changes', () => {
    expect(clampPreviewPan({
      x: 2_000,
      y: -2_000,
      viewportWidth: 1_000,
      viewportHeight: 700,
      renderedWidth: 500,
      renderedHeight: 1_400,
    })).toEqual({ x: 702, y: -1_002 });
  });

  it('returns the centered offset before a usable viewport or map exists', () => {
    expect(clampPreviewPanOffset(120, 0, 800)).toBe(0);
    expect(clampPreviewPanOffset(120, 800, 0)).toBe(0);
  });

  it('keeps visible-region requests within the logical map after fitted panning', () => {
    const region = previewVisibleRegion({
      x: 852,
      y: -552,
      viewportWidth: 1_000,
      viewportHeight: 600,
      mapWidth: 1_600,
      mapHeight: 1_200,
      scale: .5,
    });
    expect(region).not.toBeNull();
    expect(region!.x).toBeGreaterThanOrEqual(0);
    expect(region!.y).toBeGreaterThanOrEqual(0);
    expect(region!.x + region!.width).toBeLessThanOrEqual(1_600);
    expect(region!.y + region!.height).toBeLessThanOrEqual(1_200);
    expect(region!.width).toBeGreaterThan(0);
    expect(region!.height).toBeGreaterThan(0);
  });
});
