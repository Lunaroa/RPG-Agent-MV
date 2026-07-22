import { describe, expect, it } from 'vitest'

import {
  clampMapOverviewZoom,
  clampMapOverviewZoomPercent,
  formatMapOverviewZoomPercent,
  MAP_OVERVIEW_MAX_ZOOM,
  MAP_OVERVIEW_MIN_ZOOM,
  MAP_OVERVIEW_WHEEL_SENSITIVITY,
  mapOverviewPercentFromZoom,
  mapOverviewZoomFromPercent,
  parseMapOverviewZoomPercent,
} from './mapOverviewViewport'

describe('mapOverviewViewport', () => {
  it('exposes the locked zoom and wheel constants', () => {
    expect(MAP_OVERVIEW_MIN_ZOOM).toBe(0.001)
    expect(MAP_OVERVIEW_MAX_ZOOM).toBe(6)
    expect(MAP_OVERVIEW_WHEEL_SENSITIVITY).toBe(1.65)
  })

  it('clamps zoom between 0.1% and 600%', () => {
    expect(clampMapOverviewZoom(0)).toBe(0.001)
    expect(clampMapOverviewZoom(0.0005)).toBe(0.001)
    expect(clampMapOverviewZoom(1)).toBe(1)
    expect(clampMapOverviewZoom(7)).toBe(6)
    expect(clampMapOverviewZoom(Number.NaN)).toBe(1)
  })

  it('parses and clamps percentage drafts with decimals', () => {
    expect(parseMapOverviewZoomPercent('')).toBeNull()
    expect(parseMapOverviewZoomPercent('  ')).toBeNull()
    expect(parseMapOverviewZoomPercent('abc')).toBeNull()
    expect(parseMapOverviewZoomPercent('0.1')).toBe(0.1)
    expect(parseMapOverviewZoomPercent('12.5')).toBe(12.5)
    expect(clampMapOverviewZoomPercent(0.05)).toBeCloseTo(0.1, 8)
    expect(clampMapOverviewZoomPercent(12.5)).toBe(12.5)
    expect(clampMapOverviewZoomPercent(900)).toBe(600)
  })

  it('formats and converts zoom and percent consistently for input, fit, and wheel', () => {
    expect(mapOverviewZoomFromPercent(0.1)).toBe(0.001)
    expect(mapOverviewZoomFromPercent(600)).toBe(6)
    expect(mapOverviewPercentFromZoom(0.001)).toBeCloseTo(0.1, 8)
    expect(mapOverviewPercentFromZoom(6)).toBe(600)
    expect(formatMapOverviewZoomPercent(1)).toBe('100')
    expect(formatMapOverviewZoomPercent(0.001, 1)).toBe('0.1')
    expect(formatMapOverviewZoomPercent(1.255, 1)).toBe('125.5')
  })
})
