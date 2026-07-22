import { describe, expect, it } from 'vitest'

import {
  MAP_OVERVIEW_LAYOUT_VERSION,
  MAP_OVERVIEW_TILE_PX,
  mapOverviewNodeSize,
} from './mapOverviewNodeSize'

describe('mapOverviewNodeSize', () => {
  it('uses native 48px tile logic size without area scaling caps', () => {
    expect(MAP_OVERVIEW_TILE_PX).toBe(48)
    expect(MAP_OVERVIEW_LAYOUT_VERSION).toBe(4)
    expect(mapOverviewNodeSize({ width: 20, height: 15 })).toEqual({
      width: 960,
      imageHeight: 720,
      collisionHeight: 756,
    })
    expect(mapOverviewNodeSize({ width: 500, height: 500 })).toEqual({
      width: 24_000,
      imageHeight: 24_000,
      collisionHeight: 24_036,
    })
  })

  it('falls back to one tile when dimensions are missing', () => {
    expect(mapOverviewNodeSize({ width: null, height: null })).toEqual({
      width: 48,
      imageHeight: 48,
      collisionHeight: 84,
    })
  })
})
