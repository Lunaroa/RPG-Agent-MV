import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { characterNameMarkers, drawMapContent, eventCharacterBlock, eventCharacterFrame, type MvMap } from './useMapRenderer.ts';

interface RecordedCall {
  kind: 'drawImage' | 'fillRect' | 'stroke' | 'strokeRect';
  alpha: number;
  image?: HTMLImageElement;
  lineWidth?: number;
  lineDash?: number[];
  fillStyle?: string;
  strokeStyle?: string;
  shadowBlur?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

describe('map event-layer rendering', () => {
  test('parses only a leading character marker run', () => {
    assert.deepEqual(characterNameMarkers('Actor1'), { big: false, object: false, shiftY: 6 });
    assert.deepEqual(characterNameMarkers('!Door1'), { big: false, object: true, shiftY: 0 });
    assert.deepEqual(characterNameMarkers('$Actor1'), { big: true, object: false, shiftY: 6 });
    assert.deepEqual(characterNameMarkers('!$Door1'), { big: true, object: true, shiftY: 0 });
    assert.deepEqual(characterNameMarkers('$!Door1'), { big: true, object: true, shiftY: 0 });
    assert.deepEqual(characterNameMarkers('Actor!'), { big: false, object: false, shiftY: 6 });
    assert.deepEqual(characterNameMarkers('Actor$'), { big: false, object: false, shiftY: 6 });
  });

  test('keeps single-character slicing independent from the object shift marker', () => {
    const bitmap = image(144, 192);
    const normal = eventCharacterFrame(bitmap, { characterName: 'Actor1', characterIndex: 5, direction: 2, pattern: 1 });
    const big = eventCharacterFrame(bitmap, { characterName: '$Actor1', characterIndex: 5, direction: 2, pattern: 1 });
    const objectBig = eventCharacterFrame(bitmap, { characterName: '!$Door1', characterIndex: 5, direction: 2, pattern: 1 });
    assert.deepEqual(normal && [normal.sw, normal.sh], [12, 24]);
    assert.deepEqual(big && [big.sw, big.sh], [48, 48]);
    assert.deepEqual(objectBig && [objectBig.sw, objectBig.sh], [48, 48]);
  });

  test('crops the full 3x4 walking block for one character index', () => {
    const bitmap = { naturalWidth: 144, naturalHeight: 192 } as HTMLImageElement;
    const block0 = eventCharacterBlock(bitmap, { characterName: 'Actor1', characterIndex: 0 });
    const block5 = eventCharacterBlock(bitmap, { characterName: 'Actor1', characterIndex: 5 });
    const big = eventCharacterBlock(bitmap, { characterName: '$Actor1', characterIndex: 3 });
    assert.deepEqual(block0, { sx: 0, sy: 0, sw: 36, sh: 96 });
    assert.deepEqual(block5, { sx: 36, sy: 96, sw: 36, sh: 96 });
    assert.deepEqual(big, { sx: 0, sy: 0, sw: 144, sh: 192 });
  });

  test('raises people six pixels but keeps object characters on the tile baseline', () => {
    const character = image(144, 192);
    const person = recordingContext();
    drawMapContent(person.context, createCharacterMap('Actor1'), { tilesetImages: [], getCharacterImage: () => character });
    const object = recordingContext();
    drawMapContent(object.context, createCharacterMap('!Door1'), { tilesetImages: [], getCharacterImage: () => character });
    assert.equal(person.calls.find((call) => call.kind === 'drawImage')?.y, 18);
    assert.equal(object.calls.find((call) => call.kind === 'drawImage')?.y, 24);
  });

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

  test('uses a translucent fill and high-contrast double outline for hover', () => {
    const rendered = recordingContext();

    drawMapContent(rendered.context, createMap({ data: Array(3 * 6).fill(0) }), {
      tilesetImages: [],
      selectedEventId: 1,
      hoveredEventId: 2,
    });

    const frames = rendered.calls.filter((call) => call.kind === 'strokeRect');
    assert.deepEqual(frames.map((call) => call.alpha), [1, 1, 1, 1, 1]);
    assert.deepEqual(frames.map((call) => call.lineWidth), [2, 5, 3, 1, 1]);
    assert.deepEqual(frames.map((call) => call.lineDash), [[], [], [], [], []]);
    assert.deepEqual(frames.map((call) => call.strokeStyle), [
      '#fff',
      'rgba(0, 0, 0, .86)',
      '#f59e0b',
      '#fff',
      '#fff',
    ]);
    const hoverFill = rendered.calls.find((call) => call.kind === 'fillRect' && call.fillStyle === 'rgba(245, 158, 11, .28)');
    assert.deepEqual(hoverFill && [hoverFill.x, hoverFill.y, hoverFill.width, hoverFill.height], [48, 0, 48, 48]);
    assert.deepEqual(frames.map(({ x, y, width, height }) => [x, y, width, height]), [
      [5, 5, 38, 38],
      [50.5, 2.5, 43, 43],
      [52.5, 4.5, 39, 39],
      [52.5, 4.5, 39, 39],
      [100.5, 4.5, 39, 39],
    ]);
    assert.equal(rendered.context.globalAlpha, 1);
  });

  test('keeps the selected frame visible when the selected event is also hovered', () => {
    const rendered = recordingContext();
    drawMapContent(rendered.context, createMap({ data: Array(3 * 6).fill(0) }), {
      tilesetImages: [],
      selectedEventId: 1,
      hoveredEventId: 1,
    });

    const firstCellFrames = rendered.calls.filter((call) => call.kind === 'strokeRect' && Number(call.x) < 48);
    assert.deepEqual(firstCellFrames.map((call) => [call.lineWidth, call.strokeStyle]), [
      [5, 'rgba(0, 0, 0, .86)'],
      [3, '#f59e0b'],
      [2, '#fff'],
    ]);
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

function createCharacterMap(characterName: string): MvMap {
  return {
    width: 1,
    height: 1,
    data: Array(6).fill(0),
    events: [null, { id: 1, x: 0, y: 0, pages: [{ image: { characterName, characterIndex: 0, direction: 2, pattern: 1 } }] }],
  };
}

function image(naturalWidth: number, naturalHeight: number): HTMLImageElement {
  return { naturalWidth, naturalHeight } as HTMLImageElement;
}

function recordingContext(): { context: CanvasRenderingContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const stack: Array<{ globalAlpha: number; lineWidth: number; lineDash: number[]; fillStyle: string; strokeStyle: string }> = [];
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
      stack.push({
        globalAlpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        lineDash: [...lineDash],
        fillStyle: String(this.fillStyle),
        strokeStyle: String(this.strokeStyle),
      });
    },
    restore() {
      const state = stack.pop();
      if (!state) throw new Error('Canvas restore called without a matching save.');
      this.globalAlpha = state.globalAlpha;
      this.lineWidth = state.lineWidth;
      this.fillStyle = state.fillStyle;
      this.strokeStyle = state.strokeStyle;
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
        strokeStyle: String(this.strokeStyle),
        shadowBlur: this.shadowBlur,
        x,
        y,
        width,
        height,
      });
    },
    drawImage(imageValue: HTMLImageElement, ...args: number[]) {
      calls.push({
        kind: 'drawImage',
        alpha: this.globalAlpha,
        image: imageValue,
        x: args.length >= 8 ? args[4] : args[0],
        y: args.length >= 8 ? args[5] : args[1],
        width: args.length >= 8 ? args[6] : args[2],
        height: args.length >= 8 ? args[7] : args[3],
      });
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}
