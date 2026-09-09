import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./EventCommandListEditor.vue', import.meta.url), 'utf8');

describe('MV command list find contract', () => {
  test('keeps find on the shared command list and out of command mutations', () => {
    assert.match(source, /findCommandSpanIndices\(spanViews\.value, findQuery\.value\)/);
    assert.match(source, /v-model="findQuery"/);
    assert.match(source, /data-command-span/);
    assert.match(source, /scrollSpanIntoView/);
    assert.match(source, /event\.key\.toLowerCase\(\) === 'f'/);
    assert.match(source, /event\.key === 'F3' \|\| event\.code === 'F3'/);
    assert.match(source, /event\.key === 'Escape'/);
    assert.match(source, /\.CodeMirror/);
    assert.match(source, /findTemporarilyExpandedHeads/);
    assert.match(source, /handleEscape/);
    assert.doesNotMatch(source, /findQuery[^\n]*emit\(/);
  });
});
