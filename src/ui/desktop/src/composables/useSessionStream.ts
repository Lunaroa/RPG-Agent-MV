import { ref } from 'vue'
import { openSessionEventStream } from '../api/client.ts'
import {
  parseAgentAsk,
  parseAskFromToolCall,
  filterPostAskFallbackText,
  isAskTool,
  shouldSkipStreamAskToolCall,
} from '../utils/askParser.ts'
import type { Ask, AskResult } from '../utils/askParser.ts'

import type { ProductLanguage, SessionRuntimeEvent } from '@contract/types'
import { applyStreamSessionStatus } from './useSession.ts'
import { upsertToolCallSegment } from './session-stream-tool.ts'
import {
  asksSharePlacementContracts,
  findPendingMcpEventPlacementAsk,
  mergePlacementEventsFromSource,
  placementContractKey,
} from '../utils/placementAsk.ts'
import { appendSegmentContent, setSegmentContent } from './session-stream-content.ts'
import {
  parseEventPreviewFromRegisterTool,
  type EventPreviewItem,
} from '../utils/eventPreviewFromRegister.ts'
import { useTaskBoardStore } from '../stores/taskBoard.ts'
import { useSessionPlanStore } from '../stores/sessionPlan.ts'
import { useSubagentStore } from '../stores/subagents.ts'
import {
  askFromOpencodeRequest,
  isAskUserQuestionBridgeFailure,
} from './session-stream-agent-runtime-ask.ts'
import { stripNativeTaskBlocks } from '../../../../contract/native-task-blocks.ts'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage, translate } from '../i18n/messages.ts'

export type { EventPreviewItem } from '../utils/eventPreviewFromRegister.ts'
export type EventReviewPreviewListener = (
  events: EventPreviewItem[],
  meta: { callId?: string },
) => void | Promise<void>

export type SessionEvent = SessionRuntimeEvent

export interface ChatSegment {
  id: string
  // 'tool' 合并了原 tool_call / tool_result：metadata.status 为 'running' | 'done'。
  // 'user' 为用户消息气泡。
  type: 'text' | 'user' | 'reasoning' | 'tool' | 'meta' | 'status' | 'ask'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
  ask?: Ask
}

// 单例：流与片段状态提到模块作用域，全应用共享一份。切换路由时
// ChatView 卸载但 EventSource 不断，回到 /chat 仍能续看 agent 输出。
type StreamHandle = { close: () => void; onEvent: (callback: (event: unknown) => void) => void }
const eventSource = ref<StreamHandle | null>(null)
const segments = ref<ChatSegment[]>([])
const currentStatus = ref<string>('')
const isStreaming = ref(false)
const startedAt = ref<string | null>(null)
const summaryRevision = ref(0)
/** 正在接收 text_delta / reasoning_delta 的段；结束后清空，避免工具阶段仍显示 raw markdown。 */
const liveMarkdownSegmentId = ref<string | null>(null)
/** 当前订阅的会话 id，用于把 Task* 工具调用投影到对应会话的 todo 面板（直播态）。 */
let attachedSessionId: string | null = null

let segmentCounter = 0
let askSequence = 0
let currentTextSegment: ChatSegment | null = null
let currentTextRaw = ''
let currentReasoningSegment: ChatSegment | null = null
let reasoningBlockIdx = 0
let seenReasoning = false
let seenText = false
let textEmittedSinceReason = false
let nonReasoningSinceReason = false
// 与 textEmittedSinceReason 对称：reasoning/tool 在文本之后插入时，下一段文本应另起新段，
// 否则 text→tool→text 的第二段文本会并入前一段、错位到靠前位置（如最终答案被埋）。

let nonTextSinceText = false
const askSegments = new Map<string, ChatSegment>()
// callId -> tool 段，用于把 tool_result 合并回对应的 tool_call 行。
const toolSegments = new Map<string, ChatSegment>()
const askBridgeFailureCallIds = new Set<string>()
const workflowAskIdByProposal = new Map<string, string>()
const emittedWorkflowReports = new Set<string>()
/** 本轮 register 工具调用攒出的待落段预览（clarify ASK 或终态时 flush）。 */
let pendingEventPreview: EventPreviewItem[] = []
const eventPreviewByCallId = new Map<string, EventPreviewItem>()
let eventReviewPreviewListener: EventReviewPreviewListener | null = null
let productLanguage: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE

