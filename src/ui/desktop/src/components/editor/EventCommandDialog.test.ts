import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const dialogSource = readFileSync(new URL('./EventCommandDialog.vue', import.meta.url), 'utf8');
const fieldsSource = readFileSync(new URL('./EventCommandFields.vue', import.meta.url), 'utf8');

describe('event command catalog controls', () => {
  test('keeps the original three command pages and adds search without replacing them', () => {
    assert.match(dialogSource, /class="command-page-tabs editor-tab-strip"/);
    assert.match(dialogSource, /v-for="page in 3"/);
    assert.match(dialogSource, /pickerPage=ref\(1\)/);
    assert.match(dialogSource, /commandPages\(currentEngine\.value\)\.map/);
    assert.match(dialogSource, /commandPageCategories\.value\[pickerPage\.value-1\]/);
    assert.match(dialogSource, /type="search"/);
    assert.match(dialogSource, /role="combobox"/);
    assert.match(dialogSource, /commandPageCategories\.value\.flat\(\)/);
    assert.match(dialogSource, /eventcmd\.pageN/);
    assert.match(dialogSource, /category\.group\.toLocaleLowerCase/);
    assert.match(dialogSource, /item\.label\.toLocaleLowerCase/);
    assert.match(dialogSource, /eventcmd\.noSearchResults/);
  });

  test('supports keyboard selection and focuses search when opened', () => {
    assert.match(dialogSource, /nextTick\(\(\)=>pickerSearchRef\.value\?\.focus\(\)\)/);
    assert.match(dialogSource, /event\.key==='ArrowDown'\|\|event\.key==='ArrowUp'/);
    assert.match(dialogSource, /event\.key==='Enter'/);
    assert.match(dialogSource, /event\.key !== 'Escape'/);
    assert.match(dialogSource, /scrollIntoView\(\{block:'nearest'\}\)/);
  });

  test('passes current map events to narrow event-target fields and preserves missing IDs', () => {
    assert.match(dialogSource, /currentEvents\?:EditorEventListItem\[\]/);
    assert.match(dialogSource, /:current-events="currentEvents"/);
    assert.match(fieldsSource, /field\.kind === 'eventTarget'/);
    assert.match(fieldsSource, /props\.currentEvents/);
    assert.match(fieldsSource, /cmdFields\.missingEvent/);
    assert.match(fieldsSource, /options\.unshift\(\[current, label\]\)/);
  });

  test('keeps plugin name and command name separate while preserving MZ argument metadata', () => {
    assert.match(dialogSource, /eventcmd\.pluginName/);
    assert.match(dialogSource, /eventcmd\.commandName/);
    assert.match(dialogSource, /pluginCommandHintLabel\(hint\)/);
    assert.match(dialogSource, /eventcmd\.argLabel/);
    assert.match(dialogSource, /eventcmd\.argKey/);
    assert.match(dialogSource, /eventcmd\.argType/);
    assert.match(dialogSource, /pluginArgumentTypeLabel\(argument\)/);
    assert.match(dialogSource, /parameters=\[hint\.pluginName,hint\.command,hint\.displayName\|\|hint\.command,args\]/);
  });

  test('routes plugin command child dialogs through explicit layers', () => {
    assert.match(dialogSource, /dialog-z-index="LAYER_Z\.pluginParameterDialog"/);
    assert.match(dialogSource, /popper-style="\{ zIndex: LAYER_Z\.pluginParameterPopover \}"/);
    assert.doesNotMatch(dialogSource, /el-overlay:has\(\.plugin-parameter-value-dialog\)/);
  });

  test('opens the shared animation value dialog for event animation IDs', () => {
    assert.match(fieldsSource, /PluginParameterValueDialog/);
    assert.match(fieldsSource, /v-model="animationPreviewOpen"/);
    assert.match(fieldsSource, /dialog-z-index="LAYER_Z\.pluginParameterDialog"/);
    assert.match(fieldsSource, /@commit="commitAnimationPreview"/);
    assert.match(fieldsSource, /props\.command\.code === 212/);
    assert.match(fieldsSource, /props\.command\.code === 337/);
    assert.match(fieldsSource, /Number\.isInteger\(numeric\)/);
    assert.match(fieldsSource, /setField\(field, numeric\)/);
  });
});
