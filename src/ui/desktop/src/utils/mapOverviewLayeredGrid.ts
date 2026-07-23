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
  parentCycles: number[][]
}

export interface MapOverviewLayeredGridOptions {
  width?: number
  height?: number
  horizontalSpacing?: number
  layerSpacing?: number
  groupSpacing?: number
}

export interface MapOverviewLayeredGridResult {
  positions: MapOverviewLayoutPositions
  parentCycles: number[][]
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

function componentDepths(
  component: readonly MapOverviewLayoutNodeInput[],
): { depths: Map<string, number>; parentCycles: number[][] } {
  const nodeById = new Map(component.map((node) => [node.id, node]))
  const indices = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []
  let nextIndex = 0

  const visit = (node: MapOverviewLayoutNodeInput): void => {
    indices.set(node.id, nextIndex)
    lowLinks.set(node.id, nextIndex)
    nextIndex += 1
    stack.push(node.id)
    onStack.add(node.id)
    const parent = node.parentId > 0 ? nodeById.get(String(node.parentId)) : undefined
    if (parent) {
      if (!indices.has(parent.id)) {
        visit(parent)
        lowLinks.set(node.id, Math.min(lowLinks.get(node.id)!, lowLinks.get(parent.id)!))
      } else if (onStack.has(parent.id)) {
        lowLinks.set(node.id, Math.min(lowLinks.get(node.id)!, indices.get(parent.id)!))
      }
    }
    if (lowLinks.get(node.id) !== indices.get(node.id)) return
    const resolved: string[] = []
    while (stack.length) {
      const member = stack.pop()!
      onStack.delete(member)
      resolved.push(member)
      if (member === node.id) break
    }
    resolved.sort((left, right) => compareNodes(nodeById.get(left)!, nodeById.get(right)!))
    components.push(resolved)
  }

  for (const node of [...component].sort(compareNodes)) {
    if (!indices.has(node.id)) visit(node)
  }
  components.sort((left, right) => compareNodes(nodeById.get(left[0])!, nodeById.get(right[0])!))
  const componentByNode = new Map<string, number>()
  components.forEach((members, componentId) => {
    for (const member of members) componentByNode.set(member, componentId)
  })
  const parentComponent = new Map<number, number>()
  for (const node of component) {
    const childComponent = componentByNode.get(node.id)!
    const parent = node.parentId > 0 ? nodeById.get(String(node.parentId)) : undefined
    if (!parent) continue
    const parentId = componentByNode.get(parent.id)!
    if (childComponent !== parentId) parentComponent.set(childComponent, parentId)
  }
  const componentDepths = new Map<number, number>()
  const resolveComponentDepth = (componentId: number): number => {
    const existing = componentDepths.get(componentId)
    if (existing != null) return existing
    const parent = parentComponent.get(componentId)
    const depth = parent == null ? 0 : resolveComponentDepth(parent) + 1
    componentDepths.set(componentId, depth)
    return depth
  }
  const depths = new Map<string, number>()
  components.forEach((members, componentId) => {
    const depth = resolveComponentDepth(componentId)
    for (const member of members) depths.set(member, depth)
  })
  const parentCycles = components
    .filter((members) => (
      members.length > 1
      || nodeById.get(members[0])?.parentId === nodeById.get(members[0])?.mapId
    ))
    .map((members) => members.map((id) => nodeById.get(id)!.mapId))
  return { depths, parentCycles }
}

function layoutComponent(
  component: readonly MapOverviewLayoutNodeInput[],
  horizontalSpacing: number,
  layerSpacing: number,
): ComponentLayout {
  const { depths, parentCycles } = componentDepths(component)
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
  return { key: component[0], width, height, positions, parentCycles }
}

export function computeMapOverviewLayeredGrid(
  nodes: readonly MapOverviewLayoutNodeInput[],
  edges: readonly MapOverviewLayoutEdgeInput[],
  options: MapOverviewLayeredGridOptions = {},
): MapOverviewLayoutPositions {
  return computeMapOverviewLayeredGridResult(nodes, edges, options).positions
}

export function inspectMapOverviewLayeredGridParentCycles(
  nodes: readonly MapOverviewLayoutNodeInput[],
  edges: readonly MapOverviewLayoutEdgeInput[],
): number[][] {
  if (!nodes.length) return []
  return connectedComponents(nodes, edges)
    .flatMap((component) => componentDepths(component).parentCycles)
}

export function computeMapOverviewLayeredGridResult(
  nodes: readonly MapOverviewLayoutNodeInput[],
  edges: readonly MapOverviewLayoutEdgeInput[],
  options: MapOverviewLayeredGridOptions = {},
): MapOverviewLayeredGridResult {
  if (!nodes.length) return { positions: {}, parentCycles: [] }
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
  return {
    positions,
    parentCycles: components.flatMap((component) => component.parentCycles),
  }
}
