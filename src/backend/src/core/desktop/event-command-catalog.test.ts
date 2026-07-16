import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COMMAND_DEFINITIONS,
  COMMAND_PAGES,
  STANDARD_COMMAND_CODES,
  commandDefinition,
  commandTemplate,
} from '../../../../ui/desktop/src/composables/eventCommandCatalog.ts';
import { eventCommandFormCoverageSummary } from '../../../../ui/desktop/src/utils/eventCommandFormCoverage.ts';
import {
  commandBlockSpanIndices,
  editableCommandSpans,
  MOVE_ROUTE_OPERATIONS,
  quickObtainEventTemplate,
  type MvEventPage,
} from '../../../../ui/desktop/src/composables/useEventEditor.ts';
import { eventCommandDefinition } from '../rmmv/event-command-registry.ts';

describe('MV event command catalog', () => {
  test('lists every standard MV command exactly once across three pages', () => {
    assert.equal(COMMAND_PAGES.length, 3);
    assert.equal(new Set(STANDARD_COMMAND_CODES).size, STANDARD_COMMAND_CODES.length);
    assert.equal(COMMAND_DEFINITIONS.length, 105);
    for (const definition of COMMAND_DEFINITIONS) {
      assert.equal(commandDefinition(definition.code), definition);
      assert.equal(commandTemplate(definition.kind)[0].code, definition.code);
      assert.ok(Array.isArray(definition.fields));
    }
  });

  test('keeps parameter form roots aligned with the backend MV command registry', () => {
    const summary = eventCommandFormCoverageSummary();
    assert.deepEqual(summary.raw, []);
    assert.equal(summary.total, 105);

    for (const definition of COMMAND_DEFINITIONS) {
      const registryDefinition = eventCommandDefinition(definition.code);
      assert.ok(registryDefinition, `UI command ${definition.code} must exist in backend registry`);
      const parameterIndexes = new Set(registryDefinition.parameters.map((parameter) => parameter.index));
      for (const field of definition.fields) {
        const root = field.path[0];
        if (typeof root !== 'number') continue;
        assert.ok(parameterIndexes.has(root), `UI command ${definition.code} field "${field.label}" points at parameter ${root}, but backend does not define it`);
      }
    }
  });

  test('keeps multiline commands and structural blocks atomic', () => {
    const page = {
      list: [
        { code: 111, indent: 0, parameters: [0, 1, 0] },
        { code: 101, indent: 1, parameters: ['', 0, 0, 2] },
        { code: 401, indent: 1, parameters: ['line 1'] },
        { code: 401, indent: 1, parameters: ['line 2'] },
        { code: 412, indent: 0, parameters: [] },
        { code: 0, indent: 0, parameters: [] },
      ],
    } as MvEventPage;
    const spans = editableCommandSpans(page);
    assert.equal(spans.length, 3);
    assert.equal(spans[1].commands.length, 3);
    assert.deepEqual(commandBlockSpanIndices(spans, [0]), [0, 1, 2]);
    assert.deepEqual(commandBlockSpanIndices(spans, [2]), [0, 1, 2]);
  });

  test('lists every editable MV move route operation from 1 through 45', () => {
    const codes = MOVE_ROUTE_OPERATIONS.map(([code]) => code);
    assert.deepEqual(codes, Array.from({ length: 45 }, (_value, index) => index + 1));
  });

  test('builds the MZ obtain quick event without an image or sound', () => {
    for (const [kind, code] of [['item', 126], ['weapon', 127], ['armor', 128]] as const) {
      const event = quickObtainEventTemplate(kind, 3, 4, 7, 8, 'Sample Entry');
      assert.equal(event.x, 7);
      assert.equal(event.y, 8);
      assert.equal(event.pages[0].trigger, 0);
      assert.equal(event.pages[0].image.characterName, '');
      assert.equal(event.pages[0].list[0].code, code);
      assert.deepEqual(event.pages[0].list[0].parameters, [3, 0, 0, 4, ...(code === 126 ? [] : [false])]);
      assert.equal(event.pages[0].list.some((command) => command.code === 250), false);
    }
  });
});
