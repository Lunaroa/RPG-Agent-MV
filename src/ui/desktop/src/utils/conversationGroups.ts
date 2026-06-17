import type { Session } from '../composables/useSession'

export interface Conversation {
  rootId: string
  leafId: string
  title: string
  time: string
  status: string
  project: string
  sessionIds: string[]
}

const SIDEBAR_TITLE_MAX = 48

/** 续轮 ASK 回执等短 displayText，侧栏仍显示首轮用户意图 */
const GENERIC_DISPLAY_TEXT = /^(批准计划|要求修改计划|拒绝计划|澄清已提交|回答澄清|大纲已确认|确认制作清单|事件已放置|拒绝新增地图|地图选择结果)/

function truncateTitle(text: string, max = SIDEBAR_TITLE_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

export function conversationTitle(root: Session | undefined, leaf: Session): string {
  const intentLine = (root?.intent || '').split('\n')[0].trim()
  const display = (root?.displayText || leaf.displayText || '').trim()
  if (intentLine && (!display || GENERIC_DISPLAY_TEXT.test(display))) {
    return truncateTitle(intentLine) || '(无标题)'
  }
  return truncateTitle(display || intentLine) || '(无标题)'
}

function rootOf(s: Session, byId: Map<string, Session>): Session {
  const seen = new Set<string>()
  let cur = s
  while (cur.parentSessionId && byId.has(cur.parentSessionId) && !seen.has(cur.id)) {
    seen.add(cur.id)
    cur = byId.get(cur.parentSessionId)!
  }
  return cur
}

export function groupSessionsIntoConversations(sessions: Session[]): Conversation[] {
  const byId = new Map<string, Session>()
  for (const s of sessions) byId.set(s.id, s)

  const buckets = new Map<string, Session[]>()
  for (const s of sessions) {
    const root = rootOf(s, byId)
    const arr = buckets.get(root.id) || []
    arr.push(s)
    buckets.set(root.id, arr)
  }

  const referencedAsParent = new Set<string>()
  for (const s of sessions) {
    if (s.parentSessionId) referencedAsParent.add(s.parentSessionId)
  }

  const result: Conversation[] = []
  for (const [rootId, arr] of buckets) {
    const root = byId.get(rootId)
    const sorted = [...arr].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    const leaf = arr.find((s) => !referencedAsParent.has(s.id)) || sorted[0]
    result.push({
      rootId,
      leafId: leaf.id,
      title: conversationTitle(root, leaf),
      time: leaf.updatedAt || leaf.createdAt || '',
      status: leaf.status,
      project: root?.project || leaf.project || '',
      sessionIds: arr.map((s) => s.id),
    })
  }
  return result.sort((a, b) => (b.time || '').localeCompare(a.time || ''))
}

export function titleForSession(sessions: Session[], activeId?: string | null): string {
  if (!activeId) return '新建对话'
  const byId = new Map<string, Session>()
  for (const s of sessions) byId.set(s.id, s)
  const active = byId.get(activeId)
  if (!active) return '新建对话'
  const root = rootOf(active, byId)
  return conversationTitle(root, active)
}

export function activeConversationRootId(sessions: Session[], activeId?: string | null): string | null {
  if (!activeId) return null
  const byId = new Map<string, Session>()
  for (const s of sessions) byId.set(s.id, s)
  const s = byId.get(activeId)
  return s ? rootOf(s, byId).id : activeId
}
