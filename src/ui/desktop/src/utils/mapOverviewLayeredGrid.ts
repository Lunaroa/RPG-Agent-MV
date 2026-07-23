import type {
  MapOverviewLayoutEdgeInput,
  MapOverviewLayoutNodeInput,
  MapOverviewLayoutPositions,
} from './mapOverviewLayoutModel'

export const MAP_OVERVIEW_LAYERED_GRID_HORIZONTAL_GAP = 24
export const MAP_OVERVIEW_LAYERED_GRID_LAYER_GAP = 48
export const MAP_OVERVIEW_LAYERED_GRID_COMPONENT_GAP = 96

export type MapOverviewLayeredGridErrorCode =
  | 'duplicate-node'
  | 'invalid-node-size'
  | 'missing-edge-node'
  | 'parent-cycle'

export class MapOverviewLayeredGridError extends Error {
  readonly code: MapOverviewLayeredGridErrorCode

  constructor(
    code: MapOverviewLayeredGridErrorCode,
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = 'MapOverviewLayeredGridError'
  }
}

interface ComponentLayout {
  key: MapOverviewLayoutNodeInput
  width: number
  height: number
  positions: MapOverviewLayoutPositions
}

export interface MapOverviewLayeredGridOptions {
  width?: number
  height?: number
  horizontalSpacing?: number
  layerSpacing?: number
  groupSpacing?: number
}

function compareNodes(left: MapOverviewLayoutNodeInput, right: MapOverviewLayoutNodeInput): number {
  return left.order - right.order || left.mapId - right.mapId
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function connectedComponents(
  nodes: readonly MapOverviewLayoutNodeInput[],
  edges: readonly MapOverviewLayoutEdgeInput[],
): MapOverviewLayoutNodeInput[][] {
  const nodeById = new Map<string, MapOverviewLayoutNodeInput>()
  const adjacency = new Map<string, Set<string>>()
  for (const node of nodes) {
    if (nodeById.has(node.id)) {
      throw new MapOverviewLayeredGridError('duplicate-node', `Duplicate map overview node ${node.id}.`)
    }
    if (!finitePositive(node.width) || !finitePositive(node.collisionHeight)) {
      throw new MapOverviewLayeredGridError('invalid-node-size', `Map overview node ${node.id} has an invalid size.`)
    }
    nodeById.set(node.id, node)
    adjacency.set(node.id, new Set())
  }

  for (const edge of edges) {
    if (edge.source === edge.target) continue
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      throw new MapOverviewLayeredGridError(
        'missing-edge-node',
        `Map overview layout edge ${edge.id} references a missing node.`,
      )
    }
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }

  const visited = new Set<string>()
  const components: MapOverviewLayoutNodeInput[][] = []
  for (const start of [...nodes].sort(compareNodes)) {
    if (visited.has(start.id)) continue
    const queue = [start.id]
    visited.add(start.id)
    const component: MapOverviewLayoutNodeInput[] = []
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor]
      const node = nodeById.get(id)
      if (node) component.push(node)
      const neighbors = [...(adjacency.get(id) || [])]
        .map((neighborId) => nodeById.get(neighborId))
        .filter((neighbor): neighbor is MapOverviewLayoutNodeInput => Boolean(neighbor))
        .sort(compareNodes)
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.id)) continue
        visited.add(neighbor.id)
        queue.push(neighbor.id)
      }
    }
    component.sort(compareNodes)
    components.push(component)
  }
  return components.sort((left, right) => compareNodes(left[0], right[0]))
}

