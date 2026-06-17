/** 与 legacy event-placement-flow / ask-cards 一致 */
export function isPlacedStatus(status?: string | null): boolean {
  return status === 'placed' || status === 'verified'
}

/** 地图上已写入坐标 / eventId，但 status 尚未同步为 placed 时仍视为可继续编排 */
export function isPlacementEventDone(event: {
  status?: string | null
  placedEventId?: number | null
  x?: number | null
  y?: number | null
}): boolean {
  if (isPlacedStatus(event.status)) return true
  const hasCoords = Number.isInteger(event.x) && Number.isInteger(event.y)
  return event.placedEventId != null && hasCoords
}

export function countPlacedEvents(events: Array<{ status?: string; placedEventId?: number | null; x?: number | null; y?: number | null }> | undefined): number {
  return (events || []).filter((e) => isPlacementEventDone(e)).length
}

export function allPlacementEventsPlaced(events: Array<{ status?: string; placedEventId?: number | null; x?: number | null; y?: number | null }> | undefined): boolean {
  const list = events || []
  return list.length > 0 && list.every((e) => isPlacementEventDone(e))
}
