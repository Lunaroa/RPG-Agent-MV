import { describe, expect, it } from 'vitest'

import {
  buildMapOverviewSvgEdgeRoutes,
  mapOverviewSvgEdgeGeometry,
  mapOverviewSvgExportBounds,
  mapOverviewSvgNodeGeometry,
  mapOverviewSvgPortPoint,
} from '@contract/map-overview-svg-geometry'
import type { MapOverviewEdge } from '@contract/types'

describe('map overview SVG geometry', () => {
  it('uses the 1/4 thumbnail scale and exact map-cell centers', () => {
    const node = mapOverviewSvgNodeGeometry(
      { id: 1, name: 'Sample', readState: 'ready', width: 10, height: 8 },
      { x: 100, y: 80 },
    )
    expect(node.width).toBe(120)
    expect(node.imageHeight).toBe(96)
    expect(mapOverviewSvgPortPoint(node, 0, 0)).toEqual({ x: 46, y: 38 })
    expect(mapOverviewSvgPortPoint(node, 9, 7)).toEqual({ x: 154, y: 122 })
  })

  it('stably separates repeated and bidirectional coordinate relationships', () => {
    const nodes = new Map([
      [1, mapOverviewSvgNodeGeometry({ id: 1, name: 'A', readState: 'ready', width: 4, height: 4 }, { x: 0, y: 0 })],
      [2, mapOverviewSvgNodeGeometry({ id: 2, name: 'B', readState: 'ready', width: 4, height: 4 }, { x: 200, y: 0 })],
    ])
    const edges = [edge('a', 1, 2), edge('b', 1, 2), edge('c', 2, 1)]
    const routes = buildMapOverviewSvgEdgeRoutes(edges)
    const first = mapOverviewSvgEdgeGeometry(edges[0], nodes, routes.get('a'))
    const second = mapOverviewSvgEdgeGeometry(edges[1], nodes, routes.get('b'))
    const reverse = mapOverviewSvgEdgeGeometry(edges[2], nodes, routes.get('c'))
    expect(first.path).not.toBe(second.path)
    expect(first.control.y).toBeGreaterThan(0)
    expect(reverse.control.y).toBeLessThan(0)
    expect(mapOverviewSvgEdgeGeometry(edges[0], nodes, routes.get('a'))).toEqual(first)
  })

  it('creates a stable loop and includes nodes, labels and relationships in export bounds', () => {
    const node = mapOverviewSvgNodeGeometry(
      { id: 1, name: 'Loop', readState: 'ready', width: 4, height: 3 },
      { x: -30, y: -20 },
    )
    const loop = edge('loop', 1, 1)
    const geometry = mapOverviewSvgEdgeGeometry(loop, new Map([[1, node]]))
    expect(geometry.selfLoop).toBe(true)
    expect(geometry.path).toContain(' C ')
    const bounds = mapOverviewSvgExportBounds([node], [geometry])
    expect(bounds.width).toBeGreaterThan(node.width + 96)
    expect(bounds.height).toBeGreaterThan(node.collisionHeight + 96)
    expect(bounds.translateX).toBeGreaterThan(0)
    expect(bounds.translateY).toBeGreaterThan(0)
  })
})

function edge(id: string, sourceMapId: number, targetMapId: number): MapOverviewEdge {
  return {
    id,
    sourceMapId,
    sourceX: 1,
    sourceY: 1,
    targetMapId,
    targetX: 1,
    targetY: 1,
    count: 1,
    sources: [],
  }
}
