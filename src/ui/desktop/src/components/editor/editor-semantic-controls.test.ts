import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const mapPropertiesSource = readFileSync(new URL('./MapPropertiesDialog.vue', import.meta.url), 'utf8');
const eventEditorSource = readFileSync(new URL('./EventEditorDialog.vue', import.meta.url), 'utf8');
const editorToolbarSource = readFileSync(new URL('./EditorToolbar.vue', import.meta.url), 'utf8');
const editorViewSource = readFileSync(new URL('../../views/EditorView.vue', import.meta.url), 'utf8');

describe('editor semantic controls', () => {
  test('uses multiline resizable controls for map and event notes', () => {
    assert.match(mapPropertiesSource, /v-model="form\.note" type="textarea" :rows="4" resize="vertical"/);
    assert.match(eventEditorSource, /<textarea v-model="draft\.note" rows="2"[^>]+data-ui-id="event-editor-note"/);
    assert.match(eventEditorSource, /max-height:\s*96px/);
    assert.match(eventEditorSource, /class="behavior-groups"/);
    assert.match(eventEditorSource, /data-ui-id="event-editor-trigger"/);
    assert.match(eventEditorSource, /\.ev-settings[^}]+overflow-y:\s*auto/s);
  });

  test('uses a structured encounter list instead of JSON text', () => {
    assert.doesNotMatch(mapPropertiesSource, /encounterListText|encounterListJson/);
    assert.match(mapPropertiesSource, /v-for="\(encounter, encounterIndex\) in form\.encounterList"/);
    assert.match(mapPropertiesSource, /v-model="encounter\.troopId"/);
    assert.match(mapPropertiesSource, /v-model="encounter\.weight"/);
    assert.match(mapPropertiesSource, /v-model="encounter\.regionSet\[regionIndex\]"/);
  });

  test('uses searchable audio catalogs and disables dependent controls', () => {
    assert.match(mapPropertiesSource, /v-model="form\.bgm\.name" filterable clearable :disabled="!form\.autoplayBgm"/);
    assert.match(mapPropertiesSource, /v-model="form\.bgs\.name" filterable clearable :disabled="!form\.autoplayBgs"/);
    assert.match(mapPropertiesSource, /missingAsset/);
    assert.match(mapPropertiesSource, /v-model="form\.parallaxShow" :disabled="!form\.parallaxName"/);
    assert.match(mapPropertiesSource, /v-model="form\.parallaxSx" :disabled="!form\.parallaxLoopX"/);
    assert.match(mapPropertiesSource, /map-properties-dialog \.el-dialog__body[^}]+overflow-y:\s*auto/s);
  });

  test('offers automatic and four manual tile layers to both MV and MZ projects', () => {
    assert.match(editorToolbarSource, /value: 'auto'/);
    assert.match(editorToolbarSource, /\(\[0, 1, 2, 3\] as const\)/);
    assert.match(editorViewSource, /:supports-layer-selection="Boolean\(editorCatalog\)"/);
    assert.match(editorViewSource, /layer\.value = 'auto'/);
    assert.match(editorToolbarSource, /overflow-x:auto/);
    assert.doesNotMatch(editorViewSource, /supports-layer-selection="editorCatalog\?\.engine === 'rpg-maker-mz'"/);
  });
});
