import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COMMAND_DEFINITIONS,
  commandTemplate,
  normalizeEventCommandParameters,
} from '../composables/eventCommandCatalog.ts';
import { eventCommandFormCoverageSummary } from './eventCommandFormCoverage.ts';

describe('event command form coverage', () => {
  test('keeps all standard MV commands out of unsupported raw UI', () => {
    const summary = eventCommandFormCoverageSummary();

    assert.equal(summary.total, 105);
    assert.deepEqual(summary.raw, []);
    assert.ok(summary.specialized.includes(101));
    assert.ok(summary.specialized.includes(205));
    assert.ok(summary.parameterForm.includes(111));
    assert.ok(summary.parameterForm.includes(122));
    assert.ok(summary.parameterForm.includes(301));
    assert.ok(summary.parameterForm.includes(302));
    assert.ok(summary.noParameter.includes(113));
  });

  test('normalizes conditional branch parameter shapes when condition type changes', () => {
    const [command] = commandTemplate('conditional');
    assert.ok(command);

    command.parameters[0] = 12;
    normalizeEventCommandParameters(command);
    assert.deepEqual(command.parameters.slice(0, 2), [12, '']);

    command.parameters[0] = 4;
    command.parameters[2] = 3;
    normalizeEventCommandParameters(command);
    assert.equal(command.parameters[1], 1);
    assert.equal(command.parameters[3], 1);
  });

  test('normalizes control variables operand modes', () => {
    const definition = COMMAND_DEFINITIONS.find((item) => item.code === 122);
    assert.ok(definition);
    const [command] = commandTemplate(definition.kind);
    assert.ok(command);

    command.parameters[3] = 2;
    normalizeEventCommandParameters(command);
    assert.equal(command.parameters[4], 0);
    assert.equal(command.parameters[5], 0);

    command.parameters[3] = 3;
    normalizeEventCommandParameters(command);
    assert.equal(command.parameters[4], 0);
    assert.equal(command.parameters[5], 0);
    assert.equal(command.parameters[6], 0);

    command.parameters[3] = 4;
    command.parameters[4] = 9;
    normalizeEventCommandParameters(command);
    assert.equal(command.parameters[4], '');
  });

  test('does not write placeholder text into new command templates', () => {
    assert.deepEqual(commandTemplate('text')[1]?.parameters, ['']);
    assert.deepEqual(commandTemplate('scrollText')[1]?.parameters, ['']);
    assert.deepEqual(commandTemplate('comment')[0]?.parameters, ['']);
    assert.deepEqual(commandTemplate('label')[0]?.parameters, ['']);
    assert.deepEqual(commandTemplate('jumpLabel')[0]?.parameters, ['']);
  });
});
