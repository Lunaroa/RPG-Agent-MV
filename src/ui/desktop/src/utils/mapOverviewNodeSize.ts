import type { MapOverviewNode } from '@contract/types'

export const MAP_OVERVIEW_BASE_NODE_WIDTH = 360
export const MAP_OVERVIEW_BASE_NODE_HEIGHT = 216
export const MAP_OVERVIEW_LABEL_HEIGHT = 32
export const MAP_OVERVIEW_LAYOUT_VERSION = 3

const REFERENCE_MAP_AREA = 60 * 40

export interface MapOverviewNodeSize {
  scale: number
  width: number
  imageHeight: number
  collisionHeight: number
}

export function mapOverviewNodeSize(node: Pick<MapOverviewNode, 'width' | 'height'>): MapOverviewNodeSize {
  const validDimensions = typeof node.width === 'number'
    && Number.isFinite(node.width)
    && node.width > 0
    && typeof node.height === 'number'
    && Number.isFinite(node.height)
    && node.height > 0
  const scale = validDimensions
    ? Math.max(1, Math.min(3, Math.sqrt((node.width! * node.height!) / REFERENCE_MAP_AREA)))
    : 1
  const width = Math.round(MAP_OVERVIEW_BASE_NODE_WIDTH * scale)
  const imageHeight = Math.round(MAP_OVERVIEW_BASE_NODE_HEIGHT * scale)
  return {
    scale,
    width,
    imageHeight,
    collisionHeight: imageHeight + MAP_OVERVIEW_LABEL_HEIGHT,
  }
}
