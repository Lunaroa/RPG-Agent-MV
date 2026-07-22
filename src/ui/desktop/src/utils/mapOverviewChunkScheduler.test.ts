import { describe, expect, it } from 'vitest'

import type { MapOverviewNode } from '@contract/types'

import { mapOverviewChunkTileRect } from './mapOverviewChunks'
import {
  expandMapOverviewViewport,
  listMapOverviewChunksForNode,
  mapOverviewChunkKey,
  mapOverviewChunkKeyBelongsToMap,
  parseMapOverviewChunkKey,
  prioritizeMapOverviewChunks,
  shouldRetainStaleMapOverviewChunk,
} from './mapOverviewChunkScheduler'
import { MAP_OVERVIEW_TILE_PX } from './mapOverviewNodeSize'

const VERSION = '0123456789abcdefabcd'

function sampleNode(overrides: Partial<MapOverviewNode> = {}): MapOverviewNode {
  return {
    id: 1,
    name: 'Sample Map A',
    parentId: 0,
    order: 0,
    readState: 'ready',
    width: 20,
    height: 18,
    thumbnailVersion: VERSION,
    incomingCount: 0,
    outgoingCount: 0,
    unresolvedCount: 0,
    issues: [],
    ...overrides,
  }
}

describe('mapOverviewChunkScheduler', () => {
  it('builds a stable chunk cache key from map, version, coords, and level', () => {
    expect(mapOverviewChunkKey(7, VERSION, 1, 2, 4)).toBe(`7:${VERSION}:1:2:4`)
    expect(mapOverviewChunkKey(7, VERSION, 1, 2, 4)).toBe(mapOverviewChunkKey(7, VERSION, 1, 2, 4))
    expect(mapOverviewChunkKey(7, VERSION, 1, 2, 4)).not.toBe(mapOverviewChunkKey(8, VERSION, 1, 2, 4))
    expect(mapOverviewChunkKey(7, VERSION, 1, 2, 4)).not.toBe(mapOverviewChunkKey(7, VERSION, 1, 2, 8))
  })

  it('parses chunk keys with exact mapId segments (no prefix bleed 1→10/11)', () => {
    const key1 = mapOverviewChunkKey(1, VERSION, 0, 0, 4)
    const key10 = mapOverviewChunkKey(10, VERSION, 0, 0, 4)
    const key11 = mapOverviewChunkKey(11, VERSION, 0, 0, 4)
    expect(parseMapOverviewChunkKey(key1)).toEqual({
      mapId: 1, version: VERSION, chunkX: 0, chunkY: 0, level: 4,
    })
    expect(parseMapOverviewChunkKey(key10)?.mapId).toBe(10)
    expect(parseMapOverviewChunkKey('1:not-a-version:0:0:4')).toBeNull()
    expect(parseMapOverviewChunkKey(`1:${VERSION}:0:0`)).toBeNull()
    expect(mapOverviewChunkKeyBelongsToMap(key1, 1)).toBe(true)
    expect(mapOverviewChunkKeyBelongsToMap(key10, 1)).toBe(false)
    expect(mapOverviewChunkKeyBelongsToMap(key11, 1)).toBe(false)
    expect(mapOverviewChunkKeyBelongsToMap(key1, 10)).toBe(false)
    expect(mapOverviewChunkKeyBelongsToMap(`1:${VERSION}:0:0:4-extra`, 1)).toBe(false)
  })

  it('expands the camera by one viewport on each side', () => {
    expect(expandMapOverviewViewport({ x: 100, y: 200, width: 400, height: 300 })).toEqual({
      x: -300,
      y: -100,
      width: 1200,
      height: 900,
    })
  })

  it('returns no chunk requests when thumbnailVersion is missing', () => {
    const node = sampleNode({ thumbnailVersion: null })
    const center = { x: 480, y: 432 }
    const world = { x: 0, y: 0, width: 960, height: 864 }
    expect(listMapOverviewChunksForNode(node, 1, center, world)).toEqual([])
  })

  it('lists intersecting chunks using actual edge remainder sizes', () => {
    // 20×18 tiles → edge chunk (1,0) is only 4 tiles wide (not a full 16).
    const node = sampleNode({ width: 20, height: 18 })
    const center = { x: 480, y: 432 } // places node image at world origin
    const edgeRect = mapOverviewChunkTileRect(20, 18, 1, 0)
    expect(edgeRect).toEqual({ tileX: 16, tileY: 0, tileWidth: 4, tileHeight: 16 })

    const realEdgeLeft = edgeRect.tileX * MAP_OVERVIEW_TILE_PX
    const realEdgeRight = realEdgeLeft + edgeRect.tileWidth * MAP_OVERVIEW_TILE_PX
    expect(realEdgeRight).toBe(960)

    // Viewport only overlapping the real remainder still includes the edge chunk.
    const overlappingEdge = listMapOverviewChunksForNode(
      node,
      1,
      center,
      { x: realEdgeLeft + 1, y: 0, width: 10, height: 100 },
    )
    expect(overlappingEdge).toEqual([
      { mapId: 1, version: VERSION, chunkX: 1, chunkY: 0, level: 1 },
    ])

    // Viewport past the real remainder (would hit a phantom full 16×16) must not include it.
    const pastEdge = listMapOverviewChunksForNode(
      node,
      1,
      center,
      { x: realEdgeRight + 1, y: 0, width: 100, height: 100 },
    )
    expect(pastEdge).toEqual([])
  })

  it('prioritizes viewport chunks before the one-viewport ring and dedupes', () => {
    // Two adjacent 16×16 maps: A centered so its image is [0,768)×[0,768),
    // B immediately to the right [768,1536)×[0,768).
    const nodeA = sampleNode({ id: 1, width: 16, height: 16, name: 'Sample Map A' })
    const nodeB = sampleNode({ id: 2, width: 16, height: 16, name: 'Sample Map B' })
    const positions = {
      '1': { x: 384, y: 384 },
      '2': { x: 1152, y: 384 },
    }
    // Camera covers map A only; expanded ring (one viewport out) also reaches map B.
    const camera = { x: 0, y: 0, width: 767, height: 768 }
    const ordered = prioritizeMapOverviewChunks([nodeA, nodeB], positions, camera, 1, 1)

    expect(ordered[0]).toEqual({
      mapId: 1, version: VERSION, chunkX: 0, chunkY: 0, level: 1,
    })
    expect(ordered.some((item) => item.mapId === 2)).toBe(true)

    const firstB = ordered.findIndex((item) => item.mapId === 2)
    expect(firstB).toBeGreaterThan(0)
    expect(ordered.slice(0, firstB).every((item) => item.mapId === 1)).toBe(true)

    const keys = ordered.map((item) =>
      mapOverviewChunkKey(item.mapId, item.version, item.chunkX, item.chunkY, item.level),
    )
    expect(keys).toEqual([...new Set(keys)])
    expect(keys.filter((key) => key.startsWith('1:')).length).toBe(1)
  })

  it('retains stale levels until the preferred chunk is actually displayed', () => {
    const preferredKeys = new Set([`1:${VERSION}:0:0:4`])
    const preferredCells = new Set([`1:${VERSION}:0:0`])
    expect(shouldRetainStaleMapOverviewChunk({
      entryKey: `1:${VERSION}:0:0:8`,
      entryLevel: 8,
      preferredKeys,
      preferredCells,
      preferredLevel: 4,
      preferredReady: false,
      cellKey: `1:${VERSION}:0:0`,
    })).toBe(true)
    expect(shouldRetainStaleMapOverviewChunk({
      entryKey: `1:${VERSION}:0:0:8`,
      entryLevel: 8,
      preferredKeys,
      preferredCells,
      preferredLevel: 4,
      preferredReady: true,
      cellKey: `1:${VERSION}:0:0`,
    })).toBe(false)
    expect(shouldRetainStaleMapOverviewChunk({
      entryKey: `1:${VERSION}:0:0:8`,
      entryLevel: 8,
      preferredKeys,
      preferredCells: new Set(),
      preferredLevel: 4,
      preferredReady: false,
      cellKey: `1:${VERSION}:0:0`,
    })).toBe(false)
  })
})
