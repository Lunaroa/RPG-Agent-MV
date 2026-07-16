import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { drawMapContent, type MvMap } from './useMapRenderer.ts';

interface DrawCall {
  image: HTMLImageElement;
  args: number[];
}

describe('map parallax rendering', () => {
  test('draws the parallax before tiles at native pixel size', () => {
    const parallax = image(128, 128);
    const tileset = image(768, 768);
    const { context, calls } = recordingContext();
    const map = createMap({ data: [1], parallaxName: 'Clouds', parallaxShow: true });

    drawMapContent(context, map, { tilesetImages: [null, null, null, null, null, tileset], parallaxImage: parallax, tileSize: 48 });

    assert.equal(calls[0].image, parallax);
    assert.deepEqual(calls[0].args, [0, 0]);
    assert.equal(calls[1].image, tileset);
  });

  test('covers the full map at native size regardless of scrolling flags', () => {
    const parallax = image(32, 24);
    const expectedPositions = [
      [0, 0], [32, 0], [64, 0],
      [0, 24], [32, 24], [64, 24],
      [0, 48], [32, 48], [64, 48],
    ];

    for (const scrollingFlags of [
      {},
      { parallaxLoopX: true },
      { parallaxLoopY: true },
      { parallaxLoopX: true, parallaxLoopY: true },
    ]) {
      const rendered = recordingContext();
      drawMapContent(rendered.context, createMap({
        width: 5,
        height: 4,
        parallaxName: 'Clouds',
        parallaxShow: true,
        ...scrollingFlags,
      }), {
        tilesetImages: [], parallaxImage: parallax, tileSize: 16,
      });

      assert.deepEqual(rendered.calls.map((call) => call.args), expectedPositions);
      assert.ok(rendered.calls.every((call) => call.args.length === 2));
    }
  });

  test('does not draw a hidden preview and keeps native size across MV and MZ tile sizes', () => {
    const parallax = image(40, 30);
    const hidden = recordingContext();
    drawMapContent(hidden.context, createMap({ parallaxName: 'Clouds', parallaxShow: false }), {
      tilesetImages: [], parallaxImage: parallax, tileSize: 48,
    });
    assert.equal(hidden.calls.length, 0);

    for (const tileSize of [48, 32]) {
      const rendered = recordingContext();
      drawMapContent(rendered.context, createMap({ parallaxName: 'Clouds', parallaxShow: true }), {
        tilesetImages: [], parallaxImage: parallax, tileSize,
      });
      assert.deepEqual(rendered.calls[0].args, [0, 0]);
    }
  });
});

function createMap(overrides: Partial<MvMap>): MvMap {
  const width = overrides.width || 2;
  const height = overrides.height || 2;
  return {
    width,
    height,
    data: Array(width * height * 6).fill(0),
    events: [],
    ...overrides,
  };
}

function image(naturalWidth: number, naturalHeight: number): HTMLImageElement {
  return { naturalWidth, naturalHeight } as HTMLImageElement;
}

function recordingContext(): { context: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const context = {
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    drawImage(imageValue: HTMLImageElement, ...args: number[]) { calls.push({ image: imageValue, args }); },
    fillStyle: '',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}
