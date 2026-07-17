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
});
