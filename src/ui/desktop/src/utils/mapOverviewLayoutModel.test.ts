import { describe, expect, it } from 'vitest'

import type { MapOverviewEdge } from '@contract/types'

import { buildMapOverviewLayoutEdges } from './mapOverviewLayoutModel'

function edge(
  id: string,
  sourceMapId: number,
  targetMapId: number,
  count = 1,
): MapOverviewEdge {
  return {
    id,
    sourceMapId,
    sourceX: 1,
    sourceY: 2,
    targetMapId,
    targetX: 3,
    targetY: 4,
    count,
    sources: [],
  }
}

describe('map overview layout topology', () => {
  it('merges coordinate and reverse edges into one undirected map pair', () => {
    const result = buildMapOverviewLayoutEdges([
      edge('a', 1, 2, 2),
      edge('b', 1, 2, 3),
      edge('c', 2, 1, 4),
      edge('loop', 1, 1, 9),
    ], 'force-atlas2')

    expect(result).toEqual([{
      id: '1--2',
      source: '1',
      target: '2',
      count: 9,
    }])
  })

  it('keeps direction for Dagre while merging coordinates in the same direction', () => {
    const result = buildMapOverviewLayoutEdges([
      edge('a', 1, 2, 2),
      edge('b', 1, 2, 3),
      edge('c', 2, 1, 4),
      edge('loop', 2, 2, 9),
    ], 'antv-dagre')

    expect(result).toEqual([
      { id: '1->2', source: '1', target: '2', count: 5 },
      { id: '2->1', source: '2', target: '1', count: 4 },
    ])
  })
})
