import ELK from 'elkjs/lib/elk-api.js'
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'

interface LayoutRequest {
  requestId: number
  mode: 'layered' | 'incremental'
  nodes: Array<{ id: number; width: number; height: number; position?: { x: number; y: number } }>
  edges: Array<{ id: string; sourceMapId: number; targetMapId: number }>
}

interface LayoutResponse {
  requestId: number
  positions?: Record<string, { x: number; y: number }>
  error?: string
}

const elk = new ELK({
  workerUrl: elkWorkerUrl,
  workerFactory: (url) => new Worker(url || elkWorkerUrl),
})
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  void layout(event.data)
}

async function layout(request: LayoutRequest): Promise<void> {
  try {
    const incremental = request.mode === 'incremental'
    const graph = {
      id: 'root',
      layoutOptions: incremental
        ? {
            'elk.algorithm': 'stress',
            'elk.spacing.nodeNode': '46',
          }
        : {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.spacing.nodeNode': '36',
            'elk.layered.spacing.nodeNodeBetweenLayers': '64',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.separateConnectedComponents': 'true',
          },
      children: request.nodes.map((node) => ({
        id: String(node.id),
        width: node.width,
        height: node.height,
        ...(node.position ? {
          x: node.position.x - node.width / 2,
          y: node.position.y - node.height / 2,
        } : {}),
        ...(incremental && node.position ? { layoutOptions: { 'elk.stress.fixed': 'true' } } : {}),
      })),
      edges: request.edges.map((edge) => ({
        id: edge.id,
        sources: [String(edge.sourceMapId)],
        targets: [String(edge.targetMapId)],
      })),
    }
    const result = await elk.layout(graph as unknown as Parameters<typeof elk.layout>[0])
    const positions = Object.fromEntries((result.children || []).map((node) => [
      node.id,
      {
        x: Number(node.x || 0) + Number(node.width || 0) / 2,
        y: Number(node.y || 0) + Number(node.height || 0) / 2,
      },
    ]))
    postMessage({ requestId: request.requestId, positions } satisfies LayoutResponse)
  } catch (error) {
    postMessage({
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies LayoutResponse)
  }
}
