import { defineStore } from 'pinia'
import { ref } from 'vue'
import { sessions as sessionsApi } from '../api/client.ts'
import { normalizeProductLanguage } from '../i18n/messages';
import { useSettingsStore } from './settings';
import type {
  SessionRuntimeEvent,
  SessionSubagentActivity,
  SessionSubagentItem,
  SessionSubagentSnapshot,
  SessionSubagentStatus,
} from '@contract/types'
import { nativeTaskResultText } from '../../../../contract/native-task-blocks.ts'
import {
  subagentStoreLabels,
  subagentNotificationTitle,
  subagentResultTitle,
  subagentToolTitle,
} from '../utils/subagentStoreLocalization'

interface ToolCallRecord {
  tool: string
  input: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try { return JSON.stringify(value) } catch { return String(value) }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  const text = outputText(value).trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  const candidates = [text]
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // Try next candidate.
    }
  }
  return null
}

function extractTag(text: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(text)
  return match ? match[1].trim() : ''
}

function matchValue(text: string, pattern: RegExp): string {
  const match = pattern.exec(text)
  return match ? match[1].trim() : ''
}

function mapTaskStatus(status: string, retrievalStatus = ''): SessionSubagentStatus {
  const value = (status || retrievalStatus || '').toLowerCase()
  if (value === 'timeout') return 'timeout'
  if (value === 'not_ready') return 'not_ready'
  if (['completed', 'success', 'done'].includes(value)) return 'completed'
  if (['failed', 'error'].includes(value)) return 'failed'
  if (['stopped', 'killed', 'cancelled', 'canceled'].includes(value)) return 'stopped'
  if (['running', 'pending'].includes(value)) return 'running'
  return 'unknown'
}

function stripUsageTrailer(text: string): string {
  return text.replace(/\n?agentId:\s*[^\n]+[\s\S]*?<usage>[\s\S]*?<\/usage>\s*$/i, '').trim()
}

