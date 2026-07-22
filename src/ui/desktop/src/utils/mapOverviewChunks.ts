import type { MapOverviewChunkLevel } from '@contract/types'

export const MAP_OVERVIEW_CHUNK_TILES = 16
export const MAP_OVERVIEW_TILE_PX = 48
export const MAP_OVERVIEW_CHUNK_LEVELS: readonly MapOverviewChunkLevel[] = [1, 2, 4, 8, 16, 32, 64, 128]

export function isMapOverviewChunkLevel(value: unknown): value is MapOverviewChunkLevel {
  return typeof value === 'number' && (MAP_OVERVIEW_CHUNK_LEVELS as readonly number[]).includes(value)
}

export function mapOverviewChunkTileRect(
  mapWidth: number,
  mapHeight: number,
  chunkX: number,
  chunkY: number,
): { tileX: number; tileY: number; tileWidth: number; tileHeight: number } {
  if (!Number.isInteger(mapWidth) || !Number.isInteger(mapHeight) || mapWidth <= 0 || mapHeight <= 0) {
    throw new Error('Invalid map dimensions for overview chunk.')
  }
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || chunkX < 0 || chunkY < 0) {
    throw new Error('Invalid map overview chunk coordinates.')
  }
  const maxChunkX = Math.ceil(mapWidth / MAP_OVERVIEW_CHUNK_TILES) - 1
  const maxChunkY = Math.ceil(mapHeight / MAP_OVERVIEW_CHUNK_TILES) - 1
  if (chunkX > maxChunkX || chunkY > maxChunkY) throw new Error('Map overview chunk coordinates are out of range.')
  const tileX = chunkX * MAP_OVERVIEW_CHUNK_TILES
  const tileY = chunkY * MAP_OVERVIEW_CHUNK_TILES
  const tileWidth = Math.min(MAP_OVERVIEW_CHUNK_TILES, mapWidth - tileX)
  const tileHeight = Math.min(MAP_OVERVIEW_CHUNK_TILES, mapHeight - tileY)
  if (tileWidth <= 0 || tileHeight <= 0) throw new Error('Map overview chunk has no tiles.')
  return { tileX, tileY, tileWidth, tileHeight }
}

/** Pick the coarsest allowed level whose screen density still covers one CSS pixel. */
export function selectMapOverviewChunkLevel(zoom: number, devicePixelRatio: number): MapOverviewChunkLevel {
  const density = Math.max(1e-6, zoom) * Math.max(1e-6, devicePixelRatio)
  const target = 1 / density
  let chosen: MapOverviewChunkLevel = 1
  for (const level of MAP_OVERVIEW_CHUNK_LEVELS) {
    if (level <= target + 1e-9) chosen = level
  }
  return chosen
}

export function validateMapOverviewChunkUrlParts(parts: {
  mapId: string
  version: string
  chunkX: string
  chunkY: string
  levelFile: string
}): { mapId: number; version: string; chunkX: number; chunkY: number; level: MapOverviewChunkLevel } {
  const mapId = Number(parts.mapId)
  const chunkX = Number(parts.chunkX)
  const chunkY = Number(parts.chunkY)
  const levelRaw = Number(parts.levelFile.replace(/\.png$/i, ''))
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 999) throw new Error('Invalid map overview chunk map id.')
  if (!/^[a-f0-9]{20}$/.test(parts.version)) throw new Error('Invalid map overview chunk version.')
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || chunkX < 0 || chunkY < 0) {
    throw new Error('Invalid map overview chunk coordinates.')
  }
  if (!isMapOverviewChunkLevel(levelRaw) || `${levelRaw}.png` !== parts.levelFile) {
    throw new Error('Invalid map overview chunk level.')
  }
  return { mapId, version: parts.version, chunkX, chunkY, level: levelRaw }
}
