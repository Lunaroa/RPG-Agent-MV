import { defineStore } from 'pinia'
import { ref } from 'vue'
import { sessions as sessionsApi } from '../api/client.ts'
import type { SessionPlanSnapshot, SessionRuntimeEvent } from '@contract/types'

const PLAN_ASK_PREFIX = 'agent-runtime-plan:'
const PLAN_PATH_PATTERN = /(?:^|[/\\])\.opencode[/\\]plans[/\\](?:conversations[/\\][^/\\]+\.md|[^/\\]+\.md)$/i

function emptyPlan(sessionId: string): SessionPlanSnapshot {
  return {
    sessionId,
    mode: 'idle',
    title: '计划',
    planMarkdown: '',
    askId: null,
    requestId: null,
    filePath: null,
    feedback: null,
    error: null,
    updatedAt: null,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isPlanFileTool(tool: string): boolean {
  const normalized = tool.trim().toLowerCase()
  return normalized === 'write' || normalized === 'edit' || normalized === 'apply_patch'
}

function planPathFromToolInput(input: Record<string, unknown>): string | null {
  const candidate = [
    input.path,
    input.file_path,
    input.filePath,
    input.filename,
  ].map((value) => asString(value)).find(Boolean)
  if (!candidate) return null
  const normalized = candidate.replace(/\\/g, '/')
  if (PLAN_PATH_PATTERN.test(normalized)) return candidate
  const base = normalized.split('/').pop() || ''
  if (base === 'plan.md' || base === 'PLAN.md') return candidate
  return null
}

function planContentFromWriteInput(input: Record<string, unknown>): string {
  return asString(input.content) || asString(input.contents)
}

function shouldReloadPlanFromBackend(event: SessionRuntimeEvent, tool?: string): boolean {
  if (event.type === 'tool_call' && tool && isPlanFileTool(tool)) {
    return Boolean(planPathFromToolInput(asRecord(event.input)))
  }
  if (event.type === 'tool_result' && tool && isPlanFileTool(tool)) {
    return true
  }
  return event.type === 'opencode_permission_request'
    || tool === 'EnterPlanMode'
    || tool === 'ExitPlanMode'
    || tool === 'plan_enter'
    || tool === 'plan_exit'
}

export const useSessionPlanStore = defineStore('sessionPlan', () => {
  const plansBySession = ref<Record<string, SessionPlanSnapshot>>({})
  const loadingBySession = ref<Record<string, boolean>>({})
  const errorBySession = ref<Record<string, string>>({})
  const callToolsBySession = new Map<string, Map<string, string>>()

  function planFor(sessionId: string | null | undefined): SessionPlanSnapshot | null {
    if (!sessionId) return null
    return plansBySession.value[sessionId] || emptyPlan(sessionId)
  }

  function setPlan(sessionId: string, plan: SessionPlanSnapshot): void {
    plansBySession.value = { ...plansBySession.value, [sessionId]: plan }
  }

  function patchPlan(sessionId: string, patch: Partial<SessionPlanSnapshot>): void {
    setPlan(sessionId, { ...emptyPlan(sessionId), ...(plansBySession.value[sessionId] || {}), ...patch })
  }

  function rememberCall(sessionId: string, callId: string, tool: string): void {
    const map = callToolsBySession.get(sessionId) || new Map<string, string>()
    map.set(callId, tool)
    callToolsBySession.set(sessionId, map)
  }

  function applyRuntimeEvent(sessionId: string | null | undefined, event: SessionRuntimeEvent): void {
    if (!sessionId) return
    const at = asString(event.at) || new Date().toISOString()
    let shouldReload = false

    if (event.type === 'tool_call') {
      const tool = asString(event.tool)
      const callId = asString(event.call_id)
      const input = asRecord(event.input)
      if (callId && tool) rememberCall(sessionId, callId, tool)
      if (tool === 'EnterPlanMode' || tool === 'plan_enter') {
        patchPlan(sessionId, { mode: 'planning', title: '计划模式', updatedAt: at, error: null })
      } else if (tool === 'ExitPlanMode' || tool === 'plan_exit') {
        patchPlan(sessionId, {
          mode: 'approval_requested',
          title: '计划待批准',
          planMarkdown: asString(input.plan) || planFor(sessionId)?.planMarkdown || '',
          updatedAt: at,
          error: null,
        })
      } else if (isPlanFileTool(tool)) {
        const planPath = planPathFromToolInput(input)
        if (planPath) {
          const content = tool.trim().toLowerCase() === 'write' ? planContentFromWriteInput(input) : ''
          patchPlan(sessionId, {
            mode: 'planning',
            title: '计划模式',
            filePath: planPath,
            planMarkdown: content || planFor(sessionId)?.planMarkdown || '',
            updatedAt: at,
            error: null,
          })
        }
      }
      shouldReload = shouldReloadPlanFromBackend(event, tool)
    }

    if (event.type === 'opencode_permission_request') {
      const request = asRecord(event.request)
      if (request.subtype !== 'can_use_tool') return
      const toolName = asString(request.tool_name)
      if (toolName === 'EnterPlanMode') {
        patchPlan(sessionId, { mode: 'planning', title: '计划模式', updatedAt: at, error: null })
        shouldReload = true
      } else if (toolName === 'ExitPlanMode') {
        const requestId = asString(event.request_id)
        const input = asRecord(request.input)
        patchPlan(sessionId, {
          mode: 'approval_requested',
          title: '计划待批准',
          planMarkdown: asString(input.plan) || planFor(sessionId)?.planMarkdown || '',
          requestId,
          askId: requestId ? `${PLAN_ASK_PREFIX}${requestId}` : null,
          filePath: asString(input.planFilePath) || planFor(sessionId)?.filePath || null,
          feedback: null,
          error: null,
          updatedAt: at,
        })
        shouldReload = true
      }
    }

    if (event.type === 'opencode_permission_response') {
      const current = planFor(sessionId)
      const response = asRecord(event.response)
      const requestId = asString(response.request_id) || asString(event.request_id)
      if (!current?.requestId || requestId !== current.requestId) return
      const payload = asRecord(response.response)
      const behavior = asString(payload.behavior)
      if (response.subtype === 'error') {
        patchPlan(sessionId, { mode: 'error', error: asString(response.error) || '计划审批响应失败', updatedAt: at })
      } else if (behavior === 'allow') {
        patchPlan(sessionId, { mode: 'approved', feedback: null, error: null, updatedAt: at })
      } else if (behavior === 'deny') {
        patchPlan(sessionId, { mode: 'rejected', feedback: asString(payload.message), error: null, updatedAt: at })
      }
      return
    }

    if (event.type === 'tool_result') {
      const tool = callToolsBySession.get(sessionId)?.get(asString(event.call_id))
      if (tool === 'EnterPlanMode' || tool === 'plan_enter') {
        patchPlan(sessionId, {
          mode: event.success === false ? 'error' : 'planning',
          error: event.success === false ? asString(event.output) || '进入计划模式失败' : null,
          updatedAt: at,
        })
      } else if (tool === 'ExitPlanMode' || tool === 'plan_exit') {
        patchPlan(sessionId, {
          mode: event.success === false ? 'error' : 'approved',
          error: event.success === false ? asString(event.output) || '退出计划模式失败' : null,
          updatedAt: at,
        })
      }
      shouldReload = shouldReload || shouldReloadPlanFromBackend(event, tool)
    }

    if (shouldReload) {
      void loadFromBackend(sessionId)
    }
  }

  async function loadFromBackend(sessionId: string): Promise<void> {
    if (!sessionId) return
    loadingBySession.value = { ...loadingBySession.value, [sessionId]: true }
    errorBySession.value = { ...errorBySession.value, [sessionId]: '' }
    try {
      const plan = await sessionsApi.getPlan(sessionId)
      setPlan(sessionId, plan)
    } catch (error) {
      errorBySession.value = {
        ...errorBySession.value,
        [sessionId]: error instanceof Error ? error.message : '加载计划失败',
      }
    } finally {
      loadingBySession.value = { ...loadingBySession.value, [sessionId]: false }
    }
  }

  function loadingFor(sessionId: string | null | undefined): boolean {
    return !!(sessionId && loadingBySession.value[sessionId])
  }

  function errorFor(sessionId: string | null | undefined): string {
    return sessionId ? errorBySession.value[sessionId] || '' : ''
  }

  function clear(sessionId: string): void {
    const next = { ...plansBySession.value }
    delete next[sessionId]
    plansBySession.value = next
    const nextLoading = { ...loadingBySession.value }
    delete nextLoading[sessionId]
    loadingBySession.value = nextLoading
    const nextError = { ...errorBySession.value }
    delete nextError[sessionId]
    errorBySession.value = nextError
    callToolsBySession.delete(sessionId)
  }

  return {
    plansBySession,
    planFor,
    setPlan,
    applyRuntimeEvent,
    loadFromBackend,
    loadingFor,
    errorFor,
    clear,
  }
})
