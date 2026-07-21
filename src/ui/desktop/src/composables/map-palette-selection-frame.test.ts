import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { paletteFrameLineWidths } from './useMapCanvasEditor.ts';

const source = readFileSync(new URL('./useMapCanvasEditor.ts', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../components/editor/MapRuntimePreview.vue', import.meta.url), 'utf8');
const outlineSource = readFileSync(new URL('../utils/selectionOutline.ts', import.meta.url), 'utf8');

test('keeps selected and hover palette outlines at fixed CSS widths', () => {
  assert.deepEqual(paletteFrameLineWidths('selected', 1), { outer: 1, inner: 2 });
  assert.deepEqual(paletteFrameLineWidths('hover', 1), { outer: 2, inner: 1 });
  assert.deepEqual(paletteFrameLineWidths('selected', .75), { outer: 1 / .75, inner: 2 / .75 });
  assert.deepEqual(paletteFrameLineWidths('selected', 2), { outer: .5, inner: 1 });
});

test('uses the coarse selected frame for drag, region, and brush selections', () => {
  assert.match(source, /highlightPaletteDrag[\s\S]*drawPaletteFrame\(context, x, y, width, height, 'selected'\)/);
  assert.match(source, /tileTab\.value === 'R'[\s\S]*drawPaletteFrame\(context, x, y, size, size, 'selected'\)/);
  assert.match(source, /highlightPaletteSelection[\s\S]*\(maxRow - minRow \+ 1\) \* tileSize\.value,[\s\S]*'selected'/);
});

test('shares a white primary frame with a black outer edge in canvas and preview', () => {
  assert.match(outlineSource, /SELECTION_OUTLINE_WHITE_CSS_PX = 2/);
  assert.match(outlineSource, /SELECTION_OUTLINE_BLACK_CSS_PX = 1/);
  assert.match(source, /selectionOutlineWidths/);
  assert.match(source, /innerInset = emphasis === 'selected'[\s\S]*widths\.outer \+ widths\.inner \/ 2/);
  assert.match(previewSource, /selectionOutlineWidths\(actualScale\.value\)/);
  assert.match(previewSource, /borderColor:#fff|border-color:#fff/);
  assert.match(previewSource, /boxShadow: `0 0 0 \$\{outline\.black\}px #101318`/);
});
