import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const previewSource = readFileSync(new URL('./MapRuntimePreview.vue', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

test('decodes lossless preview frames into reusable base and tile canvases', () => {
  assert.match(previewSource, /ref="baseCanvasRef"/);
  assert.match(previewSource, /ref="tileCanvasRef"/);
  assert.match(previewSource, /v-show="!error && hasDisplayableFrame"/);
  assert.match(previewSource, /new Uint8Array\(frame\.data\.buffer, frame\.data\.byteOffset, frame\.data\.byteLength\)/);
  assert.match(previewSource, /createImageBitmap\(new Blob\(\[bytes\]/);
  assert.match(previewSource, /context\.drawImage\(bitmap, 0, 0\)/);
  assert.doesNotMatch(previewSource, /<img/);
  assert.doesNotMatch(editorSource, /createObjectURL|revokeObjectURL/);
  assert.doesNotMatch(editorSource, /new Uint8Array\(frame\.data\)\.slice/);
});

test('acknowledges only after drawing and drops superseded image bitmaps', () => {
  assert.match(previewSource, /bitmap\.close\(\);[\s\S]{0,180}emit\('presented', frame\.sequence\)/);
  assert.match(previewSource, /await nextAnimationFrame\(\);[\s\S]{0,140}emit\('presented', frame\.sequence\)/);
  assert.match(previewSource, /generation !== baseDecodeGeneration/);
  assert.match(previewSource, /generation !== tileDecodeGeneration/);
});

test('shows a dedicated loading label while the current map is being refreshed', () => {
  assert.match(previewSource, /refreshing\?: boolean/);
  assert.match(previewSource, /if \(props\.refreshing\) return t\('editor\.preview\.refreshing'\)/);
  assert.match(editorSource, /:refreshing="previewRefreshActive"/);
  assert.match(editorSource, /forceReload: true/);
  assert.match(editorSource, /reconcilePreview: false/);
});
