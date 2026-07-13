import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import {
  alignTroopMembers,
  animationFramesSummary,
  appendAnimationFrame,
  appendAnimationFrameCell,
  appendAnimationTiming,
  applyClassParamLinearCurve,
  appendStringListItem,
  autoNameTroop,
  canRemoveStringListItem,
  cloneDatabaseEditorRecord,
  enemyActionConditionPercentage,
  isStandardEnemyActionConditionType,
  isMvStringListField,
  normalizeAnimationFrameCell,
  normalizeAnimationFrames,
  normalizeAnimationTiming,
  normalizeAnimationTimings,
  normalizeClassParamCurves,
  normalizeTroopMembers,
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
  setEnemyActionConditionParameter,
  setEnemyActionConditionType,
  setStringListItem,
  setTroopPageCondition,
  setTroopPageSpan,
  sortedTermsMessageKeys,
  standardBlankTroopPage,
  stringListHasReservedZero,
  summarizeMvCommandList,
  troopPageConditionSummary,
} from './rmmvDatabaseEditor.ts';

describe('rmmvDatabaseEditor helpers', () => {
  it('clones Vue-reactive database records before immutable field writes', () => {
    const source = reactive({ name: 'Source', pluginData: { enabled: true } });

    const cloned = cloneDatabaseEditorRecord(source);
    cloned.name = 'Draft';
    (cloned.pluginData as { enabled: boolean }).enabled = false;

    assert.deepEqual(source, { name: 'Source', pluginData: { enabled: true } });
    assert.deepEqual(cloned, { name: 'Draft', pluginData: { enabled: false } });
  });

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
      'Turn 1+2X',
      'Enemy #2 HP <= 25%',
    ]);
    assert.deepEqual(troopPageConditionSummary(conditions, 'zh-CN'), [
      '回合 1+2X',
      '敌人 #2 HP <= 25%',
    ]);

    const withSwitch = setTroopPageCondition({ conditions }, 'switchId', 3);
    assert.deepEqual((withSwitch.conditions as Record<string, unknown>).switchId, 3);
    assert.equal(setTroopPageSpan(withSwitch, 2).span, 2);
    assert.deepEqual(summarizeMvCommandList([{ code: 117, indent: 1, parameters: [2] }]), [
      '  code 117 · 1 parameters',
    ]);
    assert.deepEqual(summarizeMvCommandList([{ code: 117, indent: 1, parameters: [2] }], 8, 'zh-CN'), [
      '  code 117 · 1 参数',
    ]);
  });

  it('edits all standard enemy action conditions with MV storage semantics', () => {
    const base = { skillId: 1, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5, plugin: true };
    assert.equal(isStandardEnemyActionConditionType(6), true);
    assert.equal(isStandardEnemyActionConditionType(12), false);
    assert.deepEqual(setEnemyActionConditionType(base, 2), {
      ...base,
      conditionType: 2,
      conditionParam1: 0,
      conditionParam2: 1,
    });
    const hp = setEnemyActionConditionParameter(setEnemyActionConditionType(base, 2), 1, 25);
    assert.equal(hp.conditionParam1, 0.25);
    assert.equal(enemyActionConditionPercentage(hp, 1), 25);
    assert.equal(setEnemyActionConditionParameter(setEnemyActionConditionType(base, 5), 1, 120).conditionParam1, 99);
    assert.equal(setEnemyActionConditionType(base, 4, { stateId: 3 }).conditionParam1, 3);
    assert.equal(setEnemyActionConditionType(base, 6, { switchId: 4 }).conditionParam1, 4);
    assert.throws(() => setEnemyActionConditionType(base, 4), /state reference/i);
    const unrelatedInvalidFields = setEnemyActionConditionType({ ...base, skillId: 0, rating: 10 }, 1);
    assert.equal(unrelatedInvalidFields.skillId, 0);
    assert.equal(unrelatedInvalidFields.rating, 10);
  });

  it('aligns, names, and clears troop data without reordering or plugin-field loss', () => {
    const members = [
      { enemyId: 2, x: 1, y: 2, hidden: false, plugin: 'a' },
      { enemyId: 1, x: 3, y: 4, hidden: true, plugin: 'b' },
      { enemyId: 2, x: 5, y: 6, hidden: false, plugin: 'c' },
    ];
    const aligned = alignTroopMembers(members);
    assert.deepEqual(aligned.map((member) => [member.enemyId, member.x, member.y]), [
      [2, 264, 436],
      [1, 408, 436],
      [2, 552, 436],
    ]);
    assert.equal(aligned[0].plugin, 'a');
    assert.deepEqual(normalizeTroopMembers([
      { enemyId: 0, x: -12, y: 700, hidden: false, plugin: 'legacy' },
    ])[0], { enemyId: 0, x: -12, y: 700, hidden: false, plugin: 'legacy' });
    assert.equal(autoNameTroop(members, [{ id: 1, name: 'Bat' }, { id: 2, name: 'Slime' }]), 'Slime*2, Bat');
    assert.throws(() => autoNameTroop([{ enemyId: 9 }], []), /#9/);
    assert.deepEqual(standardBlankTroopPage(), {
      conditions: {
        turnEnding: false,
        turnValid: false,
        enemyValid: false,
        actorValid: false,
        switchValid: false,
        turnA: 0,
        turnB: 0,
        enemyIndex: 0,
        enemyHp: 50,
        actorId: 1,
        actorHp: 50,
        switchId: 1,
      },
      list: [{ code: 0, indent: 0, parameters: [] }],
      span: 0,
    });
  });

  it('normalizes and edits Animations frames one cell field at a time', () => {
    assert.deepEqual(normalizeAnimationFrameCell([1, 2, 3]), [1, 2, 3, 100, 0, 0, 255, 0]);
    assert.deepEqual(normalizeAnimationFrames([[[1], 'bad']]), [[[1, 0, 0, 100, 0, 0, 255, 0], [0, 0, 0, 100, 0, 0, 255, 0]]]);

    const withFrame = appendAnimationFrame([]);
    assert.equal(animationFramesSummary(withFrame), '1 frames · max 1 cells per frame');
    assert.equal(animationFramesSummary(withFrame, 'zh-CN'), '1 帧 · 单帧最多 1 个 cell');
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
