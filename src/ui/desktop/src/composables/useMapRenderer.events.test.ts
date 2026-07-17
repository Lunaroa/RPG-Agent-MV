import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { drawMapContent, type MvMap } from './useMapRenderer.ts';

interface RecordedCall {
  kind: 'drawImage' | 'fillRect' | 'stroke' | 'strokeRect';
  alpha: number;
  image?: HTMLImageElement;
  lineWidth?: number;
  lineDash?: number[];
  fillStyle?: string;
  shadowBlur?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

describe('map event-layer rendering', () => {
  test('applies one opacity to tile, character, and empty events without affecting the map or grid', () => {
    const tileset = image(768, 768);
    const character = image(144, 192);
    const rendered = recordingContext();

    drawMapContent(rendered.context, createMap(), {
      tilesetImages: [null, null, null, null, null, tileset],
      tileSize: 48,
      showGrid: true,
      eventOpacity: 0.35,
      getCharacterImage: () => character,
    });

    const tilesetCalls = rendered.calls.filter((call) => call.kind === 'drawImage' && call.image === tileset);
    const characterCalls = rendered.calls.filter((call) => call.kind === 'drawImage' && call.image === character);
    const eventFrames = rendered.calls.filter((call) => call.kind === 'strokeRect');
    const eventShadows = rendered.calls.filter((call) => call.kind === 'fillRect' && call.fillStyle === 'rgba(0, 0, 0, .5)');
    const gridStrokes = rendered.calls.filter((call) => call.kind === 'stroke');

    assert.deepEqual(tilesetCalls.map((call) => call.alpha), [1, 0.35]);
    assert.deepEqual(characterCalls.map((call) => call.alpha), [0.35]);
    assert.deepEqual(eventFrames.map((call) => call.alpha), [0.35, 0.35, 0.35]);
    assert.deepEqual(eventShadows.map((call) => call.alpha), [0.35, 0.35, 0.35]);
    assert.deepEqual(eventShadows.map(({ x, y, width, height }) => [x, y, width, height]), [
      [5, 5, 38, 38],
      [53, 5, 38, 38],
      [101, 5, 38, 38],
    ]);
    assert.deepEqual(gridStrokes.map((call) => call.alpha), [1]);
    assert.equal(rendered.context.globalAlpha, 1);
  });

  test('uses full opacity by default and distinguishes hover and selection without color-only styling', () => {
    const rendered = recordingContext();

    drawMapContent(rendered.context, createMap({ data: Array(3 * 6).fill(0) }), {
      tilesetImages: [],
      selectedEventId: 1,
      hoveredEventId: 2,
    });

    const frames = rendered.calls.filter((call) => call.kind === 'strokeRect');
    assert.deepEqual(frames.map((call) => call.alpha), [1, 1, 1]);
    assert.deepEqual(frames.map((call) => call.lineWidth), [2, 1, 1]);
    assert.deepEqual(frames.map((call) => call.lineDash), [[], [4, 3], []]);
    assert.deepEqual(frames.map((call) => call.shadowBlur), [0, 0, 0]);
    assert.deepEqual(frames.map(({ x, y, width, height }) => [x, y, width, height]), [
      [5, 5, 38, 38],
      [52.5, 4.5, 39, 39],
      [100.5, 4.5, 39, 39],
    ]);

    const outerBounds = frames.map((frame) => {
      const halfLineWidth = Number(frame.lineWidth) / 2;
      return {
        left: Number(frame.x) - halfLineWidth,
        top: Number(frame.y) - halfLineWidth,
        right: Number(frame.x) + Number(frame.width) + halfLineWidth,
        bottom: Number(frame.y) + Number(frame.height) + halfLineWidth,
      };
    });
    assert.deepEqual(outerBounds, [
      { left: 4, top: 4, right: 44, bottom: 44 },
      { left: 52, top: 4, right: 92, bottom: 44 },
      { left: 100, top: 4, right: 140, bottom: 44 },
    ]);
    assert.equal(outerBounds[1].left - outerBounds[0].right, 8);
    assert.equal(outerBounds[2].left - outerBounds[1].right, 8);
    assert.equal(rendered.context.globalAlpha, 1);
  });

  test('clamps explicit event opacity and treats invalid values as full opacity', () => {
    for (const [eventOpacity, expected] of [[-1, 0], [2, 1], [Number.NaN, 1]] as const) {
      const rendered = recordingContext();
      drawMapContent(rendered.context, createMap({ data: Array(3 * 6).fill(0) }), {
        tilesetImages: [],
        eventOpacity,
      });
      const frames = rendered.calls.filter((call) => call.kind === 'strokeRect');
      assert.deepEqual(frames.map((call) => call.alpha), [expected, expected, expected]);
      assert.equal(rendered.context.globalAlpha, 1);
    }
  });
});

function createMap(overrides: Partial<MvMap> = {}): MvMap {
  const width = 3;
  const height = 1;
  const data = Array(width * height * 6).fill(0);
  data[0] = 1;
  return {
    width,
    height,
    data,
    events: [
      null,
      { id: 1, x: 0, y: 0, pages: [{ image: { tileId: 1 } }] },
      { id: 2, x: 1, y: 0, pages: [{ image: { characterName: 'Actor1', characterIndex: 0, direction: 2, pattern: 1 } }] },
      { id: 3, x: 2, y: 0, pages: [{ image: {} }] },
    ],
    ...overrides,
  };
}

function image(naturalWidth: number, naturalHeight: number): HTMLImageElement {
  return { naturalWidth, naturalHeight } as HTMLImageElement;
}

function recordingContext(): { context: CanvasRenderingContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const stack: Array<{ globalAlpha: number; lineWidth: number; lineDash: number[] }> = [];
  let lineDash: number[] = [];
  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    fillStyle: '',
    strokeStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    clearRect() {},
    fillRect(x: number, y: number, width: number, height: number) {
      calls.push({
        kind: 'fillRect',
        alpha: this.globalAlpha,
        fillStyle: String(this.fillStyle),
        x,
        y,
        width,
        height,
      });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    save() {
      stack.push({ globalAlpha: this.globalAlpha, lineWidth: this.lineWidth, lineDash: [...lineDash] });
    },
    restore() {
      const state = stack.pop();
      if (!state) throw new Error('Canvas restore called without a matching save.');
      this.globalAlpha = state.globalAlpha;
      this.lineWidth = state.lineWidth;
      lineDash = state.lineDash;
    },
    setLineDash(value: number[]) { lineDash = [...value]; },
    stroke() { calls.push({ kind: 'stroke', alpha: this.globalAlpha }); },
    strokeRect(x: number, y: number, width: number, height: number) {
      calls.push({
        kind: 'strokeRect',
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        lineDash: [...lineDash],
        shadowBlur: this.shadowBlur,
        x,
        y,
        width,
        height,
      });
    },
    drawImage(imageValue: HTMLImageElement) {
      calls.push({ kind: 'drawImage', alpha: this.globalAlpha, image: imageValue });
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}
