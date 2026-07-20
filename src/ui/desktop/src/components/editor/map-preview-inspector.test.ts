import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./MapPreviewInspector.vue', import.meta.url), 'utf8');

test('keeps dual state tabs and marks current-map reachable entries without filtering the catalog', () => {
  assert.match(source, /kind === 'switch'/);
  assert.match(source, /kind === 'variable'/);
  assert.match(source, /entry\.mapReachable/);
  assert.match(source, /editor\.preview\.mapReachable/);
  assert.match(source, /class="reachable-dot"/);
  assert.match(source, /entry\.name\.trim\(\) \|\| t\('editor\.preview\.unnamed'\)/);
  assert.match(source, /displayName\(entry\)\.toLocaleLowerCase\(\)\.includes\(needle\)/);
  assert.match(source, /return entries\.filter/);
  assert.doesNotMatch(source, /filter\(\(entry\) => entry\.mapReachable/);
});
