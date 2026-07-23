import { mapOverviewEdgeAggregateKey as sharedMapOverviewEdgeAggregateKey } from '@contract/map-overview-edge-key'

export const MAP_OVERVIEW_PORT_LABEL_HEIGHT = 14
export const MAP_OVERVIEW_PORT_LABEL_MIN_WIDTH = 26
export const MAP_OVERVIEW_PORT_LABEL_HORIZONTAL_PADDING = 4
export const MAP_OVERVIEW_PORT_LABEL_OFFSET_Y = -10
export const MAP_OVERVIEW_PORT_MARKER_RADIUS = 5

const MAP_OVERVIEW_PORT_LABEL_GLYPH_WIDTH = 5.6
const MAP_OVERVIEW_PORT_LABEL_GAP = 2
const MAP_OVERVIEW_PORT_MARKER_CLEARANCE = MAP_OVERVIEW_PORT_MARKER_RADIUS + 1

export interface MapOverviewPortLabelGeometry {
  text: string
  width: number
  height: number
  offsetY: number
  rectY: number
  textY: number
}

export interface MapOverviewPortLabelPlacementInput {
  key: string
  point: { x: number; y: number }
  label: MapOverviewPortLabelGeometry
}

export interface MapOverviewPortLabelPlacement {
  key: string
  x: number
  y: number
  offsetY: number
  shifted: boolean
}

interface MapOverviewPortLabelRect {
  key: string
  left: number
  right: number
  top: number
  bottom: number
}

export function mapOverviewPortLabelGeometry(x: number, y: number): MapOverviewPortLabelGeometry {
  const text = `${x},${y}`
  return {
    text,
    width: Math.max(
      MAP_OVERVIEW_PORT_LABEL_MIN_WIDTH,
      Math.ceil(text.length * MAP_OVERVIEW_PORT_LABEL_GLYPH_WIDTH + MAP_OVERVIEW_PORT_LABEL_HORIZONTAL_PADDING * 2),
    ),
    height: MAP_OVERVIEW_PORT_LABEL_HEIGHT,
    offsetY: MAP_OVERVIEW_PORT_LABEL_OFFSET_Y,
    rectY: -9,
    textY: 1,
  }
}

export function placeMapOverviewPortLabels(
  inputs: readonly MapOverviewPortLabelPlacementInput[],
): ReadonlyMap<string, MapOverviewPortLabelPlacement> {
  const ordered = [...inputs].sort((left, right) => (
    right.point.y - left.point.y
    || left.point.x - right.point.x
    || left.key.localeCompare(right.key)
  ))
  const markerRects = new Map(inputs.map(input => [input.key, {
    key: input.key,
    left: input.point.x - MAP_OVERVIEW_PORT_MARKER_CLEARANCE,
    right: input.point.x + MAP_OVERVIEW_PORT_MARKER_CLEARANCE,
    top: input.point.y - MAP_OVERVIEW_PORT_MARKER_CLEARANCE,
    bottom: input.point.y + MAP_OVERVIEW_PORT_MARKER_CLEARANCE,
  }]))
  const placedRects: MapOverviewPortLabelRect[] = []
  const placements = new Map<string, MapOverviewPortLabelPlacement>()

  for (const input of ordered) {
    const naturalY = input.point.y + input.label.offsetY
    let y = naturalY
    let rect = portLabelRect(input, y)
    let attempts = 0
    while (true) {
      const collisions = [
        ...placedRects.filter(candidate => rectsOverlap(rect, candidate)),
        ...[...markerRects.values()].filter(candidate => (
          candidate.key !== input.key && rectsOverlap(rect, candidate)
        )),
      ]
      if (!collisions.length) break
      const nextBottom = Math.min(...collisions.map(collision => collision.top)) - MAP_OVERVIEW_PORT_LABEL_GAP
      y = nextBottom - input.label.rectY - input.label.height
      rect = portLabelRect(input, y)
      attempts += 1
      if (attempts > inputs.length * 2 + 1) {
        throw new Error('Map overview port labels could not be placed without overlap.')
      }
    }
    placedRects.push(rect)
    placements.set(input.key, {
      key: input.key,
      x: input.point.x,
      y,
      offsetY: y - input.point.y,
      shifted: y !== naturalY,
    })
  }

  return placements
}

function portLabelRect(
  input: MapOverviewPortLabelPlacementInput,
  y: number,
): MapOverviewPortLabelRect {
  return {
    key: input.key,
    left: input.point.x - input.label.width / 2,
    right: input.point.x + input.label.width / 2,
    top: y + input.label.rectY,
    bottom: y + input.label.rectY + input.label.height,
  }
}

function rectsOverlap(left: MapOverviewPortLabelRect, right: MapOverviewPortLabelRect): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
}

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
