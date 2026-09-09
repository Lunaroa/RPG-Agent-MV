import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./EventCommandListEditor.vue', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('./EventEditorDialog.vue', import.meta.url), 'utf8');

describe('event editor inline command find contract', () => {
  test('wires find to the shared command list without mutating the draft', () => {
    assert.match(source, /findCommandSpanIndices\(spanViews\.value, findQuery\.value\)/);
    assert.match(source, /<div v-if="findOpen" class="command-find"/);
    assert.match(source, /v-model="findQuery"/);
    assert.match(source, /data-command-span/);
    assert.match(source, /scrollToFindMatch/);
    assert.match(source, /event\.key\.toLowerCase\(\) === 'f'/);
    assert.match(source, /event\.key === 'F3' \|\| event\.code === 'F3'/);
    assert.match(source, /event\.key === 'Escape'/);
    assert.match(source, /\.CodeMirror/);
    assert.match(source, /findTemporarilyExpandedHeads/);
    assert.doesNotMatch(source, /findQuery[^\n]*emit\(/);
  });

  test('map dialog routes Escape through the shared list before closing', () => {
    assert.match(dialogSource, /commandListEditor\.value\?\.handleEscape\(\)/);
    assert.match(dialogSource, /:shortcut-gate="commandListShortcutGate"/);
    assert.match(dialogSource, /isTopmostEditorDialog\(LAYER_Z\.eventEditor\)/);
  });
});
