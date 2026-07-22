import type { MapOverviewLibraryLayoutId } from './mapOverviewLayouts'
import type {
  MapOverviewLayoutEdgeInput,
  MapOverviewLayoutNodeInput,
  MapOverviewLayoutPositions,
} from './mapOverviewLayoutModel'

export interface MapOverviewLayoutWorkerRequest {
  requestId: string
  layoutId: MapOverviewLibraryLayoutId
  nodes: MapOverviewLayoutNodeInput[]
  edges: MapOverviewLayoutEdgeInput[]
  width?: number
  height?: number
}

export interface MapOverviewLayoutWorkerComplete {
  type: 'complete'
  requestId: string
  positions: MapOverviewLayoutPositions
}

export interface MapOverviewLayoutWorkerFailed {
  type: 'error'
  requestId: string
  message: string
}

export type MapOverviewLayoutWorkerResponse =
  | MapOverviewLayoutWorkerComplete
  | MapOverviewLayoutWorkerFailed
