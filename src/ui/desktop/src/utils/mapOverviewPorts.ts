import { mapOverviewEdgeAggregateKey as sharedMapOverviewEdgeAggregateKey } from '@contract/map-overview-edge-key'

export function mapOverviewPortRelative(
  x: number,
  y: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  if (!Number.isInteger(mapWidth) || !Number.isInteger(mapHeight) || mapWidth <= 0 || mapHeight <= 0) {
    throw new Error('Map dimensions are required for overview ports.')
  }
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) {
    throw new Error('Transfer coordinates are outside the map; ports are not created.')
  }
  return {
    x: (x + 0.5) / mapWidth,
    y: (y + 0.5) / mapHeight,
  }
}

export function mapOverviewPortKey(x: number, y: number): string {
  return `p-${x}-${y}`
}

/** Re-export the contract SSOT so UI/tests share the same six-field key as the backend. */
export function mapOverviewEdgeAggregateKey(input: {
  sourceMapId: number
  sourceX: number
  sourceY: number
  targetMapId: number
  targetX: number
  targetY: number
}): string {
  return sharedMapOverviewEdgeAggregateKey(input)
}
