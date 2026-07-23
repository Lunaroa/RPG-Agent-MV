import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const previewSource = readFileSync(new URL('./MapRuntimePreview.vue', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

test('keeps preview diagnostics collapsed until the user requests details', () => {
  assert.match(previewSource, /const detailsOpen = ref\(false\)/);
  assert.match(previewSource, /v-if="diagnostic && detailsOpen"/);
  assert.match(previewSource, /detailsOpen \? t\('editor\.preview\.hideDetails'\) : t\('editor\.preview\.showDetails'\)/);
  assert.match(previewSource, /watch\(\(\) => \[props\.error, props\.diagnostic, props\.preflightFailure\]/);
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

test('shows structured staging conflicts without replacing a warm preview', () => {
  assert.match(previewSource, /data-ui-id="map-preview-staging-conflict"/);
  assert.match(previewSource, /preflightFailure\.conflicts/);
  assert.match(previewSource, /stagingConflictReasonLabel\(reason\)/);
  assert.match(previewSource, /'staging-conflict-warm': hasDisplayablePreview/);
  assert.match(previewSource, /v-show="!error && Boolean\(iframeUrl\)"/);
  assert.match(editorSource, /handlePreviewPreflightFailure\(result, intent\)/);
  assert.match(editorSource, /result\.session\?\.iframeUrl[\s\S]{0,120}\['running', 'suspended'\]/);
  assert.match(editorSource, /if \(!keepExistingPreview\) await stopPreviewSession\(\)/);
  assert.doesNotMatch(previewSource, /Error invoking remote method|StagingError/);
});

test('returns to map editing without automatically applying or discarding staging', () => {
  assert.match(editorSource, /async function resolvePreviewStagingConflict\(\) \{[\s\S]{0,120}mode\.value = 'map'/);
  assert.match(editorSource, /resolvePreviewStagingConflict\(\)[\s\S]{0,180}refreshStagingStatus\(\)/);
  assert.doesNotMatch(editorSource, /resolvePreviewStagingConflict\(\)[\s\S]{0,240}(applyStaging|discardStaging)\(\)/);
  assert.match(editorSource, /if \(stagingConflict\.value\) \{[\s\S]{0,140}conflictApplyDisabled/);
});