function componentDepths(component: readonly MapOverviewLayoutNodeInput[]): Map<string, number> {
  const nodeById = new Map(component.map((node) => [node.id, node]))
  const state = new Map<string, 'visiting' | 'done'>()
  const depths = new Map<string, number>()

  const resolve = (node: MapOverviewLayoutNodeInput): number => {
    const existing = depths.get(node.id)
    if (existing != null) return existing
    if (state.get(node.id) === 'visiting') {
      throw new MapOverviewLayeredGridError(
        'parent-cycle',
        `Map overview parent hierarchy contains a cycle at map ${node.mapId}.`,
      )
    }
    state.set(node.id, 'visiting')
    const parent = node.parentId > 0 ? nodeById.get(String(node.parentId)) : undefined
    const depth = parent ? resolve(parent) + 1 : 0
    depths.set(node.id, depth)
    state.set(node.id, 'done')
    return depth
  }

  for (const node of component) resolve(node)
  return depths
}

function layoutComponent(
  component: readonly MapOverviewLayoutNodeInput[],
  horizontalSpacing: number,
  layerSpacing: number,
): ComponentLayout {
  const depths = componentDepths(component)
  const rows = new Map<number, MapOverviewLayoutNodeInput[]>()
  for (const node of component) {
    const depth = depths.get(node.id) || 0
    const row = rows.get(depth) || []
    row.push(node)
    rows.set(depth, row)
  }

  const orderedRows = [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, row]) => row.sort(compareNodes))
  const rowMetrics = orderedRows.map((row) => ({
    nodes: row,
    width: row.reduce((sum, node) => sum + node.width, 0)
      + Math.max(0, row.length - 1) * horizontalSpacing,
    height: Math.max(...row.map((node) => node.collisionHeight)),
  }))
  const width = Math.max(...rowMetrics.map((row) => row.width))
  const height = rowMetrics.reduce((sum, row) => sum + row.height, 0)
    + Math.max(0, rowMetrics.length - 1) * layerSpacing
  const positions: MapOverviewLayoutPositions = {}
  let rowTop = 0
  for (const row of rowMetrics) {
    let left = (width - row.width) / 2
    for (const node of row.nodes) {
      positions[node.id] = {
        x: left + node.width / 2,
        y: rowTop + row.height / 2,
      }
      left += node.width + horizontalSpacing
    }
    rowTop += row.height + layerSpacing
  }
  return { key: component[0], width, height, positions }
}

export function computeMapOverviewLayeredGrid(
  nodes: readonly MapOverviewLayoutNodeInput[],
  edges: readonly MapOverviewLayoutEdgeInput[],
  options: MapOverviewLayeredGridOptions = {},
): MapOverviewLayoutPositions {
  if (!nodes.length) return {}
  const horizontalSpacing = options.horizontalSpacing ?? MAP_OVERVIEW_LAYERED_GRID_HORIZONTAL_GAP
  const layerSpacing = options.layerSpacing ?? MAP_OVERVIEW_LAYERED_GRID_LAYER_GAP
  const groupSpacing = options.groupSpacing ?? MAP_OVERVIEW_LAYERED_GRID_COMPONENT_GAP
  const components = connectedComponents(nodes, edges).map(component => (
    layoutComponent(component, horizontalSpacing, layerSpacing)
  ))
  const totalWidth = Math.max(...components.map((component) => component.width))
  const totalHeight = components.reduce((sum, component) => sum + component.height, 0)
    + Math.max(0, components.length - 1) * groupSpacing
  const viewportCenterX = finitePositive(options.width || 0) ? Number(options.width) / 2 : totalWidth / 2
  const viewportCenterY = finitePositive(options.height || 0) ? Number(options.height) / 2 : totalHeight / 2
  const originX = viewportCenterX - totalWidth / 2
  const originY = viewportCenterY - totalHeight / 2
  const positions: MapOverviewLayoutPositions = {}
  let componentTop = originY
  for (const component of components) {
    const componentLeft = originX + (totalWidth - component.width) / 2
    for (const [id, position] of Object.entries(component.positions)) {
      positions[id] = {
        x: componentLeft + position.x,
        y: componentTop + position.y,
      }
    }
    componentTop += component.height + groupSpacing
  }
  return positions
}
