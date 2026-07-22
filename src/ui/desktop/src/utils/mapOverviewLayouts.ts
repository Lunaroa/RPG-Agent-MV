import type { MapOverviewLayoutId } from '@contract/types'

export type { MapOverviewLayoutId }

export const DEFAULT_MAP_OVERVIEW_LAYOUT_ID: MapOverviewLayoutId = 'force-atlas2'

/** Worker-safe Expr path: each G6 node must set `data.layoutSize = [width, collisionHeight]`. */
export const MAP_OVERVIEW_LAYOUT_NODE_SIZE_EXPR = 'node.data.layoutSize'

/**
 * Worker-safe grid comparator (G6 / @antv/layout Expr).
 * Bare `sortBy: 'mapId'` is not a field key in @antv/layout 5.x — it becomes a broken Expr.
 */
export const MAP_OVERVIEW_GRID_SORT_BY_EXPR =
  'nodeA.data.mapId < nodeB.data.mapId ? -1 : (nodeA.data.mapId > nodeB.data.mapId ? 1 : 0)'

export const MAP_OVERVIEW_LAYOUT_IDS: readonly MapOverviewLayoutId[] = [
  'force-atlas2',
  'd3-force',
  'antv-dagre',
  'grid',
  'circular',
] as const

export interface MapOverviewLayoutDescriptor {
  id: MapOverviewLayoutId
  /** i18n key stub; locale strings are owned by the main session. */
  labelKey: string
}

export const MAP_OVERVIEW_LAYOUTS: readonly MapOverviewLayoutDescriptor[] = [
  { id: 'force-atlas2', labelKey: 'mapOverview.layout.forceAtlas2' },
  { id: 'd3-force', labelKey: 'mapOverview.layout.d3Force' },
  { id: 'antv-dagre', labelKey: 'mapOverview.layout.antvDagre' },
  { id: 'grid', labelKey: 'mapOverview.layout.grid' },
  { id: 'circular', labelKey: 'mapOverview.layout.circular' },
] as const

/** Confirmation dialog i18n key stubs for applying a new automatic layout. */
export const MAP_OVERVIEW_LAYOUT_CONFIRM_I18N = {
  title: 'mapOverview.layout.confirmTitle',
  body: 'mapOverview.layout.confirmBody',
  apply: 'mapOverview.layout.confirmApply',
  cancel: 'mapOverview.layout.confirmCancel',
} as const

const LAYOUT_ID_SET = new Set<string>(MAP_OVERVIEW_LAYOUT_IDS)

export function isMapOverviewLayoutId(value: unknown): value is MapOverviewLayoutId {
  return typeof value === 'string' && LAYOUT_ID_SET.has(value)
}

export function parseMapOverviewLayoutId(
  value: unknown,
  fallback: MapOverviewLayoutId = DEFAULT_MAP_OVERVIEW_LAYOUT_ID,
): MapOverviewLayoutId {
  return isMapOverviewLayoutId(value) ? value : fallback
}

export interface MapOverviewLayoutNodeRef {
  mapId: number
  width: number
  collisionHeight: number
}

export interface MapOverviewLayoutContext {
  /** Collision geometry for nodes in this run (used for circular radius / dagre gaps). */
  nodes: readonly MapOverviewLayoutNodeRef[]
  width?: number
  height?: number
  /** Extra padding around collision boxes. */
  nodeSpacing?: number
}

/** Payload stored on each G6 node as `data.layoutSize` for worker-safe Expr sizing. */
export function mapOverviewLayoutSizePayload(
  size: Pick<MapOverviewLayoutNodeRef, 'width' | 'collisionHeight'>,
): [number, number] {
  return [size.width, size.collisionHeight]
}

export function compareMapOverviewLayoutByMapId(
  a: Pick<MapOverviewLayoutNodeRef, 'mapId'>,
  b: Pick<MapOverviewLayoutNodeRef, 'mapId'>,
): number {
  return a.mapId - b.mapId
}

/** Sort graph node stubs so circular (ordering: null) follows mapId ascending. */
export function sortMapOverviewLayoutNodesByMapId<T extends { mapId: number }>(nodes: T[]): T[] {
  return [...nodes].sort(compareMapOverviewLayoutByMapId)
}

/**
 * Plain layout option bag shared by Electron main (settings) and renderer.
 * Intentionally has no runtime dependency on `@antv/g6` / `@antv/layout`.
 */
export type MapOverviewG6LayoutOptions = {
  type: MapOverviewLayoutId
  enableWorker: true
  width?: number
  height?: number
  nodeSize?: string
  nodeSpacing?: number
  preventOverlap?: boolean
  barnesHut?: boolean
  collideStrength?: number
  rankdir?: string
  nodesep?: number
  ranksep?: number
  condense?: boolean
  sortBy?: string
  ordering?: null
  radius?: number
  [key: string]: unknown
}

