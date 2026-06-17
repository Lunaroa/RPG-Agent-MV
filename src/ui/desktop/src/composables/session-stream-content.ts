export interface StreamSegmentRef {
  id: string
  content: string
}

/** 在 reactive 数组里按 id 定位段；流式 delta 必须改 proxy 才能触发 UI 更新。 */
export function findSegmentIndex(segments: StreamSegmentRef[], segment: StreamSegmentRef): number {
  const byId = segments.findIndex((s) => s.id === segment.id)
  return byId >= 0 ? byId : segments.indexOf(segment)
}

export function appendSegmentContent(
  segments: StreamSegmentRef[],
  segment: StreamSegmentRef,
  delta: string,
): void {
  if (!delta) return
  const idx = findSegmentIndex(segments, segment)
  if (idx >= 0) segments[idx].content += delta
  else segment.content += delta
}

export function setSegmentContent(
  segments: StreamSegmentRef[],
  segment: StreamSegmentRef,
  content: string,
): void {
  const idx = findSegmentIndex(segments, segment)
  if (idx >= 0) segments[idx].content = content
  else segment.content = content
}
