import type { MapOverviewSnapshot } from '@contract/types'
import type { MapOverviewSvgPosition } from '@contract/map-overview-svg-geometry'

export interface MapOverviewSvgCanvasApi {
  readonly destroyed: boolean
  setScene(
    snapshot: MapOverviewSnapshot,
    imageUrls: ReadonlyMap<number, string>,
    positions?: Record<string, MapOverviewSvgPosition>,
    thumbnailErrors?: ReadonlyMap<number, string>,
  ): Promise<void>
  setThumbnailState(mapId: number, imageUrl: string | null, error: string | null): Promise<void>
  setSize(width: number, height: number): void
  setSelection(nodeId: number | null, edgeId: string | null): void
  getZoom(): number
  getPosition(): [number, number]
  getPositions(): Record<string, MapOverviewSvgPosition>
  getNodePosition(nodeId: string | number): MapOverviewSvgPosition | null
  applyPositions(positions: Record<string, MapOverviewSvgPosition>): Promise<void>
  zoomTo(level: number, animate?: boolean, origin?: [number, number]): Promise<void>
  translateTo(position: [number, number], animate?: boolean): Promise<void>
  fitView(animate?: boolean): Promise<void>
  fitCenter(animate?: boolean): Promise<void>
  focusNode(nodeId: string | number, duration?: number): Promise<void>
  destroy(): void
}
