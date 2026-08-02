import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  commandBlockSpanIndices,
  commandDisplay,
  commandSpanDisplay,
  commandInsertIndent,
  editableCommandSpans,
  ensureTerminator,
  skipTerminatorIndices,
  type MvCommand,
} from './useEventEditor.ts';

const cmd = (code: number, indent = 0, parameters: unknown[] = []): MvCommand => ({ code, indent, parameters });

function spansOf(list: MvCommand[]) {
  return editableCommandSpans({ list } as never);
}

function skipList(): MvCommand[] {
  // 250 / [109 .. 101+401 .. 0] / 230 / terminator
  return [cmd(250), cmd(109), cmd(101, 1, ['', 0, 0, 2]), cmd(401, 1, ['hi']), cmd(0), cmd(230), cmd(0)];
}

describe('ensureTerminator with skip blocks', () => {
  test('keeps the skip terminator when the block sits at the end of the list', () => {
    const list = [cmd(250), cmd(109), cmd(230, 1), cmd(0), cmd(0)];
    ensureTerminator(list);
    assert.deepEqual(list.map((command) => command.code), [250, 109, 230, 0, 0]);
  });

  test('repairs a skip block whose terminator was consumed by earlier mutations', () => {
    const list = [cmd(109), cmd(230, 1), cmd(0)];
    ensureTerminator(list);
    assert.deepEqual(list.map((command) => command.code), [109, 230, 0, 0]);
    assert.equal(list[2].indent, 0);
  });

  test('keeps nested skip terminators at their own indent', () => {
    const list = [cmd(109), cmd(109, 1), cmd(230, 2), cmd(0, 1), cmd(0), cmd(0)];
    ensureTerminator(list);
    assert.deepEqual(list.map((command) => command.code), [109, 109, 230, 0, 0, 0]);
    assert.deepEqual(list.map((command) => command.indent), [0, 1, 2, 1, 0, 0]);
  });

  test('still collapses redundant trailing page terminators', () => {
    const list = [cmd(250), cmd(0), cmd(0), cmd(0)];
    ensureTerminator(list);
    assert.deepEqual(list.map((command) => command.code), [250, 0]);
  });

  test('keeps RM branch placeholder rows that sit before structure markers', () => {
    const list = [cmd(111), cmd(101, 1, ['', 0, 0, 2]), cmd(0, 1), cmd(412), cmd(0)];
    ensureTerminator(list);
    assert.deepEqual(list.map((command) => command.code), [111, 101, 0, 412, 0]);
    assert.equal(list[2].indent, 1);
  });
});

describe('commandBlockSpanIndices with skip blocks', () => {
  test('selecting the skip head expands to its code-0 terminator', () => {
    const list = skipList();
    const expanded = commandBlockSpanIndices(spansOf(list), [1]);
    assert.deepEqual(expanded, [1, 2, 3]);
  });

  test('selecting the skip terminator expands back to the head', () => {
    const list = skipList();
    const expanded = commandBlockSpanIndices(spansOf(list), [3]);
    assert.deepEqual(expanded, [1, 2, 3]);
  });

  test('selecting an if head still expands through 412', () => {
    const list = [cmd(111), cmd(230, 1), cmd(411), cmd(250, 1), cmd(412), cmd(117), cmd(0)];
    const expanded = commandBlockSpanIndices(spansOf(list), [0]);
    assert.deepEqual(expanded, [0, 1, 2, 3, 4]);
  });

  test('nested if blocks stop at the matching outer end marker', () => {
    const list = [cmd(111), cmd(111, 1), cmd(412, 1), cmd(412), cmd(117), cmd(0)];
    const expanded = commandBlockSpanIndices(spansOf(list), [0]);
    assert.deepEqual(expanded, [0, 1, 2, 3]);
  });
});

describe('commandDisplay code-0 rows and skip terminators', () => {
  test('renders comment continuation rows with a colon instead of a command head', () => {
    assert.equal(commandDisplay(cmd(408, 1, ['continued'])).label, ':continued');
    const span = spansOf([cmd(108, 0, ['comment']), cmd(408, 1, ['continued']), cmd(0)])[0]!;
    assert.deepEqual(commandSpanDisplay(span, null, 'en-US').lines, [':continued']);
  });

  test('renders code 0 as an RM placeholder row keeping its indent', () => {
    const view = commandDisplay(cmd(0, 1));
    assert.equal(view.label, '◆');
    assert.equal(view.indent, 1);
  });

  test('skipTerminatorIndices only marks code 0 rows that close a skip block', () => {
    const list = [
      cmd(109), cmd(111, 1), cmd(230, 2), cmd(0, 2), cmd(412, 1), cmd(0), // skip block with branch placeholder
      cmd(111), cmd(250, 1), cmd(0, 1), cmd(412), // plain if with placeholder
      cmd(0), // page terminator
    ];
    assert.deepEqual([...skipTerminatorIndices(list)], [5]);
  });

  test('renders labels without JSON wrapping', () => {
    assert.equal(commandDisplay(cmd(118, 0, ['12312'])).label, '◆Label: 12312');
    assert.equal(commandDisplay(cmd(119, 0, ['123123'])).label, '◆Jump to Label: 123123');
  });

  test('renders the move route head with target and wait suffix', () => {
    const route = { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: true };
    assert.equal(commandDisplay(cmd(205, 0, [-1, route])).label, '◆Set Movement Route: Player (Wait)');
    assert.equal(commandDisplay(cmd(505, 0, [{ code: 4 }])).label, ':◇Move Up');
  });

  test('renders an explicit invalid marker instead of 0NaN for condition IDs', () => {
    const switchCondition = commandDisplay(cmd(111, 0, [0, 'NaN', 0]), { switches: [] }, 'en-US');
    assert.match(switchCondition.label, /Invalid entry ID/);
    assert.doesNotMatch(switchCondition.label, /0NaN/);

    const variableCondition = commandDisplay(cmd(111, 0, [1, 1, 1, 'NaN', 0]), { variables: [] }, 'en-US');
    assert.match(variableCondition.label, /Invalid entry ID/);
    assert.doesNotMatch(variableCondition.label, /0NaN/);
  });
});

describe('commandInsertIndent inside blocks', () => {
  test('inserting right after the skip head lands at indent + 1', () => {
    const list = [cmd(109), cmd(0), cmd(0)];
    assert.equal(commandInsertIndent(list, 1), 1);
  });

  test('inserting after the whole skip block returns to the outer indent', () => {
    const list = [cmd(109), cmd(230, 1), cmd(0), cmd(0)];
    assert.equal(commandInsertIndent(list, 3), 0);
  });

  test('inserting inside an if block lands at indent + 1', () => {
    const list = [cmd(111), cmd(412), cmd(0)];
    assert.equal(commandInsertIndent(list, 1), 1);
  });
});
