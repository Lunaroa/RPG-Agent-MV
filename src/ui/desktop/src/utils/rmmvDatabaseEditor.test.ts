import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  animationFramesSummary,
  appendAnimationFrame,
  appendAnimationFrameCell,
  appendAnimationTiming,
  applyClassParamLinearCurve,
  appendStringListItem,
  canRemoveStringListItem,
  isMvStringListField,
  normalizeAnimationFrameCell,
  normalizeAnimationFrames,
  normalizeAnimationTiming,
  normalizeAnimationTimings,
  normalizeClassParamCurves,
  normalizeTroopPageConditions,
  normalizeStringList,
  normalizeTermsArray,
  removeStringListItem,
  termsArraySlotCount,
  setAnimationFrameCellValue,
  setAnimationTimingFlashColor,
  setAnimationTimingSeValue,
  setAnimationTimingValue,
  setClassParamCurveLevel,
  setStringListItem,
  setTroopPageCondition,
  setTroopPageSpan,
  sortedTermsMessageKeys,
  stringListHasReservedZero,
  summarizeMvCommandList,
  troopPageConditionSummary,
} from './rmmvDatabaseEditor.ts';

describe('rmmvDatabaseEditor helpers', () => {
  it('recognizes MV System and Types name arrays as structured string lists', () => {
    assert.equal(isMvStringListField('System', 'switches'), true);
    assert.equal(isMvStringListField('Types', 'skillTypes'), true);
    assert.equal(isMvStringListField('System', 'menuCommands'), false);
    assert.equal(stringListHasReservedZero('System', 'variables'), true);
    assert.equal(stringListHasReservedZero('Terms', 'commands'), false);
  });

  it('keeps the reserved zero slot for System and Types lists', () => {
    assert.deepEqual(normalizeStringList(['Fire'], true), ['', 'Fire']);
    assert.deepEqual(setStringListItem(['', 'A'], 0, 'Ignored', true), ['', 'A']);
    assert.deepEqual(removeStringListItem(['', 'A'], 0, true), ['', 'A']);
    assert.deepEqual(removeStringListItem([''], 1, true), ['']);
    assert.equal(canRemoveStringListItem(['', 'Magic', 'Special'], 1, true), false);
    assert.equal(canRemoveStringListItem(['', 'Magic', 'Special'], 2, true), true);
    assert.equal(canRemoveStringListItem(['', 'Magic'], 0, true), false);
  });

  it('edits normal Terms lists without reserving a hidden index', () => {
    assert.deepEqual(appendStringListItem(['Fight'], false), ['Fight', '']);
    assert.deepEqual(setStringListItem(['Fight'], 0, 'Battle', false), ['Battle']);
    assert.deepEqual(removeStringListItem(['Fight', 'Escape'], 0, false), ['Escape']);
  });

  it('pads Terms arrays to MV slot counts for native grid editing', () => {
    assert.equal(termsArraySlotCount('basic', ['等级']), 10);
    assert.equal(termsArraySlotCount('commands', new Array(26).fill('x')), 26);
    assert.deepEqual(normalizeTermsArray(['等级', 'Lv'], 'basic'), [
      '等级', 'Lv', '', '', '', '', '', '', '', '',
    ]);
  });

  it('sorts known Terms messages before custom message keys', () => {
    assert.deepEqual(sortedTermsMessageKeys({ customZ: 'z', victory: 'v', actorDamage: 'd' }), [
      'actorDamage',
      'victory',
      'customZ',
    ]);
  });

  it('normalizes and edits full Classes parameter curves for levels 1-99', () => {
    const curves = normalizeClassParamCurves([[999, 10]]);
    assert.equal(curves.length, 8);
    assert.equal(curves[0].length, 100);
    assert.equal(curves[0][0], 0);
    assert.equal(curves[0][1], 10);
    assert.equal(curves[7][99], 0);

    const edited = setClassParamCurveLevel(curves, 2, 99, 321);
    assert.equal(edited[2][99], 321);

    const linear = applyClassParamLinearCurve(edited, 0, 1, 5, 10, 50);
    assert.deepEqual(linear[0].slice(1, 6), [10, 20, 30, 40, 50]);
  });

  it('structures Troops pages and preserves MV command summaries for review', () => {
    const conditions = normalizeTroopPageConditions({
      turnValid: true,
      turnA: 1,
      turnB: 2,
      enemyValid: true,
      enemyIndex: 1,
      enemyHp: 25,
    });
    assert.equal(conditions.turnValid, true);
    assert.equal(conditions.enemyHp, 25);
    assert.deepEqual(troopPageConditionSummary(conditions), [
      '回合 1+2X',
      '敌人 #2 HP <= 25%',
    ]);

    const withSwitch = setTroopPageCondition({ conditions }, 'switchId', 3);
    assert.deepEqual((withSwitch.conditions as Record<string, unknown>).switchId, 3);
    assert.equal(setTroopPageSpan(withSwitch, 2).span, 2);
    assert.deepEqual(summarizeMvCommandList([{ code: 117, indent: 1, parameters: [2] }]), [
      '  code 117 · 1 参数',
    ]);
  });

  it('normalizes and edits Animations frames one cell field at a time', () => {
    assert.deepEqual(normalizeAnimationFrameCell([1, 2, 3]), [1, 2, 3, 100, 0, 0, 255, 0]);
    assert.deepEqual(normalizeAnimationFrames([[[1], 'bad']]), [[[1, 0, 0, 100, 0, 0, 255, 0], [0, 0, 0, 100, 0, 0, 255, 0]]]);

    const withFrame = appendAnimationFrame([]);
    assert.equal(animationFramesSummary(withFrame), '1 帧 · 单帧最多 1 个 cell');
    const withCell = appendAnimationFrameCell(withFrame, 0);
    const edited = setAnimationFrameCellValue(withCell, 0, 1, 6, 128);
    assert.equal(edited[0][1][6], 128);
  });

  it('normalizes and edits Animations SE timing and flash timing', () => {
    const timing = normalizeAnimationTiming({
      frame: 12,
      se: { name: 'Slash1', volume: 120, pitch: 30, pan: -120 },
      flashScope: 9,
      flashColor: [300, -1, 60],
      flashDuration: 6,
    });
    assert.deepEqual(timing, {
      frame: 12,
      se: { name: 'Slash1', volume: 100, pitch: 50, pan: -100 },
      flashScope: 3,
      flashColor: [255, 0, 60, 255],
      flashDuration: 6,
    });

    let timings = appendAnimationTiming([]);
    timings = setAnimationTimingValue(timings, 0, 'frame', 18);
    timings = setAnimationTimingSeValue(timings, 0, 'name', 'Hit1');
    timings = setAnimationTimingFlashColor(timings, 0, 2, 90);
    assert.equal(normalizeAnimationTimings(timings)[0].frame, 18);
    assert.equal(normalizeAnimationTimings(timings)[0].se.name, 'Hit1');
    assert.equal(normalizeAnimationTimings(timings)[0].flashColor[2], 90);
  });
});
