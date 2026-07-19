import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { drawCheckerboard, drawMapContent, type MvMap } from './useMapRenderer.ts';

describe('MV region and transparent-background rendering', () => {
  test('uses the measured neutral 16px checkerboard', () => {
    const rendered = recordingContext();

    drawCheckerboard(rendered.context, 48, 48);

    assert.equal(rendered.fills[0].style, '#ffffff');
    assert.deepEqual(rendered.fills.slice(1).map(({ style, x, y, width, height }) => [style, x, y, width, height]), [
      ['#e5e5e5', 0, 0, 16, 16],
      ['#e5e5e5', 32, 0, 16, 16],
      ['#e5e5e5', 16, 16, 16, 16],
      ['#e5e5e5', 0, 32, 16, 16],
      ['#e5e5e5', 32, 32, 16, 16],
    ]);
  });

  test('overlays one saturated MV source palette and one alpha rule on the map', () => {
    const rendered = recordingContext();
    const data = Array(12 * 6).fill(0);
    for (let id = 1; id <= 12; id += 1) data[12 * 5 + id - 1] = id;
    const map: MvMap = { width: 12, height: 1, data, events: [] };

    drawMapContent(rendered.context, map, {
      tilesetImages: [],
      tileSize: 48,
      showRegions: true,
    });

    const regionFills = rendered.fills.filter((call) => call.alpha === .5);
    assert.deepEqual(regionFills.map((call) => call.style), [
      '#830000', '#833700', '#838300', '#378300', '#008300', '#008337',
      '#008383', '#003783', '#000083', '#370083', '#830083', '#830037',
    ]);
    assert.deepEqual(rendered.texts.map(({ text, x, y }) => ({ text, x, y })),
      Array.from({ length: 12 }, (_, index) => ({ text: String(index + 1), x: index * 48 + 24, y: 24 })));
    assert.ok(rendered.texts.every((call) => call.font === '18px Arial, sans-serif'));
    assert.ok(rendered.texts.every((call) => !/\b(?:bold|[5-9]00)\b/.test(call.font)));
    assert.ok(rendered.texts.every((call) => call.shadowBlur === 0 && call.shadowOffsetX === 1 && call.shadowOffsetY === 1));

    const overlay = recordingContext();
    const overlayData = Array(6).fill(0);
    overlayData[5] = 1;
    drawMapContent(overlay.context, { width: 1, height: 1, data: overlayData, events: [] }, {
      tilesetImages: [],
      tileSize: 48,
      showRegions: true,
    });
    assert.deepEqual(overlay.fills.filter((call) => call.alpha === .5).map((call) => call.style), ['#830000']);
  });

  test('can keep region fills on the map while moving labels to the viewport layer', () => {
    const rendered = recordingContext();
    const data = Array(6).fill(0);
    data[5] = 12;
    drawMapContent(rendered.context, { width: 1, height: 1, data, events: [] }, {
      tilesetImages: [],
      tileSize: 48,
      showRegions: true,
      showRegionLabels: false,
    });

    assert.deepEqual(rendered.fills.filter((call) => call.alpha === .5).map((call) => call.style), ['#830037']);
    assert.deepEqual(rendered.texts, []);
  });
});

function recordingContext(): {
  context: CanvasRenderingContext2D;
  fills: Array<{ style: string; alpha: number; x: number; y: number; width: number; height: number }>;
  texts: Array<{ text: string; x: number; y: number; style: string; font: string; shadowBlur: number; shadowOffsetX: number; shadowOffsetY: number }>;
} {
  const fills: Array<{ style: string; alpha: number; x: number; y: number; width: number; height: number }> = [];
  const texts: Array<{ text: string; x: number; y: number; style: string; font: string; shadowBlur: number; shadowOffsetX: number; shadowOffsetY: number }> = [];
  const stack: Array<Record<string, unknown>> = [];
  const context = {
    fillStyle: '',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    font: '',
    clearRect() {},
    save() {
      stack.push({
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
        shadowColor: this.shadowColor,
        shadowBlur: this.shadowBlur,
        shadowOffsetX: this.shadowOffsetX,
        shadowOffsetY: this.shadowOffsetY,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
        font: this.font,
      });
    },
    restore() {
      const saved = stack.pop();
      if (saved) Object.assign(this, saved);
    },
    fillRect(x: number, y: number, width: number, height: number) {
      fills.push({ style: String(this.fillStyle), alpha: Number(this.globalAlpha), x, y, width, height });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({
        text,
        x,
        y,
        style: String(this.fillStyle),
        font: String(this.font),
        shadowBlur: Number(this.shadowBlur),
        shadowOffsetX: Number(this.shadowOffsetX),
        shadowOffsetY: Number(this.shadowOffsetY),
      });
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, fills, texts };
}