let transcriptPersister: (() => void | Promise<void>) | null = null

function isKnownRuntimeWarningText(text: string): boolean {
  return /\[ripgrep\]\s+fallback:\s+builtin rg unavailable on win32, using system rg/i.test(text.trim())
}

export function registerEventReviewPreviewListener(fn: EventReviewPreviewListener | null): void {
  eventReviewPreviewListener = fn
}

/** Restore sidebar preview from persisted event-preview-list transcript segments. */
export function collectEventPreviewItemsFromSegments(saved: ChatSegment[]): EventPreviewItem[] {
  const items: EventPreviewItem[] = []
  const seen = new Set<string>()
  for (const segment of saved) {
    if (segment.type !== 'meta' || segment.metadata?.type !== 'event-preview-list') continue
    const events = segment.metadata.events
    if (!Array.isArray(events)) continue
    for (const raw of events) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as EventPreviewItem
      const contractId = String(row.contractId || '').trim()
      if (!contractId || seen.has(contractId)) continue
      seen.add(contractId)
      items.push(row)
    }
  }
  return items
}

/** ChatView 注册：ASK 结果 / patch 后立即落盘，避免切对话后状态丢失。 */
export function registerTranscriptPersister(fn: (() => void | Promise<void>) | null): void {
  transcriptPersister = fn
}

function notifyTranscriptChanged(): void {
  void transcriptPersister?.()
}

function finalizeLiveMarkdownSegment(): void {
  liveMarkdownSegmentId.value = null
}

function markReasoningInterrupted(): void {
  if (seenReasoning) nonReasoningSinceReason = true
}

function markLiveMarkdownSegment(segmentId: string): void {
  liveMarkdownSegmentId.value = segmentId
}

