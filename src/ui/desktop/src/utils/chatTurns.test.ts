/**
 * Run: node --experimental-strip-types --test src/utils/chatTurns.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildChatTurns, groupExecutionSegments, summarizeExecutionGroup, visibleExecutionGroupSegments } from './chatTurns.ts'
import type { ChatSegment } from '../composables/useSessionStream.ts'

function segment(type: ChatSegment['type'], id: string, content = '', metadata?: Record<string, unknown>): ChatSegment {
  return { type, id, content, metadata, timestamp: 1 }
}

describe('buildChatTurns', () => {
  test('keeps visible segments in chronological order including reasoning', () => {
    const turns = buildChatTurns([
      segment('user', 'u1', '做一张地图'),
      segment('reasoning', 'r1', '先检查地图'),
      segment('tool', 't1', '', { tool: 'maps.tree', status: 'done' }),
      segment('text', 'a1', '中间进展'),
      segment('meta', 'm1', '', { type: 'tokens', inputTokens: 5, outputTokens: 8 }),
      segment('text', 'a2', '最终结果'),
      segment('meta', 's1', '', { type: 'summary', durationMs: 10_000, outDir: 'runtime/session' }),
    ])

    assert.equal(turns.length, 1)
    assert.deepEqual(turns[0].timeline.map((item) => item.id), ['r1', 'execution-t1', 'a1', 'execution-m1', 'a2', 'execution-s1'])
    assert.equal(turns[0].artifact?.id, 's1')
  })

  test('keeps ASK and failures visible, including legacy transcripts without summary', () => {
    const ask = segment('ask', 'ask1')
    ask.ask = { askId: 'ask-1', type: 'clarify', title: '补充信息', prompt: '请选择' }
    const turns = buildChatTurns([
      segment('user', 'u1', '继续'),
      ask,
      segment('status', 'st1', '', { status: 'blocked', blocker: '需要选择地图' }),
    ])
    assert.deepEqual(turns[0].timeline.map((item) => item.id), ['ask1', 'execution-st1'])
  })

  test('does not move tools above their original position when reasoning is visible', () => {
    const turns = buildChatTurns([
      segment('user', 'u1', '继续'),
      segment('text', 'a1', '先说明计划'),
      segment('reasoning', 'r1', '正在检查事件'),
      segment('tool', 't1', '', { tool: 'eventRegistry.reconcile' }),
      segment('text', 'a2', '最终结果'),
    ])
    assert.deepEqual(turns[0].timeline.map((item) => item.id), ['a1', 'r1', 'execution-t1', 'a2'])
  })

  test('keeps execution groups between the reasoning chunks they belong to', () => {
    const turns = buildChatTurns([
      segment('user', 'u1', '继续'),
      segment('reasoning', 'r1', '先读取地图。'),
      segment('tool', 't1', '', { tool: 'Shell', input: { command: 'Get-ChildItem data' }, status: 'done' }),
      segment('tool', 't2', '', { tool: 'Read', input: { path: 'data/Map001.json' }, status: 'done' }),
      segment('reasoning', 'r2', '再检查事件。'),
      segment('tool', 't3', '', { tool: 'Agent', input: { description: '检查事件内容' }, status: 'running' }),
      segment('text', 'a1', '完成。'),
    ])

    assert.deepEqual(turns[0].timeline.map((item) => item.id), [
      'r1',
      'execution-t1',
      'r2',
      'execution-t3',
      'a1',
    ])
    const firstGroup = turns[0].timeline[1]
    assert.equal(firstGroup.type, 'execution-group')
    if (firstGroup.type !== 'execution-group') return
    assert.deepEqual(firstGroup.segments.map((item) => item.id), ['t1', 't2'])
  })

  test('removes the docked pending ask from the timeline', () => {
    const ask = segment('ask', 'ask1')
    ask.ask = { askId: 'ask-1', type: 'clarify', title: '补充信息', prompt: '请选择' }
    const turns = buildChatTurns([
      segment('user', 'u1', '继续'),
      ask,
      segment('reasoning', 'r1', '检查工程'),
    ], 'ask-1')

    assert.deepEqual(turns[0].timeline.map((item) => item.id), ['r1'])
  })

  test('keeps submitted asks visible while hiding only the active docked ask', () => {
    const submittedAsk = segment('ask', 'ask1')
    submittedAsk.ask = {
      askId: 'ask-submitted',
      type: 'clarify',
      title: '已回答',
      prompt: '请选择',
      result: { answer: '继续', submittedAt: '2026-06-14T00:00:00.000Z' },
    }
    const activeAsk = segment('ask', 'ask2')
    activeAsk.ask = { askId: 'ask-active', type: 'clarify', title: '待回答', prompt: '请选择' }
    const turns = buildChatTurns([
      segment('user', 'u1', '继续'),
      submittedAsk,
      segment('text', 'a1', '已经收到'),
      activeAsk,
      segment('reasoning', 'r1', '等待确认'),
    ], 'ask-active')

    assert.deepEqual(turns[0].timeline.map((item) => item.id), ['ask1', 'a1', 'r1'])
  })

  test('groups contiguous execution records and preserves hard boundaries', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1'),
      segment('meta', 'c1', '', { type: 'command' }),
      segment('status', 's1', '', { status: 'running' }),
      segment('reasoning', 'r1', '分析结果'),
      segment('tool', 't2'),
      segment('text', 'a1', '结论'),
    ])

    assert.deepEqual(timeline.map((item) => item.id), [
      'execution-t1',
      'r1',
      'execution-t2',
      'a1',
    ])
    assert.equal(timeline[0].type === 'execution-group'
      ? timeline[0].segments.length
      : 0, 3)
  })

  test('hides redundant transient status rows inside expanded execution groups', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', { tool: 'Read', status: 'done' }),
      segment('status', 's1', '', { status: 'running' }),
      segment('status', 's2', '', { status: 'starting' }),
      segment('status', 's3', '', { status: 'blocked', blocker: '需要选择地图' }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(visibleExecutionGroupSegments(group).map((item) => item.id), ['t1', 's3'])
    assert.equal(summarizeExecutionGroup(group).state, 'blocked')
  })

  test('ignores empty text and reasoning segments between execution records', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', { tool: 'TaskList', status: 'done' }),
      segment('reasoning', 'r1', '   '),
      segment('text', 'a1', ''),
      segment('tool', 't2', '', { tool: 'TaskUpdate', status: 'done' }),
      segment('reasoning', 'r2', '\n\t'),
      segment('tool', 't3', '', { tool: 'TaskGet', status: 'done' }),
      segment('text', 'a2', '下一步说明'),
      segment('tool', 't4', '', { tool: 'TaskUpdate', status: 'done' }),
    ])

    assert.deepEqual(timeline.map((item) => item.id), [
      'execution-t1',
      'a2',
      'execution-t4',
    ])
    assert.equal(timeline[0].type === 'execution-group'
      ? timeline[0].segments.length
      : 0, 3)
  })

  test('summarizes failure with file and command counts while collapsed', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', { tool: 'maps.read', input: { path: 'data/Map001.json' }, status: 'done', success: true }),
      segment('meta', 'c1', '', { type: 'command', command: 'npm run build' }),
      segment('tool', 't2', '', { tool: 'shell.command', input: { command: 'npm run build' }, status: 'done', success: false }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'failed',
      createdFiles: 0,
      editedFiles: 0,
      commands: 2,
      text: '已运行 2 条命令',
    })
  })

  test('treats pass summary as complete even when a transient error status was recorded', () => {
    const timeline = groupExecutionSegments([
      segment('status', 's-pass', '', { status: 'pass' }),
      segment('meta', 'stderr', '', { type: 'stderr', text: "Cannot read properties of null (reading 'background')\n" }),
      segment('status', 's-error', '', { status: 'error', blocker: "Cannot read properties of null (reading 'background')" }),
      segment('meta', 'summary', '', { type: 'summary', status: 'error' }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'complete',
      createdFiles: 0,
      editedFiles: 0,
      commands: 0,
      text: '已运行 0 条命令',
    })
  })

  test('treats empty blocked status after a successful daemon turn as complete', () => {
    const timeline = groupExecutionSegments([
      segment('meta', 'm1', '', { type: 'tokens', inputTokens: 1, outputTokens: 2 }),
      segment('status', 's1', '', { status: 'blocked', blocker: null }),
      segment('meta', 'm2', '', { type: 'summary', status: 'blocked', blocker: null }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'complete',
      createdFiles: 0,
      editedFiles: 0,
      commands: 0,
      text: '已运行 0 条命令',
    })
  })

  test('summarizes blocked status with blocker without calling it failed', () => {
    const timeline = groupExecutionSegments([
      segment('status', 's1', '', { status: 'blocked', blocker: '需要选择地图' }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'blocked',
      createdFiles: 0,
      editedFiles: 0,
      commands: 0,
      text: '已运行 0 条命令',
    })
  })

  test('counts patch-created and edited files once, with created taking precedence', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', {
        tool: 'functions.apply_patch',
        input: `*** Begin Patch
*** Add File: src/new.ts
+export const value = 1
*** Update File: src/existing.ts
@@
-old
+new
*** Delete File: src/removed.ts
*** End Patch`,
        status: 'done',
        success: true,
      }),
      segment('tool', 't2', '', {
        tool: 'functions.apply_patch',
        input: `*** Begin Patch
*** Update File: src/new.ts
@@
-old
+new
*** Update File: src/existing.ts
@@
-old
+newer
*** End Patch`,
        status: 'done',
        success: true,
      }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'complete',
      createdFiles: 1,
      editedFiles: 2,
      commands: 0,
      text: '已创建 1 个文件 已编辑 2 个文件',
    })
  })

  test('classifies structured create and edit tools and deduplicates normalized paths', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', {
        tool: 'filesystem.create_file',
        input: { path: './src/New.ts' },
        status: 'done',
        success: true,
      }),
      segment('tool', 't2', '', {
        tool: 'filesystem.edit',
        input: { filePath: 'src\\new.ts' },
        status: 'done',
        success: true,
      }),
      segment('tool', 't3', '', {
        tool: 'filesystem.write',
        input: { file_path: 'src/existing.ts' },
        status: 'done',
        success: true,
      }),
      segment('tool', 't4', '', {
        tool: 'filesystem.update',
        input: { paths: ['src/existing.ts'] },
        status: 'done',
        success: true,
      }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'complete',
      createdFiles: 1,
      editedFiles: 1,
      commands: 0,
      text: '已创建 1 个文件 已编辑 1 个文件',
    })
  })

  test('counts non-file tools as commands and skips mirrored command metadata', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', { tool: 'Read', input: { path: 'src/file.ts' }, status: 'done', success: true }),
      segment('tool', 't2', '', { tool: 'search.query', input: { query: 'chat' }, status: 'done', success: true }),
      segment('tool', 't3', '', {
        tool: 'events.register',
        input: { name: 'intro', projectPath: 'projects/game' },
        output: 'Created event intro',
        status: 'done',
        success: true,
      }),
      segment('tool', 't4', '', { tool: 'shell.command', input: { command: 'npm test' }, status: 'done', success: true }),
      segment('meta', 'c1', '', { type: 'command', command: '  npm   test  ' }),
      segment('meta', 'c2', '', { type: 'command', command: 'npm run build' }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'complete',
      createdFiles: 0,
      editedFiles: 0,
      commands: 5,
      text: '已运行 5 条命令',
    })
  })

  test('uses a write result to distinguish a newly created file', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', {
        tool: 'filesystem.write',
        input: { path: 'src/new.ts' },
        output: 'Created new file successfully',
        status: 'done',
        success: true,
      }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'complete',
      createdFiles: 1,
      editedFiles: 0,
      commands: 0,
      text: '已创建 1 个文件',
    })
  })

  test('uses running copy for every visible category', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', {
        tool: 'filesystem.create_file',
        input: { path: 'src/new.ts' },
        status: 'running',
      }),
      segment('tool', 't2', '', {
        tool: 'search.query',
        input: { query: 'chat' },
        status: 'running',
      }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'running',
      createdFiles: 1,
      editedFiles: 0,
      commands: 1,
      text: '正在创建 1 个文件 正在运行 1 条命令',
    })
  })

  test('summarizes execution groups in English mode', () => {
    const timeline = groupExecutionSegments([
      segment('tool', 't1', '', {
        tool: 'filesystem.create_file',
        input: { path: 'src/new.ts' },
        status: 'running',
      }),
      segment('tool', 't2', '', {
        tool: 'search.query',
        input: { query: 'chat' },
        status: 'running',
      }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group, 'en-US'), {
      state: 'running',
      createdFiles: 1,
      editedFiles: 0,
      commands: 1,
      text: 'Creating 1 file Running 1 command',
    })
  })

  test('falls back to zero commands for execution groups without recognized operations', () => {
    const timeline = groupExecutionSegments([
      segment('status', 's1', '', { status: 'done' }),
      segment('meta', 'm1', '', { type: 'tokens', inputTokens: 1, outputTokens: 2 }),
    ])
    const group = timeline[0]
    assert.equal(group.type, 'execution-group')
    if (group.type !== 'execution-group') return

    assert.deepEqual(summarizeExecutionGroup(group), {
      state: 'complete',
      createdFiles: 0,
      editedFiles: 0,
      commands: 0,
      text: '已运行 0 条命令',
    })
  })

  test('keeps hidden ask continuations as turn boundaries', () => {
    const turns = buildChatTurns([
      segment('user', 'u1', '开始'),
      segment('text', 'a1', '需要确认'),
      segment('meta', 'artifact1', '', { type: 'artifact', sessionId: 's1' }),
      segment('user', 'u2', '批准计划', { sourceAskId: 'ask-1' }),
      segment('text', 'a2', '继续执行'),
      segment('meta', 'artifact2', '', { type: 'artifact', sessionId: 's2' }),
    ])

    assert.equal(turns.length, 2)
    assert.equal(turns[0].artifact?.id, 'artifact1')
    assert.equal(turns[1].artifact?.id, 'artifact2')
    assert.equal(turns[1].user?.metadata?.sourceAskId, 'ask-1')
  })
})
