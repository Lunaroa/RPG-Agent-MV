/**
 * Conversation switch / restore: persisted ask.result must survive restoreSegments.
 * Run: node --experimental-strip-types --test src/composables/useSessionStream.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref, watch } from 'vue'

import { patchAskInSegments } from '../../../../contract/session-transcript.ts'
import type { SessionSubagentItem } from '../../../../contract/types.ts'
import { canStopSubagent, useSubagentStore } from '../stores/subagents.ts'
import { subagentTimelineSegments } from '../utils/subagentTimeline.ts'
import { upsertToolCallSegment } from './session-stream-tool.ts'
import { appendSegmentContent, setSegmentContent } from './session-stream-content.ts'
import {
  registerEventReviewPreviewListener,
  useSessionStream,
  type EventPreviewItem,
} from './useSessionStream.ts'
import {
  askFromOpencodeRequest,
  isAskUserQuestionBridgeFailure,
} from './session-stream-agent-runtime-ask.ts'

type ChatSegment = {
  id: string
  type: string
  content: string
  timestamp: number
}

describe('stream segment content updates', () => {
  test('merges each interactive playtest run into one persisted card', () => {
    const stream = useSessionStream()
    stream.resetState()

    stream.replaySessionEvents([
      {
        type: 'playtest_run', sequence: 1, runId: 'run-1', status: 'starting', phase: 'start',
        mode: 'battle_test', troopId: 3, troopName: 'Sample Troop', temporaryProject: true,
        stagingIncluded: true,
      },
      { type: 'playtest_run', sequence: 2, runId: 'run-1', status: 'running', phase: 'update', pid: 4200 },
      { type: 'playtest_run', sequence: 3, runId: 'run-1', status: 'exited', phase: 'done', exitCode: 0 },
    ])

    const cards = stream.segments.value.filter((segment) => segment.metadata?.type === 'playtest_run')
    assert.equal(cards.length, 1)
    assert.equal(cards[0]?.metadata?.status, 'exited')
    assert.equal(cards[0]?.metadata?.pid, 4200)
    assert.equal(cards[0]?.metadata?.mode, 'battle_test')
    assert.equal(cards[0]?.metadata?.troopId, 3)
    assert.equal(cards[0]?.metadata?.troopName, 'Sample Troop')
    assert.equal(cards[0]?.metadata?.temporaryProject, true)
    assert.equal(cards[0]?.metadata?.stagingIncluded, true)

    const persisted = JSON.parse(JSON.stringify(cards))
    stream.restoreSegments([...persisted, ...persisted])
    stream.replaySessionEvents([
      { type: 'playtest_run', sequence: 4, runId: 'run-1', status: 'stop_failed', phase: 'done' },
    ])
    const restored = stream.segments.value.filter((segment) => segment.metadata?.type === 'playtest_run')
    assert.equal(restored.length, 1)
    assert.equal(restored[0]?.metadata?.status, 'stop_failed')

    stream.resetState()
  })

  test('appendSegmentContent mutates reactive proxy, not stale plain object', async () => {
    const segments = ref<ChatSegment[]>([])
    const plain: ChatSegment = {
      id: 'seg_1',
      type: 'reasoning',
      content: '',
      timestamp: 1,
    }
    segments.value.push(plain)

    let renderCount = 0
    const stop = watch(
      () => segments.value[0]?.content,
      () => { renderCount++ },
    )

    appendSegmentContent(segments.value, plain, 'hello')
    appendSegmentContent(segments.value, plain, ' world')
    await nextTick()
    stop()

    assert.equal(segments.value[0]?.content, 'hello world')
    assert.ok(renderCount >= 1, `expected reactive updates, got ${renderCount}`)
  })

  test('direct plain mutation does not notify watchers', async () => {
    const segments = ref<ChatSegment[]>([])
    const plain: ChatSegment = {
      id: 'seg_2',
      type: 'text',
      content: '',
      timestamp: 1,
    }
    segments.value.push(plain)

    let renderCount = 0
    const stop = watch(
      () => segments.value[0]?.content,
      () => { renderCount++ },
    )

    plain.content += 'stuck'
    await nextTick()
    stop()

    assert.equal(segments.value[0]?.content, 'stuck')
    assert.equal(renderCount, 0)
  })

  test('setSegmentContent writes through reactive array slot', async () => {
    const segments = ref<ChatSegment[]>([])
    const plain: ChatSegment = {
      id: 'seg_3',
      type: 'text',
      content: '',
      timestamp: 1,
    }
    segments.value.push(plain)

    let renderCount = 0
    const stop = watch(
      () => segments.value[0]?.content,
      () => { renderCount++ },
    )

    setSegmentContent(segments.value, plain, 'final')
    await nextTick()
    stop()

    assert.equal(segments.value[0]?.content, 'final')
    assert.equal(renderCount, 1)
  })

  test('starts a new reasoning segment after tool calls so commands stay in chronological order', () => {
    const stream = useSessionStream()
    stream.resetState()

    stream.replaySessionEvents([
      { type: 'reasoning_delta', sequence: 1, text: '先读取地图。' },
      {
        type: 'tool_call',
        sequence: 2,
        call_id: 'call-shell',
        tool: 'Shell',
        input: { command: 'Get-ChildItem data' },
      },
      {
        type: 'tool_result',
        sequence: 3,
        call_id: 'call-shell',
        tool: 'Shell',
        success: true,
        output: 'Map001.json',
      },
      { type: 'reasoning_delta', sequence: 4, text: '再检查事件。' },
      {
        type: 'tool_call',
        sequence: 5,
        call_id: 'call-agent',
        tool: 'Agent',
        input: { description: '检查事件内容' },
      },
      { type: 'text_delta', sequence: 6, text: '完成。' },
    ])

    assert.deepEqual(
      stream.segments.value.map((segment) => [segment.type, segment.content, segment.metadata?.tool]),
      [
        ['reasoning', '先读取地图。', undefined],
        ['tool', '', 'Shell'],
        ['reasoning', '再检查事件。', undefined],
        ['tool', '', 'Agent'],
        ['text', '完成。', undefined],
      ],
    )

    stream.resetState()
  })

  test('history replay does not approve workflow proposals', async () => {
    setActivePinia(createPinia())
    const previousApi = (globalThis as any).api
    const approved: string[] = []
    ;(globalThis as any).api = {
      workflow: {
        approveProposal: async (proposalId: string) => {
          approved.push(proposalId)
          return { ok: true }
        },
      },
    }
    try {
      const stream = useSessionStream()
      stream.resetState()
      stream.replaySessionEvents([
        {
          type: 'opencode_permission_request',
          sequence: 1,
          request_id: 'perm-workflow-history',
          request: {
            subtype: 'can_use_tool',
            tool_name: 'rmmv_RmmvWorkflow',
            description: 'rmmv_RmmvWorkflow',
            input: { title: '历史巡检', script: 'return { ok: true }' },
          },
        },
        {
          type: 'opencode_permission_response',
          sequence: 2,
          request_id: 'perm-workflow-history',
          response: 'once',
        },
        {
          type: 'tool_result',
          sequence: 3,
          call_id: 'call-workflow-history',
          tool: 'rmmv_RmmvWorkflow',
          input: { title: '历史巡检', script: 'return { ok: true }' },
          success: true,
          output: JSON.stringify({
            data: { kind: 'workflow-proposal', proposalId: 'wp-history', status: 'pending' },
          }),
        },
        {
          type: 'workflow_run',
          sequence: 4,
          phase: 'done',
          proposalId: 'wp-history',
          status: 'completed',
          workflow: '历史巡检',
          report: { ok: true },
        },
      ])
      await nextTick()

      assert.deepEqual(approved, [])
    } finally {
      ;(globalThis as any).api = previousApi
    }
  })

  test('workflow completion updates the approval card and appends one report message', async () => {
    setActivePinia(createPinia())
    const previousApi = (globalThis as any).api
    let emitSessionEvent: (data: unknown) => void = () => {}
    ;(globalThis as any).api = {
      sessions: {
        onEvent: (callback: (data: unknown) => void) => {
          emitSessionEvent = callback
          return () => {}
        },
        subscribe: async () => ({ ok: true }),
        unsubscribe: async () => ({ ok: true }),
      },
    }
    const stream = useSessionStream()
    try {
      await stream.attachToSession('session-workflow-report')
      emitSessionEvent({ sessionId: 'session-workflow-report', event: {
        type: 'opencode_permission_request',
        sequence: 1,
        request_id: 'perm-workflow',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'rmmv_RmmvWorkflow',
          description: 'rmmv_RmmvWorkflow',
          input: { title: '只读巡检', script: 'return { ok: true }' },
        },
      } })
      stream.updateAskResult('agent-runtime-plan:perm-workflow', {
        submittedAt: '2026-06-28T17:36:25.000Z',
        decision: 'approve',
      })
      for (const event of [
        {
          type: 'tool_result',
          sequence: 2,
          call_id: 'call-workflow',
          tool: 'rmmv_RmmvWorkflow',
          input: { title: '只读巡检', script: 'return { ok: true }' },
          success: true,
          output: JSON.stringify({
            data: { kind: 'workflow-proposal', proposalId: 'wp-report', status: 'pending' },
          }),
        },
        {
          type: 'workflow_run',
          sequence: 3,
          phase: 'done',
          proposalId: 'wp-report',
          status: 'completed',
          workflow: '只读巡检',
          report: { checked: 3, ok: true },
        },
        {
          type: 'workflow_run',
          sequence: 4,
          phase: 'done',
          proposalId: 'wp-report',
          status: 'completed',
          workflow: '只读巡检',
          report: { checked: 3, ok: true },
        },
      ]) {
        emitSessionEvent({ sessionId: 'session-workflow-report', event })
      }
      await nextTick()

      const ask = stream.getAsk('agent-runtime-plan:perm-workflow') as any
      assert.equal(ask?.proposalId, 'wp-report')
      assert.equal(ask?.result?.workflowStatus, 'completed')
      const reports = stream.segments.value.filter((segment) => (
        segment.type === 'text' && segment.content.includes('"checked": 3')
      ))
      assert.equal(reports.length, 1)
      assert.match(reports[0]?.content || '', /```json/)

      const restored = JSON.parse(JSON.stringify(stream.segments.value))
      stream.restoreSegments(restored)
      stream.replaySessionEvents([{
        type: 'workflow_run',
        sequence: 5,
        phase: 'done',
        proposalId: 'wp-report',
        status: 'completed',
        workflow: '只读巡检',
        report: { checked: 3, ok: true },
      }])
      assert.equal(
        stream.segments.value.filter((segment) => (
          segment.type === 'text' && segment.content.includes('"checked": 3')
        )).length,
        1,
      )
    } finally {
      stream.detachFromSession()
      ;(globalThis as any).api = previousApi
    }
  })

  test('replayed failed event does not flip an already-completed workflow approval card', async () => {
    setActivePinia(createPinia())
    const stream = useSessionStream()
    stream.restoreSegments([{
      id: 'persisted-workflow-approval',
      type: 'ask',
      content: '',
      timestamp: Date.now(),
      ask: {
        type: 'risk-approval',
        askId: 'agent-runtime-plan:perm-workflow-replay',
        title: '只读巡检',
        prompt: '',
        proposalId: 'wp-replay',
        result: {
          submittedAt: '2026-06-28T17:36:25.000Z',
          decision: 'approve',
          workflowStatus: 'completed',
        },
      },
    } as any])

    stream.replaySessionEvents([{
      type: 'workflow_run',
      sequence: 4,
      phase: 'done',
      proposalId: 'wp-replay',
      status: 'failed',
      workflow: '只读巡检',
      reason: '提议 wp-replay 当前状态为 completed，不能再批准。',
    }])
    await nextTick()

    const ask = stream.getAsk('agent-runtime-plan:perm-workflow-replay') as any
    assert.equal(ask?.result?.workflowStatus, 'completed')
  })

  test('workflow failure updates the approval card and surfaces the reason', async () => {
    setActivePinia(createPinia())
    const stream = useSessionStream()
    stream.restoreSegments([{
      id: 'persisted-workflow-failure',
      type: 'ask',
      content: '',
      timestamp: Date.now(),
      ask: {
        type: 'risk-approval',
        askId: 'agent-runtime-plan:perm-workflow-failed',
        title: '失败巡检',
        prompt: '',
        proposalId: 'wp-report-failed',
        result: {
          submittedAt: '2026-06-28T17:36:25.000Z',
          decision: 'approve',
          workflowStatus: 'running',
        },
      },
    } as any])
    stream.replaySessionEvents([{
      type: 'workflow_run',
      sequence: 3,
      phase: 'done',
      proposalId: 'wp-report-failed',
      status: 'failed',
      workflow: '失败巡检',
      reason: 'child workflow failed',
    }])
    await nextTick()

    const ask = stream.getAsk('agent-runtime-plan:perm-workflow-failed') as any
    assert.equal(ask?.result?.workflowStatus, 'failed')
    assert.equal(
      stream.segments.value.some((segment) => segment.content.includes('child workflow failed')),
      true,
    )
  })

  test('hides native task blocks from live assistant text', () => {
    const stream = useSessionStream()
    stream.resetState()
    const taskBlock = [
      '<task id="ses_child" state="completed">',
      '<summary>Background task completed</summary>',
      '<task_result>',
      'hello from subagent!',
      '</task_result>',
      '</task>',
    ].join('\n')

    stream.replaySessionEvents([
      { type: 'text_delta', sequence: 1, text: taskBlock },
      { type: 'text_delta', sequence: 2, text: `前文${taskBlock}后文` },
    ])

    assert.deepEqual(
      stream.segments.value.map((segment) => [segment.type, segment.content]),
      [['text', '前文后文']],
    )

    stream.resetState()
  })

  test('hides native task blocks when restoring persisted chat segments', () => {
    const stream = useSessionStream()
    stream.resetState()
    const taskBlock = [
      '<task id="ses_child" state="completed">',
      '<summary>Background task completed</summary>',
      '<task_result>',
      'hello from subagent!',
      '</task_result>',
      '</task>',
    ].join('\n')

    stream.restoreSegments([
      { id: 'old-1', type: 'text', content: taskBlock, timestamp: 1 },
      { id: 'old-2', type: 'text', content: `前文${taskBlock}后文`, timestamp: 2 },
      { id: 'old-3', type: 'user', content: '<task>用户原文不清洗</task>', timestamp: 3 },
      { id: 'old-4', type: 'text', content: '```xml\n<task id="demo" state="completed">保留示例</task>\n```', timestamp: 4 },
    ] as never)

    assert.deepEqual(
      stream.segments.value.map((segment) => [segment.type, segment.content]),
      [
        ['text', '前文后文'],
        ['user', '<task>用户原文不清洗</task>'],
        ['text', '```xml\n<task id="demo" state="completed">保留示例</task>\n```'],
      ],
    )

    stream.resetState()
  })
})

describe('tool_call dedupe', () => {
  test('upsertToolCallSegment keeps one row per call_id', () => {
    const segments: ChatSegment[] = []
    const toolSegments = new Map<string, ChatSegment>()
    let n = 0
    const createSegment = (
      type: 'tool',
      content: string,
      metadata?: Record<string, unknown>
    ): ChatSegment => ({
      id: `seg_${++n}`,
      type,
      content,
      timestamp: n,
      metadata
    })
    upsertToolCallSegment(segments, toolSegments, {
      call_id: 'call-1',
      tool: 'glob',
      input: { path: '/repo' }
    }, createSegment)
    upsertToolCallSegment(segments, toolSegments, {
      call_id: 'call-1',
      tool: 'glob',
      input: { path: '/repo/examples' }
    }, createSegment)
    assert.equal(segments.length, 1)
    assert.deepEqual(segments[0].metadata?.input, { path: '/repo/examples' })
  })
})

describe('opencode AskUserQuestion stream bridge', () => {
  test('creates multi-choice ASK from AskUserQuestion opencode question request', () => {
    const ask = askFromOpencodeRequest({
      request_id: 'req-ask-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        description: 'Answer questions?',
        input: {
          questions: [
            {
              question: '今天天气？',
              header: '天气',
              options: [{ label: '晴天' }, { label: '下雨' }],
              multiSelect: false,
            },
            {
              question: '还要演示哪些？',
              header: '演示',
              options: [{ label: 'PLAN' }, { label: '子 Agent' }],
              multiSelect: true,
            },
          ],
        },
      },
    })

    assert.equal(ask?.type, 'multi-choice-clarify')
    assert.equal(ask?.askId, 'agent-runtime-ask:req-ask-1')
    assert.equal(ask?.fromMcp, true)
    assert.equal(ask?.questions?.[0]?.id, '今天天气？')
    assert.equal(ask?.questions?.[0]?.multiSelect, false)
    assert.equal(ask?.questions?.[1]?.multiSelect, true)
    assert.deepEqual(
      ask?.questions?.[1]?.options.map((option) => option.label),
      ['PLAN', '子 Agent'],
    )
  })

  test('uses English fallback copy for opencode ASK when product language is English', () => {
    const ask = askFromOpencodeRequest({
      request_id: 'req-ask-en',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        input: {
          questions: [
            {
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        },
      },
    }, 'en-US')

    assert.equal(ask?.title, 'Waiting for input')
    assert.equal(ask?.prompt, 'Answer opencode clarification questions')
    assert.equal(ask?.questions?.[0]?.question, 'Question 1')
  })

  test('classifies failed AskUserQuestion tool_result without treating it as ASK input', () => {
    assert.equal(askFromOpencodeRequest({
      request_id: 'toolu_ask',
      request: {
        type: 'tool_result',
        tool_name: 'AskUserQuestion',
        success: false,
      },
    }), null)
    assert.equal(isAskUserQuestionBridgeFailure({
      tool: 'tool',
      success: false,
    }, 'AskUserQuestion'), true)
    assert.equal(isAskUserQuestionBridgeFailure({
      tool: 'AskUserQuestion',
      success: true,
    }), false)
  })

  test('classifies ripgrep fallback stderr as runtime warning instead of error', () => {
    const stream = useSessionStream()
    stream.resetState()

    stream.replaySessionEvents([
      {
        type: 'stderr',
        sequence: 1,
        text: '[ripgrep] fallback: builtin rg unavailable on win32, using system rg\n',
      },
    ])

    assert.equal(stream.segments.value.length, 1)
    assert.equal(stream.segments.value[0]?.metadata?.type, 'runtime_warning')
  })

  test('pass terminal status leaves unanswered ASK unlocked for continuation', () => {
    const stream = useSessionStream()
    stream.resetState()
    const askJson = JSON.stringify({
      type: 'clarify',
      askId: 'ask-pass-continue',
      title: '续答测试',
      prompt: '选一个',
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    })

    stream.replaySessionEvents([
      {
        type: 'text_delta',
        sequence: 1,
        text: `<agent-console-ask>${askJson}</agent-console-ask>`,
      },
      { type: 'status', sequence: 2, status: 'pass' },
    ])

    const ask = stream.getAsk('ask-pass-continue')
    assert.ok(ask)
    assert.equal(ask?.result?.canceledAt, undefined)
    assert.ok(ask?.result?.sessionEndedAt)
    assert.equal(ask?.result?.cancellationStatus, 'pass')
    assert.equal(ask?.result?.submittedAt, undefined)
    stream.resetState()
  })

  test('failed terminal status locks unanswered ASK', () => {
    const stream = useSessionStream()
    stream.resetState()
    const askJson = JSON.stringify({
      type: 'clarify',
      askId: 'ask-failed-lock',
      title: '取消测试',
      prompt: '选一个',
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    })

    stream.replaySessionEvents([
      {
        type: 'text_delta',
        sequence: 1,
        text: `<agent-console-ask>${askJson}</agent-console-ask>`,
      },
      { type: 'status', sequence: 2, status: 'failed' },
    ])

    const ask = stream.getAsk('ask-failed-lock')
    assert.ok(ask)
    assert.ok(ask?.result?.canceledAt)
    assert.equal(ask?.result?.cancellationStatus, 'failed')
    stream.resetState()
  })
})

describe('event register preview stream', () => {
  const registerInput = {
    action: 'registry.register',
    contract: {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'town.elder.intro',
      purpose: 'Register a sample NPC event for user review.',
      rmmvTarget: {
        operation: 'add-map-event',
        mapId: 4,
        eventName: 'EV_VillagerElder',
        trigger: 'action-button',
      },
      implementation: { commands: [{ kind: 'text', text: 'Sample warning line.' }] },
    },
  }

  test('does not preview a failed registry.register call', () => {
    const stream = useSessionStream()
    stream.resetState()
    const previews: EventPreviewItem[] = []
    registerEventReviewPreviewListener((events) => { previews.push(...events) })

    stream.replaySessionEvents([
      {
        type: 'tool_call',
        sequence: 1,
        call_id: 'call-register',
        tool: 'mcp__rmmv__RmmvEvent',
        input: registerInput,
      },
      {
        type: 'tool_result',
        sequence: 2,
        call_id: 'call-register',
        success: false,
        output: JSON.stringify({ ok: false, error: 'rmmvTarget is required' }),
      },
      { type: 'status', sequence: 3, status: 'failed' },
    ])

    assert.equal(previews.length, 0)
    assert.equal(
      stream.segments.value.some((segment) => segment.type === 'meta' && segment.metadata?.type === 'event-preview-list'),
      false,
    )
    registerEventReviewPreviewListener(null)
    stream.resetState()
  })

  test('previews registry.register only after an ok result', () => {
    const stream = useSessionStream()
    stream.resetState()
    const previews: EventPreviewItem[] = []
    registerEventReviewPreviewListener((events) => { previews.push(...events) })

    stream.replaySessionEvents([
      {
        type: 'tool_call',
        sequence: 1,
        call_id: 'call-register',
        tool: 'mcp__rmmv__RmmvEvent',
        input: registerInput,
      },
      {
        type: 'tool_result',
        sequence: 2,
        call_id: 'call-register',
        success: true,
        output: JSON.stringify({
          summary: JSON.stringify({ status: 'ok', contract: registerInput.contract }),
          data: { status: 'ok', contract: registerInput.contract },
        }),
      },
      { type: 'status', sequence: 3, status: 'pass' },
    ])

    assert.equal(previews.length, 1)
    assert.equal(previews[0].contractId, 'town.elder.intro')
    const previewSegment = stream.segments.value.find(
      (segment) => segment.type === 'meta' && segment.metadata?.type === 'event-preview-list',
    )
    assert.equal((previewSegment?.metadata?.events as EventPreviewItem[] | undefined)?.[0]?.eventName, 'EV_VillagerElder')
    registerEventReviewPreviewListener(null)
    stream.resetState()
  })

  test('previews opencode capability tool name rmmv_RmmvEvent', () => {
    const stream = useSessionStream()
    stream.resetState()
    const previews: EventPreviewItem[] = []
    registerEventReviewPreviewListener((events) => { previews.push(...events) })

    stream.replaySessionEvents([
      {
        type: 'tool_call',
        sequence: 1,
        call_id: 'call-register-opencode',
        tool: 'rmmv_RmmvEvent',
        input: registerInput,
      },
      {
        type: 'tool_result',
        sequence: 2,
        call_id: 'call-register-opencode',
        success: true,
        output: JSON.stringify({
          summary: 'Registered town.elder.intro',
          data: { status: 'ok', contract: registerInput.contract },
        }),
      },
      { type: 'status', sequence: 3, status: 'pass' },
    ])

    assert.equal(previews.length, 1)
    assert.equal(previews[0].contractId, 'town.elder.intro')
    registerEventReviewPreviewListener(null)
    stream.resetState()
  })
})

describe('subagent stream state', () => {
  test('only native running subagents expose the single-item stop action', () => {
    assert.equal(canStopSubagent({
      id: 'task-native',
      description: 'native',
      status: 'running',
      taskType: 'agent',
    }), true)
    assert.equal(canStopSubagent({
      id: 'wf:wp-1:0',
      description: 'workflow',
      status: 'running',
      taskType: 'workflow',
    }), false)
    assert.equal(canStopSubagent({
      id: 'task-complete',
      description: 'complete',
      status: 'completed',
      taskType: 'agent',
    }), false)
  })

  test('records live dynamic workflow agents with the same stable identity as history', () => {
    setActivePinia(createPinia())
    const subagents = useSubagentStore()

    subagents.applyRuntimeEvent('s1', {
      type: 'workflow_run',
      phase: 'progress',
      proposalId: 'wp-live',
      event: {
        type: 'agent-start',
        label: 'review:maps',
        index: 0,
        prompt: '检查地图',
        at: '2026-06-15T02:10:00.000Z',
      },
      sequence: 1,
      at: '2026-06-15T02:10:00.000Z',
    })
    subagents.applyRuntimeEvent('s1', {
      type: 'workflow_run',
      phase: 'progress',
      proposalId: 'wp-live',
      event: {
        type: 'agent-end',
        label: 'review:maps',
        index: 0,
        ok: true,
        output: '地图检查完成',
        at: '2026-06-15T02:10:01.000Z',
      },
      sequence: 2,
      at: '2026-06-15T02:10:01.000Z',
    })

    const item = subagents.itemsFor('s1').find((entry) => entry.id === 'wf:wp-live:0')
    assert.equal(item?.description, 'review:maps')
    assert.equal(item?.prompt, '检查地图')
    assert.equal(item?.taskType, 'workflow')
    assert.equal(item?.status, 'completed')
    assert.equal(item?.output, '地图检查完成')
    assert.deepEqual(item?.activity?.map((entry) => entry.kind), ['started', 'output'])
  })

  test('records live progress activity for right panel details', () => {
    setActivePinia(createPinia())
    const subagents = useSubagentStore()

    subagents.applyRuntimeEvent('s1', {
      type: 'subagent_task_started',
      sequence: 1,
      at: '2026-06-15T03:00:00.000Z',
      taskId: 'task-search',
      description: '搜索地图资产',
      prompt: '列出地图和素材。',
      taskType: 'agent',
    })
    subagents.applyRuntimeEvent('s1', {
      type: 'subagent_task_progress',
      sequence: 2,
      at: '2026-06-15T03:00:01.000Z',
      taskId: 'task-search',
      description: '搜索地图资产',
      taskType: 'agent',
      lastToolName: 'Grep',
      detail: '搜索地图',
      toolInput: { pattern: 'Map', path: 'data' },
      toolOutput: '41 matches',
      toolStatus: 'completed',
    })

    const item = subagents.itemsFor('s1').find((entry) => entry.id === 'task-search')
    assert.equal(item?.status, 'running')
    assert.equal(item?.activity?.at(-1)?.title, '正在使用 Grep')
    assert.equal(item?.activity?.at(-1)?.tool, 'Grep')
    assert.deepEqual(item?.activity?.at(-1)?.input, { pattern: 'Map', path: 'data' })
    assert.equal(item?.activity?.at(-1)?.output, '41 matches')
    assert.equal(item?.activity?.at(-1)?.status, 'completed')
  })

  test('does not treat Agent completed placeholder as live subagent output', () => {
    setActivePinia(createPinia())
    const subagents = useSubagentStore()

    subagents.applyRuntimeEvent('s1', {
      type: 'subagent_task_notification',
      sequence: 1,
      at: '2026-06-15T03:00:02.000Z',
      taskId: 'task-search',
      status: 'completed',
      output: 'Agent "搜索地图资产" completed',
      outputFile: '/tmp/task-search.output',
    })

    const item = subagents.itemsFor('s1').find((entry) => entry.id === 'task-search')
    assert.equal(item?.status, 'completed')
    assert.equal(item?.output, null)
    assert.equal(item?.outputFile, '/tmp/task-search.output')
  })

  test('unwraps native task result for subagent output', () => {
    setActivePinia(createPinia())
    const subagents = useSubagentStore()

    subagents.applyRuntimeEvent('s1', {
      type: 'subagent_task_notification',
      sequence: 1,
      at: '2026-06-15T03:00:02.000Z',
      taskId: 'task-search',
      status: 'completed',
      output: '<task id="task-search" state="completed">\n<task_result>\nhello\n</task_result>\n</task>',
    })

    const item = subagents.itemsFor('s1').find((entry) => entry.id === 'task-search')
    assert.equal(item?.status, 'completed')
    assert.equal(item?.output, 'hello')
    assert.equal(item?.activity?.at(-1)?.detail, 'hello')
  })
})

describe('subagent timeline presentation', () => {
  test('maps activity and final output to chat-style segments', () => {
    const item: SessionSubagentItem = {
      id: 'task-search',
      description: '搜索地图资产',
      prompt: '列出地图和素材。',
      status: 'completed',
      output: '## PASS\n\n找到 5 个文件。',
      outputFile: 'runtime/out/task-search.txt',
      updatedAt: '2026-06-15T03:00:03.000Z',
      activity: [
        {
          id: 'started-1',
          kind: 'started',
          title: '启动子任务',
          status: 'running',
          at: '2026-06-15T03:00:00.000Z',
        },
        {
          id: 'progress-2',
          kind: 'progress',
          title: '子任务运行中',
          status: 'running',
          at: '2026-06-15T03:00:01.000Z',
        },
        {
          id: 'notification-3',
          kind: 'notification',
          title: '子任务完成',
          detail: '输出已写入文件。',
          status: 'completed',
          outputFile: 'runtime/out/task-search.txt',
          at: '2026-06-15T03:00:02.000Z',
        },
      ],
    }

    const segments = subagentTimelineSegments(item)
    assert.equal(segments[0].type, 'reasoning')
    assert.equal(
      segments.some((segment) => segment.type === 'meta' && segment.metadata?.type === 'preparation'),
      true,
    )
    assert.equal(
      segments.some((segment) => segment.type === 'meta' && segment.metadata?.type === 'output-file'),
      false,
    )
    assert.equal(
      segments.some((segment) => segment.type === 'text' && segment.content.includes('## PASS')),
      true,
    )
  })

  test('maps progress with tool to a chat tool row', () => {
    const item: SessionSubagentItem = {
      id: 'task-grep',
      description: '搜索 registry',
      status: 'running',
      activity: [
        {
          id: 'progress-1',
          kind: 'progress',
          title: '正在使用 Grep',
          detail: 'registry|task',
          status: 'running',
          tool: 'Grep',
          at: '2026-06-15T03:00:01.000Z',
        },
      ],
    }

    const tool = subagentTimelineSegments(item).find((segment) => segment.type === 'tool')
    assert.equal(tool?.metadata?.tool, 'Grep')
    assert.equal(tool?.metadata?.status, 'running')
    assert.deepEqual(tool?.metadata?.input, {
      detail: 'registry|task',
      query: 'registry|task',
      status: 'running',
    })
  })

  test('maps subagent tool input and output to expandable tool row', () => {
    const item: SessionSubagentItem = {
      id: 'task-grep',
      description: '搜索 registry',
      status: 'running',
      activity: [
        {
          id: 'progress-1',
          kind: 'progress',
          title: '正在使用 Grep',
          detail: '搜索 registry',
          status: 'completed',
          tool: 'Grep',
          input: { pattern: 'registry' },
          output: '3 matches',
          at: '2026-06-15T03:00:01.000Z',
        },
      ],
    }

    const tool = subagentTimelineSegments(item).find((segment) => segment.type === 'tool')
    assert.equal(tool?.metadata?.tool, 'Grep')
    assert.equal(tool?.metadata?.status, 'done')
    assert.deepEqual(tool?.metadata?.input, { pattern: 'registry' })
    assert.equal(tool?.metadata?.output, '3 matches')
  })

  test('explains completed subagent with output file but no text output', () => {
    const item: SessionSubagentItem = {
      id: 'task-empty-output',
      description: '探索迷宫',
      status: 'completed',
      output: null,
      outputFile: '/tmp/task-empty-output.output',
      updatedAt: '2026-06-15T03:00:03.000Z',
      activity: [
        {
          id: 'notification-1',
          kind: 'notification',
          title: '子任务完成',
          status: 'completed',
          outputFile: '/tmp/task-empty-output.output',
          at: '2026-06-15T03:00:02.000Z',
        },
      ],
    }

    const segments = subagentTimelineSegments(item)
    assert.equal(
      segments.some((segment) => segment.type === 'text' && segment.content.includes('没有收到正文输出')),
      true,
    )
    assert.equal(
      segments.some((segment) => segment.type === 'text' && segment.content.includes('/tmp/task-empty-output.output')),
      true,
    )
  })

  test('marks historical tool rows done after subagent completion', () => {
    const item: SessionSubagentItem = {
      id: 'task-grep',
      description: '搜索 registry',
      status: 'completed',
      output: '完成',
      activity: [
        {
          id: 'progress-1',
          kind: 'progress',
          title: '正在使用 Grep',
          detail: 'registry|task',
          status: 'running',
          tool: 'Grep',
          at: '2026-06-15T03:00:01.000Z',
        },
        {
          id: 'notification-2',
          kind: 'notification',
          title: '子任务完成',
          detail: '完成',
          status: 'completed',
          at: '2026-06-15T03:00:02.000Z',
        },
      ],
    }

    const tool = subagentTimelineSegments(item).find((segment) => segment.type === 'tool')
    assert.equal(tool?.metadata?.tool, 'Grep')
    assert.equal(tool?.metadata?.status, 'done')
    assert.equal(tool?.metadata?.success, true)
  })

  test('maps failed subagent state to status error segment', () => {
    const item: SessionSubagentItem = {
      id: 'task-failed',
      description: '失败任务',
      status: 'timeout',
      error: '执行超时',
      updatedAt: '2026-06-15T03:00:03.000Z',
      activity: [
        {
          id: 'failed-1',
          kind: 'failed',
          title: '子任务失败',
          detail: '工具没有返回结果。',
          status: 'failed',
          at: '2026-06-15T03:00:02.000Z',
        },
      ],
    }

    const segments = subagentTimelineSegments(item)
    assert.equal(
      segments.some((segment) => segment.type === 'status' && segment.metadata?.blocker === '工具没有返回结果。'),
      true,
    )
    assert.equal(
      segments.some((segment) => segment.type === 'status' && segment.metadata?.status === 'timeout' && segment.metadata?.blocker === '执行超时'),
      true,
    )
  })
})

describe('conversation switch transcript', () => {
  test('patchAskInSegments preserves submitted ask for reload', () => {
    const segments = [
      {
        id: 'seg_1',
        type: 'ask',
        content: '',
        timestamp: 1,
        ask: {
          type: 'event-placement-list',
          askId: 'ask-epl-1',
          title: '放置',
          prompt: '',
          events: [{ contractId: 'c1', status: 'draft' }],
          result: null,
        },
      },
    ]
    const patched = patchAskInSegments(segments, 'ask-epl-1', (ask) => ({
      ...ask,
      events: [{ contractId: 'c1', status: 'placed' }],
      result: { submittedAt: '2026-06-02T12:00:00.000Z', placed: true },
    }))
    const reloaded = JSON.parse(JSON.stringify(patched))
    assert.equal(reloaded[0].ask.result.submittedAt, '2026-06-02T12:00:00.000Z')
    assert.equal(reloaded[0].ask.events[0].status, 'placed')
  })
})
