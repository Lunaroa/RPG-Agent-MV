import { describe, expect, it } from 'vitest'

import {
  mapOverviewEdgeAggregateKey,
  mapOverviewPortKey,
  mapOverviewPortRelative,
} from './mapOverviewPorts'

describe('mapOverviewPorts', () => {
  it('uses tile centers as relative ports', () => {
    expect(mapOverviewPortRelative(0, 0, 10, 8)).toEqual({ x: 0.05, y: 0.0625 })
    expect(mapOverviewPortRelative(9, 7, 10, 8)).toEqual({ x: 0.95, y: 0.9375 })
    expect(mapOverviewPortKey(3, 4)).toBe('p-3-4')
  })

  it('refuses out-of-bounds coordinates without clamping', () => {
    expect(() => mapOverviewPortRelative(-1, 0, 10, 8)).toThrow(/outside/)
    expect(() => mapOverviewPortRelative(10, 0, 10, 8)).toThrow(/outside/)
    expect(() => mapOverviewPortRelative(0, 8, 10, 8)).toThrow(/outside/)
  })

  it('separates edges by six-field aggregate key including direction and self-loops', () => {
    const a = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 3, targetMapId: 4, targetX: 5, targetY: 6,
    })
    const b = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 4, targetMapId: 4, targetX: 5, targetY: 6,
    })
    const reverse = mapOverviewEdgeAggregateKey({
      sourceMapId: 4, sourceX: 5, sourceY: 6, targetMapId: 1, targetX: 2, targetY: 3,
    })
    const loop = mapOverviewEdgeAggregateKey({
      sourceMapId: 1, sourceX: 2, sourceY: 3, targetMapId: 1, targetX: 8, targetY: 9,
    })
    expect(a).not.toBe(b)
    expect(a).not.toBe(reverse)
    expect(loop).toBe('1:2,3->1:8,9')
    expect(a).toBe('1:2,3->4:5,6')
    expect(reverse).toBe('4:5,6->1:2,3')
  })
})
