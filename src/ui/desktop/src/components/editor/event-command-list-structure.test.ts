import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const eventEditorSource = readFileSync(new URL('./EventEditorDialog.vue', import.meta.url), 'utf8');
const sharedListSource = readFileSync(new URL('./EventCommandListEditor.vue', import.meta.url), 'utf8');
const sharedLogicSource = readFileSync(new URL('../../composables/useEventEditor.ts', import.meta.url), 'utf8');
const commonEventSource = readFileSync(new URL('../console/CommonEventDetailEditor.vue', import.meta.url), 'utf8');
const databaseEntrySource = readFileSync(new URL('../console/DatabaseEntryDetailEditor.vue', import.meta.url), 'utf8');
const editorViewSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

describe('MV event command list structure contract', () => {
  test('uses one shared projection and complete structure-block helpers', () => {
    assert.match(sharedLogicSource, /export function commandStructureBlocks\(/);
    assert.match(sharedLogicSource, /export function commandBranchScope\(/);
    assert.match(sharedLogicSource, /export function commandSpanDisplay\(/);
    assert.match(sharedLogicSource, /export function commandInsertionSlots\(/);
    assert.match(sharedLogicSource, /export function dropCommandSpanBlocks\(/);
    assert.match(sharedListSource, /commandSpanDisplay/);
    assert.match(sharedListSource, /commandBlockSpanIndices/);
    assert.match(sharedListSource, /dropCommandSpanBlocks/);
  });

  test('keeps RM-style visual rows and branch-safe selection in the shared command list', () => {
    assert.match(sharedListSource, /\[`role-\$\{[^}]+role\}`\]: true/);
    assert.match(sharedListSource, /commandBranchScope\(spans\.value/);
    assert.match(sharedListSource, /@dblclick="openCommand\(/);
    assert.match(sharedListSource, /@contextmenu\.stop\.prevent="openCommandContext/);
    assert.match(sharedListSource, /@dragstart="onRowDragStart/);
    assert.match(sharedListSource, /@dragover\.prevent="onRowDragOver/);
    assert.match(sharedListSource, /@drop\.prevent="onRowDrop/);
    assert.match(sharedListSource, /drop-before/);
    assert.match(sharedListSource, /cmd-blank/);
    assert.match(sharedListSource, /openCommandPickerAt/);
    assert.match(sharedListSource, /event\.key === 'Enter'/);
    assert.match(sharedListSource, /event\.code === 'Space'/);
  });

  test('hosts mount the shared command list with lock protection and context menu', () => {
    assert.match(eventEditorSource, /<EventCommandListEditor/);
    assert.match(commonEventSource, /<EventCommandListEditor/);
    assert.match(databaseEntrySource, /<EventCommandListEditor/);
    assert.match(sharedListSource, /locked\?: boolean/);
    assert.match(sharedListSource, /:disabled="locked/);
    assert.match(sharedListSource, /cmdContext\.visible/);
    assert.match(sharedListSource, /eventEditorDialog\.newCmd/);
    assert.match(sharedListSource, /eventEditorDialog\.copy/);
    assert.match(sharedListSource, /eventEditorDialog\.paste/);
    assert.match(sharedListSource, /eventEditorDialog\.selectAll/);
  });

  test('hides the meaningless "this event" target outside the map event host', () => {
    assert.match(eventEditorSource, /<EventCommandListEditor[\s\S]{0,700}:current-events="currentEvents"/);
    assert.match(commonEventSource, /<EventCommandListEditor[\s\S]{0,700}:allow-this-event="false"/);
    assert.match(databaseEntrySource, /<EventCommandListEditor[\s\S]{0,900}:allow-this-event="false"/);
    assert.match(sharedListSource, /:allow-this-event="allowThisEvent"/);
  });

  test('keeps the modeless map context menu clickable and closes only on outside input', () => {
    assert.match(editorViewSource, /<EventEditorDialog[\s\S]{0,700}\smodeless[\s\S]{0,180}\/>/);
    assert.match(eventEditorSource, /\.ev-modal-overlay\.modeless\s*\{[^}]*pointer-events:\s*none/s);
    assert.match(sharedListSource, /\.cmd-context-mask\s*\{[^}]*pointer-events:\s*auto/s);
    assert.match(sharedListSource, /\.cmd-context-menu\s*\{[^}]*pointer-events:\s*auto/s);
    assert.match(sharedListSource, /<div v-if="cmdContext\.visible" class="cmd-context-mask"/);
    assert.match(sharedListSource, /class="cmd-context-mask"[^>]*@mousedown\.self="closeCommandContext"[^>]*@contextmenu\.self\.prevent="closeCommandContext"/);
    assert.match(sharedListSource, /function closeCommandContext\(\)\s*\{\s*cmdContext\.visible\s*=\s*false;/);
  });
});
