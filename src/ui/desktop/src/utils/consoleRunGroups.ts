export interface RunLogSessionLike {
  id: string
  status?: string
  project?: string
  intent?: string
  displayText?: string
  title?: string
  parentSessionId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface RunLogConversation {
  rootId: string
  leafId: string
  title: string
  time: string
  status: string
  project: string
  sessionIds: string[]
  turnCount: number
  searchText: string
}

const TITLE_MAX = 72

function oneLine(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateTitle(value: string): string {
  const clean = oneLine(value)
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX)}...` : clean
}

function sessionTime(session: RunLogSessionLike): string {
  return session.updatedAt || session.createdAt || ''
}

function titleFor(root: RunLogSessionLike | undefined, leaf: RunLogSessionLike): string {
  return truncateTitle(root?.displayText || root?.title || root?.intent || leaf.displayText || leaf.title || leaf.intent || '未命名会话')
}

function rootOf(session: RunLogSessionLike, byId: Map<string, RunLogSessionLike>): RunLogSessionLike {
  const seen = new Set<string>()
  let current = session
  while (current.parentSessionId && byId.has(current.parentSessionId) && !seen.has(current.id)) {
    seen.add(current.id)
    current = byId.get(current.parentSessionId)!
  }
  return current
}

function chainToRoot(leaf: RunLogSessionLike, byId: Map<string, RunLogSessionLike>): RunLogSessionLike[] {
  const chain: RunLogSessionLike[] = []
  const seen = new Set<string>()
  let current: RunLogSessionLike | undefined = leaf
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parentSessionId ? byId.get(current.parentSessionId) : undefined
  }
  return chain
}

function newest(sessions: RunLogSessionLike[]): RunLogSessionLike {
  return [...sessions].sort((a, b) => sessionTime(b).localeCompare(sessionTime(a)))[0]
}

export function groupSessionsIntoRunLogs(sessions: RunLogSessionLike[]): RunLogConversation[] {
  const byId = new Map<string, RunLogSessionLike>()
  for (const session of sessions) byId.set(session.id, session)

  const buckets = new Map<string, RunLogSessionLike[]>()
  for (const session of sessions) {
    const root = rootOf(session, byId)
    const bucket = buckets.get(root.id) || []
    bucket.push(session)
    buckets.set(root.id, bucket)
  }

  const referencedAsParent = new Set<string>()
  for (const session of sessions) {
    if (session.parentSessionId) referencedAsParent.add(session.parentSessionId)
  }

  const conversations: RunLogConversation[] = []
  for (const [rootId, bucket] of buckets) {
    const root = byId.get(rootId)
    const leafCandidates = bucket.filter((session) => !referencedAsParent.has(session.id))
    const leaf = newest(leafCandidates.length ? leafCandidates : bucket)
    const chain = chainToRoot(leaf, byId)
    const searchableSessions = bucket.length > chain.length ? bucket : chain
    const searchText = searchableSessions
      .flatMap((session) => [
        session.id,
        session.intent,
        session.displayText,
        session.title,
        session.project,
      ])
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    conversations.push({
      rootId,
      leafId: leaf.id,
      title: titleFor(root, leaf),
      time: sessionTime(leaf),
      status: leaf.status || 'unknown',
      project: root?.project || leaf.project || '',
      sessionIds: chain.map((session) => session.id),
      turnCount: bucket.length,
      searchText,
    })
  }

  return conversations.sort((a, b) => (b.time || '').localeCompare(a.time || ''))
}
