/**
 * Pure helpers for merging persisted chat transcripts across continuation chains.
 */

export interface PersistedAsk {
  askId: string
  result?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface PersistedSegment {
  type: string
  ask?: PersistedAsk
  [key: string]: unknown
}

/** 内存转录为空时不写 chat-log，避免切换会话用空列表覆盖磁盘上的历史。 */
export function shouldPersistChatLog(segmentCount: number): boolean {
  return segmentCount > 0
}

/** Normalize chatLog payloads from sessions.get / sessions.history. */
export function extractChatLogSegments(chatLog: unknown): PersistedSegment[] | null {
  if (!chatLog) return null
  if (Array.isArray(chatLog)) return chatLog as PersistedSegment[]
  if (typeof chatLog === 'object' && chatLog !== null) {
    const segments = (chatLog as { segments?: unknown }).segments
    if (Array.isArray(segments)) return segments as PersistedSegment[]
  }
  return null
}

/** Prefer the turn with the richest persisted transcript (usually the chain leaf). */
export function pickBestPersistedSegments(
  turns: Array<{ chatLog?: unknown }>
): PersistedSegment[] | null {
  let best: PersistedSegment[] | null = null
  for (const turn of turns) {
    const segments = extractChatLogSegments(turn.chatLog)
    if (!segments?.length) continue
    if (!best || segments.length > best.length) best = segments
  }
  return best
}

function persistedSegmentFingerprint(segment: PersistedSegment): string {
  const id = typeof segment.id === 'string' ? segment.id.trim() : ''
  if (id) return `id:${id}`
  if (segment.type === 'ask' && segment.ask) {
    const askId = typeof segment.ask.askId === 'string' ? segment.ask.askId.trim() : ''
    if (askId) return `ask:${askId}`
  }
  const content = typeof segment.content === 'string' ? segment.content.trim() : ''
  return `${segment.type}:${content}`
}

/** Merge continuation-chain chat logs; dedupe by segment id or type+content fingerprint. */
export function loadPersistedSegmentsFromChain(
  turns: Array<{ chatLog?: unknown }>,
): PersistedSegment[] | null {
  const best = pickBestPersistedSegments(turns)

  const seen = new Set<string>()
  const merged: PersistedSegment[] = []
  for (const turn of turns) {
    const segments = extractChatLogSegments(turn.chatLog)
    if (!segments?.length) continue
    for (const segment of segments) {
      const fingerprint = persistedSegmentFingerprint(segment)
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      merged.push(segment)
    }
  }

  if (!merged.length) return best
  if (!best) return merged
  return merged.length > best.length ? merged : best
}

/** Immutable patch for a single ASK segment (used when persisting editor placement updates). */
export function patchAskInSegments<T extends PersistedSegment>(
  segments: T[],
  askId: string,
  updater: (ask: PersistedAsk) => PersistedAsk
): T[] {
  let changed = false
  const next = segments.map((segment) => {
    if (segment.type !== 'ask' || !segment.ask || segment.ask.askId !== askId) return segment
    changed = true
    return { ...segment, ask: updater(segment.ask) }
  })
  return changed ? next : segments
}

function segmentText(segment: PersistedSegment): string {
  return typeof segment.content === 'string' ? segment.content.trim() : ''
}

/** Render persisted UI segments into a plain-text transcript for prompt injection. */
export function formatSegmentsAsConversationHistory(segments: PersistedSegment[]): string {
  const lines: string[] = []
  for (const segment of segments) {
    const content = segmentText(segment)
    switch (segment.type) {
      case 'user':
        if (content) lines.push(`User: ${content}`)
        break
      case 'text':
        if (content) lines.push(`Assistant: ${content}`)
        break
      case 'tool': {
        const meta = segment.metadata && typeof segment.metadata === 'object'
          ? segment.metadata as Record<string, unknown>
          : {}
        const tool = String(meta.tool || segment.tool || 'tool')
        const status = meta.status ? ` (${String(meta.status)})` : ''
        if (content) lines.push(`[Tool ${tool}${status}] ${content}`)
        break
      }
      case 'ask': {
        const ask = segment.ask
        if (!ask) break
        const title = typeof ask.title === 'string' ? ask.title : String(ask.type || 'ask')
        const prompt = typeof ask.prompt === 'string' ? ask.prompt.trim() : ''
        if (prompt) lines.push(`[Ask ${title}] ${prompt}`)
        else lines.push(`[Ask ${title}]`)
        if (ask.result && typeof ask.result === 'object') {
          lines.push(`[Ask result] ${JSON.stringify(ask.result)}`)
        }
        break
      }
      default:
        break
    }
  }
  return lines.join('\n').trim()
}

/** Merge continuation-chain chat logs (and bare intents) into one history block. */
export function buildConversationHistoryFromChain(
  turns: Array<{ intent?: unknown; chatLog?: unknown }>,
): string {
  const blocks: string[] = []
  for (const turn of turns) {
    const segments = extractChatLogSegments(turn.chatLog)
    if (segments?.length) {
      const formatted = formatSegmentsAsConversationHistory(segments)
      if (formatted) blocks.push(formatted)
      continue
    }
    const intent = typeof turn.intent === 'string' ? turn.intent.trim() : ''
    if (intent) blocks.push(`User: ${intent}`)
  }
  return blocks.join('\n\n').trim()
}
