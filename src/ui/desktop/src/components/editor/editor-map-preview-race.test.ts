import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

test('map loading separates the requested map from the committed map', () => {
  assert.match(source, /:selected-map-id="requestedMapId \?\? selectedMapId"/);
  assert.match(source, /mapLoadCoordinator\.begin\(\{ project, mapId \}\)/);
  assert.match(source, /mapLoadCoordinator\.runExclusive\(token,/);
  assert.match(source, /if \(!mapLoadCoordinator\.isCurrent\(token\)\) return 'superseded'/);
});

test('preview lifecycle is driven by one latest intent queue', () => {
  assert.match(source, /previewIntentCoordinator\.runExclusive\(token,/);
  assert.match(source, /previewFrameMatchesIntent\(frame, intent\)/);
  assert.match(source, /previewSessionMatchesIntent\(session, intent\)/);
  assert.doesNotMatch(source, /ensurePreviewForSelectedMap/);
});

test('restart checks the latest intent after stopping the old session', () => {
  const restart = source.slice(source.indexOf('async function restartPreview()'), source.indexOf('async function setPreviewSwitch'));
  assert.match(restart, /previewIntentCoordinator\.begin\(currentPreviewIntent\(\)\)/);
  assert.match(restart, /await stopPreviewSession\(\)/);
  assert.match(restart, /if \(!isCurrent\(\) \|\| !token\.value\.active\) return/);
});
