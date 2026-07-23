import { describe, expect, it } from 'vitest'

import {
  firstMapOverviewThumbnailFailure,
  isMapOverviewThumbnailVersionChanged,
  mapOverviewPreparationPercent,
  validateMapOverviewLayoutNoOverlap,
  validateMapOverviewLayoutPositions,
} from './mapOverviewPreparation'

describe('map overview preparation gate', () => {
  it('reports progress from completed thumbnail attempts', () => {
    expect(mapOverviewPreparationPercent(0, 4)).toBe(0)
    expect(mapOverviewPreparationPercent(1, 4)).toBe(25)
    expect(mapOverviewPreparationPercent(4, 4)).toBe(100)
    expect(() => mapOverviewPreparationPercent(5, 4)).toThrow(/Invalid/)
  })

  it('selects a stable first thumbnail failure and recognizes a stale version', () => {
    const stale = new Error('The map overview thumbnail version changed. Reload the map overview and try again.')
    expect(firstMapOverviewThumbnailFailure([
      { mapId: 8, error: new Error('later') },
      { mapId: 2, error: stale },
    ])).toEqual({ mapId: 2, error: stale })
    expect(firstMapOverviewThumbnailFailure([])).toBeNull()
    expect(isMapOverviewThumbnailVersionChanged(stale)).toBe(true)
    expect(isMapOverviewThumbnailVersionChanged(new Error('decode failed'))).toBe(false)
  })

  it('accepts complete finite layout positions', () => {
    expect(() => validateMapOverviewLayoutPositions(['1', '2'], [
      { id: '1', x: 10, y: 20 },
      { id: '2', x: 30, y: 40 },
    ])).not.toThrow()
  })

  it('rejects incomplete, non-finite, or completely stacked layouts', () => {
    expect(() => validateMapOverviewLayoutPositions(['1', '2'], [
      { id: '1', x: 10, y: 20 },
    ])).toThrow(/every map/)
    expect(() => validateMapOverviewLayoutPositions(['1'], [
      { id: '1', x: Number.NaN, y: 20 },
    ])).toThrow(/non-finite/)
    expect(() => validateMapOverviewLayoutPositions(['1', '2'], [
      { id: '1', x: 10, y: 20 },
      { id: '2', x: 10, y: 20 },
    ])).toThrow(/same position/)
  })

  it('rejects overlapping node rectangles but accepts touching boundaries', () => {
    const nodes = [
      { id: '1', width: 100, height: 80 },
      { id: '2', width: 120, height: 60 },
    ]
    expect(() => validateMapOverviewLayoutNoOverlap(nodes, {
      '1': { x: 0, y: 0 },
      '2': { x: 109, y: 0 },
    })).toThrow(/overlaps/)
    expect(() => validateMapOverviewLayoutNoOverlap(nodes, {
      '1': { x: 0, y: 0 },
      '2': { x: 110, y: 0 },
    })).not.toThrow()
  })
})
