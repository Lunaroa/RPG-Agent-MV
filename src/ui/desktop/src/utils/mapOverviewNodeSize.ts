import type { MapOverviewNode } from '@contract/types'

export const MAP_OVERVIEW_TILE_PX = 12
export const MAP_OVERVIEW_LABEL_HEIGHT = 36
/** Bump once when node collision geometry changes; migrate positions per project. */
export const MAP_OVERVIEW_LAYOUT_VERSION = 5

export interface MapOverviewNodeSize {
  width: number
  imageHeight: number
  collisionHeight: number
}

/** Overview thumbnail size: width/height in tiles × 12px. Label below is included in collision. */
export function mapOverviewNodeSize(node: Pick<MapOverviewNode, 'width' | 'height'>): MapOverviewNodeSize {
  const valid = typeof node.width === 'number'
    && Number.isFinite(node.width)
    && node.width > 0
    && typeof node.height === 'number'
    && Number.isFinite(node.height)
    && node.height > 0
  const width = valid ? Math.round(node.width! * MAP_OVERVIEW_TILE_PX) : MAP_OVERVIEW_TILE_PX
  const imageHeight = valid ? Math.round(node.height! * MAP_OVERVIEW_TILE_PX) : MAP_OVERVIEW_TILE_PX
  return {
    width,
    imageHeight,
    collisionHeight: imageHeight + MAP_OVERVIEW_LABEL_HEIGHT,
  }
}

export function mapOverviewNodeDiagonalHalf(size: MapOverviewNodeSize): number {
  return Math.hypot(size.width, size.collisionHeight) / 2
}
