import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const versionView = read('GameVersionView.vue');
const packagingView = read('GamePackagingView.vue');

test('release views clone reactive drafts safely and register unsaved-change guards', () => {
  assert.doesNotMatch(versionView, /structuredClone\(/);
  assert.doesNotMatch(packagingView, /structuredClone\(/);
  assert.match(versionView, /cloneDraft\(next\.config\)/);
  assert.match(packagingView, /cloneDraft\(activePreset\.value\)/);
  assert.match(versionView, /registerProductPluginLifecycleGuard\('game-version'/);
  assert.match(packagingView, /registerProductPluginLifecycleGuard\('game-packaging'/);
});

test('version view exposes index validation and keeps update controls in a responsive grid', () => {
  assert.match(versionView, /data-ui-id="game-version-test-index"/);
  assert.match(versionView, /gameRelease\.testUpdateIndex/);
  assert.match(versionView, /:disabled="saving \|\| testingUpdateIndex"/);
  assert.match(versionView, /class="update-policy"/);
  assert.match(versionView, /\.update-options \{ display: grid;/);
});

test('packaging view validates publication data before preflight and preserves Android drafts', () => {
  const metadataCheck = packagingView.indexOf('if (preset.upload?.enabled)');
  const preflight = packagingView.indexOf('const checked = await runPreflight()', metadataCheck);
  assert.ok(metadataCheck >= 0 && preflight > metadataCheck);
  assert.doesNotMatch(packagingView, /else delete preset\.android/);
  assert.match(packagingView, /data-ui-id="game-packaging-cancel"/);
  assert.match(packagingView, /data-ui-id="game-packaging-progress"/);
  assert.match(packagingView, /data-ui-id="game-packaging-add-preset"/);
  assert.match(packagingView, /data-ui-id="game-packaging-publish"/);
  assert.match(packagingView, /data-ui-id="game-packaging-publish-result"/);
  assert.match(packagingView, /gameBuild\.onProgress/);
  assert.match(packagingView, /let loadRequestId = 0/);
  assert.match(packagingView, /isCurrentProjectRequest\(project, requestId\)/);
  assert.match(packagingView, /:inert="building \|\| checking \|\| publishing \|\| creatingManifestSigningIdentity \? true : undefined"/);
});

function read(name: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, name), 'utf8');
}
