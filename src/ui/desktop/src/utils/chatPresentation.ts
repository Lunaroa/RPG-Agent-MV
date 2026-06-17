import type { ChatSegment } from '../composables/useSessionStream'

function cloneSegment(segment: ChatSegment, content = segment.content): ChatSegment {
  const clone = { ...segment, content }
  if (segment.metadata) clone.metadata = { ...segment.metadata }
  if (segment.ask) clone.ask = { ...segment.ask }
  return clone
}

function isTypedSegment(segment: ChatSegment): boolean {
  return segment.type === 'text' || segment.type === 'reasoning'
}

function commonPrefix(left: string, right: string): string {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
  return left.slice(0, index)
}

function compatiblePrefix(displayed: ChatSegment[], source: ChatSegment[]): boolean {
  if (displayed.length > source.length) return false
  return displayed.every((segment, index) => segment.id === source[index]?.id)
}

function pendingIndex(displayed: ChatSegment[], source: ChatSegment[]): number {
  return displayed.findIndex((segment, index) =>
    isTypedSegment(segment) && segment.content !== source[index]?.content
  )
}

export function syncChatPresentation(
  displayed: ChatSegment[],
  source: ChatSegment[],
  animate: boolean,
): ChatSegment[] {
  if (!animate || !compatiblePrefix(displayed, source)) {
    return source.map((segment) => cloneSegment(segment))
  }

  const next = displayed.map((segment, index) => {
    const target = source[index]
    if (!target) return cloneSegment(segment)
    if (!isTypedSegment(target)) return cloneSegment(target)
    const content = target.content.startsWith(segment.content)
      ? segment.content
      : commonPrefix(segment.content, target.content)
    return cloneSegment(target, content)
  })

  if (pendingIndex(next, source) >= 0) return next

  for (let index = next.length; index < source.length; index += 1) {
    const target = source[index]
    if (!target) break
    if (isTypedSegment(target) && target.content) {
      next.push(cloneSegment(target, ''))
      break
    }
    next.push(cloneSegment(target))
  }
  return next
}

export function adaptiveRevealCount(backlog: number, boundaryWaiting: boolean): number {
  if (backlog <= 0) return 0
  let count = 1
  if (backlog > 1_200) count = 96
  else if (backlog > 600) count = 48
  else if (backlog > 240) count = 20
  else if (backlog > 80) count = 8
  else if (backlog > 24) count = 3

  if (boundaryWaiting) {
    count = Math.max(count, Math.ceil(backlog / 5))
  }
  return Math.min(backlog, count)
}

function safeSliceEnd(content: string, requestedEnd: number): number {
  let end = Math.min(content.length, requestedEnd)
  if (end < content.length) {
    const lastCodeUnit = content.charCodeAt(end - 1)
    if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) end += 1
  }
  return end
}

export function advanceChatPresentation(
  displayed: ChatSegment[],
  source: ChatSegment[],
): ChatSegment[] {
  const synced = syncChatPresentation(displayed, source, true)
  const index = pendingIndex(synced, source)
  if (index < 0) return synced

  const current = synced[index]
  const target = source[index]
  if (!current || !target) return synced

  const backlog = target.content.length - current.content.length
  const revealCount = adaptiveRevealCount(backlog, source.length > index + 1)
  const end = safeSliceEnd(target.content, current.content.length + revealCount)
  const next = [...synced]
  next[index] = cloneSegment(target, target.content.slice(0, end))
  return syncChatPresentation(next, source, true)
}

export function isChatPresentationDrained(
  displayed: ChatSegment[],
  source: ChatSegment[],
): boolean {
  if (displayed.length !== source.length) return false
  return displayed.every((segment, index) => {
    const target = source[index]
    return target?.id === segment.id && target.content === segment.content
  })
}

export function pendingChatPresentationSegmentId(
  displayed: ChatSegment[],
  source: ChatSegment[],
): string | null {
  const index = pendingIndex(displayed, source)
  return index >= 0 ? displayed[index]?.id || null : null
}
