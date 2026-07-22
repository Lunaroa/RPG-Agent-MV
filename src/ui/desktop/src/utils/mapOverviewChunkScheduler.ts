import type { MapOverviewChunkLevel, MapOverviewNode } from '@contract/types'

import {
  MAP_OVERVIEW_CHUNK_TILES,
  isMapOverviewChunkLevel,
  mapOverviewChunkTileRect,
  selectMapOverviewChunkLevel,
} from './mapOverviewChunks'
import { MAP_OVERVIEW_TILE_PX, mapOverviewNodeSize } from './mapOverviewNodeSize'

export interface MapOverviewChunkRequest {
  mapId: number
  version: string
  chunkX: number
  chunkY: number
  level: MapOverviewChunkLevel
}

export interface MapOverviewViewportBox {
  x: number
  y: number
  width: number
  height: number
}

export function mapOverviewChunkKey(
  mapId: number,
  version: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
): string {
  return `${mapId}:${version}:${chunkX}:${chunkY}:${level}`
}

/** Parse a cache key produced by `mapOverviewChunkKey`; rejects prefix-ambiguous map ids. */
export function parseMapOverviewChunkKey(key: string): MapOverviewChunkRequest | null {
  if (typeof key !== 'string' || !key) return null
  const parts = key.split(':')
  if (parts.length !== 5) return null
  const mapId = Number(parts[0])
  const version = parts[1]
  const chunkX = Number(parts[2])
  const chunkY = Number(parts[3])
  const level = Number(parts[4])
  if (!Number.isInteger(mapId) || mapId <= 0) return null
  if (!/^[a-f0-9]{20}$/.test(version)) return null
  if (!Number.isInteger(chunkX) || chunkX < 0 || !Number.isInteger(chunkY) || chunkY < 0) return null
  if (!isMapOverviewChunkLevel(level)) return null
  if (mapOverviewChunkKey(mapId, version, chunkX, chunkY, level) !== key) return null
  return { mapId, version, chunkX, chunkY, level }
}

/** Exact mapId match for a chunk key (never prefix-match map 1 onto 10/11). */
export function mapOverviewChunkKeyBelongsToMap(key: string, mapId: number): boolean {
  if (!Number.isInteger(mapId) || mapId <= 0) return false
  const parsed = parseMapOverviewChunkKey(key)
  return parsed != null && parsed.mapId === mapId
}

/** Expand the camera by one viewport on each side for prefetch. */
export function expandMapOverviewViewport(box: MapOverviewViewportBox): MapOverviewViewportBox {
  return {
    x: box.x - box.width,
    y: box.y - box.height,
    width: box.width * 3,
    height: box.height * 3,
  }
}

export function listMapOverviewChunksForNode(
  node: Pick<MapOverviewNode, 'id' | 'width' | 'height' | 'thumbnailVersion'>,
  level: MapOverviewChunkLevel,
  nodeCenter: { x: number; y: number },
  worldBox: MapOverviewViewportBox,
): MapOverviewChunkRequest[] {
  if (!node.thumbnailVersion) return []
  const size = mapOverviewNodeSize(node)
  if (!node.width || !node.height || node.width <= 0 || node.height <= 0) return []
  const left = nodeCenter.x - size.width / 2
  const top = nodeCenter.y - size.imageHeight / 2
  const right = left + size.width
  const bottom = top + size.imageHeight
  if (right < worldBox.x || bottom < worldBox.y || left > worldBox.x + worldBox.width || top > worldBox.y + worldBox.height) {
    return []
  }
  const maxChunkX = Math.ceil(node.width / MAP_OVERVIEW_CHUNK_TILES) - 1
  const maxChunkY = Math.ceil(node.height / MAP_OVERVIEW_CHUNK_TILES) - 1
  const requests: MapOverviewChunkRequest[] = []
  for (let chunkY = 0; chunkY <= maxChunkY; chunkY += 1) {
    for (let chunkX = 0; chunkX <= maxChunkX; chunkX += 1) {
      const rect = mapOverviewChunkTileRect(node.width, node.height, chunkX, chunkY)
      const chunkLeft = left + rect.tileX * MAP_OVERVIEW_TILE_PX
      const chunkTop = top + rect.tileY * MAP_OVERVIEW_TILE_PX
      const chunkRight = chunkLeft + rect.tileWidth * MAP_OVERVIEW_TILE_PX
      const chunkBottom = chunkTop + rect.tileHeight * MAP_OVERVIEW_TILE_PX
      if (
        chunkRight < worldBox.x
        || chunkBottom < worldBox.y
        || chunkLeft > worldBox.x + worldBox.width
        || chunkTop > worldBox.y + worldBox.height
      ) continue
      requests.push({
        mapId: node.id,
        version: node.thumbnailVersion,
        chunkX,
        chunkY,
        level,
      })
    }
  }
  return requests
}

export function mapOverviewChunkCellKey(
  mapId: number,
  version: string,
  chunkX: number,
  chunkY: number,
): string {
  return `${mapId}:${version}:${chunkX}:${chunkY}`
}

/**
 * Keep a previously displayed (non-preferred) chunk when its cell is still needed
 * and the preferred level is not yet decoded+displayed. Prevents white flashes.
 */
export function shouldRetainStaleMapOverviewChunk(input: {
  entryKey: string
  entryLevel: MapOverviewChunkLevel
  preferredKeys: ReadonlySet<string>
  preferredCells: ReadonlySet<string>
  preferredLevel: MapOverviewChunkLevel | undefined
  preferredReady: boolean
  cellKey: string
}): boolean {
  if (input.preferredKeys.has(input.entryKey)) return true
  if (!input.preferredCells.has(input.cellKey)) return false
  if (input.preferredLevel == null || input.preferredLevel === input.entryLevel) return true
  return !input.preferredReady
}

export function prioritizeMapOverviewChunks(
  nodes: readonly MapOverviewNode[],
  positions: Record<string, { x: number; y: number }>,
  camera: MapOverviewViewportBox,
  zoom: number,
  devicePixelRatio: number,
): MapOverviewChunkRequest[] {
  const level = selectMapOverviewChunkLevel(zoom, devicePixelRatio)
  const primary = camera
  const expanded = expandMapOverviewViewport(camera)
  const seen = new Set<string>()
  const ordered: MapOverviewChunkRequest[] = []
  const pushAll = (box: MapOverviewViewportBox) => {
    for (const node of nodes) {
      const position = positions[String(node.id)]
      if (!position) continue
      for (const request of listMapOverviewChunksForNode(node, level, position, box)) {
        const key = mapOverviewChunkKey(request.mapId, request.version, request.chunkX, request.chunkY, request.level)
        if (seen.has(key)) continue
        seen.add(key)
        ordered.push(request)
      }
    }
  }
  pushAll(primary)
  pushAll(expanded)
  return ordered
}
