import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const previewSource = readFileSync(new URL('./MapRuntimePreview.vue', import.meta.url), 'utf8');

test('uses the shared bounded pan calculation at every preview scale', () => {
  assert.match(previewSource, /import \{ clampPreviewPan, previewVisibleRegion \} from '\.\.\/\.\.\/utils\/mapPreviewViewport'/);
  assert.match(previewSource, /const clamped = clampPreviewPan\(\{/);
  assert.match(previewSource, /renderedWidth: mapPixelWidth\.value \* actualScale\.value/);
  assert.match(previewSource, /renderedHeight: mapPixelHeight\.value \* actualScale\.value/);
  assert.match(previewSource, /const view = previewVisibleRegion\(\{/);
  assert.match(previewSource, /if \(view\) emit\('viewChanged', view\)/);
});

test('accepts primary and middle-button panning but rejects other buttons', () => {
  assert.match(previewSource, /event\.button !== 0 && event\.button !== 1/);
  assert.match(previewSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(previewSource, /@auxclick\.prevent/);
});

test('reset restores the fitted centered preview', () => {
  assert.match(previewSource, /function resetView\(\) \{[\s\S]{0,160}displayScale\.value = 1/);
  assert.match(previewSource, /function resetView\(\) \{[\s\S]{0,200}offsetX\.value = 0/);
  assert.match(previewSource, /function resetView\(\) \{[\s\S]{0,240}offsetY\.value = 0/);
});
