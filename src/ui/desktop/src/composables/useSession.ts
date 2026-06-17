import { ref, computed } from 'vue'
import { sessions } from '../api/client.ts'
import type { SessionSummary } from '@contract/types'

export type Session = SessionSummary

const TERMINAL_STATUSES = ['pass', 'blocked', 'failed', 'error', 'stopped', 'interrupted', 'timeout'] as const
const LIVE_STATUSES = ['created', 'preparing', 'starting', 'running'] as const

// 单例：会话状态提到模块作用域，全应用共享一份，切换路由时不丢。
const activeSession = ref<Session | null>(null)
const sessionStatus = ref<string>('')
const isRunning = ref(false)
const isStopped = ref(false)

/** 由 useSessionStream 在收到 status 事件时调用；不依赖 ChatView 的 watch（切走 /editor 时组件会卸载）。 */
export function applyStreamSessionStatus(status: string): void {
  if (!status) return
  sessionStatus.value = status
  if (TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number])) {
    isRunning.value = false
  } else if (LIVE_STATUSES.includes(status as (typeof LIVE_STATUSES)[number])) {
    isRunning.value = true
  }
}

const canStop = computed(() => {
  return activeSession.value && ['created', 'preparing', 'starting', 'running'].includes(sessionStatus.value)
})

const canRun = computed(() => {
  return !isRunning.value
})

export function useSession() {
  async function createSession(payload: {
    profileId: string
    providerId?: string
    modelId?: string
    executionEngine?: string
    project: string
    mapId?: number
    intent: string
    displayText?: string
    continuationOf?: string
    thinkingLevel?: string
    timeoutMs?: number
  }): Promise<Session> {
    isRunning.value = true
    isStopped.value = false
    
    try {
      const session = await sessions.create(payload) as Session
      activeSession.value = session
      sessionStatus.value = session.status
      return session
    } catch (error) {
      isRunning.value = false
      throw error
    }
  }

  async function stopSession(): Promise<void> {
    if (!activeSession.value) return
    
    try {
      const session = await sessions.stop(activeSession.value.id) as Session
      activeSession.value = session
      updateStatus(session.status)
      isStopped.value = true
    } catch (error) {
      console.error('Failed to stop session:', error)
    }
  }

  function updateStatus(status: string): void {
    applyStreamSessionStatus(status)
  }

  async function refreshActiveSession(): Promise<void> {
    const id = activeSession.value?.id
    if (!id) return
    try {
      const detail = await sessions.get(id) as Session
      activeSession.value = { ...activeSession.value, ...detail }
      updateStatus(detail.status)
    } catch (error) {
      console.error('Failed to refresh active session:', error)
    }
  }

  function clearSession(): void {
    activeSession.value = null
    sessionStatus.value = ''
    isRunning.value = false
    isStopped.value = false
  }

  // 显式开新对话链：等同 clearSession，语义化命名供 ChatView「新建对话」调用。
  function newConversation(): void {
    clearSession()
  }

  return {
    activeSession,
    sessionStatus,
    isRunning,
    isStopped,
    canStop,
    canRun,
    createSession,
    stopSession,
    updateStatus,
    refreshActiveSession,
    clearSession,
    newConversation
  }
}
