/**
 * Run: node --experimental-strip-types --test src/utils/consoleRunTimeline.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildRunTimeline, filterRunTimeline } from './consoleRunTimeline.ts';

describe('buildRunTimeline', () => {
  test('merges runtime tool calls and supplements the user request from chat log', () => {
    const timeline = buildRunTimeline({
      segments: [
        { id: 'u1', type: 'user', content: '检查地图事件', timestamp: 10 },
        { id: 'a1', type: 'text', content: '旧的重复回复', timestamp: 30 },
      ],
    }, [
      { type: 'text_delta', segment_id: 'answer', text: '检查完成', at: '2026-06-01T00:00:02.000Z', sequence: 2 },
      { type: 'tool_call', call_id: 'call-1', tool: 'mcp__rmmv__RmmvReadContext', input: { action: 'mapIndex' }, at: '2026-06-01T00:00:01.000Z', sequence: 1 },
      { type: 'tool_result', call_id: 'call-1', tool: 'mcp__rmmv__RmmvReadContext', success: true, output: { result: '找到 4 个事件' }, at: '2026-06-01T00:00:01.500Z', sequence: 3 },
    ]);

    assert.deepEqual(timeline.map((item) => item.kind), ['user', 'tool', 'assistant']);
    assert.equal(timeline[1].parameters, '{\n  "action": "mapIndex"\n}');
    assert.equal(timeline[1].body, '找到 4 个事件');
    assert.equal(timeline[1].outcome, 'success');
    assert.equal(timeline.some((item) => item.body === '旧的重复回复'), false);
  });

  test('uses readable ask cards instead of duplicate ask tool calls', () => {
    const timeline = buildRunTimeline({
      segments: [
        { id: 'u1', type: 'user', content: '继续', timestamp: 1 },
        { id: 'a1', type: 'ask', timestamp: 2, ask: { title: '选择地图', prompt: '请选择地图' } },
      ],
    }, [
      { type: 'tool_call', call_id: 'ask-1', tool: 'mcp__askuser__ask_map_selection', sequence: 1 },
      { type: 'tool_result', call_id: 'ask-1', tool: 'mcp__askuser__ask_map_selection', success: true, sequence: 2 },
    ]);

    assert.deepEqual(timeline.map((item) => item.kind), ['user', 'decision']);
  });

  test('turns persisted chat segments into readable cards without raw objects', () => {
    const timeline = buildRunTimeline({
      segments: [
        { id: 'u1', type: 'user', content: '继续', timestamp: 1 },
        { id: 't1', type: 'tool', timestamp: 2, metadata: { tool: 'maps.tree', input: { project: 'Project' }, output: { count: 12 }, success: true } },
        { id: 'e1', type: 'meta', timestamp: 3, metadata: { type: 'stderr', text: 'stack\nError: missing file\nmore stack' } },
        { id: 'p1', type: 'meta', timestamp: 4, metadata: { type: 'preparation', stage: 'context' } },
      ],
    }, [], undefined, 'zh-CN');

    assert.equal(timeline[1].parameters, '{\n  "project": "Project"\n}');
    assert.equal(timeline[1].body, '工具执行成功');
    assert.equal(timeline[2].error, 'stack\nError: missing file\nmore stack');
    assert.equal(timeline[3].lowValue, true);
    assert.equal(timeline.some((item) => item.body.includes('{"')), false);
  });

  test('shows ripgrep fallback stderr as warning-level runtime status', () => {
    const timeline = buildRunTimeline({
      segments: [
        { id: 'w1', type: 'meta', timestamp: 1, metadata: { type: 'stderr', text: '[ripgrep] fallback: builtin rg unavailable on win32, using system rg\n' } },
      ],
    }, [], undefined, 'zh-CN');

    assert.equal(timeline[0].kind, 'status');
    assert.equal(timeline[0].title, '运行告警');
    assert.equal(timeline[0].outcome, 'neutral');
    assert.equal(timeline[0].body, '[ripgrep] fallback: builtin rg unavailable on win32, using system rg');
  });

  test('does not expose raw textual tool output', () => {
    const timeline = buildRunTimeline({
      segments: [
        {
          id: 't1',
          type: 'tool',
          timestamp: 1,
          metadata: {
            tool: 'registry.list',
            input: { action: 'list' },
            output: '{\n  "updatedAt": "2026-06-11T04:13:03.060Z",\n  "items": []\n}',
            success: true,
          },
        },
      ],
    }, [], undefined, 'zh-CN');

    assert.equal(timeline[0].parameters, '{\n  "action": "list"\n}');
    assert.equal(timeline[0].body, '工具执行成功');
  });

  test('hides native task wrappers from old run timeline data', () => {
    const taskBlock = '<task id="ses_child" state="completed">\n<task_result>\nhello\n</task_result>\n</task>';
    const timeline = buildRunTimeline({
      segments: [
        { id: 'a1', type: 'text', content: `旧回复${taskBlock}结束`, timestamp: 1 },
        { id: 't1', type: 'tool', timestamp: 2, metadata: { tool: 'Agent', output: taskBlock, success: true } },
      ],
    }, [
      { type: 'text_delta', segment_id: 'answer', text: taskBlock, sequence: 1 },
      { type: 'text_delta', segment_id: 'answer-2', text: `事件回复${taskBlock}结束`, sequence: 2 },
    ]);

    assert.equal(timeline.some((item) => /<\/?task|task_result/.test(`${item.body}${item.error || ''}`)), false);
    assert.ok(timeline.some((item) => item.body === '事件回复结束'));
  });

  test('shows complete failed tool parameters and cleaned error text', () => {
    const timeline = buildRunTimeline({
      segments: [
        {
          id: 't1',
          type: 'tool',
          timestamp: 1,
          metadata: {
            tool: 'mcp__rmmv__RmmvReadContext',
            input: { action: 'stateSlots', switches: 50, variables: 50 },
            output: 'Unknown action: stateSlots',
            success: false,
          },
        },
        {
          id: 't2',
          type: 'tool',
          timestamp: 2,
          metadata: {
            tool: 'mcp__rmmv__RmmvReadContext',
            input: { action: 'list' },
            output: '<tool_use_error>InputValidationError: RmmvReadContext failed due to the following issue:\nInvalid enum value `list` for action</tool_use_error>',
            success: false,
          },
        },
      ],
    }, [], undefined, 'zh-CN');

    assert.equal(timeline[0].parameters, '{\n  "action": "stateSlots",\n  "switches": 50,\n  "variables": 50\n}');
    assert.equal(timeline[0].error, 'Unknown action: stateSlots');
    assert.equal(timeline[1].parameters, '{\n  "action": "list"\n}');
    assert.equal(timeline[1].error, 'InputValidationError: RmmvReadContext failed due to the following issue:\nInvalid enum value `list` for action');
  });

  test('adds a session blocker when no event already contains it', () => {
    const timeline = buildRunTimeline(null, [], 'Agent backend exited unsuccessfully', 'zh-CN');
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].title, '会话阻塞');
    assert.equal(timeline[0].error, 'Agent backend exited unsuccessfully');
  });

  test('localizes generated runtime summaries in English mode', () => {
    const timeline = buildRunTimeline({
      segments: [
        { id: 'u1', type: 'user', content: 'continue', timestamp: 1 },
        { id: 't1', type: 'tool', timestamp: 2, metadata: { tool: '', input: {}, output: {}, success: true } },
        { id: 'p1', type: 'meta', timestamp: 3, metadata: { type: 'preparation' } },
      ],
    }, [
      { type: 'artifact', sequence: 4 },
      { type: 'status', status: 'failed', sequence: 5 },
    ], '', 'en-US');

    assert.equal(timeline[0].title, 'User Request');
    assert.equal(timeline[1].title, 'Run Artifact Generated');
    assert.equal(timeline[1].body, 'Artifact was written to the current session directory');
    assert.equal(timeline[2].title, 'Run failed');
  });
});

describe('filterRunTimeline', () => {
  test('hides internal noise by default and combines filters', () => {
    const timeline = buildRunTimeline(null, [
      { type: 'preparation', stage: 'context', sequence: 1 },
      { type: 'tool_call', call_id: 'a', tool: 'maps.tree', input: {}, sequence: 2 },
      { type: 'tool_result', call_id: 'a', tool: 'maps.tree', success: false, output: { error: '地图不存在' }, sequence: 3 },
      { type: 'artifact', sequence: 4 },
    ], undefined, 'zh-CN');

    assert.equal(filterRunTimeline(timeline, {}).length, 2);
    assert.deepEqual(
      filterRunTimeline(timeline, { kinds: ['tool'], outcomes: ['failure'], query: '地图' }).map((item) => item.tool),
      ['maps.tree'],
    );
    assert.equal(filterRunTimeline(timeline, { showInternal: true }).length, 3);
  });

  test('uses union within a multi-select dimension and intersection across dimensions', () => {
    const timeline = buildRunTimeline(null, [
      { type: 'tool_call', call_id: 'a', tool: 'maps.tree', input: {}, sequence: 1 },
      { type: 'tool_result', call_id: 'a', tool: 'maps.tree', success: true, output: {}, sequence: 2 },
      { type: 'tool_call', call_id: 'b', tool: 'maps.get', input: {}, sequence: 3 },
      { type: 'tool_result', call_id: 'b', tool: 'maps.get', success: false, output: 'missing', sequence: 4 },
      { type: 'status', status: 'failed', sequence: 5 },
    ], undefined, 'zh-CN');

    assert.deepEqual(
      filterRunTimeline(timeline, { tools: ['maps.tree', 'maps.get'] }).map((item) => item.tool),
      ['maps.tree', 'maps.get'],
    );
    assert.deepEqual(
      filterRunTimeline(timeline, { kinds: ['tool', 'status'], outcomes: ['failure'] }).map((item) => item.title),
      ['maps.get', '运行失败'],
    );
  });
});
