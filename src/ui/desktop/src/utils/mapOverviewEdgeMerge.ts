import type { MapOverviewEdge } from '@contract/types'

/**
 * A render unit for the overview canvas: either a single directed edge or a
 * merged A ⇄ B pair whose two directed edges are exact endpoint mirrors
 * (A(x,y)→B(u,v) with B(u,v)→A(x,y)).
 */
export interface MergedMapOverviewEdge {
  /** Representative edge that carries the drawn geometry (deterministic pick). */
  edge: MapOverviewEdge
  /** The opposite direction when the pair is bidirectional. */
  reverse: MapOverviewEdge | null
  bidirectional: boolean
  /** Sum of both directions' transfer counts. */
  totalCount: number
}

function directionKey(edge: MapOverviewEdge): string {
  return `${edge.sourceMapId}:${edge.sourceX},${edge.sourceY}>${edge.targetMapId}:${edge.targetX},${edge.targetY}`
}

function reverseKey(edge: MapOverviewEdge): string {
  return `${edge.targetMapId}:${edge.targetX},${edge.targetY}>${edge.sourceMapId}:${edge.sourceX},${edge.sourceY}`
}

/**
 * Pair up mirrored edges into single bidirectional render units.
 * Deterministic: the representative is the pair member that comes first in the
 * input order, so the merged edge keeps a stable id across re-renders.
 */
export function mergeBidirectionalMapOverviewEdges(
  edges: readonly MapOverviewEdge[],
): MergedMapOverviewEdge[] {
  const byDirection = new Map<string, MapOverviewEdge>()
  for (const edge of edges) {
    // Duplicate direction keys should not occur (counts are pre-aggregated); keep the first.
    if (!byDirection.has(directionKey(edge))) byDirection.set(directionKey(edge), edge)
  }
  const consumed = new Set<string>()
  const merged: MergedMapOverviewEdge[] = []
  for (const edge of edges) {
    if (consumed.has(edge.id)) continue
    consumed.add(edge.id)
    const candidate = byDirection.get(reverseKey(edge))
    const reverse = candidate && candidate.id !== edge.id && !consumed.has(candidate.id) ? candidate : null
    if (reverse) consumed.add(reverse.id)
    merged.push({
      edge,
      reverse,
      bidirectional: Boolean(reverse),
      totalCount: edge.count + (reverse?.count || 0),
    })
  }
  return merged
}
