import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { drawMapContent, type MvMap, type UldsDrawLayer } from './useMapRenderer.ts';

interface DrawCall {
  image: HTMLImageElement;
  args: number[];
}

function image(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

function layer(overrides: Partial<UldsDrawLayer> = {}): UldsDrawLayer {
  return {
    image: image(32, 32),
    x: 0,
    y: 0,
    z: 0.5,
    scaleX: 1,
    scaleY: 1,
    blendMode: 0,
    opacity: 255,
    loop: false,
    rotation: 0,
    anchorX: 0,
    anchorY: 0,
    ...overrides,
  };
}

function recordingContext(): { context: CanvasRenderingContext2D; calls: DrawCall[]; operations: string[] } {
  const calls: DrawCall[] = [];
  const operations: string[] = [];
  const context = {
    clearRect() {},
    fillRect() {},
    save() { operations.push('save'); },
    restore() { operations.push('restore'); },
    drawImage(imageValue: HTMLImageElement, ...args: number[]) { calls.push({ image: imageValue, args }); },
    translate() {},
    rotate() {},
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    set globalCompositeOperationSetter(value: string) { operations.push(value); },
  } as unknown as CanvasRenderingContext2D;
  const tracked = new Proxy(context, {
    set(target, property, value) {
      if (property === 'globalCompositeOperation') operations.push(`blend:${value}`);
      return Reflect.set(target, property, value);
    },
  }) as CanvasRenderingContext2D;
  return { context: tracked, calls, operations };
}

function createMap(overrides: Partial<MvMap> = {}): MvMap {
  return { width: 2, height: 2, data: [1, 0, 0, 0], events: [], ...overrides };
}

describe('ULDS layer rendering', () => {
  test('draws below-tile layers after the parallax and before tiles', () => {
    const ground = layer({ image: image(64, 64), z: 0 });
    const overlay = layer({ image: image(64, 64), z: 4 });
    const parallax = image(128, 128);
    const tileset = image(768, 768);
    const { context, calls } = recordingContext();

    drawMapContent(context, createMap({ parallaxName: 'Clouds', parallaxShow: true }), {
      tilesetImages: [null, null, null, null, null, tileset],
      parallaxImage: parallax,
      tileSize: 48,
      uldsLayers: [overlay, ground],
    });

    assert.equal(calls[0].image, parallax, 'parallax first');
    assert.equal(calls[1].image, ground.image, 'below-tile ULDS second');
    assert.equal(calls[2].image, tileset, 'tiles third');
    assert.ok(calls.some((call) => call.image === overlay.image), 'above-tile layer drawn');
    assert.ok(calls.findIndex((call) => call.image === overlay.image) > calls.findIndex((call) => call.image === tileset), 'above-tile after tiles');
  });

  test('sorts each z group ascending', () => {
    const low = layer({ z: 6 });
    const high = layer({ z: 9 });
    const { context, calls } = recordingContext();
    drawMapContent(context, createMap(), { tilesetImages: [], uldsLayers: [high, low] });
    assert.ok(calls.findIndex((call) => call.image === low.image) < calls.findIndex((call) => call.image === high.image));
  });

  test('applies scale and anchor to the drawn rectangle', () => {
    const scaled = layer({ image: image(40, 20), scaleX: 2, scaleY: -1, anchorX: 0.5, anchorY: 0.5, x: 100, y: 50 });
    const { context, calls } = recordingContext();
    drawMapContent(context, createMap(), { tilesetImages: [], uldsLayers: [scaled] });
    // anchor (0.5, 0.5): top-left = (100 - 0.5*80, 50 - 0.5*(-20)) = (60, 60)
    assert.deepEqual(calls[0].args, [60, 60, 80, -20]);
  });

  test('tiles loop layers across the whole canvas from the layer origin', () => {
    const looping = layer({ image: image(32, 32), loop: true, x: 16, y: 0 });
    const { context, calls } = recordingContext();
    drawMapContent(context, createMap({ width: 2, height: 2, data: [0, 0, 0, 0] }), { tilesetImages: [], tileSize: 32, uldsLayers: [looping] });
    const xs = calls.map((call) => call.args[0]);
    assert.deepEqual([...new Set(xs)].sort((a, b) => a - b), [-16, 16, 48], 'starts before the origin and tiles by 32');
    assert.equal(calls.length, 9, '3x3 tile repetitions on a 64x64 canvas');
  });

  test('maps blend modes onto canvas composite operations', () => {
    const { context, operations } = recordingContext();
    drawMapContent(context, createMap(), { tilesetImages: [], uldsLayers: [layer({ blendMode: 1 })] });
    assert.ok(operations.includes('blend:lighter'));
  });

  test('skips layers without a resolved image', () => {
    const { context, calls } = recordingContext();
    drawMapContent(context, createMap(), { tilesetImages: [], uldsLayers: [layer({ image: null })] });
    assert.equal(calls.length, 0);
  });
});