const DEFAULT_NODE_SPACING = 24
const DAGRE_LABEL_GAP = 36

function resolveSpacing(ctx: MapOverviewLayoutContext): number {
  return typeof ctx.nodeSpacing === 'number' && Number.isFinite(ctx.nodeSpacing) && ctx.nodeSpacing >= 0
    ? ctx.nodeSpacing
    : DEFAULT_NODE_SPACING
}

function viewportFields(ctx: MapOverviewLayoutContext): Pick<MapOverviewG6LayoutOptions, 'width' | 'height'> {
  const out: Pick<MapOverviewG6LayoutOptions, 'width' | 'height'> = {}
  if (typeof ctx.width === 'number' && Number.isFinite(ctx.width) && ctx.width > 0) out.width = ctx.width
  if (typeof ctx.height === 'number' && Number.isFinite(ctx.height) && ctx.height > 0) out.height = ctx.height
  return out
}

function averageNodeExtent(nodes: readonly MapOverviewLayoutNodeRef[]): { width: number; height: number } {
  if (!nodes.length) return { width: 48, height: 48 }
  let width = 0
  let height = 0
  for (const node of nodes) {
    width += node.width
    height += node.collisionHeight
  }
  return {
    width: width / nodes.length,
    height: height / nodes.length,
  }
}

/**
 * Circular radius from collision boxes + spacing so adjacent nodes do not sit on top of each other.
 * Matches @antv/layout circular perimeter / (2π) when nodeSpacing is set.
 */
export function computeMapOverviewCircularRadius(
  nodes: readonly MapOverviewLayoutNodeRef[],
  nodeSpacing = DEFAULT_NODE_SPACING,
): number {
  if (!nodes.length) return 200
  let perimeter = 0
  for (const node of nodes) {
    perimeter += Math.max(node.width, node.collisionHeight) + nodeSpacing
  }
  const fromPerimeter = perimeter / (2 * Math.PI)
  const maxHalfDiag = Math.max(
    ...nodes.map((node) => Math.hypot(node.width, node.collisionHeight) / 2),
  )
  return Math.max(fromPerimeter, maxHalfDiag * 1.25, 100)
}

export function buildMapOverviewLayoutOptions(
  id: MapOverviewLayoutId,
  ctx: MapOverviewLayoutContext,
): MapOverviewG6LayoutOptions {
  if (!isMapOverviewLayoutId(id)) {
    throw new Error(`Unknown map overview layout id: ${String(id)}`)
  }
  const spacing = resolveSpacing(ctx)
  const viewport = viewportFields(ctx)
  const sizeAware = {
    nodeSize: MAP_OVERVIEW_LAYOUT_NODE_SIZE_EXPR,
    nodeSpacing: spacing,
  } as const

  switch (id) {
    case 'force-atlas2':
      return {
        type: 'force-atlas2',
        enableWorker: true,
        preventOverlap: true,
        barnesHut: true,
        ...sizeAware,
        ...viewport,
      }
    case 'd3-force':
      return {
        type: 'd3-force',
        enableWorker: true,
        preventOverlap: true,
        collideStrength: 1,
        ...sizeAware,
        ...viewport,
      }
    case 'antv-dagre': {
      // antv-dagre uses nodesep/ranksep (not nodeSpacing). LR: nodesep = vertical, ranksep = horizontal.
      const avg = averageNodeExtent(ctx.nodes)
      return {
        type: 'antv-dagre',
        enableWorker: true,
        rankdir: 'LR',
        nodeSize: MAP_OVERVIEW_LAYOUT_NODE_SIZE_EXPR,
        nodesep: Math.max(spacing, Math.round(avg.height * 0.08)),
        ranksep: Math.max(spacing + DAGRE_LABEL_GAP, Math.round(avg.width * 0.12) + DAGRE_LABEL_GAP),
        ...viewport,
      }
    }
    case 'grid':
      return {
        type: 'grid',
        enableWorker: true,
        preventOverlap: true,
        condense: true,
        sortBy: MAP_OVERVIEW_GRID_SORT_BY_EXPR,
        ...sizeAware,
        ...viewport,
      }
    case 'circular':
      return {
        type: 'circular',
        enableWorker: true,
        // Data order must already be mapId-sorted (see sortMapOverviewLayoutNodesByMapId).
        ordering: null,
        radius: computeMapOverviewCircularRadius(ctx.nodes, spacing),
        ...sizeAware,
        ...viewport,
      }
    default: {
      const _exhaustive: never = id
      throw new Error(`Unhandled map overview layout id: ${String(_exhaustive)}`)
    }
  }
}
