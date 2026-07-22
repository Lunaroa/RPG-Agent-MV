import { describe, expect, it } from 'vitest'

import { MAP_OVERVIEW_LAYOUT_VERSION, mapOverviewNodeSize } from './mapOverviewNodeSize'

describe('mapOverviewNodeSize', () => {
  it('migrates saved positions once for the larger collision boxes', () => {
    expect(MAP_OVERVIEW_LAYOUT_VERSION).toBe(3)
  })

  it('keeps small and unreadable maps at the base node size', () => {
    expect(mapOverviewNodeSize({ width: 20, height: 15 })).toEqual({
      scale: 1,
      width: 360,
      imageHeight: 216,
      collisionHeight: 248,
    })
    expect(mapOverviewNodeSize({ width: null, height: null })).toEqual({
      scale: 1,
      width: 360,
      imageHeight: 216,
      collisionHeight: 248,
    })
  })

  it('grows continuously from the reference area', () => {
    const size = mapOverviewNodeSize({ width: 120, height: 80 })
    expect(size.scale).toBe(2)
    expect(size.width).toBe(720)
    expect(size.imageHeight).toBe(432)
    expect(size.collisionHeight).toBe(464)
  })

  it('caps very large maps at three times the base size', () => {
    expect(mapOverviewNodeSize({ width: 500, height: 500 })).toEqual({
      scale: 3,
      width: 1080,
      imageHeight: 648,
      collisionHeight: 680,
    })
  })
})
