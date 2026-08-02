import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CONDITIONAL_BRANCH_PARAMETER_CONTRACTS_BY_ENGINE,
  CONDITIONAL_BUTTON_KEY_NAMES,
  CONDITIONAL_BUTTON_MODES,
  CONDITIONAL_BRANCH_PARAMETER_CONTRACTS,
  applyConditionalBranchElse,
  conditionalElseBodyCommandCount,
  initializeConditionalBranchDraftMap,
  inspectConditionalBranchSpan,
  isConditionalNamedEntryTarget,
  switchConditionalBranchDraft,
  updateConditionalVariableOperand,
  validateConditionalBranchParameters,
  type ConditionalBranchCommand,
} from './conditionalBranchEditor.ts';
import { normalizeEventCommandParameters } from './eventCommandCatalogLocalization.ts';

function command(code: number, indent: number, parameters: unknown[] = []): ConditionalBranchCommand {
  return { code, indent, parameters };
}

describe('conditional branch editor helpers', () => {
  test('defines and validates all fourteen condition types with legal normalized defaults', () => {
    const expectedTypes = Array.from({ length: 14 }, (_, type) => type);
    const actualTypes = Object.keys(CONDITIONAL_BRANCH_PARAMETER_CONTRACTS).map(Number).sort((left, right) => left - right);
    assert.deepEqual(actualTypes, expectedTypes);

    for (const engine of ['rpg-maker-mv', 'rpg-maker-mz'] as const) {
      const contracts = CONDITIONAL_BRANCH_PARAMETER_CONTRACTS_BY_ENGINE[engine];
      for (const type of expectedTypes) {
        const contract = contracts[type];
        assert.ok(contract, `missing ${engine} contract for condition type ${type}`);
        const normalizedCommand = command(111, 0, [type]);
        normalizeEventCommandParameters(normalizedCommand, engine);
        assert.equal(normalizedCommand.parameters[0], type);
        assert.ok(contract.lengths.includes(normalizedCommand.parameters.length), `${engine} type ${type} normalized to an undocumented shape`);
        assert.doesNotThrow(() => validateConditionalBranchParameters(normalizedCommand.parameters, engine), `${engine} type ${type} normalized defaults must be valid`);
        if (type === 11) {
          assert.equal(normalizedCommand.parameters[1], CONDITIONAL_BUTTON_KEY_NAMES[0]);
          if (engine === 'rpg-maker-mv') assert.deepEqual(normalizedCommand.parameters, [11, 'down']);
          else assert.deepEqual(normalizedCommand.parameters, [11, 'down', CONDITIONAL_BUTTON_MODES[0]]);
        }

        for (const [indexText, field] of Object.entries(contract.fields)) {
          const index = Number(indexText);
          const invalid = [...normalizedCommand.parameters];
          invalid[index] = field.kind === 'positiveInteger'
            ? 0
            : field.kind === 'nonNegativeInteger'
              ? -1
              : field.kind === 'integer' || field.kind === 'finiteNumber'
                ? Number.NaN
                : field.kind === 'string'
                  ? null
                  : field.kind === 'boolean'
                    ? 'false'
                    : Symbol('invalid-condition-value');
          assert.throws(
            () => validateConditionalBranchParameters(invalid, engine),
            /must/,
            `${engine} type ${type} field ${index} should reject an invalid value`,
          );
        }
      }
    }

    assert.doesNotThrow(() => validateConditionalBranchParameters([4, 1, 1, 'Hero']));
    assert.doesNotThrow(() => validateConditionalBranchParameters([4, 1, 2, 1]));
    assert.doesNotThrow(() => validateConditionalBranchParameters([5, 0, 1, 1]));
    assert.doesNotThrow(() => validateConditionalBranchParameters([11, 'down'], 'rpg-maker-mv'));
    assert.doesNotThrow(() => validateConditionalBranchParameters([11, 'down', 0], 'rpg-maker-mz'));
    assert.throws(() => validateConditionalBranchParameters([11, 2], 'rpg-maker-mv'), /allowed values/);
    assert.throws(() => validateConditionalBranchParameters([11, 'down'], 'rpg-maker-mz'), /invalid parameter shape/);
    assert.throws(() => validateConditionalBranchParameters([4, 1, 1, 1]), /name/);
    assert.throws(() => validateConditionalBranchParameters([4, 1, 2, 0]), /entry ID/);
    assert.throws(() => validateConditionalBranchParameters([5, 0, 1, 0]), /state ID/);
  });

  test('updates variable operand atomically and preserves p1/p4', () => {
    const original = [1, 17, 0, 42, 5];
    const variable = updateConditionalVariableOperand(original, 1);
    assert.deepEqual(variable, [1, 17, 1, 1, 5]);
    assert.deepEqual(original, [1, 17, 0, 42, 5]);

    const constant = updateConditionalVariableOperand(variable, 0);
    assert.deepEqual(constant, [1, 17, 0, 0, 5]);
  });

  test('isolates conditional type drafts and preserves only visited edits', () => {
    const source = [7, 100, 0];
    const drafts = initializeConditionalBranchDraftMap(source);
    assert.deepEqual(drafts, { 7: source });

    const switchedToItem = switchConditionalBranchDraft(
      drafts,
      source,
      8,
      (type) => {
        const next = command(111, 0, [type]);
        normalizeEventCommandParameters(next, 'rpg-maker-mv');
        return next.parameters;
      },
    );
    assert.deepEqual(switchedToItem.parameters, [8, 1]);
    switchedToItem.parameters[1] = 42;

    const switchedBackToGold = switchConditionalBranchDraft(
      switchedToItem.drafts,
      switchedToItem.parameters,
      7,
      (type) => [type, 0, 0],
    );
    assert.deepEqual(switchedBackToGold.parameters, source);
    assert.deepEqual(switchedToItem.drafts[8], [8, 1]);
    assert.deepEqual(drafts, { 7: source });

    const switchedToScript = switchConditionalBranchDraft(
      switchedBackToGold.drafts,
      switchedBackToGold.parameters,
      12,
      (type) => {
        const next = command(111, 0, [type]);
        normalizeEventCommandParameters(next, 'rpg-maker-mv');
        return next.parameters;
      },
    );
    assert.deepEqual(switchedToScript.parameters, [12, '']);
    assert.equal(switchedToScript.parameters[1], '');
    assert.equal(switchedToScript.drafts[7]?.[1], 100);
    assert.equal(switchedToScript.drafts[8]?.[1], 42);
  });

  test('keeps asynchronous named-entry targets bound to their opening field', () => {
    assert.equal(isConditionalNamedEntryTarget([0, 1, 0], 'switch', 1), true);
    assert.equal(isConditionalNamedEntryTarget([0, 1, 0], 'variable', 1), false);
    assert.equal(isConditionalNamedEntryTarget([1, 10, 0, 20, 0], 'variable', 1), true);
    assert.equal(isConditionalNamedEntryTarget([1, 10, 0, 20, 0], 'variable', 3), false);
    assert.equal(isConditionalNamedEntryTarget([1, 10, 1, 20, 0], 'variable', 3), true);
    assert.equal(isConditionalNamedEntryTarget([2, 'A', 0], 'variable', 1), false);
  });

  test('rejects invalid named-entry IDs and non-finite values', () => {
    assert.throws(() => validateConditionalBranchParameters([1, 0, 0, 1, 0]), /Left variable ID/);
    assert.throws(() => validateConditionalBranchParameters([1, Number.NaN, 0, 1, 0]), /Left variable ID/);
    assert.throws(() => validateConditionalBranchParameters([1, 1, 1, 0, 0]), /Right variable ID/);
    assert.throws(() => validateConditionalBranchParameters([1, 1, 0, Number.POSITIVE_INFINITY, 0]), /constant/);
    assert.throws(() => updateConditionalVariableOperand([0, 1, 0], 1), /type-1/);
  });

  test('adds an explicit 412 for new branches and optional 411', () => {
    const head = command(111, 0, [1, 3, 0, 9, 2]);
    assert.deepEqual(applyConditionalBranchElse([head], false).map((item) => item.code), [111, 412]);
    assert.deepEqual(applyConditionalBranchElse([head], true).map((item) => item.code), [111, 411, 412]);
  });

  test('preserves Then and Else bodies while toggling the marker', () => {
    const withoutElse = [
      command(111, 0, [1, 3, 0, 9, 2]),
      command(230, 1, [60]),
      command(412, 0),
    ];
    const withElse = applyConditionalBranchElse(withoutElse, true);
    assert.deepEqual(withElse.map((item) => item.code), [111, 230, 411, 412]);
    assert.deepEqual(withElse[1]?.parameters, [60]);

    const withElseBody = [
      ...withElse.slice(0, 3),
      command(250, 1, []),
      withElse[3]!,
    ];
    assert.deepEqual(inspectConditionalBranchSpan(withElseBody), { headIndent: 0, elseIndex: 2, endIndex: 4 });
    const removed = applyConditionalBranchElse(withElseBody, false);
    assert.deepEqual(removed.map((item) => item.code), [111, 230, 412]);
    assert.deepEqual(removed[1]?.parameters, [60]);
  });

  test('does not count RM placeholder rows as Else body commands', () => {
    const emptyElse = [
      command(111, 0, [0, 1, 0]),
      command(411, 0),
      command(0, 1),
      command(412, 0),
    ];
    assert.equal(conditionalElseBodyCommandCount(emptyElse), 0);
    const populatedElse = [...emptyElse.slice(0, 2), command(230, 1, [1]), ...emptyElse.slice(2)];
    assert.equal(conditionalElseBodyCommandCount(populatedElse), 1);
  });

  test('does not mutate the source span while building a draft edit', () => {
    const original = [
      command(111, 0, [1, 3, 0, 9, 2]),
      command(230, 1, [{ role: 'then' }]),
      command(411, 0),
      command(250, 1, [{ role: 'else' }]),
      command(412, 0),
    ];
    const snapshot = JSON.parse(JSON.stringify(original));
    const removed = applyConditionalBranchElse(original, false);
    removed[1]!.parameters[0] = { role: 'draft-only' };
    assert.deepEqual(original, snapshot);
    assert.deepEqual(original.map((item) => item.code), [111, 230, 411, 250, 412]);
  });

  test('allows nested commands but rejects malformed top-level markers', () => {
    const nested = [
      command(111, 0, [1, 3, 0, 9, 2]),
      command(111, 1, [0, 2, 0]),
      command(412, 1),
      command(411, 0),
      command(412, 0),
    ];
    assert.deepEqual(inspectConditionalBranchSpan(nested), { headIndent: 0, elseIndex: 3, endIndex: 4 });
    assert.throws(() => inspectConditionalBranchSpan(nested.slice(0, -1)), /412/);
    assert.throws(() => inspectConditionalBranchSpan([...nested, command(230, 0)]), /after/);
    assert.throws(() => inspectConditionalBranchSpan([
      command(111, 0, [1, 3, 0, 9, 2]),
      command(411, 0),
      command(411, 0),
      command(412, 0),
    ]), /more than one/);
  });
});