export function useSessionStream() {
  function setProductLanguage(value: unknown): void {
    productLanguage = normalizeProductLanguage(value)
  }

  function createSegment(type: ChatSegment['type'], content: string, metadata?: Record<string, unknown>): ChatSegment {
    return {
      id: `seg_${++segmentCounter}`,
      type,
      content,
      timestamp: Date.now(),
      metadata
    }
  }

  function appendSegment(segment: ChatSegment): void {
    segments.value.push(segment)
  }

  /** push 后返回 reactive proxy，避免持有 plain object 导致流式 content 不触发渲染。 */
  function pushLiveSegment(segment: ChatSegment): ChatSegment {
    appendSegment(segment)
    return segments.value[segments.value.length - 1]!
  }

  function replaceAskSegment(segment: ChatSegment, ask: Ask): void {
    const idx = segments.value.indexOf(segment)
    const next: ChatSegment = { ...segment, ask }
    if (idx >= 0) {
      segments.value[idx] = next
    } else {
      segment.ask = ask
    }
    askSegments.set(ask.askId, next)
  }

  function mergeEventPlacementAskUpsert(previous: Ask, incoming: Ask): Ask {
    let merged: Ask = {
      ...incoming,
      fromMcp: Boolean(previous.fromMcp || incoming.fromMcp),
      result: previous.result ?? incoming.result,
    }
    if (previous.type === 'event-placement-list' && incoming.type === 'event-placement-list') {
      merged = mergePlacementEventsFromSource(merged, previous)
    }
    return merged
  }

  function trackEventPreview(tool: string | undefined, input: unknown, callId: string | undefined): void {
    const item = parseEventPreviewFromRegisterTool(tool, input)
    if (!item || !callId) return
    eventPreviewByCallId.set(callId, item)
  }

  function addPendingEventPreview(item: EventPreviewItem): void {
    const existingIdx = pendingEventPreview.findIndex((e) => e.contractId === item.contractId)
    if (existingIdx >= 0) {
      pendingEventPreview[existingIdx] = item
    } else {
      pendingEventPreview.push(item)
    }
  }

  function parseObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
    if (typeof value !== 'string') return null
    const text = value.trim()
    if (!text) return null
    const candidates = [text]
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        // Try the next candidate.
      }
    }
    return null
  }

  function objectField(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }

  function registerResultStatus(output: unknown): string {
    const envelope = parseObject(output)
    if (!envelope) return ''
    const data = objectField(envelope.data)
    if (typeof data?.status === 'string') return data.status
    const summary = typeof envelope.summary === 'string' ? parseObject(envelope.summary) : null
    if (typeof summary?.status === 'string') return summary.status
    if (typeof envelope.status === 'string') return envelope.status
    return ''
  }

  function emitEventReviewPreviewFromToolResult(
    event: SessionEvent & { call_id?: string; success?: boolean; output?: unknown },
  ): void {
    const callId = event.call_id
    if (!callId) return
    const item = eventPreviewByCallId.get(callId)
    eventPreviewByCallId.delete(callId)
    if (!item || event.success === false || registerResultStatus(event.output) !== 'ok') return
    addPendingEventPreview(item)
    void eventReviewPreviewListener?.([item], { callId })
  }

  /** 将本轮攒出的 register 预览落段为 event-preview-list meta 段。 */
  function flushEventPreviewSegment(): void {
    if (!pendingEventPreview.length) return
    appendSegment(createSegment('meta', '', {
      type: 'event-preview-list',
      events: [...pendingEventPreview],
    }))
    pendingEventPreview = []
  }

  function maybeAppendAskUserQuestionBridgeFailure(
    event: SessionEvent & { tool?: string; call_id?: string; success?: boolean; output?: unknown },
    existing?: ChatSegment
  ): void {
    if (!isAskUserQuestionBridgeFailure(event, existing?.metadata?.tool)) return
    const key = String(event.call_id || event.output || 'AskUserQuestion')
    if (askBridgeFailureCallIds.has(key)) return
    askBridgeFailureCallIds.add(key)
    appendSegment(createSegment('meta', '', {
      type: 'ask_bridge_failed',
      callId: event.call_id,
      text: translate('stream.askBridgeFailed', productLanguage),
      output: event.output,
    }))
  }

  // Create or update an ASK segment, keyed by askId so re-parses merge in place.
  function upsertAsk(ask: Ask): void {
    const existing = askSegments.get(ask.askId)
    if (existing?.ask) {
      replaceAskSegment(existing, mergeEventPlacementAskUpsert(existing.ask, ask))
      return
    }
    let nextAsk = ask
    if (ask.type === 'event-placement-list' && ask.fromMcp) {
      for (const segment of segments.value) {
        const sibling = segment.ask
        if (segment.type !== 'ask' || !sibling) continue
        if (sibling.type !== 'event-placement-list' || sibling.fromMcp) continue
        if (!asksSharePlacementContracts(sibling, ask)) continue
        nextAsk = mergePlacementEventsFromSource(nextAsk, sibling)
        replaceAskSegment(segment, mergePlacementEventsFromSource(sibling, nextAsk))
      }
    }
    // clarify 评审 ASK 到达 = 注册完成信号：预览块插在 ASK 之前。
    if (ask.type === 'clarify' && pendingEventPreview.length > 0) {
      flushEventPreviewSegment()
    }
    const segment = createSegment('ask', '')
    segment.ask = nextAsk
    askSegments.set(nextAsk.askId, segment)
    appendSegment(segment)
  }

  // 工作流工具的权限审批由 opencode approvalHandler 在执行前完成（弹 risk-approval 卡）。
  // 用户批准后 handler 执行：propose 落盘 pending 提议 + 立即返回 tool_result。
  // 后端在 tool_result 到达时自动批准并异步运行；前端只绑定审批卡 UI 并展示 workflow_run 事件。
  function bindWorkflowProposalToApproval(event: SessionEvent, proposalId: string): void {
    const input = event.input && typeof event.input === 'object'
      ? event.input as Record<string, unknown>
      : {}
    const title = String(input.title || '')
    const script = String(input.script || '')
    const candidates = [...segments.value].reverse().filter((segment) => {
      const ask = segment.ask as (Ask & { proposalId?: string }) | undefined
      if (segment.type !== 'ask' || ask?.type !== 'risk-approval') return false
      if (ask.proposalId && ask.proposalId !== proposalId) return false
      return ask.result?.decision === 'approve'
    })
    const matched = candidates.find((segment) => {
      const ask = segment.ask as Ask & { script?: string }
      return (!title || ask.title === title) && (!script || ask.script === script)
    }) || candidates[0]
    if (!matched?.ask) return
    const ask = matched.ask as Ask & { proposalId?: string }
    const next = {
      ...ask,
      proposalId,
      result: {
        ...(ask.result || {}),
        workflowStatus: 'running',
      },
    } as Ask
    replaceAskSegment(matched, next)
    workflowAskIdByProposal.set(proposalId, next.askId)
    notifyTranscriptChanged()
  }

  function updateWorkflowApprovalStatus(proposalId: string, status: string): void {
    const askId = workflowAskIdByProposal.get(proposalId)
      || segments.value.find((segment) => (
        segment.ask?.type === 'risk-approval'
        && String((segment.ask as Ask & { proposalId?: string }).proposalId || '') === proposalId
      ))?.ask?.askId
    if (!askId) return
    const segment = askSegments.get(askId)
    if (!segment?.ask) return
    // 终态保护：已 completed/aborted 的卡不被迟到的 failed 事件覆盖。
    const currentStatus = (segment.ask.result as { workflowStatus?: string } | undefined)?.workflowStatus
    const TERMINAL = new Set(['completed', 'aborted'])
    if (TERMINAL.has(currentStatus || '') && status === 'failed') return
    replaceAskSegment(segment, {
      ...segment.ask,
      result: {
        ...(segment.ask.result || {}),
        workflowStatus: status,
      },
    } as Ask)
    notifyTranscriptChanged()
  }

  function formatWorkflowReport(report: unknown): string {
    if (typeof report === 'string') return report.trim()
    if (report == null) return ''
    try {
      return `\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``
    } catch {
      return String(report)
    }
  }

  function handleWorkflowRunEvent(event: SessionEvent): void {
    if (String(event.phase || '') !== 'done') return
    const proposalId = String(event.proposalId || '')
    if (!proposalId) return
    const status = String(event.status || 'failed')
    updateWorkflowApprovalStatus(proposalId, status)
    if (emittedWorkflowReports.has(proposalId)) return
    emittedWorkflowReports.add(proposalId)

    markReasoningInterrupted()
    finalizeLiveMarkdownSegment()
    currentTextSegment = null
    seenText = false
    const workflowName = String(event.workflow || translate('ask.riskApproval.actionWorkflow', productLanguage))
    if (status === 'completed') {
      const report = formatWorkflowReport(event.report)
      const heading = translate('chat.workflow.completed', productLanguage, { name: workflowName })
      appendSegment(createSegment('text', report ? `${heading}\n\n${report}` : heading, {
        type: 'workflow_report',
        proposalId,
        status,
      }))
    } else {
      const reason = String(event.reason || status)
      appendSegment(createSegment('text', translate('chat.workflow.failed', productLanguage, {
        name: workflowName,
        reason,
      }), {
        type: 'workflow_report',
        proposalId,
        status,
      }))
    }
    notifyTranscriptChanged()
  }

  function bindWorkflowProposalFromToolResult(event: SessionEvent): void {
    const output = typeof event.output === 'string' ? event.output : ''
    if (!output.includes('workflow-proposal')) {
      return
    }
    let proposalId = ''
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>
      const data = parsed?.data as Record<string, unknown> | undefined
      if (data?.kind === 'workflow-proposal') {
        proposalId = String(data.proposalId || '')
      }
    } catch {
      return
    }
    if (!proposalId || workflowAskIdByProposal.has(proposalId)) {
      return
    }
    bindWorkflowProposalToApproval(event, proposalId)
  }


  // Extract every complete <agent-console-ask> block from the streaming text:
  // upsert an ASK segment for each, and return the text with those blocks removed
  // plus any unclosed trailing block hidden until its closing tag arrives.
  function extractAsksFromText(raw: string): string {
    const pattern = /<agent-console-ask>([\s\S]*?)<\/agent-console-ask>/g
    let result = ''
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(raw))) {
      result += raw.slice(cursor, match.index)
      const ask = parseAgentAsk(match[1], {
        createAskId: () => `ask-${Date.now()}-${++askSequence}`,
        getPrevious: (askId) => askSegments.get(askId)?.ask,
        language: productLanguage,
      })
      if (ask) upsertAsk(ask)
      cursor = pattern.lastIndex
    }
    let remainder = raw.slice(cursor)
    const openIdx = remainder.indexOf('<agent-console-ask>')
    if (openIdx >= 0) {
      currentTextRaw = result + remainder.slice(openIdx)
      remainder = remainder.slice(0, openIdx)
    } else {
      currentTextRaw = result
    }
    return result + remainder
  }

  function handleSessionEvent(event: SessionEvent): void {
    if (attachedSessionId) {
      useSessionPlanStore().applyRuntimeEvent(attachedSessionId, event)
      useSubagentStore().applyRuntimeEvent(attachedSessionId, event)
      if (event.type === 'todo_updated' && Array.isArray(event.todos)) {
        useTaskBoardStore().applyTodoUpdated(attachedSessionId, event.todos)
      }
    }

    if (event.type === 'workflow_run') {
      handleWorkflowRunEvent(event)
      return
    }

    if (event.type === 'stdout') {
      markReasoningInterrupted()
      appendSegment(createSegment('text', event.text || ''))
      return
    }

    if (event.type === 'stderr') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      const permissionSkipped = Boolean((event as { permission_skipped?: boolean }).permission_skipped)
        || /permission requested:\s*external_directory|auto-rejecting/i.test(event.text || '')
      const metaType = permissionSkipped
        ? 'permission_hint'
        : isKnownRuntimeWarningText(String(event.text || ''))
          ? 'runtime_warning'
          : 'stderr'
      appendSegment(createSegment('meta', '', {
        type: metaType,
        text: event.text || '',
        permissionSkipped,
      }))
      return
    }

    if (event.type === 'reasoning_delta') {
      if (textEmittedSinceReason || nonReasoningSinceReason) {
        reasoningBlockIdx++
        textEmittedSinceReason = false
        nonReasoningSinceReason = false
        seenReasoning = false
        currentReasoningSegment = null
      }
      if (!seenReasoning) {
        seenReasoning = true
        currentReasoningSegment = pushLiveSegment(createSegment('reasoning', ''))
      }
      if (currentReasoningSegment) {
        appendSegmentContent(segments.value, currentReasoningSegment, event.text || '')
        markLiveMarkdownSegment(currentReasoningSegment.id)
      }
      nonTextSinceText = true
      return
    }

    if (event.type === 'text_delta') {
      const delta = stripNativeTaskBlocks(event.text || '')
      if (!delta.trim()) return
      if (nonTextSinceText) {
        // reasoning/tool 打断后再来的文本另起新段（位置正确，避免并入靠前的旧段）。
        nonTextSinceText = false
        seenText = false
      }
      if (!seenText) {
        seenText = true
        currentTextRaw = ''
        currentTextSegment = pushLiveSegment(createSegment('text', ''))
      }
      textEmittedSinceReason = true
      currentTextRaw += delta
      if (currentTextSegment) {
        // 无 ASK 标记时增量追加，避免每 delta 全量替换 content；有 ASK 块时走提取逻辑。
        if (currentTextRaw.indexOf('<agent-console-ask>') === -1) {
          appendSegmentContent(segments.value, currentTextSegment, delta)
        } else {
          const visible = extractAsksFromText(currentTextRaw)
          setSegmentContent(segments.value, currentTextSegment, filterPostAskFallbackText(visible))
        }
        markLiveMarkdownSegment(currentTextSegment.id)
      }
      return
    }

    if (event.type === 'stream_end') {
      finalizeLiveMarkdownSegment()
      return
    }

    if (event.type === 'tool_call') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      nonTextSinceText = true
      if (event.tool && isAskTool(event.tool)) {
        if (shouldSkipStreamAskToolCall(event.tool)) {
          return
        }
        const ask = parseAskFromToolCall(event.tool, event.call_id, event.input, {
          getPrevious: (askId) => askSegments.get(askId)?.ask,
          language: productLanguage,
        })
        if (ask) {
          upsertAsk(ask)
          return
        }
        // 旧 ASK 解析失败时不展示 raw options JSON，避免与卡片重复且不可交互。
        appendSegment(createSegment('meta', '', {
          type: 'ask-parse-failed',
          tool: event.tool,
          callId: event.call_id,
        }))
        return
      }
      trackEventPreview(event.tool, event.input, event.call_id)
      if (attachedSessionId) {
        useTaskBoardStore().applyToolCall(attachedSessionId, event.tool, event.input, event.call_id)
      }
      upsertToolCallSegment(segments.value, toolSegments, event, createSegment)
      return
    }

    if (event.type === 'tool_result') {
      markReasoningInterrupted()
      emitEventReviewPreviewFromToolResult(event)
      bindWorkflowProposalFromToolResult(event)
      const existing = event.call_id ? toolSegments.get(event.call_id) : undefined
      if (existing) {
        // 合并回对应 tool_call 行：通过 index 替换以可靠触发响应式更新。
        const idx = segments.value.indexOf(existing)
        if (idx >= 0) {
          const skipped = Boolean((event as { skipped?: boolean }).skipped)
          const merged: ChatSegment = {
            ...existing,
            metadata: {
              ...existing.metadata,
              input: event.input ?? existing.metadata?.input,
              output: event.output,
              success: event.success,
              skipped,
              status: skipped ? 'skipped' : 'done',
            },
          }
          segments.value[idx] = merged
          if (event.call_id) toolSegments.set(event.call_id, merged)
        }
        maybeAppendAskUserQuestionBridgeFailure(event, existing)
        return
      }
      // 没有匹配的 tool_call（少见）：作为独立完成行追加。
      const skipped = Boolean((event as { skipped?: boolean }).skipped)
      const segment = createSegment('tool', '', {
        tool: event.tool,
        callId: event.call_id,
        output: event.output,
        success: event.success,
        skipped,
        status: skipped ? 'skipped' : 'done',
      })
      appendSegment(segment)
      maybeAppendAskUserQuestionBridgeFailure(event, segment)
      return
    }

    if (event.type === 'opencode_permission_request' || event.type === 'opencode_question_request') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      const ask = askFromOpencodeRequest(
        event as { request?: unknown; request_id?: unknown },
        productLanguage,
      ) as Ask | null
      if (ask) upsertAsk(ask)
      return
    }

    if (event.type === 'opencode_permission_response' || event.type === 'opencode_question_response') {
      return
    }

    if (event.type === 'command') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      const segment = createSegment('meta', '', {
        type: 'command',
        command: event.command,
        executable: event.executable
      })
      appendSegment(segment)
      return
    }

    if (event.type === 'preparation') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      appendSegment(createSegment('meta', '', {
        type: 'preparation',
        stage: event.stage,
        status: event.status,
        command: event.command,
        containerName: event.containerName,
        exitCode: event.exitCode
      }))
      return
    }

    if (event.type === 'artifact') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      const segment = createSegment('meta', '', {
        type: 'artifact',
        outDir: event.outDir,
        sessionId: event.sessionId
      })
      appendSegment(segment)
      return
    }

    if (event.type === 'status') {
      markReasoningInterrupted()
      const status = event.status || ''
      currentStatus.value = status
      applyStreamSessionStatus(status)
      if (event.status === 'running' && event.at) startedAt.value = event.at
      const segment = createSegment('status', '', {
        status: event.status,
        exitCode: event.exitCode,
        blocker: event.blocker
      })
      appendSegment(segment)
      
      if (['pass', 'blocked', 'failed', 'error', 'stopped', 'interrupted', 'timeout'].includes(event.status || '')) {
        isStreaming.value = false
        finalizeLiveMarkdownSegment()
        flushEventPreviewSegment()
        if (event.status === 'pass') {
          markPendingAsksSessionEnded()
        } else {
          lockAllPendingAsks(event.status || 'stopped')
        }
      }
      return
    }

    if (event.type === 'summary') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      appendSegment(createSegment('meta', '', {
        type: 'summary',
        status: event.status,
        blocker: event.blocker,
        durationMs: event.durationMs,
        inputTokens: event.inputTokens || 0,
        outputTokens: event.outputTokens || 0,
        outDir: event.outDir,
        sessionId: event.sessionId
      }))
      summaryRevision.value++
      return
    }

    if (event.type === 'usage_summary') {
      markReasoningInterrupted()
      finalizeLiveMarkdownSegment()
      const inputTokens = event.inputTokens || 0
      const outputTokens = event.outputTokens || 0
      if (inputTokens || outputTokens) {
        const segment = createSegment('meta', '', {
          type: 'tokens',
          inputTokens,
          outputTokens
        })
        appendSegment(segment)
      }
    }
  }

  function lockAllPendingAsks(status: string): void {
    const canceledAt = new Date().toISOString()
    for (const segment of askSegments.values()) {
      if (!segment.ask || segment.ask.result?.submittedAt || segment.ask.result?.canceledAt) continue
      segment.ask = {
        ...segment.ask,
        result: { ...(segment.ask.result || {}), canceledAt, cancellationStatus: status }
      }
    }
  }

  function markPendingAsksSessionEnded(): void {
    const sessionEndedAt = new Date().toISOString()
    for (const segment of askSegments.values()) {
      if (!segment.ask || segment.ask.result?.submittedAt || segment.ask.result?.sessionEndedAt) continue
      segment.ask = {
        ...segment.ask,
        result: { ...(segment.ask.result || {}), sessionEndedAt, cancellationStatus: 'pass' }
      }
    }
  }

  // 续接同一对话链时只重置每轮累加器，保留既有转录；新对话首轮才整清。
  async function attachToSession(
    sessionId: string,
    opts?: { fresh?: boolean; fromSequence?: number }
  ): Promise<void> {
    if (eventSource.value) {
      eventSource.value.close()
    }
    attachedSessionId = sessionId

    if (opts?.fresh === false) {
      resetTurnState()
    } else {
      resetState()
    }
    isStreaming.value = true

    const es = openSessionEventStream(sessionId, {
      fromSequence: opts?.fromSequence ?? 0
    })
    eventSource.value = es

    es.onEvent((data) => {
      try {
        const event = (typeof data === 'string' ? JSON.parse(data) : data) as SessionEvent
        handleSessionEvent(event)
      } catch (error) {
        console.error('Failed to parse session event:', error)
      }
    })
  }

  function detachFromSession(): void {
    if (eventSource.value) {
      eventSource.value.close()
      eventSource.value = null
    }
    attachedSessionId = null
    isStreaming.value = false
    finalizeLiveMarkdownSegment()
  }

  // Merge a result into an ASK segment so AskCard can lock / reflect status.
  function updateAskResult(askId: string, result: AskResult): Ask | null {
    const segment = askSegments.get(askId)
    if (!segment?.ask) return null
    const nextAsk = { ...segment.ask, result: { ...(segment.ask.result || {}), ...result } }
    replaceAskSegment(segment, nextAsk)
    notifyTranscriptChanged()
    return nextAsk
  }

  function mergePlacementEventPatch(
    ask: Ask,
    contractId: string,
    patch: Record<string, unknown>,
  ): Ask {
    const nextEvents = ((ask.events || []) as Array<Record<string, unknown>>).map((event) => {
      if (placementContractKey(event) !== contractId) return event
      return { ...event, ...patch }
    })
    return { ...ask, events: nextEvents }
  }

  /** 更新 ASK 本体字段（如 event-placement 的 events[].status）；同步所有契约相同的 placement ASK */
  function patchAsk(askId: string, updater: (ask: Ask) => Ask): Ask | null {
    const segment = askSegments.get(askId)
    if (!segment?.ask) return null
    const updated = updater(segment.ask)
    replaceAskSegment(segment, updated)

    if (updated.type === 'event-placement-list') {
      for (const other of segments.value) {
        if (other.type !== 'ask' || !other.ask || other.ask.askId === askId) continue
        if (other.ask.type !== 'event-placement-list') continue
        if (!asksSharePlacementContracts(updated, other.ask)) continue
        const otherSeg = askSegments.get(other.ask.askId)
        if (!otherSeg) continue
        replaceAskSegment(otherSeg, mergePlacementEventsFromSource(other.ask, updated))
      }
    }

    notifyTranscriptChanged()
    return updated
  }

  /** 地图编辑器放置后：按 contractId 补丁并镜像到 MCP / 文本双卡 */
  function syncPlacementEventPatch(
    askId: string,
    contractId: string,
    patch: Record<string, unknown>,
  ): Ask | null {
    const segment = askSegments.get(askId)
    if (!segment?.ask) return null
    return patchAsk(askId, (current) => mergePlacementEventPatch(current, contractId, patch))
  }

  function getAsk(askId: string): Ask | null {
    const fromMap = askSegments.get(askId)?.ask
    if (fromMap) return fromMap
    const segment = segments.value.find((s) => s.type === 'ask' && s.ask?.askId === askId)
    return segment?.ask || null
  }

  // 仅重置每轮流式累加器；segmentCounter/askSequence 不重置以保证跨轮 id 唯一。
  function resetTurnState(): void {
    finalizeLiveMarkdownSegment()
    currentTextSegment = null
    currentTextRaw = ''
    currentReasoningSegment = null
    reasoningBlockIdx = 0
    seenReasoning = false
    seenText = false
    textEmittedSinceReason = false
    nonReasoningSinceReason = false
    nonTextSinceText = false
    pendingEventPreview = []
    eventPreviewByCallId.clear()
  }

  function resetState(): void {
    resetTurnState()
    segments.value = []
    currentStatus.value = ''
    isStreaming.value = false
    startedAt.value = null
    segmentCounter = 0
    askSequence = 0
    askSegments.clear()
    toolSegments.clear()
    askBridgeFailureCallIds.clear()
    workflowAskIdByProposal.clear()
    emittedWorkflowReports.clear()
  }

  // 在发送前把用户输入作为气泡推入转录。
  function appendUserSegment(text: string, metadata?: Record<string, unknown>): void {
    appendSegment(createSegment('user', text, metadata))
  }

  function appendSlashStatusSegment(text: string, ok: boolean): void {
    appendSegment(createSegment('meta', '', {
      type: 'slash_status',
      text,
      ok,
    }))
  }

  // 加载历史对话：用持久化的 segments 还原整条转录（id 重排避免与后续新段冲突）。
  function restoreSegments(saved: ChatSegment[]): void {
    resetState()
    for (const s of saved) {
      const content = s.type === 'text' ? stripNativeTaskBlocks(s.content || '') : s.content
      if (s.type === 'text' && !content.trim()) continue
      const seg: ChatSegment = { ...s, id: `seg_${++segmentCounter}`, content }
      segments.value.push(seg)
      if (seg.type === 'ask' && seg.ask) askSegments.set(seg.ask.askId, seg)
      if (seg.type === 'ask' && seg.ask?.type === 'risk-approval') {
        const proposalId = String((seg.ask as Ask & { proposalId?: string }).proposalId || '')
        if (proposalId) workflowAskIdByProposal.set(proposalId, seg.ask.askId)
      }
      if (seg.metadata?.type === 'workflow_report') {
        const proposalId = String(seg.metadata.proposalId || '')
        if (proposalId) emittedWorkflowReports.add(proposalId)
      }
      const callId = seg.metadata?.callId
      if (seg.type === 'tool' && typeof callId === 'string') toolSegments.set(callId, seg)
    }
  }

  /** 无 chat-log 时从 sessions.get 返回的 events 重建转录；回放不得触发批准等外部副作用。 */
  function replaySessionEvents(events: SessionEvent[]): void {
    const ordered = [...events].sort(
      (a, b) => Number(a.sequence || 0) - Number(b.sequence || 0)
    )
    for (const event of ordered) {
      handleSessionEvent(event)
    }
  }

  return {
    segments,
    currentStatus,
    isStreaming,
    liveMarkdownSegmentId,
    startedAt,
    summaryRevision,
    attachToSession,
    detachFromSession,
    resetState,
    resetTurnState,
    appendUserSegment,
    appendSlashStatusSegment,
    restoreSegments,
    replaySessionEvents,
    setProductLanguage,
    updateAskResult,
    patchAsk,
    syncPlacementEventPatch,
    getAsk,
    findPendingMcpEventPlacementAsk: () => findPendingMcpEventPlacementAsk(segments.value),
  }
}
