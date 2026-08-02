import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commandBlockSpanIndices,
  commandBranchScope,
  commandSpanLength,
  commandSpanDisplay,
  commandStructureBlocks,
  dropCommandSpanBlocks,
  editableCommandSpans,
  skipTerminatorIndices,
  type MvCommand,
} from './useEventEditor';

function command(code: number, indent = 0, parameters: unknown[] = []): MvCommand {
  return { code, indent, parameters };
}

function spansFor(list: MvCommand[]) {
  return editableCommandSpans({ list } as never);
}

test('groups every MV continuation family without changing raw parameter payloads', () => {
  const list = [
    command(101, 0, ['Face', 0, 0, 2]), command(401, 1, ['line 1']), command(401, 1, ['line 2']),
    command(205, 0, [-1, { list: [command(1)], wait: true }]), command(505, 1, [command(15)]),
    command(302, 0, [0, 1, 2, 'shop']), command(605, 1, ['shop row']),
    command(355, 0, ['script']), command(655, 1, ['script line']),
    command(357, 0, ['Plugin', 'command', 'raw']), command(657, 1, ['raw params']),
    command(999, 0, ['unknown', { keep: true }]), command(0),
  ];

  assert.equal(commandSpanLength(list, 0), 3);
  assert.equal(commandSpanLength(list, 3), 2);
  assert.equal(commandSpanLength(list, 5), 2);
  assert.equal(commandSpanLength(list, 7), 2);
  assert.equal(commandSpanLength(list, 9), 2);
  const spans = spansFor(list);
  assert.deepEqual(spans.map((span) => span.commands.map((item) => item.code)), [
    [101, 401, 401], [205, 505], [302, 605], [355, 655], [357, 657], [999],
  ]);
  assert.deepEqual(spans[4]?.commands[1]?.parameters, ['raw params']);
  assert.deepEqual(spans[5]?.commands[0]?.parameters, ['unknown', { keep: true }]);
});

test('models choices, branches, nested conditional and their complete selection boundaries', () => {
  const spans = spansFor([
    command(102, 0, [['Yes', 'No'], 0, 0, 2]),
    command(402, 0, [0, 0, 'Yes']),
    command(101, 1, ['', 0, 0, 2]), command(401, 2, ['yes body']),
    command(403, 0, [1]),
    command(111, 1, [0, 1, 0, 0, 0]), command(411, 1), command(412, 1),
    command(404, 0), command(0),
  ]);
  const blocks = commandStructureBlocks(spans);
  const choices = blocks.find((block) => block.headCode === 102);
  const conditional = blocks.find((block) => block.headCode === 111);
  assert.ok(choices);
  assert.deepEqual(choices && {
    kind: choices.kind,
    headSpanIndex: choices.headSpanIndex,
    endSpanIndex: choices.endSpanIndex,
    branchSpanIndices: choices.branchSpanIndices,
  }, { kind: 'choices', headSpanIndex: 0, endSpanIndex: 7, branchSpanIndices: [1, 3] });
  assert.equal(conditional?.parentId, choices?.id);
  assert.deepEqual(commandBlockSpanIndices(spans, [0]), Array.from({ length: 8 }, (_item, index) => index));
  assert.deepEqual(commandBlockSpanIndices(spans, [1]), Array.from({ length: 8 }, (_item, index) => index));
  assert.notEqual(commandBranchScope(spans, 1), commandBranchScope(spans, 3));
  assert.equal(commandSpanDisplay(spans[1]!, null, 'en-US').head.startsWith(':'), true);
  assert.equal(commandSpanDisplay(spans[7]!, null, 'en-US').role, 'terminator');
});

test('keeps battle branches, loop ends, skip ends, and unknown structure rows visible', () => {
  const list = [
    command(301, 0, [0, true, false]),
    command(601, 0, ['win']), command(230, 1, [10]),
    command(602, 0, ['escape']), command(603, 0, ['lose']),
    command(604, 0),
    command(112, 0), command(230, 1, [5]), command(413, 0),
    command(109, 0), command(999, 1, ['unknown']), command(0, 0),
    command(777, 0, ['after']), command(0, 0),
  ];
  const spans = spansFor(list);
  const blocks = commandStructureBlocks(spans);
  const battle = blocks.find((block) => block.headCode === 301);
  const loop = blocks.find((block) => block.headCode === 112);
  const skip = blocks.find((block) => block.headCode === 109);
  assert.deepEqual(battle && { kind: battle.kind, endSpanIndex: battle.endSpanIndex, branchSpanIndices: battle.branchSpanIndices }, {
    kind: 'battle', endSpanIndex: 5, branchSpanIndices: [1, 3, 4],
  });
  assert.deepEqual(loop && { kind: loop.kind, endSpanIndex: loop.endSpanIndex }, { kind: 'loop', endSpanIndex: 8 });
  assert.deepEqual(skip && { kind: skip.kind, endSpanIndex: skip.endSpanIndex }, { kind: 'skip', endSpanIndex: 11 });
  assert.ok(spans.some((span) => span.commands[0]?.code === 999));
  const skipTerminators = skipTerminatorIndices(list);
  assert.deepEqual([...skipTerminators], [11]);
  assert.equal(commandSpanDisplay(spans[11]!, null, 'en-US', skipTerminators.has(spans[11]!.index), 'End').head, ':End');
});

test('multi-selection drag moves complete spans as one group and rejects self-drops', () => {
  const list = [
    command(230, 0, [1]), command(250, 0, [{ name: 'A' }]), command(999, 0, ['keep']), command(777, 0, ['anchor']), command(0),
  ];
  const spans = spansFor(list);
  const moved = dropCommandSpanBlocks(list, spans, [0, 2], spans.length);
  assert.ok(moved);
  assert.deepEqual(moved && moved.list.map((item) => item.code), [250, 777, 230, 999, 0]);
  assert.deepEqual(moved && moved.list[2]?.parameters, [1]);
  assert.equal(dropCommandSpanBlocks(list, spans, [1], 1), null);
});
