import { describe, expect, it } from 'vitest'
import type { MapOverviewNode } from '@contract/types'
import { findMapOverviewMatches } from './mapOverviewSearch'

const nodes = [
  mapNode(7, 'Forest Path'),
  mapNode(12, 'Harbor'),
  mapNode(120, 'Old Harbor'),
]

describe('findMapOverviewMatches', () => {
  it('matches map names without hiding context rules in the query parser', () => {
    expect(findMapOverviewMatches(nodes, 'harbor').map((node) => node.id)).toEqual([12, 120])
  })

  it.each(['12', '012', 'MAP012', 'map00012'])('matches numeric query %s as the same map id', (query) => {
    expect(findMapOverviewMatches(nodes, query).map((node) => node.id)).toEqual([12])
  })

  it('returns no candidates for an empty query', () => {
    expect(findMapOverviewMatches(nodes, '   ')).toEqual([])
  })
})

function mapNode(id: number, name: string): MapOverviewNode {
  return {
    id,
    name,
    parentId: 0,
    order: id,
    readState: 'ready',
    width: 20,
    height: 15,
    thumbnailVersion: null,
    incomingCount: 0,
    outgoingCount: 0,
    unresolvedCount: 0,
    issues: [],
  }
}
