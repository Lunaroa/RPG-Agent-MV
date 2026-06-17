export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TaskItem {
  id: string
  subject: string
  description: string
  status: TaskStatus
  activeForm?: string
}

const TASK_UPDATE = 'TaskUpdate'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function fallbackTodoId(index: number): string {
  return `todo:${index + 1}`
}

export function asTaskStatus(value: unknown): TaskStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'pending'
}

export function taskFromBackend(raw: Record<string, unknown>): TaskItem {
  return {
    id: asString(raw.id),
    subject: asString(raw.subject) || asString(raw.content),
    description: asString(raw.description),
    status: asTaskStatus(raw.status),
    activeForm: asString(raw.activeForm) || undefined,
  }
}

/** Map an OpenCode todo item (id, content, status, priority) to a TaskItem. */
export function todoFromOpencode(raw: unknown, index = 0): TaskItem | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = asString(record.id) || fallbackTodoId(index)
  const content = asString(record.content)
  if (!content) return null
  return {
    id,
    subject: content,
    description: '',
    status: asTaskStatus(record.status),
  }
}

/** Replace the entire task list with an authoritative snapshot from a todo_updated event. */
export function applyTodoSnapshot(_list: TaskItem[], todos: unknown[]): TaskItem[] {
  return todos.map(todoFromOpencode).filter((t): t is TaskItem => t !== null)
}

export function applyTaskToolCall(
  list: TaskItem[],
  tool: string | undefined,
  input: unknown,
  _callId: string | undefined,
): TaskItem[] {
  if (tool !== TASK_UPDATE) return list
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (Array.isArray(data.todos)) return applyTodoSnapshot(list, data.todos)
  const taskId = asString(data.taskId)
  if (!taskId || data.status !== 'deleted') return list
  return list.filter((task) => task.id !== taskId)
}
