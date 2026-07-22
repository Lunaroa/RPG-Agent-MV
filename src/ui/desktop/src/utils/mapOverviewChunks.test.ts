import { describe, expect, it } from 'vitest'

import {
  isMapOverviewChunkLevel,
  MAP_OVERVIEW_CHUNK_LEVELS,
  MAP_OVERVIEW_TILE_PX,
  mapOverviewChunkTileRect,
  selectMapOverviewChunkLevel,
  validateMapOverviewChunkUrlParts,
} from './mapOverviewChunks'

describe('mapOverviewChunks', () => {
  it('locks tile pixel size and the allowed downsample level set', () => {
    expect(MAP_OVERVIEW_TILE_PX).toBe(48)
    expect(MAP_OVERVIEW_CHUNK_LEVELS).toEqual([1, 2, 4, 8, 16, 32, 64, 128])
    for (const level of MAP_OVERVIEW_CHUNK_LEVELS) {
      expect(isMapOverviewChunkLevel(level)).toBe(true)
    }
    expect(isMapOverviewChunkLevel(3)).toBe(false)
    expect(isMapOverviewChunkLevel(256)).toBe(false)
  })

  it('uses 16x16 tiles with remainder edge chunks', () => {
    expect(mapOverviewChunkTileRect(20, 18, 0, 0)).toEqual({
      tileX: 0, tileY: 0, tileWidth: 16, tileHeight: 16,
    })
    expect(mapOverviewChunkTileRect(20, 18, 1, 1)).toEqual({
      tileX: 16, tileY: 16, tileWidth: 4, tileHeight: 2,
    })
    expect(() => mapOverviewChunkTileRect(20, 18, 2, 0)).toThrow(/out of range/)
  })

  it('selects only allowed downsample levels from screen density', () => {
    expect(selectMapOverviewChunkLevel(1, 1)).toBe(1)
    expect(selectMapOverviewChunkLevel(0.5, 1)).toBe(2)
    expect(selectMapOverviewChunkLevel(0.01, 1)).toBe(64)
    expect(selectMapOverviewChunkLevel(0.001, 1)).toBe(128)
  })

  it('validates chunk URL path segments and rejects traversal', () => {
    expect(validateMapOverviewChunkUrlParts({
      mapId: '7',
      version: '0123456789abcdefabcd',
      chunkX: '0',
      chunkY: '1',
      levelFile: '4.png',
    })).toEqual({
      mapId: 7,
      version: '0123456789abcdefabcd',
      chunkX: 0,
      chunkY: 1,
      level: 4,
    })
    expect(() => validateMapOverviewChunkUrlParts({
      mapId: '7',
      version: '0123456789abcdefabcd',
      chunkX: '0',
      chunkY: '1',
      levelFile: '../4.png',
    })).toThrow(/level/)
    expect(() => validateMapOverviewChunkUrlParts({
      mapId: '7',
      version: 'not-a-version',
      chunkX: '0',
      chunkY: '1',
      levelFile: '4.png',
    })).toThrow(/version/)
    expect(() => validateMapOverviewChunkUrlParts({
      mapId: '7',
      version: '0123456789abcdefabcd',
      chunkX: '0',
      chunkY: '1',
      levelFile: '3.png',
    })).toThrow(/level/)
  })
})
