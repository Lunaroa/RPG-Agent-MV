import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { repairChoiceSkeletonInList, repairMapEventChoiceSkeletons } from './choice-skeleton-repair.ts';

const cmd = (code: number, indent: number, parameters: unknown[] = []) => ({ code, indent, parameters });

describe('choice skeleton repair', () => {
  test('inserts the missing first 402 branch before the following branches', () => {
    const list = [
      cmd(102, 0, [['111', '222', '333'], -1, 0, 2, 0]),
      cmd(402, 0, [1, '222']),
      cmd(101, 1, ['', 0, 0, 2]),
      cmd(402, 0, [2, '333']),
      cmd(404, 0, []),
      cmd(0, 0, []),
    ];
    assert.equal(repairChoiceSkeletonInList(list), true);
    assert.deepEqual(list.map((row) => row.code), [102, 402, 402, 101, 402, 404, 0]);
    assert.deepEqual(list[1].parameters, [0, '111']);
  });

  test('inserts a missing middle branch before 403/404 without touching bodies', () => {
    const list = [
      cmd(102, 0, [['A', 'B', 'C'], -2, 0, 2, 0]),
      cmd(402, 0, [0, 'A']),
      cmd(402, 0, [2, 'C']),
      cmd(403, 0, []),
      cmd(404, 0, []),
    ];
    assert.equal(repairChoiceSkeletonInList(list), true);
    assert.deepEqual(list.map((row) => `${row.code}:${JSON.stringify(row.parameters[0] ?? '')}`), [
      '102:["A","B","C"]', '402:0', '402:1', '402:2', '403:""', '404:""',
    ]);
  });

  test('keeps ascending choice order when several leading branches are missing', () => {
    const list = [
      cmd(102, 0, [['111', '222', '333'], -1, 0, 2, 0]),
      cmd(402, 0, [2, '333']),
      cmd(404, 0, []),
      cmd(0, 0, []),
    ];
    assert.equal(repairChoiceSkeletonInList(list), true);
    assert.deepEqual(
      list.map((row) => `${row.code}:${JSON.stringify(row.parameters[0] ?? '')}`),
      ['102:["111","222","333"]', '402:0', '402:1', '402:2', '404:""', '0:""'],
    );
  });

  test('inserts every missing branch before the cancel branch', () => {
    const list = [
      cmd(102, 0, [['A', 'B'], -2, 0, 2, 0]),
      cmd(403, 0, []),
      cmd(404, 0, []),
    ];
    assert.equal(repairChoiceSkeletonInList(list), true);
    assert.deepEqual(
      list.map((row) => `${row.code}:${JSON.stringify(row.parameters[0] ?? '')}`),
      ['102:["A","B"]', '402:0', '402:1', '403:""', '404:""'],
    );
  });

  test('keeps intact skeletons untouched', () => {
    const list = [
      cmd(102, 0, [['Yes', 'No'], 0, 0, 2, 0]),
      cmd(402, 0, [0, 'Yes']),
      cmd(402, 0, [1, 'No']),
      cmd(404, 0, []),
      cmd(0, 0, []),
    ];
    const before = JSON.stringify(list);
    assert.equal(repairChoiceSkeletonInList(list), false);
    assert.equal(JSON.stringify(list), before);
  });

  test('leaves blocks without any structural rows untouched', () => {
    const list = [
      cmd(102, 0, [['A', 'B'], 0, 0, 2, 0]),
      cmd(121, 0, [1, 1, 0]),
    ];
    assert.equal(repairChoiceSkeletonInList(list), false);
    assert.equal(list.length, 2);
  });

  test('respects indent when the choice block is nested', () => {
    const list = [
      cmd(111, 0, [0, 1, 0]),
      cmd(102, 1, [['X', 'Y'], -1, 0, 2, 0]),
      cmd(402, 1, [1, 'Y']),
      cmd(404, 1, []),
      cmd(412, 0, []),
      cmd(0, 0, []),
    ];
    assert.equal(repairChoiceSkeletonInList(list), true);
    assert.deepEqual(list[2], cmd(402, 1, [0, 'X']));
  });

  test('repairs every page list of a map events array', () => {
    const events = [
      null,
      {
        id: 1,
        pages: [
          { list: [cmd(102, 0, [['Go'], -1, 0, 2, 0]), cmd(404, 0, []), cmd(0, 0, [])] },
          { list: [cmd(101, 0, ['', 0, 0, 2]), cmd(0, 0, [])] },
        ],
      },
    ];
    const result = repairMapEventChoiceSkeletons(events);
    assert.equal(result.changed, true);
    const pageList = (events[1] as { pages: Array<{ list: unknown[] }> }).pages[0].list;
    assert.deepEqual(pageList.map((row) => row.code), [102, 402, 404, 0]);
  });
});
