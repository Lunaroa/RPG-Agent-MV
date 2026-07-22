import { describe, expect, it } from 'vitest'

import {
  MAP_OVERVIEW_LAYOUT_VERSION,
  MAP_OVERVIEW_TILE_PX,
  mapOverviewNodeSize,
} from './mapOverviewNodeSize'

describe('mapOverviewNodeSize', () => {
  it('uses the fixed one-quarter 12px tile size without area scaling caps', () => {
    expect(MAP_OVERVIEW_TILE_PX).toBe(12)
    expect(MAP_OVERVIEW_LAYOUT_VERSION).toBe(5)
    expect(mapOverviewNodeSize({ width: 20, height: 15 })).toEqual({
      width: 240,
      imageHeight: 180,
      collisionHeight: 216,
    })
    expect(mapOverviewNodeSize({ width: 500, height: 500 })).toEqual({
      width: 6_000,
      imageHeight: 6_000,
      collisionHeight: 6_036,
    })
  })

  it('falls back to one tile when dimensions are missing', () => {
    expect(mapOverviewNodeSize({ width: null, height: null })).toEqual({
      width: 12,
      imageHeight: 12,
      collisionHeight: 48,
    })
  })
})
