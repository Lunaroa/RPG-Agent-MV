import type {
  MapOverviewEdge,
  MapOverviewLayoutId,
  MapOverviewNode,
} from '@contract/types'

import { mapOverviewNodeSize } from './mapOverviewNodeSize'

export interface MapOverviewLayoutNodeInput {
  id: string
  mapId: number
  parentId: number
  order: number
  width: number
  collisionHeight: number
  x?: number
  y?: number
}

export interface MapOverviewLayoutEdgeInput {
  id: string
  source: string
  target: string
  count: number
}

export interface MapOverviewLayoutPosition {
  x: number
  y: number
}

export type MapOverviewLayoutPositions = Record<string, MapOverviewLayoutPosition>

export function buildMapOverviewLayoutNodes(
  nodes: readonly MapOverviewNode[],
  seedPositions: MapOverviewLayoutPositions = {},
): MapOverviewLayoutNodeInput[] {
  return nodes.map((node) => {
    const size = mapOverviewNodeSize(node)
    const seed = seedPositions[String(node.id)]
    return {
      id: String(node.id),
      mapId: node.id,
      parentId: node.parentId,
      order: node.order,
      width: size.width,
      collisionHeight: size.collisionHeight,
      x: Number.isFinite(seed?.x) ? seed.x : undefined,
      y: Number.isFinite(seed?.y) ? seed.y : undefined,
    }
  })
}

/**
 * Layout algorithms only need map-to-map topology. Coordinate-level transfer edges stay in the SVG display layer.
 * Dagre keeps direction; every other layout uses one canonical undirected edge per map pair.
 */
export function buildMapOverviewLayoutEdges(
  edges: readonly MapOverviewEdge[],
  layoutId: MapOverviewLayoutId,
): MapOverviewLayoutEdgeInput[] {
  const directed = layoutId === 'antv-dagre'
  const aggregated = new Map<string, MapOverviewLayoutEdgeInput>()

  for (const edge of edges) {
    if (edge.sourceMapId === edge.targetMapId) continue
    const sourceMapId = directed
      ? edge.sourceMapId
      : Math.min(edge.sourceMapId, edge.targetMapId)
    const targetMapId = directed
      ? edge.targetMapId
      : Math.max(edge.sourceMapId, edge.targetMapId)
    const id = directed
      ? `${sourceMapId}->${targetMapId}`
      : `${sourceMapId}--${targetMapId}`
    const current = aggregated.get(id)
    if (current) {
      current.count += edge.count
      continue
    }
    aggregated.set(id, {
      id,
      source: String(sourceMapId),
      target: String(targetMapId),
      count: edge.count,
    })
  }

  return [...aggregated.values()].sort((left, right) => (
    Number(left.source) - Number(right.source)
    || Number(left.target) - Number(right.target)
  ))
}
