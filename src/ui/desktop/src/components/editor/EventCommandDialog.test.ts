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

  test('keeps code-111 variable operand updates atomic and preserves branch markers', () => {
    assert.match(dialogSource, /updateConditionalVariableOperand/);
    assert.match(dialogSource, /draft\.value\.parameters=updateConditionalVariableOperand\(draft\.value\.parameters,operand as 0\|1\)/);
    assert.match(dialogSource, /applyConditionalBranchElse\(draftSpan\.value\.length\?draftSpan\.value:\[draft\.value\],elseBranchEnabled\.value,currentEngine\.value\)/);
    assert.match(dialogSource, /:checked="elseBranchEnabled"/);
    assert.match(dialogSource, /@change="toggleElseBranch"/);
    assert.match(dialogSource, /eventcmd\.removeElseConfirm/);
    assert.match(dialogSource, /const input=event\.target as HTMLInputElement\|null/);
    assert.match(dialogSource, /if\(input\)input\.checked=true/);
    assert.match(dialogSource, /isCode111NamedId/);
    assert.match(dialogSource, /isFinitePositiveInteger\(payload\.id\)/);
    assert.match(dialogSource, /const nextSpan=clone\(commands\)/);
    assert.match(dialogSource, /draftSpan\.value=\[\]/);
    assert.match(dialogSource, /conditionalTypeDrafts/);
    assert.match(dialogSource, /initializeConditionalBranchDraftMap/);
    assert.match(dialogSource, /switchConditionalBranchDraft/);
    assert.match(dialogSource, /conditionalNumberParam\(7,1\)/);
    assert.match(dialogSource, /conditionalNumberParam\(8,1,1\)/);
    assert.match(dialogSource, /conditionalNumberParam\(9,1,1\)/);
    assert.match(dialogSource, /conditionalNumberParam\(10,1,1\)/);
    assert.match(dialogSource, /conditionalStringParam\(11,1,'down'\)/);
    assert.match(dialogSource, /conditionalStringParam\(12,1\)/);
    assert.match(dialogSource, /conditionalBooleanParam\(9,2\)/);
    assert.match(dialogSource, /conditionalBooleanParam\(10,2\)/);
    assert.match(dialogSource, /conditionalButtonKeys/);
    assert.match(dialogSource, /currentEngine==='rpg-maker-mz'/);
    assert.match(dialogSource, /conditionalButtonModes/);
  });

  test('guards asynchronous code-111 named-entry callbacks by opening scope', () => {
    assert.match(dialogSource, /type PendingNamedEntry = \{kind:ConditionalNamedEntryKind;index:number;mirror\?:number;conditionType:number\|null\}/);
    assert.match(dialogSource, /const conditionType=draft\.value\?\.code===111\?activeConditionalType\(\):null/);
    assert.match(dialogSource, /if\(pending\.conditionType!==null\)/);
    assert.match(dialogSource, /if\(!visible\.value\|\|draft\.value\?\.code!==111\|\|activeConditionalType\(\)!==pending\.conditionType\)return/);
    assert.match(dialogSource, /isConditionalNamedEntryTarget\(draft\.value\.parameters,pending\.kind,pending\.index\)/);
  });
});
