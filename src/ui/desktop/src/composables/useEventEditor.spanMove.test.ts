import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dropCommandSpanBlock,
  editableCommandSpans,
  moveCommandSpanBlock,
  type MvCommand,
} from './useEventEditor.ts';

const cmd = (code: number, indent = 0, parameters: unknown[] = []): MvCommand => ({ code, indent, parameters });

function spansOf(list: MvCommand[]) {
  return editableCommandSpans({ list } as never);
}

function branchList(): MvCommand[] {
  // 250 / [111 .. 101+401 .. 412] / 230 / terminator
  return [cmd(250), cmd(111), cmd(101, 1), cmd(401, 1, ['hi']), cmd(412), cmd(230), cmd(0)];
}

describe('moveCommandSpanBlock', () => {
  test('moves a full 111 block below the next span', () => {
    const list = branchList();
    const result = moveCommandSpanBlock(list, spansOf(list), 1, 1);
    assert.ok(result);
    assert.deepEqual(result.list.map((command) => command.code), [250, 230, 111, 101, 401, 412, 0]);
    assert.equal(result.headIndex, 2);
  });

  test('moving up before the first span is rejected', () => {
    const list = branchList();
    assert.equal(moveCommandSpanBlock(list, spansOf(list), 0, -1), null);
  });

  test('selecting the 412 marker moves the whole owning block', () => {
    const list = branchList();
    const result = moveCommandSpanBlock(list, spansOf(list), 3, 1);
    assert.ok(result);
    assert.deepEqual(result.list.map((command) => command.code), [250, 230, 111, 101, 401, 412, 0]);
  });
});

describe('dropCommandSpanBlock', () => {
  test('drops a span before the list head', () => {
    const list = branchList();
    const result = dropCommandSpanBlock(list, spansOf(list), 4, 0);
    assert.ok(result);
    assert.deepEqual(result.list.map((command) => command.code), [230, 250, 111, 101, 401, 412, 0]);
    assert.equal(result.headIndex, 0);
  });

  test('drops a block at the end while keeping the terminator last', () => {
    const list = branchList();
    const spans = spansOf(list);
    const result = dropCommandSpanBlock(list, spans, 1, spans.length);
    assert.ok(result);
    assert.deepEqual(result.list.map((command) => command.code), [250, 230, 111, 101, 401, 412, 0]);
    assert.equal(result.list[result.list.length - 1].code, 0);
  });

  test('rejects drops inside or right around the dragged block', () => {
    const list = branchList();
    const spans = spansOf(list);
    assert.equal(dropCommandSpanBlock(list, spans, 1, 1), null);
    assert.equal(dropCommandSpanBlock(list, spans, 1, 2), null);
    assert.equal(dropCommandSpanBlock(list, spans, 1, 4), null);
  });

  test('re-anchors indent when dropping into a branch body', () => {
    const list = [cmd(250), cmd(111), cmd(230, 1), cmd(412), cmd(0)];
    const result = dropCommandSpanBlock(list, spansOf(list), 0, 2);
    assert.ok(result);
    assert.deepEqual(result.list.map((command) => command.code), [111, 250, 230, 412, 0]);
    assert.equal(result.list[1].indent, 1);
  });

  test('flattens indent when dragging out of a branch body', () => {
    const list = [cmd(111), cmd(230, 1), cmd(412), cmd(250), cmd(0)];
    const spans = spansOf(list);
    const result = dropCommandSpanBlock(list, spans, 1, spans.length);
    assert.ok(result);
    assert.deepEqual(result.list.map((command) => command.code), [111, 412, 250, 230, 0]);
    assert.equal(result.list[3].indent, 0);
  });
});
