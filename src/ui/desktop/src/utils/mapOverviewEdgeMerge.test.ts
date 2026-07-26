import { describe, expect, it } from 'vitest'

import { mergeBidirectionalMapOverviewEdges } from './mapOverviewEdgeMerge'
import type { MapOverviewEdge, MapOverviewTransferSource } from '@contract/types'

function makeEdge(
  id: string,
  sourceMapId: number,
  sourceX: number,
  sourceY: number,
  targetMapId: number,
  targetX: number,
  targetY: number,
  count = 1,
): MapOverviewEdge {
  return {
    id,
    sourceMapId,
    sourceX,
    sourceY,
    targetMapId,
    targetX,
    targetY,
    count,
    sources: [] as MapOverviewTransferSource[],
  }
}

describe('mergeBidirectionalMapOverviewEdges', () => {
  it('merges exact endpoint mirrors into one bidirectional unit', () => {
    const forward = makeEdge('a', 1, 5, 6, 2, 10, 11, 2)
    const backward = makeEdge('b', 2, 10, 11, 1, 5, 6, 3)
    const merged = mergeBidirectionalMapOverviewEdges([forward, backward])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      edge: { id: 'a' },
      reverse: { id: 'b' },
      bidirectional: true,
      totalCount: 5,
    })
  })

  it('keeps one-way edges and mismatched coordinates separate', () => {
    const forward = makeEdge('a', 1, 5, 6, 2, 10, 11)
    const oneWay = makeEdge('c', 3, 0, 0, 1, 5, 6)
    // Same maps as `forward` but a different landing spot: not a mirror.
    const nearMiss = makeEdge('d', 2, 10, 12, 1, 5, 6)
    const merged = mergeBidirectionalMapOverviewEdges([forward, oneWay, nearMiss])

    expect(merged).toHaveLength(3)
    expect(merged.every(item => !item.bidirectional && item.reverse === null)).toBe(true)
    expect(merged.map(item => item.totalCount)).toEqual([1, 1, 1])
  })

  it('is deterministic: the first edge in input order stays representative', () => {
    const backward = makeEdge('b', 2, 10, 11, 1, 5, 6)
    const forward = makeEdge('a', 1, 5, 6, 2, 10, 11)
    const merged = mergeBidirectionalMapOverviewEdges([backward, forward])

    expect(merged).toHaveLength(1)
    expect(merged[0]!.edge.id).toBe('b')
    expect(merged[0]!.reverse!.id).toBe('a')
  })

  it('does not pair a self-loop with itself', () => {
    const loop = makeEdge('self', 1, 4, 4, 1, 4, 4)
    const merged = mergeBidirectionalMapOverviewEdges([loop])

    expect(merged).toHaveLength(1)
    expect(merged[0]!.bidirectional).toBe(false)
  })
})
