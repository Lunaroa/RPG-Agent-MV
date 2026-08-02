import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const eventEditorSource = readFileSync(new URL('./EventEditorDialog.vue', import.meta.url), 'utf8');
const sharedListSource = readFileSync(new URL('../../composables/useEventEditor.ts', import.meta.url), 'utf8');
const commonBattleSource = readFileSync(new URL('../console/MvCommandListEditor.vue', import.meta.url), 'utf8');
const editorViewSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

describe('MV event command list structure contract', () => {
  test('uses one shared projection and complete structure-block helpers', () => {
    assert.match(sharedListSource, /export function commandStructureBlocks\(/);
    assert.match(sharedListSource, /export function commandBranchScope\(/);
    assert.match(sharedListSource, /export function commandSpanDisplay\(/);
    assert.match(sharedListSource, /export function dropCommandSpanBlocks\(/);
    assert.match(eventEditorSource, /commandSpanDisplay/);
    assert.match(eventEditorSource, /commandBlockSpanIndices/);
    assert.match(eventEditorSource, /dropCommandSpanBlocks/);
    assert.match(commonBattleSource, /commandSpanDisplay/);
    assert.match(commonBattleSource, /commandBlockSpanIndices/);
    assert.match(commonBattleSource, /dropCommandSpanBlocks/);
  });

  test('keeps RM-style visual rows and branch-safe selection in map/common/battle hosts', () => {
    for (const source of [eventEditorSource, commonBattleSource]) {
      assert.match(source, /\[`role-\$\{[^}]+role\}`\]: true/);
      assert.match(source, /commandBranchScope\(spans\.value/);
      assert.match(source, /@dblclick="openCommand\(/);
      assert.match(source, /@contextmenu\.stop\.prevent="openCommandContext/);
      assert.match(source, /@dragstart="onRowDragStart/);
      assert.match(source, /@dragover\.prevent="onRowDragOver/);
      assert.match(source, /@drop\.prevent="onRowDrop/);
      assert.match(source, /drop-before/);
    }
  });

  test('exposes lock protection and a native-style command context menu for common/battle lists', () => {
    assert.match(commonBattleSource, /locked\?: boolean/);
    assert.match(commonBattleSource, /:disabled="locked/);
    assert.match(commonBattleSource, /commandContext\.visible/);
    assert.match(commonBattleSource, /eventEditorDialog\.newCmd/);
    assert.match(commonBattleSource, /eventEditorDialog\.copy/);
    assert.match(commonBattleSource, /eventEditorDialog\.paste/);
    assert.match(commonBattleSource, /eventEditorDialog\.selectAll/);
  });

  test('keeps the modeless map context menu clickable and closes only on outside input', () => {
    assert.match(editorViewSource, /<EventEditorDialog[\s\S]{0,700}\smodeless[\s\S]{0,180}\/>/);
    assert.match(eventEditorSource, /\.ev-modal-overlay\.modeless\s*\{[^}]*pointer-events:\s*none/s);
    assert.match(eventEditorSource, /\.cmd-context-mask\s*\{[^}]*pointer-events:\s*auto/s);
    assert.match(eventEditorSource, /\.cmd-context-menu\s*\{[^}]*pointer-events:\s*auto/s);
    assert.match(eventEditorSource, /<div v-if="cmdContext\.visible" class="cmd-context-mask"/);
    assert.match(eventEditorSource, /class="cmd-context-mask"[^>]*@mousedown\.self="closeCommandContext"[^>]*@contextmenu\.self\.prevent="closeCommandContext"/);
    assert.match(eventEditorSource, /function closeCommandContext\(\)\s*\{\s*cmdContext\.visible\s*=\s*false;/);
  });
});
