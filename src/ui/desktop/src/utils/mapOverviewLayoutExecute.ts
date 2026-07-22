/**
 * Renderer-only G6 layout execution.
 * Must never be imported from Electron main / preload / workspaceSettings / backend.
 */
import {
  AntVDagreLayout,
  CircularLayout,
  D3ForceLayout,
  ForceAtlas2Layout,
  GridLayout,
  type EdgeData,
  type Graph,
  type NodeData,
} from '@antv/g6'

import {
  isMapOverviewLayoutId,
  type MapOverviewG6LayoutOptions,
  type MapOverviewLayoutId,
} from './mapOverviewLayouts'

type LayoutCtor = new (options?: Record<string, unknown>) => {
  execute: (data: { nodes: unknown[]; edges?: unknown[] }, options?: Record<string, unknown>) => Promise<void>
  forEachNode: (cb: (node: { id: string | number; x: number; y: number }) => void) => void
  destroy?: () => void
  stop?: () => void
}

const LAYOUT_CTORS: Record<MapOverviewLayoutId, LayoutCtor> = {
  'force-atlas2': ForceAtlas2Layout as unknown as LayoutCtor,
  'd3-force': D3ForceLayout as unknown as LayoutCtor,
  'antv-dagre': AntVDagreLayout as unknown as LayoutCtor,
  grid: GridLayout as unknown as LayoutCtor,
  circular: CircularLayout as unknown as LayoutCtor,
}

export interface MapOverviewLayoutRunHandle {
  stop: () => void
}

/**
 * G6 5.1.1 `graph.layout()` with `animation:false` does not await iterative+worker execute
 * (it fire-and-forgets execute, then stop/tick). Use setLayout + @antv/layout execute, then
 * apply final positions atomically so ForceAtlas2/D3 workers can be awaited.
 */
export async function executeMapOverviewGraphLayout(
  graph: Graph,
  options: MapOverviewG6LayoutOptions,
  opts?: {
    isCancelled?: () => boolean
    onHandle?: (handle: MapOverviewLayoutRunHandle | null) => void
  },
): Promise<void> {
  if (!isMapOverviewLayoutId(options.type)) {
    throw new Error(`Unknown map overview layout id: ${String(options.type)}`)
  }
  graph.setLayout(options)
  graph.stopLayout()

  const Ctor = LAYOUT_CTORS[options.type]
  const {
    type: _type,
    nodeFilter: _nodeFilter,
    comboFilter: _comboFilter,
    preLayout: _preLayout,
    isLayoutInvisibleNodes: _isLayoutInvisibleNodes,
    ...layoutOptions
  } = options
  const layout = new Ctor({ ...layoutOptions })
  const handle: MapOverviewLayoutRunHandle = {
    stop: () => {
      layout.stop?.()
      layout.destroy?.()
    },
  }
  opts?.onHandle?.(handle)

  const nodes = graph.getNodeData() as NodeData[]
  const edges = graph.getEdgeData() as EdgeData[]
  const data = {
    nodes: nodes.map((node) => ({
      id: String(node.id),
      data: { ...(node.data || {}) },
      x: typeof node.style?.x === 'number' ? node.style.x : undefined,
      y: typeof node.style?.y === 'number' ? node.style.y : undefined,
    })),
    edges: edges.map((edge) => ({
      id: String(edge.id),
      source: String(edge.source),
      target: String(edge.target),
      data: { ...(edge.data || {}) },
    })),
  }

  try {
    await layout.execute(data, { ...layoutOptions })
    if (opts?.isCancelled?.()) return

    const updates: Array<{ id: string; style: { x: number; y: number } }> = []
    layout.forEachNode((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        throw new Error(`Layout produced invalid position for node ${String(node.id)}.`)
      }
      updates.push({ id: String(node.id), style: { x: node.x, y: node.y } })
    })
    if (!updates.length) throw new Error('Layout produced no node positions.')
    if (opts?.isCancelled?.()) return

    graph.updateNodeData(updates)
    await graph.draw()
  } finally {
    layout.destroy?.()
    opts?.onHandle?.(null)
  }
}
