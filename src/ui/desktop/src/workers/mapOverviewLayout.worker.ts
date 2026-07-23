import {
  AntVDagreLayout,
  CircularLayout,
  D3ForceLayout,
  ForceAtlas2Layout,
  GridLayout,
} from '@antv/layout'

import {
  buildMapOverviewLayoutOptions,
  type MapOverviewLibraryLayoutId,
} from '../utils/mapOverviewLayouts'
import { parseMapOverviewLayoutParameters } from '../utils/mapOverviewLayoutParameters'
import type {
  MapOverviewLayoutWorkerRequest,
  MapOverviewLayoutWorkerResponse,
} from '../utils/mapOverviewLayoutWorkerProtocol'

type LayoutCtor = new (options?: Record<string, unknown>) => {
  execute: (
    data: { nodes: unknown[]; edges: unknown[] },
    options?: Record<string, unknown>,
  ) => Promise<void>
  forEachNode: (callback: (node: { id: string | number; x: number; y: number }) => void) => void
  destroy?: () => void
}

const LAYOUT_CTORS: Record<MapOverviewLibraryLayoutId, LayoutCtor> = {
  'force-atlas2': ForceAtlas2Layout as unknown as LayoutCtor,
  'd3-force': D3ForceLayout as unknown as LayoutCtor,
  'antv-dagre': AntVDagreLayout as unknown as LayoutCtor,
  grid: GridLayout as unknown as LayoutCtor,
  circular: CircularLayout as unknown as LayoutCtor,
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<MapOverviewLayoutWorkerRequest>) => void) | null
  postMessage: (response: MapOverviewLayoutWorkerResponse) => void
}

workerScope.onmessage = (event) => {
  const request = event.data
  void execute(request)
}

async function execute(request: MapOverviewLayoutWorkerRequest): Promise<void> {
  const Ctor = LAYOUT_CTORS[request.layoutId]
  const parameters = parseMapOverviewLayoutParameters(request.layoutId, request.parameters)
  const options = buildMapOverviewLayoutOptions(request.layoutId, {
    nodes: request.nodes,
    width: request.width,
    height: request.height,
  }, parameters)
  const layout = new Ctor({ ...options, enableWorker: false })
  try {
    await layout.execute({
      nodes: request.nodes.map((node) => ({
        id: node.id,
        data: {
          mapId: node.mapId,
          layoutSize: [node.width, node.collisionHeight],
        },
        x: node.x,
        y: node.y,
      })),
      edges: request.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: { count: edge.count, weight: edge.count },
      })),
    }, { ...options, enableWorker: false })
    const positions: Record<string, { x: number; y: number }> = {}
    layout.forEachNode((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        throw new Error(`Layout produced an invalid position for node ${String(node.id)}.`)
      }
      positions[String(node.id)] = { x: node.x, y: node.y }
    })
    workerScope.postMessage({ type: 'complete', requestId: request.requestId, positions })
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    layout.destroy?.()
  }
}
