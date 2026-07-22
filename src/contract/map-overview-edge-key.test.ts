import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mapOverviewEdgeAggregateKey } from './map-overview-edge-key.ts'

describe('mapOverviewEdgeAggregateKey', () => {
  it('uses the six-field comma form for direction and self-loops', () => {
    const a = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 3, targetMapId: 4, targetX: 5, targetY: 6,
    })
    const reverse = mapOverviewEdgeAggregateKey({
      sourceMapId: 4, sourceX: 5, sourceY: 6, targetMapId: 1, targetX: 2, targetY: 3,
    })
    const loop = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 3, targetMapId: 1, targetX: 8, targetY: 9,
    })
    assert.equal(a, '1:2,3->4:5,6')
    assert.equal(reverse, '4:5,6->1:2,3')
    assert.equal(loop, '1:2,3->1:8,9')
    assert.notEqual(a, reverse)
  })
})
