import { describe, expect, it } from 'vitest'

import {
  computeMapOverviewLayeredGrid,
  computeMapOverviewLayeredGridResult,
  inspectMapOverviewLayeredGridParentCycles,
  MAP_OVERVIEW_LAYERED_GRID_COMPONENT_GAP,
  MAP_OVERVIEW_LAYERED_GRID_HORIZONTAL_GAP,
  MAP_OVERVIEW_LAYERED_GRID_LAYER_GAP,
} from './mapOverviewLayeredGrid'
import type {
  MapOverviewLayoutEdgeInput,
  MapOverviewLayoutNodeInput,
} from './mapOverviewLayoutModel'

function node(
  mapId: number,
  parentId: number,
  order: number,
  width = 100,
  collisionHeight = 80,
): MapOverviewLayoutNodeInput {
  return { id: String(mapId), mapId, parentId, order, width, collisionHeight }
}

function edge(source: number, target: number): MapOverviewLayoutEdgeInput {
  return { id: `${source}--${target}`, source: String(source), target: String(target), count: 1 }
}

function expectNoOverlap(
  nodes: readonly MapOverviewLayoutNodeInput[],
  positions: ReturnType<typeof computeMapOverviewLayeredGrid>,
): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex]
      const right = nodes[rightIndex]
      const leftPosition = positions[left.id]
      const rightPosition = positions[right.id]
      const separatedX = Math.abs(leftPosition.x - rightPosition.x) >= (left.width + right.width) / 2
      const separatedY = Math.abs(leftPosition.y - rightPosition.y) >= (left.collisionHeight + right.collisionHeight) / 2
      expect(separatedX || separatedY, `${left.id} overlaps ${right.id}`).toBe(true)
    }
  }
}

describe('map overview layered grid', () => {
  it('uses custom horizontal, layer, and component spacing', () => {
    const nodes = [
      node(1, 0, 1, 100, 80),
      node(2, 1, 2, 120, 60),
      node(3, 0, 3, 90, 70),
    ]
    const positions = computeMapOverviewLayeredGrid(nodes, [edge(1, 2)], {
      horizontalSpacing: 32,
      layerSpacing: 64,
      groupSpacing: 128,
    })
    const firstBottom = positions['1'].y + 40
    const secondTop = positions['2'].y - 30
    expect(secondTop - firstBottom).toBe(64)
    const mainBottom = positions['2'].y + 30
    const isolatedTop = positions['3'].y - 35
    expect(isolatedTop - mainBottom).toBe(128)
  })

  it('separates connected components and lays each component out by local parent depth', () => {
    const nodes = [
      node(1, 0, 1, 120, 80),
      node(2, 1, 2, 80, 60),
      node(3, 1, 3, 100, 70),
      node(4, 0, 4, 60, 50),
    ]
    const positions = computeMapOverviewLayeredGrid(nodes, [
      edge(1, 2),
      edge(1, 3),
      edge(3, 1),
      { id: 'loop', source: '4', target: '4', count: 1 },
    ])

    expect(positions['2'].y).toBe(positions['3'].y)
    expect(positions['2'].x).toBeLessThan(positions['3'].x)
    expect(positions['3'].x - positions['2'].x).toBe(
      nodes[1].width / 2 + MAP_OVERVIEW_LAYERED_GRID_HORIZONTAL_GAP + nodes[2].width / 2,
    )
    const firstLayerBottom = positions['1'].y + nodes[0].collisionHeight / 2
    const secondLayerTop = positions['2'].y - Math.max(nodes[1].collisionHeight, nodes[2].collisionHeight) / 2
    expect(secondLayerTop - firstLayerBottom).toBe(MAP_OVERVIEW_LAYERED_GRID_LAYER_GAP)
    const mainBottom = Math.max(
      positions['2'].y + nodes[1].collisionHeight / 2,
      positions['3'].y + nodes[2].collisionHeight / 2,
    )
    const isolatedTop = positions['4'].y - nodes[3].collisionHeight / 2
    expect(isolatedTop - mainBottom).toBe(MAP_OVERVIEW_LAYERED_GRID_COMPONENT_GAP)
    expectNoOverlap(nodes, positions)
  })

  it('treats a parent outside the transfer component as a local root', () => {
    const nodes = [node(1, 0, 1), node(2, 1, 2), node(3, 0, 3)]
    const positions = computeMapOverviewLayeredGrid(nodes, [edge(2, 3)])

    expect(positions['2'].y).toBe(positions['3'].y)
    expect(positions['1'].y).toBeLessThan(positions['2'].y)
  })

  it('is deterministic, complete and finite for hundreds of generic nodes', () => {
    const nodes = Array.from({ length: 600 }, (_, index) => node(
      index + 1,
      index < 12 ? 0 : Math.floor(index / 12),
      index + 1,
      48 + index % 5,
      72 + index % 7,
    ))
    const edges = nodes.slice(1).map((item, index) => edge(nodes[index].mapId, item.mapId))
    const first = computeMapOverviewLayeredGrid(nodes, edges, { width: 1600, height: 900 })
    const second = computeMapOverviewLayeredGrid(nodes, edges, { width: 1600, height: 900 })

    expect(second).toEqual(first)
    expect(Object.keys(first)).toHaveLength(nodes.length)
    expect(Object.values(first).every((position) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true)
    expectNoOverlap(nodes, first)
  })

  it('places cyclic parent groups on one layer and reports deterministic diagnostics', () => {
    const nodes = [
      node(1, 2, 1),
      node(2, 1, 2),
      node(3, 2, 3),
      node(4, 4, 4),
    ]
    const first = computeMapOverviewLayeredGridResult(nodes, [edge(1, 2), edge(2, 3), edge(3, 4)])
    const second = computeMapOverviewLayeredGridResult(nodes, [edge(1, 2), edge(2, 3), edge(3, 4)])

    expect(second).toEqual(first)
    expect(first.parentCycles).toEqual([[1, 2], [4]])
    expect(inspectMapOverviewLayeredGridParentCycles(
      nodes,
      [edge(1, 2), edge(2, 3), edge(3, 4)],
    )).toEqual(first.parentCycles)
    expect(first.positions['1'].y).toBe(first.positions['2'].y)
    expect(first.positions['3'].y).toBeGreaterThan(first.positions['2'].y)
    expectNoOverlap(nodes, first.positions)
  })

  it('fails when a topology edge references a missing node', () => {
    expect(() => computeMapOverviewLayeredGrid([node(1, 0, 1)], [edge(1, 2)]))
      .toThrowError(/missing node/i)
  })
})
