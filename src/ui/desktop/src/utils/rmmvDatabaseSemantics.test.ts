import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classParameterValueRange,
  createStandardMvEffect,
  createStandardMvTrait,
  isStandardMvEffectCode,
  isStandardMvTraitCode,
  mvEffectEditorValue,
  mvTraitEditorValue,
  normalizeMvEffect,
  normalizeMvTrait,
  setMvEffectEditorValue,
  setMvTraitEditorValue,
  setStandardMvEffectCode,
  setStandardMvTraitCode,
} from './rmmvDatabaseSemantics.ts';

describe('RPG Maker MV semantic database editors', () => {
  it('edits standard trait percentages while preserving unknown fields', () => {
    const source = { code: 21, dataId: 2, value: 1.25, pluginFlag: { enabled: true } };
    assert.equal(mvTraitEditorValue(source), 125);
    assert.deepEqual(setMvTraitEditorValue(source, 150), {
      ...source,
      value: 1.5,
    });
    assert.deepEqual(normalizeMvTrait(source).pluginFlag, { enabled: true });
  });

  it('switches standard trait types to deterministic valid operands', () => {
    const source = { code: 21, dataId: 3, value: 2, pluginField: 'keep' };
    assert.deepEqual(setStandardMvTraitCode(source, 55), {
      code: 55,
      dataId: 1,
      value: 1,
      pluginField: 'keep',
    });
    assert.deepEqual(createStandardMvTrait(13, { stateId: 4 }), {
      code: 13,
      dataId: 4,
      value: 1,
    });
  });

  it('converts effect percentages and keeps plugin fields on standard effects', () => {
    const source = { code: 11, dataId: 0, value1: .25, value2: 50, pluginField: ['keep'] };
    assert.equal(mvEffectEditorValue(source, 'value1'), 25);
    assert.deepEqual(setMvEffectEditorValue(source, 'value1', -40), {
      ...source,
      value1: -.4,
    });
    assert.deepEqual(normalizeMvEffect(source).pluginField, ['keep']);
    assert.deepEqual(setStandardMvEffectCode(source, 44, { commonEventId: 3 }), {
      code: 44,
      dataId: 3,
      value1: 0,
      value2: 0,
      pluginField: ['keep'],
    });
    assert.deepEqual(createStandardMvEffect(21, { stateId: 2 }), {
      code: 21,
      dataId: 0,
      value1: 1,
      value2: 0,
    });
  });

  it('distinguishes plugin codes and exposes the original class parameter ranges', () => {
    assert.equal(isStandardMvTraitCode(64), true);
    assert.equal(isStandardMvTraitCode(999), false);
    assert.equal(isStandardMvEffectCode(44), true);
    assert.equal(isStandardMvEffectCode(999), false);
    assert.deepEqual(classParameterValueRange(0), { minimum: 1, maximum: 9999 });
    assert.deepEqual(classParameterValueRange(1), { minimum: 0, maximum: 9999 });
    assert.deepEqual(classParameterValueRange(7), { minimum: 1, maximum: 999 });
    assert.throws(() => classParameterValueRange(8), /Invalid MV class parameter index/);
  });
});
