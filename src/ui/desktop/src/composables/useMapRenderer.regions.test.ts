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

  test('renders the original MV region palette on checkerboard with centered labels', () => {
    const rendered = recordingContext();
    const data = Array(6).fill(0);
    data[5] = 1;
    const map: MvMap = { width: 1, height: 1, data, events: [] };

    drawMapContent(rendered.context, map, {
      tilesetImages: [],
      tileSize: 48,
      showRegions: true,
      regionOnly: true,
    });

    const regionFills = rendered.fills.slice(6);
    assert.deepEqual(regionFills.slice(0, 3).map((call) => call.style), ['#b46868', 'rgb(193, 117, 117)', '#b46868']);
    assert.deepEqual(rendered.texts, [{ text: '1', x: 24, y: 24, style: '#fff' }]);
  });
});

function recordingContext(): {
  context: CanvasRenderingContext2D;
  fills: Array<{ style: string; x: number; y: number; width: number; height: number }>;
  texts: Array<{ text: string; x: number; y: number; style: string }>;
} {
  const fills: Array<{ style: string; x: number; y: number; width: number; height: number }> = [];
  const texts: Array<{ text: string; x: number; y: number; style: string }> = [];
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
    save() {},
    restore() {},
    fillRect(x: number, y: number, width: number, height: number) {
      fills.push({ style: String(this.fillStyle), x, y, width, height });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, style: String(this.fillStyle) });
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, fills, texts };
}
