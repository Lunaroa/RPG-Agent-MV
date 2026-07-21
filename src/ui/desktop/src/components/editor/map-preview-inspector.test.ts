import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./MapPreviewInspector.vue', import.meta.url), 'utf8');
const draftSource = readFileSync(new URL('./previewVariableDrafts.ts', import.meta.url), 'utf8');

test('keeps compact switch, variable, and self-switch tabs without filtering the catalog', () => {
  assert.match(source, /kind === 'switch'/);
  assert.match(source, /kind === 'variable'/);
  assert.match(source, /id: 'self-switch'/);
  assert.match(source, /type="text"/);
  assert.doesNotMatch(source, /type="number"/);
  assert.match(draftSource, /parseMapPreviewVariableInput/);
  assert.match(source, /variableDraftState/);
  assert.match(source, /@keydown\.escape\.prevent="discardVariableDraft/);
  assert.match(source, /selfSwitchLetters/);
  assert.match(source, /unsupportedVariableTypes\.has/);
  assert.match(source, /entry\.mapReachable/);
  assert.match(source, /editor\.preview\.mapReachable/);
  assert.match(source, /class="reachable-dot"/);
  assert.match(source, /entry\.name\.trim\(\) \|\| t\('editor\.preview\.unnamed'\)/);
  assert.match(source, /displayName\(entry\)\.toLocaleLowerCase\(\)\.includes\(needle\)/);
  assert.match(source, /return entries\.filter/);
  assert.doesNotMatch(source, /filter\(\(entry\) => entry\.mapReachable/);
});

test('searches self-switch events and reveals only explicit dock selections', () => {
  assert.doesNotMatch(source, /v-if="kind !== 'self-switch'" class="state-search"/);
  assert.match(source, /filteredSelfSwitchEvents/);
  assert.match(source, /eventRevealEpoch/);
  assert.match(source, /pendingRevealEventId/);
  assert.match(source, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest', behavior: 'auto' \}\)/);
  assert.match(source, /if \(!previewEventMatchesQuery\(event, query\.value\)\) query\.value = ''/);
  assert.match(source, /watch\(kind, \(\) => \{ void revealPendingSelfSwitchEvent\(\); \}\)/);
});
