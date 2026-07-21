import type { Session } from '../composables/useSession'
import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate } from '../i18n/messages.ts'

export interface Conversation {
  rootId: string
  leafId: string
  title: string
  time: string
  status: string
  project: string
  sessionIds: string[]
  batchDeletable: boolean
}

const SIDEBAR_TITLE_MAX = 48
const TERMINAL_SESSION_STATUSES = new Set([
  'pass',
  'blocked',
  'failed',
  'error',
  'stopped',
  'interrupted',
  'timeout',
])

/** 续轮 ASK 回执等短 displayText，侧栏仍显示首轮用户意图 */
const GENERIC_DISPLAY_TEXT = /^(批准计划|要求修改计划|拒绝计划|澄清已提交|回答澄清|大纲已确认|确认制作清单|事件已放置|拒绝新增地图|地图选择结果|Plan approved|Requested plan changes|Plan rejected|Clarification submitted|Clarification answered|Outline approved|Production board approved|Event placed|New map rejected|Map selection result)/

function truncateTitle(text: string, max = SIDEBAR_TITLE_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

export function conversationTitle(root: Session | undefined, leaf: Session, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  const intentLine = (root?.intent || '').split('\n')[0].trim()
  const display = (root?.displayText || leaf.displayText || '').trim()
  if (intentLine && (!display || GENERIC_DISPLAY_TEXT.test(display))) {
    return truncateTitle(intentLine) || translate('conversation.untitled', language)
  }
  return truncateTitle(display || intentLine) || translate('conversation.untitled', language)
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

export function groupSessionsIntoConversations(sessions: Session[], language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): Conversation[] {
  language = normalizeProductLanguage(language)
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
      title: conversationTitle(root, leaf, language),
      time: leaf.updatedAt || leaf.createdAt || '',
      status: leaf.status,
      project: root?.project || leaf.project || '',
      sessionIds: arr.map((s) => s.id),
      batchDeletable: arr.every((session) => TERMINAL_SESSION_STATUSES.has(session.status)),
    })
  }
  return result.sort((a, b) => (b.time || '').localeCompare(a.time || ''))
}

export function sessionIdsForConversations(conversations: readonly Conversation[]): string[] {
  return [...new Set(conversations.flatMap((conversation) => conversation.sessionIds))]
}

export function nearestConversationAfterDeletion(
  conversations: readonly Conversation[],
  deletedRootIds: ReadonlySet<string>,
  activeRootId: string,
): Conversation | null {
  const activeIndex = conversations.findIndex((conversation) => conversation.rootId === activeRootId)
  if (activeIndex < 0) return conversations.find((conversation) => !deletedRootIds.has(conversation.rootId)) || null
  for (let index = activeIndex + 1; index < conversations.length; index += 1) {
    if (!deletedRootIds.has(conversations[index].rootId)) return conversations[index]
  }
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    if (!deletedRootIds.has(conversations[index].rootId)) return conversations[index]
  }
  return null
}

export function titleForSession(sessions: Session[], activeId?: string | null, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  if (!activeId) return translate('conversation.new', language)
  const byId = new Map<string, Session>()
  for (const s of sessions) byId.set(s.id, s)
  const active = byId.get(activeId)
  if (!active) return translate('conversation.new', language)
  const root = rootOf(active, byId)
  return conversationTitle(root, active, language)
}

export function activeConversationRootId(sessions: Session[], activeId?: string | null): string | null {
  if (!activeId) return null
  const byId = new Map<string, Session>()
  for (const s of sessions) byId.set(s.id, s)
  const s = byId.get(activeId)
  return s ? rootOf(s, byId).id : activeId
}
