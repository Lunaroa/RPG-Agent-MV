import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const previewSource = readFileSync(new URL('./MapRuntimePreview.vue', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

test('keeps preview diagnostics collapsed until the user requests details', () => {
  assert.match(previewSource, /const detailsOpen = ref\(false\)/);
  assert.match(previewSource, /v-if="diagnostic && detailsOpen"/);
  assert.match(previewSource, /detailsOpen \? t\('editor\.preview\.hideDetails'\) : t\('editor\.preview\.showDetails'\)/);
  assert.match(previewSource, /watch\(\(\) => \[props\.error, props\.diagnostic\]/);
});

test('shows structured fields and copies only the prepared diagnostic payload', () => {
  assert.match(previewSource, /diagnostic\.detail\.resources/);
  assert.match(previewSource, /diagnostic\.detail\.runtimeOutput/);
  assert.match(previewSource, /\$emit\('copy-diagnostic'\)/);
  assert.match(editorSource, /clipboardApi\.writeText\(serializeMapPreviewDiagnostic\(diagnostic\)\)/);
  assert.match(editorSource, /failureCode === 'preview-debug-marker-conflict'[\s\S]{0,120}editor\.preview\.debugMarkerConflict/);
  assert.match(editorSource, /return t\('editor\.preview\.unknownError'\)/);
  assert.match(editorSource, /previewError\.value = t\('editor\.preview\.unknownError'\)/);
  assert.doesNotMatch(editorSource, /previewError\.value = diagnostic\.detail\.message/);
});

test('clears detailed diagnostics when the preview intent is no longer active', () => {
  assert.match(editorSource, /if \(!token\.value\.active\) \{[\s\S]{0,180}previewDiagnostic\.value = null/);
  assert.match(editorSource, /previewDiagnostic\.value = session\.status === 'failed' \? mapPreviewDiagnosticFromSession\(session\) : null/);
});
