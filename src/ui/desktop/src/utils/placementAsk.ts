import type { Ask } from './askParser.ts'
import { isPlacementEventDone } from './placementStatus.ts'

export function placementContractKey(event: { contractId?: string; id?: string }): string {
  return String(event.contractId || event.id || '')
}

export function asksSharePlacementContracts(a: Ask, b: Ask): boolean {
  const aIds = new Set(((a.events || []) as Array<{ contractId?: string; id?: string }>).map(placementContractKey).filter(Boolean))
  const bIds = new Set(((b.events || []) as Array<{ contractId?: string; id?: string }>).map(placementContractKey).filter(Boolean))
  if (!aIds.size || !bIds.size) return false
  for (const id of aIds) {
    if (bIds.has(id)) return true
  }
  return false
}

export function mergePlacementEventsFromSource(
  target: Ask,
  source: Ask | null | undefined,
): Ask {
  if (!source?.events?.length) return target
  const byContract = new Map(
    ((source.events || []) as Array<Record<string, unknown>>).map((event) => [
      placementContractKey(event),
      event,
    ]),
  )
  const events = ((target.events || []) as Array<Record<string, unknown>>).map((event) => {
    const prior = byContract.get(placementContractKey(event))
    if (!prior) return event
    const done = isPlacementEventDone(prior as { status?: string; placedEventId?: number | null; x?: number | null; y?: number | null })
      || isPlacementEventDone(event as { status?: string; placedEventId?: number | null; x?: number | null; y?: number | null })
    return {
      ...event,
      status: done ? String(prior.status || event.status || 'placed') : String(event.status || prior.status || 'draft'),
      placedEventId: prior.placedEventId ?? event.placedEventId ?? null,
      x: Number.isInteger(prior.x) ? prior.x : event.x,
      y: Number.isInteger(prior.y) ? prior.y : event.y,
      targetMapId: prior.targetMapId ?? event.targetMapId ?? null,
    }
  })
  return { ...target, events }
}

export function findPendingMcpEventPlacementAsk(segments: Array<{ type?: string; ask?: Ask }>): Ask | null {
  for (const segment of segments) {
    const ask = segment.ask
    if (ask?.type !== 'event-placement-list' || !ask.fromMcp) continue
    if (ask.result?.submittedAt || ask.result?.canceledAt) continue
    return ask
  }
  return null
}

export function resolvePlacementSubmitAsk(
  visibleAsk: Ask,
  segments: Array<{ type?: string; ask?: Ask }>,
): { askId: string; ask: Ask } {
  if (visibleAsk.fromMcp) {
    return { askId: visibleAsk.askId, ask: visibleAsk }
  }
  const mcpAsk = findPendingMcpEventPlacementAsk(segments)
  if (mcpAsk && asksSharePlacementContracts(visibleAsk, mcpAsk)) {
    return {
      askId: mcpAsk.askId,
      ask: mergePlacementEventsFromSource(mcpAsk, visibleAsk),
    }
  }
  return { askId: visibleAsk.askId, ask: visibleAsk }
}
