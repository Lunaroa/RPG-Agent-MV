import type { MapOverviewEdge } from '@contract/types'

export interface MapOverviewPointerGestureInput {
  type: string
  button?: number
  spacePressed: boolean
  interactiveTarget: boolean
}

export function shouldStartMapOverviewNodeDrag(input: MapOverviewPointerGestureInput): boolean {
  if (input.spacePressed) return false
  if (input.type.startsWith('touch')) return true
  return input.button === 0
}

export function shouldStartMapOverviewPan(input: MapOverviewPointerGestureInput): boolean {
  if (input.type === 'wheel') return true
  if (input.type.startsWith('touch')) return !input.interactiveTarget
  if (input.button === 1) return true
  if (input.button !== 0) return false
  return input.spacePressed || !input.interactiveTarget
}

export function buildMapOverviewIncidentEdgeIndex(
  edges: readonly MapOverviewEdge[],
): ReadonlyMap<number, readonly MapOverviewEdge[]> {
  const mutable = new Map<number, MapOverviewEdge[]>()
  for (const edge of edges) {
    appendIncidentEdge(mutable, edge.sourceMapId, edge)
    if (edge.targetMapId !== edge.sourceMapId) appendIncidentEdge(mutable, edge.targetMapId, edge)
  }
  return mutable
}

function appendIncidentEdge(
  index: Map<number, MapOverviewEdge[]>,
  mapId: number,
  edge: MapOverviewEdge,
): void {
  const existing = index.get(mapId)
  if (existing) {
    existing.push(edge)
    return
  }
  index.set(mapId, [edge])
}
