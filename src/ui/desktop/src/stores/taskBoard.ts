import { defineStore } from 'pinia'
import { ref } from 'vue'
import { sessions as sessionsApi } from '../api/client.ts'
import {
  applyTaskToolCall,
  applyTodoSnapshot,
  taskFromBackend,
  type TaskItem,
  type TaskStatus,
} from './taskBoardProjection.ts'
export type { TaskItem, TaskStatus } from './taskBoardProjection.ts'

/**
 * 桌面右侧「待办」面板的状态。数据来源有二：
 * 1) 直播态——useSessionStream 消费后端 todo_updated 事件，用权威快照替换整个列表，回合进行中即时出现；
 * 2) 权威态——会话激活 / 回合结束 / 人工回写后，从后端 sessions.listTasks（读 opencode todo 状态）回填校正。
 * 人工勾选完成 / 删除走 sessions.updateTask 写回磁盘，乐观更新后以后端结果为准。
 */

export const useTaskBoardStore = defineStore('taskBoard', () => {
  // sessionId -> 任务列表（保持后端返回的数字 id 升序）
  const tasksBySession = ref<Record<string, TaskItem[]>>({})
  const loadingBySession = ref<Record<string, boolean>>({})
  const errorBySession = ref<Record<string, string>>({})

  function tasksFor(sessionId: string | null | undefined): TaskItem[] {
    if (!sessionId) return []
    return tasksBySession.value[sessionId] || []
  }

  function progressFor(sessionId: string | null | undefined): { done: number; total: number } {
    const list = tasksFor(sessionId)
    return { done: list.filter((t) => t.status === 'completed').length, total: list.length }
  }

  function setTasks(sessionId: string, tasks: TaskItem[]): void {
    if (!sessionId) return
    tasksBySession.value = { ...tasksBySession.value, [sessionId]: tasks }
  }

  function upsert(sessionId: string, task: TaskItem): void {
    const list = tasksBySession.value[sessionId] || []
    const idx = list.findIndex((t) => t.id === task.id)
    const next = idx >= 0 ? list.map((t, i) => (i === idx ? { ...t, ...task } : t)) : [...list, task]
    tasksBySession.value = { ...tasksBySession.value, [sessionId]: next }
  }

  /** 直播投影：把一次 TaskUpdate 工具调用映射进面板（目前仅处理删除）。 */
  function applyToolCall(sessionId: string, tool: string | undefined, input: unknown, callId: string | undefined): void {
    if (!sessionId) return
    tasksBySession.value = {
      ...tasksBySession.value,
      [sessionId]: applyTaskToolCall(tasksBySession.value[sessionId] || [], tool, input, callId),
    }
  }

  /** 消费后端 todo_updated 事件：用权威快照整体替换任务列表，实现实时投影。 */
  function applyTodoUpdated(sessionId: string, todos: unknown[]): void {
    if (!sessionId) return
    tasksBySession.value = {
      ...tasksBySession.value,
      [sessionId]: applyTodoSnapshot(tasksBySession.value[sessionId] || [], todos),
    }
  }

  /** 从后端读取权威任务列表回填（会话激活 / 回合结束 / 回写后调用）。 */
  async function loadFromBackend(sessionId: string): Promise<void> {
    if (!sessionId) return
    loadingBySession.value = { ...loadingBySession.value, [sessionId]: true }
    errorBySession.value = { ...errorBySession.value, [sessionId]: '' }
    try {
      const raw = (await sessionsApi.listTasks(sessionId)) as Array<Record<string, unknown>>
      setTasks(
        sessionId,
        (raw || []).map(taskFromBackend),
      )
    } catch (error) {
      console.error('[taskBoard] load tasks failed', error)
      errorBySession.value = {
        ...errorBySession.value,
        [sessionId]: error instanceof Error ? error.message : '加载任务失败',
      }
    } finally {
      loadingBySession.value = { ...loadingBySession.value, [sessionId]: false }
    }
  }

  async function toggleComplete(sessionId: string, task: TaskItem): Promise<void> {
    if (!sessionId || task.id.startsWith('pending:')) return
    const nextStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed'
    upsert(sessionId, { ...task, status: nextStatus }) // 乐观更新
    try {
      await sessionsApi.updateTask(sessionId, task.id, { status: nextStatus })
    } finally {
      await loadFromBackend(sessionId)
    }
  }

  async function remove(sessionId: string, taskId: string): Promise<void> {
    if (!sessionId || taskId.startsWith('pending:')) return
    const list = tasksBySession.value[sessionId] || []
    tasksBySession.value = { ...tasksBySession.value, [sessionId]: list.filter((t) => t.id !== taskId) } // 乐观删除
    try {
      await sessionsApi.updateTask(sessionId, taskId, { delete: true })
    } finally {
      await loadFromBackend(sessionId)
    }
  }

  function clear(sessionId: string): void {
    if (!sessionId) return
    const next = { ...tasksBySession.value }
    delete next[sessionId]
    tasksBySession.value = next
    const nextLoading = { ...loadingBySession.value }
    delete nextLoading[sessionId]
    loadingBySession.value = nextLoading
    const nextError = { ...errorBySession.value }
    delete nextError[sessionId]
    errorBySession.value = nextError
  }

  function loadingFor(sessionId: string | null | undefined): boolean {
    return !!(sessionId && loadingBySession.value[sessionId])
  }

  function errorFor(sessionId: string | null | undefined): string {
    return sessionId ? errorBySession.value[sessionId] || '' : ''
  }

  return {
    tasksBySession,
    loadingBySession,
    errorBySession,
    tasksFor,
    progressFor,
    setTasks,
    applyToolCall,
    applyTodoUpdated,
    loadFromBackend,
    toggleComplete,
    remove,
    clear,
    loadingFor,
    errorFor,
  }
})