function usefulSubagentOutput(value: string): string {
  const text = nativeTaskResultText(value).trim()
  if (!text) return ''
  if (/^Agent(?:\s+"[^"]+")?\s+completed\.?$/i.test(text)) return ''
  return text
}

export const useSubagentStore = defineStore('subagents', () => {
  const settingsStore = useSettingsStore()
  const label = () => subagentStoreLabels(normalizeProductLanguage(settingsStore.ui.language))
  const lang = () => normalizeProductLanguage(settingsStore.ui.language)
  const snapshotsBySession = ref<Record<string, SessionSubagentSnapshot>>({})
  const loadingBySession = ref<Record<string, boolean>>({})
  const errorBySession = ref<Record<string, string>>({})
  const callToolsBySession = new Map<string, Map<string, ToolCallRecord>>()
  const callToItemBySession = new Map<string, Map<string, string>>()

  function snapshotFor(sessionId: string | null | undefined): SessionSubagentSnapshot {
    return sessionId
      ? snapshotsBySession.value[sessionId] || { sessionId, items: [], updatedAt: null }
      : { sessionId: '', items: [], updatedAt: null }
  }

  function itemsFor(sessionId: string | null | undefined): SessionSubagentItem[] {
    return snapshotFor(sessionId).items
  }

  function setSnapshot(sessionId: string, snapshot: SessionSubagentSnapshot): void {
    snapshotsBySession.value = { ...snapshotsBySession.value, [sessionId]: snapshot }
  }

  function setItems(sessionId: string, items: SessionSubagentItem[], updatedAt?: string | null): void {
    setSnapshot(sessionId, { sessionId, items, updatedAt: updatedAt || new Date().toISOString() })
  }

  function upsert(sessionId: string, item: SessionSubagentItem): void {
    const snapshot = snapshotFor(sessionId)
    const idx = snapshot.items.findIndex((entry) => entry.id === item.id)
    const nextItems = idx >= 0
      ? snapshot.items.map((entry, index) => index === idx ? { ...entry, ...item } : entry)
      : [...snapshot.items, item]
    setItems(sessionId, nextItems, item.updatedAt)
  }

  function appendActivity(
    sessionId: string,
    itemId: string,
    entry: Omit<SessionSubagentActivity, 'id'>,
  ): SessionSubagentActivity[] {
    const existing = itemsFor(sessionId).find((item) => item.id === itemId)?.activity || []
    return [
      ...existing,
      {
        id: `${entry.kind}-${existing.length + 1}`,
        ...entry,
      },
    ]
  }

  function rename(sessionId: string, fromId: string, toId: string): string {
    if (!toId || fromId === toId) return fromId
    const snapshot = snapshotFor(sessionId)
    const item = snapshot.items.find((entry) => entry.id === fromId)
    if (!item) return toId
    setItems(
      sessionId,
      snapshot.items.map((entry) => entry.id === fromId ? { ...entry, id: toId } : entry),
      item.updatedAt,
    )
    return toId
  }

  function rememberCall(sessionId: string, callId: string, tool: string, input: Record<string, unknown>): void {
    const map = callToolsBySession.get(sessionId) || new Map<string, ToolCallRecord>()
    map.set(callId, { tool, input })
    callToolsBySession.set(sessionId, map)
  }

  function applyRuntimeEvent(sessionId: string | null | undefined, event: SessionRuntimeEvent): void {
    if (!sessionId) return
    const at = asString(event.at) || new Date().toISOString()

    // 工作流扇出的子 agent 走另一条线（后台引擎直接派发），把它的逐个子 agent 进度
    // 翻译成与主 agent 子任务同构的面板条目：标签 + 状态 + 输入(提问) + 输出。
    if ((event as { type?: string }).type === 'workflow_run') {
      const wf = event as unknown as Record<string, unknown>
      if (asString(wf.phase) !== 'progress') return
      const inner = asRecord(wf.event)
      const innerType = asString(inner.type)
      if (innerType !== 'agent-start' && innerType !== 'agent-end') return
      const proposalId = asString(wf.proposalId)
      const index = Number(inner.index ?? 0)
      const id = `wf:${proposalId}:${index}`
      const agentLabel = asString(inner.label) || `agent ${index}`
      const innerAt = asString(inner.at) || at
      if (innerType === 'agent-start') {
        const prompt = asString(inner.prompt)
        upsert(sessionId, {
          id,
          description: agentLabel,
          prompt,
          status: 'running',
          updatedAt: innerAt,
          activity: appendActivity(sessionId, id, {
            kind: 'started',
            title: label().started,
            detail: prompt || null,
            status: 'running',
            at: innerAt,
          }),
        })
      } else {
        const ok = inner.ok === true
        const blocker = asString(inner.blocker)
        const status: SessionSubagentStatus = ok ? 'completed' : 'failed'
        const output = asString(inner.output)
        const existing = itemsFor(sessionId).find((item) => item.id === id)
        upsert(sessionId, {
          ...(existing || { id, description: agentLabel, status }),
          id,
          description: agentLabel,
          status,
          output: output || existing?.output || null,
          error: ok ? null : (blocker || label().failed),
          updatedAt: innerAt,
          activity: appendActivity(sessionId, id, {
            kind: ok ? 'output' : 'failed',
            title: subagentResultTitle(status, !ok, lang()),
            detail: ok ? (output || null) : (blocker || null),
            status,
            at: innerAt,
          }),
        })
      }
      return
    }

    if (event.type === 'tool_call') {
      const callId = asString(event.call_id)
      const tool = asString(event.tool)
      const input = asRecord(event.input)
      if (callId && tool) rememberCall(sessionId, callId, tool, input)
      if (tool === 'Agent' && callId) {
        const id = `pending:${callId}`
        const callMap = callToItemBySession.get(sessionId) || new Map<string, string>()
        callMap.set(callId, id)
        callToItemBySession.set(sessionId, callMap)
        upsert(sessionId, {
          id,
          description: asString(input.description) || 'subagent',
          prompt: asString(input.prompt),
          status: 'running',
          callId,
          updatedAt: at,
          activity: appendActivity(sessionId, id, {
            kind: 'started',
            title: label().started,
            detail: asString(input.prompt) || asString(input.description) || null,
            status: 'running',
            at,
          }),
        })
      } else if (tool === 'TaskOutput') {
        const taskId = asString(input.task_id)
        const existing = taskId ? itemsFor(sessionId).find((item) => item.id === taskId) : null
        if (taskId) upsert(sessionId, {
          ...(existing || { id: taskId, description: taskId, status: 'running' as SessionSubagentStatus }),
          id: taskId,
          status: 'running',
          callId,
          updatedAt: at,
          activity: appendActivity(sessionId, taskId, {
            kind: 'progress',
            title: label().readOutput,
            status: 'running',
            at,
          }),
        })
      } else if (tool === 'TaskStop') {
        const taskId = asString(input.task_id) || asString(input.shell_id)
        const existing = taskId ? itemsFor(sessionId).find((item) => item.id === taskId) : null
        if (taskId) upsert(sessionId, {
          ...(existing || { id: taskId, description: taskId, status: 'running' as SessionSubagentStatus }),
          id: taskId,
          status: 'running',
          callId,
          updatedAt: at,
          activity: appendActivity(sessionId, taskId, {
            kind: 'stop_requested',
            title: label().stopRequested,
            status: 'running',
            at,
          }),
        })
      }
      return
    }

    if (event.type === 'tool_result') {
      const callId = asString(event.call_id)
      const call = callToolsBySession.get(sessionId)?.get(callId)
      if (!call) return
      const text = outputText(event.output)
      if (call.tool === 'Agent') {
        const parsed = parseJsonObject(event.output)
        const agentId = asString(parsed?.agentId) || matchValue(text, /\bagentId:\s*([^\s(]+)/i) || matchValue(text, /\bagent_id:\s*([^\s]+)/i)
        const taskId = asString(parsed?.taskId) || matchValue(text, /\btaskId:\s*([^\s]+)/i)
        const currentId = callToItemBySession.get(sessionId)?.get(callId) || `pending:${callId}`
        const nextId = rename(sessionId, currentId, taskId || agentId || currentId)
        const rawStatus = asString(parsed?.status)
        const status: SessionSubagentStatus = event.success === false
          ? 'failed'
          : rawStatus === 'async_launched' || rawStatus === 'remote_launched' || /Async agent launched|Remote agent launched/i.test(text)
            ? 'running'
            : 'completed'
        upsert(sessionId, {
          id: nextId,
          description: asString(parsed?.description) || asString(call.input.description) || 'subagent',
          prompt: asString(parsed?.prompt) || asString(call.input.prompt),
          status,
          output: status === 'running' ? '' : stripUsageTrailer(text),
          outputFile: asString(parsed?.outputFile) || matchValue(text, /\boutput_file:\s*(.+)$/im) || null,
          sessionUrl: asString(parsed?.sessionUrl) || matchValue(text, /\bsession_url:\s*(\S+)/i) || null,
          error: event.success === false ? text || label().failed : null,
          callId,
          updatedAt: at,
          activity: appendActivity(sessionId, nextId, {
            kind: event.success === false ? 'failed' : status === 'running' ? 'progress' : 'output',
            title: subagentResultTitle(status, event.success === false, lang()),
            detail: status === 'running' ? null : stripUsageTrailer(text) || null,
            status,
            outputFile: asString(parsed?.outputFile) || matchValue(text, /\boutput_file:\s*(.+)$/im) || null,
            at,
          }),
        })
      } else if (call.tool === 'TaskOutput') {
        const retrievalStatus = extractTag(text, 'retrieval_status')
        const taskId = extractTag(text, 'task_id') || asString(call.input.task_id)
        if (!taskId) return
        const description = extractTag(text, 'description')
        const existing = itemsFor(sessionId).find((item) => item.id === taskId)
        upsert(sessionId, {
          id: taskId,
          description: description || existing?.description || taskId,
          status: mapTaskStatus(extractTag(text, 'status'), retrievalStatus),
          taskType: extractTag(text, 'task_type') || null,
          output: extractTag(text, 'output') || null,
          error: extractTag(text, 'error') || null,
          callId,
          updatedAt: at,
          activity: appendActivity(sessionId, taskId, {
            kind: extractTag(text, 'error') ? 'failed' : 'output',
            title: extractTag(text, 'error') ? label().outputReadFailed : label().outputRead,
            detail: extractTag(text, 'output') || extractTag(text, 'error') || null,
            status: mapTaskStatus(extractTag(text, 'status'), retrievalStatus),
            at,
          }),
        })
      } else if (call.tool === 'TaskStop') {
        const parsed = parseJsonObject(event.output)
        const taskId = asString(parsed?.task_id) || asString(call.input.task_id) || asString(call.input.shell_id)
        if (!taskId) return
        upsert(sessionId, {
          id: taskId,
          description: taskId,
          status: event.success === false ? 'failed' : 'stopped',
          taskType: asString(parsed?.task_type) || null,
          output: asString(parsed?.message) || text,
          error: event.success === false ? text || label().stopFailed : null,
          callId,
          updatedAt: at,
          activity: appendActivity(sessionId, taskId, {
            kind: event.success === false ? 'failed' : 'stopped',
            title: event.success === false ? label().stopFailed : label().stopped,
            detail: asString(parsed?.message) || (event.success === false ? text : null),
            status: event.success === false ? 'failed' : 'stopped',
            at,
          }),
        })
      }
      return
    }

    if (event.type === 'subagent_task_started' || event.type === 'subagent_task_progress') {
      const callId = asString(event.callId)
      const taskId = asString(event.taskId)
      const callMap = callToItemBySession.get(sessionId) || new Map<string, string>()
      const currentId = callId ? callMap.get(callId) || `pending:${callId}` : ''
      const nextId = rename(sessionId, currentId, taskId || currentId)
      if (callId && nextId) {
        callMap.set(callId, nextId)
        callToItemBySession.set(sessionId, callMap)
      }
      const id = nextId || taskId
      if (!id) return
      const existing = itemsFor(sessionId).find((item) => item.id === id)
      const logType = asString(event.logType)
      const toolStatus = asString(event.toolStatus)
      const activityStatus = toolStatus === 'failed'
        ? 'failed'
        : toolStatus === 'completed'
          ? 'completed'
          : 'running'
      upsert(sessionId, {
        ...(existing || { id, description: id, status: 'running' as SessionSubagentStatus }),
        id,
        description: asString(event.description) || existing?.description || id,
        prompt: asString(event.prompt) || existing?.prompt,
        status: 'running',
        taskType: asString(event.taskType) || existing?.taskType || null,
        callId: callId || existing?.callId || null,
        updatedAt: at,
        activity: appendActivity(sessionId, id, {
          kind: logType ? 'output' : event.type === 'subagent_task_started' ? 'started' : 'progress',
          title: logType === 'reasoning'
            ? label().reasoning
            : logType === 'text'
              ? label().output
              : event.type === 'subagent_task_started'
            ? label().started
            : asString(event.lastToolName)
              ? subagentToolTitle(asString(event.lastToolName), lang())
              : label().running,
          detail: asString(event.detail) || asString(event.prompt) || asString(event.description) || null,
          status: activityStatus,
          tool: asString(event.lastToolName) || null,
          input: event.toolInput,
          output: event.toolOutput,
          at,
        }),
      })
      return
    }

    if (event.type === 'subagent_task_notification') {
      const callId = asString(event.callId)
      const taskId = asString(event.taskId)
      const callMap = callToItemBySession.get(sessionId) || new Map<string, string>()
      const currentId = callId ? callMap.get(callId) || `pending:${callId}` : ''
      const nextId = rename(sessionId, currentId, taskId || currentId)
      if (callId && nextId) {
        callMap.set(callId, nextId)
        callToItemBySession.set(sessionId, callMap)
      }
      const id = nextId || taskId
      if (!id) return
      const existing = itemsFor(sessionId).find((item) => item.id === id)
      const status = mapTaskStatus(asString(event.status))
      const output = usefulSubagentOutput(asString(event.output))
      upsert(sessionId, {
        ...(existing || { id, description: id, status }),
        id,
        status,
        output: output || existing?.output || null,
        outputFile: asString(event.outputFile) || existing?.outputFile || null,
        error: status === 'failed' || status === 'timeout'
          ? asString(event.error) || output || label().failed
          : null,
        callId: callId || existing?.callId || null,
        updatedAt: at,
        activity: appendActivity(sessionId, id, {
          kind: status === 'failed' || status === 'timeout' ? 'failed' : 'notification',
          title: subagentNotificationTitle(status, lang()),
          detail: output || asString(event.error) || null,
          status,
          outputFile: asString(event.outputFile) || null,
          at,
        }),
      })
      return
    }

    if (event.type === 'subagent_stop_requested') {
      const taskId = asString(event.taskId)
      if (!taskId) return
      const existing = itemsFor(sessionId).find((item) => item.id === taskId)
      upsert(sessionId, {
        ...(existing || { id: taskId, description: taskId, status: 'running' as SessionSubagentStatus }),
        stopRequestId: asString(event.requestId) || null,
        updatedAt: at,
        activity: appendActivity(sessionId, taskId, {
          kind: 'stop_requested',
          title: label().stopRequested,
          status: 'running',
          at,
        }),
      })
      return
    }

    if (event.type === 'opencode_permission_response') {
      const response = asRecord(event.response)
      const requestId = asString(response.request_id) || asString(event.request_id)
      if (!requestId) return
      for (const item of itemsFor(sessionId)) {
        if (item.stopRequestId !== requestId) continue
        upsert(sessionId, {
          ...item,
          status: response.subtype === 'error' ? 'failed' : 'stopped',
          error: response.subtype === 'error' ? asString(response.error) || label().stopFailed : null,
          updatedAt: at,
          activity: appendActivity(sessionId, item.id, {
            kind: response.subtype === 'error' ? 'failed' : 'stopped',
            title: response.subtype === 'error' ? label().stopFailed : label().stopped,
            detail: response.subtype === 'error' ? asString(response.error) || null : null,
            status: response.subtype === 'error' ? 'failed' : 'stopped',
            at,
          }),
        })
      }
    }
  }

  async function loadFromBackend(sessionId: string): Promise<void> {
    if (!sessionId) return
    loadingBySession.value = { ...loadingBySession.value, [sessionId]: true }
    errorBySession.value = { ...errorBySession.value, [sessionId]: '' }
    try {
      setSnapshot(sessionId, await sessionsApi.listSubagents(sessionId))
    } catch (error) {
      errorBySession.value = {
        ...errorBySession.value,
        [sessionId]: error instanceof Error ? error.message : label().loadFailed,
      }
    } finally {
      loadingBySession.value = { ...loadingBySession.value, [sessionId]: false }
    }
  }

  async function stop(sessionId: string, item: SessionSubagentItem): Promise<{ ok: boolean; reason?: string }> {
    if (!sessionId || !item.id) return { ok: false, reason: 'missing task id' }
    const response = await sessionsApi.stopSubagent(sessionId, item.id)
    if (response.ok) {
      upsert(sessionId, { ...item, stopRequestId: response.requestId || null, updatedAt: new Date().toISOString() })
    }
    return response
  }

  function loadingFor(sessionId: string | null | undefined): boolean {
    return !!(sessionId && loadingBySession.value[sessionId])
  }

  function errorFor(sessionId: string | null | undefined): string {
    return sessionId ? errorBySession.value[sessionId] || '' : ''
  }

  function clear(sessionId: string): void {
    const next = { ...snapshotsBySession.value }
    delete next[sessionId]
    snapshotsBySession.value = next
    const nextLoading = { ...loadingBySession.value }
    delete nextLoading[sessionId]
    loadingBySession.value = nextLoading
    const nextError = { ...errorBySession.value }
    delete nextError[sessionId]
    errorBySession.value = nextError
    callToolsBySession.delete(sessionId)
    callToItemBySession.delete(sessionId)
  }

  return {
    snapshotsBySession,
    snapshotFor,
    itemsFor,
    applyRuntimeEvent,
    loadFromBackend,
    stop,
    loadingFor,
    errorFor,
    clear,
  }
})
