import type {
  MapOverviewLayoutId,
  MapOverviewLayoutParametersById,
  MapOverviewSnapshot,
} from '@contract/types'

import { computeMapOverviewLayeredGrid } from './mapOverviewLayeredGrid'
import {
  buildMapOverviewLayoutEdges,
  buildMapOverviewLayoutNodes,
  type MapOverviewLayoutPositions,
} from './mapOverviewLayoutModel'
import { isMapOverviewLibraryLayoutId } from './mapOverviewLayouts'
import {
  defaultMapOverviewLayoutParameters,
  parseMapOverviewLayoutParameters,
} from './mapOverviewLayoutParameters'
import { runMapOverviewLayoutWorker } from './mapOverviewLayoutWorkerClient'

export interface MapOverviewLayoutRunHandle {
  stop: () => void
}

export async function executeMapOverviewLayout(
  snapshot: Pick<MapOverviewSnapshot, 'nodes' | 'edges'>,
  layoutId: MapOverviewLayoutId,
  options: {
    requestId: string
    seedPositions?: MapOverviewLayoutPositions
    width?: number
    height?: number
    isCancelled?: () => boolean
    onHandle?: (handle: MapOverviewLayoutRunHandle | null) => void
    parameters?: MapOverviewLayoutParametersById[MapOverviewLayoutId]
  },
): Promise<MapOverviewLayoutPositions> {
  const nodes = buildMapOverviewLayoutNodes(snapshot.nodes, options.seedPositions)
  const edges = buildMapOverviewLayoutEdges(snapshot.edges, layoutId)
  if (layoutId === 'layered-grid') {
    const parameters = parseMapOverviewLayoutParameters(
      'layered-grid',
      options.parameters ?? defaultMapOverviewLayoutParameters('layered-grid'),
    )
    return computeMapOverviewLayeredGrid(nodes, edges, {
      width: options.width,
      height: options.height,
      horizontalSpacing: parameters.horizontalSpacing,
      layerSpacing: parameters.layerSpacing,
      groupSpacing: parameters.groupSpacing,
    })
  }
  if (!isMapOverviewLibraryLayoutId(layoutId)) {
    throw new Error(`Unknown map overview layout id: ${String(layoutId)}`)
  }
  const parameters = parseMapOverviewLayoutParameters(
    layoutId,
    options.parameters ?? defaultMapOverviewLayoutParameters(layoutId),
  )
  const run = runMapOverviewLayoutWorker({
    requestId: options.requestId,
    layoutId,
    nodes,
    edges,
    width: options.width,
    height: options.height,
    parameters,
  })
  options.onHandle?.({ stop: run.stop })
  try {
    const positions = await run.promise
    return options.isCancelled?.() ? {} : positions
  } finally {
    options.onHandle?.(null)
  }
}
