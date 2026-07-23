import { describe, expect, it } from 'vitest'
import type { MapOverviewEdge } from '@contract/types'

import {
  buildMapOverviewFocusedNodeIds,
  buildMapOverviewIncidentEdgeIndex,
  isMapOverviewNodeDragAllowed,
  shouldStartMapOverviewNodeDrag,
  shouldStartMapOverviewPan,
} from './mapOverviewSvgInteraction'

describe('map overview SVG gesture policy', () => {
  it('keeps primary node drag separate from middle-button and space panning', () => {
    expect(shouldStartMapOverviewNodeDrag({
      type: 'mousedown',
      button: 0,
      spacePressed: false,
      interactiveTarget: true,
    })).toBe(true)
    expect(shouldStartMapOverviewNodeDrag({
      type: 'mousedown',
      button: 1,
      spacePressed: false,
      interactiveTarget: true,
    })).toBe(false)
    expect(shouldStartMapOverviewNodeDrag({
      type: 'mousedown',
      button: 0,
      spacePressed: true,
      interactiveTarget: true,
    })).toBe(false)
  })

  it('pans with middle button or space from interactive content', () => {
    expect(shouldStartMapOverviewPan({
      type: 'mousedown',
      button: 1,
      spacePressed: false,
      interactiveTarget: true,
    })).toBe(true)
    expect(shouldStartMapOverviewPan({
      type: 'mousedown',
      button: 0,
      spacePressed: true,
      interactiveTarget: true,
    })).toBe(true)
    expect(shouldStartMapOverviewPan({
      type: 'mousedown',
      button: 0,
      spacePressed: false,
      interactiveTarget: true,
    })).toBe(false)
    expect(shouldStartMapOverviewPan({
      type: 'mousedown',
      button: 0,
      spacePressed: false,
      interactiveTarget: false,
    })).toBe(true)
    expect(shouldStartMapOverviewPan({
      type: 'wheel',
      spacePressed: false,
      interactiveTarget: true,
    })).toBe(true)
  })

  it('allows only directly focused maps to drag while a node or edge is selected', () => {
    const edges = [
      edge('1-2', 1, 2),
      edge('2-3', 2, 3),
      edge('4-5', 4, 5),
    ]
    const nodeFocus = buildMapOverviewFocusedNodeIds(edges, 1, null)
    expect([...nodeFocus]).toEqual([1, 2])
    expect(isMapOverviewNodeDragAllowed(1, 1, null, nodeFocus)).toBe(true)
    expect(isMapOverviewNodeDragAllowed(2, 1, null, nodeFocus)).toBe(true)
    expect(isMapOverviewNodeDragAllowed(3, 1, null, nodeFocus)).toBe(false)

    const edgeFocus = buildMapOverviewFocusedNodeIds(edges, null, '2-3')
    expect([...edgeFocus]).toEqual([2, 3])
    expect(isMapOverviewNodeDragAllowed(2, null, '2-3', edgeFocus)).toBe(true)
    expect(isMapOverviewNodeDragAllowed(1, null, '2-3', edgeFocus)).toBe(false)
  })

  it('does not lock dragging for hover-only state', () => {
    expect(isMapOverviewNodeDragAllowed(9, null, null, new Set())).toBe(true)
  })
})

describe('map overview incident edge index', () => {
  it('indexes only incident edges and stores a self-loop once', () => {
    const edges = [
      edge('1-2', 1, 2),
      edge('2-3', 2, 3),
      edge('4-4', 4, 4),
    ]
    const index = buildMapOverviewIncidentEdgeIndex(edges)

    expect(index.get(1)?.map(item => item.id)).toEqual(['1-2'])
    expect(index.get(2)?.map(item => item.id)).toEqual(['1-2', '2-3'])
    expect(index.get(3)?.map(item => item.id)).toEqual(['2-3'])
    expect(index.get(4)?.map(item => item.id)).toEqual(['4-4'])
  })
})

function edge(id: string, sourceMapId: number, targetMapId: number): MapOverviewEdge {
  return {
    id,
    sourceMapId,
    sourceX: 0,
    sourceY: 0,
    targetMapId,
    targetX: 0,
    targetY: 0,
    count: 1,
    sources: [],
  }
}
