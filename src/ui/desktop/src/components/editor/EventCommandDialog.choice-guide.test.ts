import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const dialogSource = readFileSync(new URL('./EventCommandDialog.vue', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../../../../../backend/src/core/rmmv/rpg-maker-engine.ts', import.meta.url), 'utf8');
const catalogServiceSource = readFileSync(new URL('../../../../../backend/src/core/desktop/editor-catalog-service.ts', import.meta.url), 'utf8');
const manifestSource = readFileSync(new URL('../../../../../backend/src/core/rmmv/rmmv-layout.ts', import.meta.url), 'utf8');

describe('show choices and text guide contract', () => {
  test('uses one trimmed choice textarea and blocks overflow or stale indices', () => {
    assert.match(dialogSource, /<textarea v-model="choiceText"/);
    assert.doesNotMatch(dialogSource, /choiceInputs\[/);
    assert.match(dialogSource, /split\(\/\\r\?\\n\/\)\.map\(\(line\)=>line\.trim\(\)\)\.filter\(Boolean\)/);
    assert.match(dialogSource, /choiceLines\.value\.length>6/);
    assert.match(dialogSource, /invalidChoiceDefault/);
    assert.match(dialogSource, /invalidChoiceCancel/);
    assert.match(dialogSource, /:disabled="draft\?\.code === 102 && Boolean\(choiceError\)"/);
  });

  test('rebuilds 102/402/403/404 while matching existing branch bodies', () => {
    assert.match(dialogSource, /function buildChoiceEditSpan\(\)/);
    assert.match(dialogSource, /oldBranches/);
    assert.match(dialogSource, /cancelBody/);
    assert.match(dialogSource, /command\.code===402\|\|command\.code===403\|\|command\.code===404/);
    assert.match(dialogSource, /span\.push\(\{code:402/);
    assert.match(dialogSource, /span\.push\(\{code:403/);
    assert.match(dialogSource, /span\.push\(\{code:404/);
  });

  test('reads MZ uiAreaWidth, gives MV the explicit screen-width contract, and clamps guide pixels to the measured textarea', () => {
    assert.match(engineSource, /uiAreaWidth: number/);
    assert.match(engineSource, /uiAreaWidth: 816/);
    assert.match(engineSource, /const uiAreaWidth = Number\(advanced\?\.uiAreaWidth\)/);
    assert.match(engineSource, /RPG Maker MZ System\.json must define positive advanced\.uiAreaWidth/);
    assert.match(manifestSource, /uiAreaWidth: number/);
    assert.match(catalogServiceSource, /uiAreaWidth: manifest\.uiAreaWidth/);
    assert.match(dialogSource, /area\.getBoundingClientRect\(\)\.width/);
    assert.match(dialogSource, /area\.clientWidth/);
    assert.match(dialogSource, /props\.catalog\?\.uiAreaWidth/);
    assert.match(dialogSource, /const maxGuide=Math\.max\(0,Math\.min\(Math\.max\(0,wrapWidth-1\),area\.offsetLeft\+measuredWidth-1\)\)/);
    assert.match(dialogSource, /Math\.min\(maxGuide,target\)/);
  });
});
