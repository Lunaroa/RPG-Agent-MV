import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const toolbarSource = readFileSync(new URL('./EditorToolbar.vue', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

test('shows a guarded current-map refresh action only in preview mode', () => {
  assert.match(toolbarSource, /v-if="mode === 'preview'"/);
  assert.match(toolbarSource, /data-ui-id="editor-preview-refresh"[\s\S]{0,260}:disabled="!previewRefreshEnabled"/);
  assert.match(toolbarSource, /:aria-label="t\('editor\.preview\.refreshCurrentMap'\)"/);
  assert.match(toolbarSource, /@click="\$emit\('refresh-preview'\)"/);
  assert.match(editorSource, /:preview-refresh-enabled="previewRefreshEnabled"/);
  assert.match(editorSource, /@refresh-preview="refreshPreview"/);
});

test('refreshes the effective map before forcing a serialized runtime reload', () => {
  assert.match(editorSource, /async function refreshPreview\(\)/);
  assert.match(editorSource, /resetHistory: false/);
  assert.match(editorSource, /preserveEventSelection: true/);
  assert.match(editorSource, /reconcilePreview: false/);
  assert.match(editorSource, /previewIntentCoordinator\.begin\(\{ \.\.\.intent, forceReload: true \}\)/);
  assert.match(editorSource, /previewStatus\.value === 'running'/);
  assert.match(editorSource, /event\.operationId !== session\.operationId/);
  assert.match(editorSource, /previewRuntimeCommand\.value = command/);
  assert.match(editorSource, /&& !previewRefreshActive\.value/);
});
