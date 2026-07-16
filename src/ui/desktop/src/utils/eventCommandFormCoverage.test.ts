import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COMMAND_DEFINITIONS,
  commandDefinition,
  commandPages,
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

  test('uses MZ 1.10 parameter forms and structured plugin commands', () => {
    const [text] = commandTemplate('text', 1, 'rpg-maker-mz');
    assert.deepEqual(text?.parameters, ['', 0, 0, 2, '']);

    const [selectItem] = commandTemplate('selectItem', 1, 'rpg-maker-mz');
    assert.deepEqual(selectItem?.parameters, [1, 2]);
    assert.deepEqual(
      commandDefinition(104, 'rpg-maker-mz')?.fields[1]?.options?.map(([value]) => value),
      [1, 2, 3, 4],
    );

    const [movePicture] = commandTemplate('movePicture', 1, 'rpg-maker-mz');
    assert.equal(movePicture?.parameters.length, 13);
    assert.equal(movePicture?.parameters[12], 0);

    const [actorImages] = commandTemplate('actorImages', 1, 'rpg-maker-mz');
    assert.deepEqual(actorImages?.parameters, [1, '', 0, '', 0, '']);
    assert.equal(commandDefinition(322, 'rpg-maker-mz')?.fields[1]?.asset, 'faces');
    assert.equal(commandDefinition(322, 'rpg-maker-mz')?.fields[3]?.asset, 'characters');

    const [battleAnimation] = commandTemplate('battleAnimation', 1, 'rpg-maker-mz');
    assert.deepEqual(battleAnimation?.parameters, [-1, 1]);

    const [plugin] = commandTemplate('plugin', 1, 'rpg-maker-mz');
    assert.equal(plugin?.code, 357);
    assert.deepEqual(plugin?.parameters, ['', '', '', {}]);
    const codes = commandPages('rpg-maker-mz').flatMap((groups) => groups.flatMap((group) => group.items.map((item) => item.code)));
    assert.equal(codes.includes(356), false);
    assert.equal(codes.includes(357), true);
  });
});
