import type { ChatSegment } from './useSessionStream'

/** Merge duplicate tool_call events with the same call_id into one segment row. */
export function upsertToolCallSegment(
  segments: ChatSegment[],
  toolSegments: Map<string, ChatSegment>,
  event: { tool?: string; call_id?: string; input?: unknown },
  createSegment: (
    type: 'tool',
    content: string,
    metadata?: Record<string, unknown>
  ) => ChatSegment
): ChatSegment {
  const callId = typeof event.call_id === 'string' ? event.call_id : ''
  const existing = callId ? toolSegments.get(callId) : undefined
  if (existing) {
    const idx = segments.indexOf(existing)
    const merged: ChatSegment = {
      ...existing,
      metadata: {
        ...existing.metadata,
        tool: event.tool ?? existing.metadata?.tool,
        input: event.input ?? existing.metadata?.input,
        status: 'running'
      }
    }
    if (idx >= 0) segments[idx] = merged
    if (callId) toolSegments.set(callId, merged)
    return merged
  }
  const segment = createSegment('tool', '', {
    tool: event.tool,
    callId: event.call_id,
    input: event.input,
    status: 'running'
  })
  if (callId) toolSegments.set(callId, segment)
  segments.push(segment)
  return segment
}
