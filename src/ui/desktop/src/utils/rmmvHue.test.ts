import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { rotateHuePixelsLikeMv } from './rmmvHue.ts';

describe('RPG Maker MV hue rotation', () => {
  test('rotates RGB pixels with the MV HSL algorithm and preserves alpha', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 128,
      64, 64, 64, 200,
    ]);
    rotateHuePixelsLikeMv(pixels, 120);
    assert.deepEqual([...pixels], [
      0, 255, 0, 128,
      64, 64, 64, 200,
    ]);
  });

  test('normalizes negative and full-turn offsets', () => {
    const negative = new Uint8ClampedArray([255, 0, 0, 255]);
    rotateHuePixelsLikeMv(negative, -120);
    assert.deepEqual([...negative], [0, 0, 255, 255]);
    const full = new Uint8ClampedArray([12, 34, 56, 78]);
    rotateHuePixelsLikeMv(full, 360);
    assert.deepEqual([...full], [12, 34, 56, 78]);
  });
});
