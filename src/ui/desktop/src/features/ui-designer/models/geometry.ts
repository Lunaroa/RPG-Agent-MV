import type { UiDesignerDocument, UiGuide, UiNode, UiPoint, UiRect, UiSnapResult, UiViewport } from '@contract/ui-designer'
import { cloneUiDocument, findNode } from './document'

export type UiAlignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'
export type UiDistributionAxis = 'horizontal' | 'vertical'

/** Browser viewport metrics used at the DOM boundary of the canvas. */
export interface UiCanvasViewportFrame {
  left: number
  top: number
  scrollLeft: number
  scrollTop: number
  stageMargin: number
}

const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

/** Convert a client-space pointer into the document's canvas world space. */
export function viewportClientToWorld(point: UiPoint, frame: UiCanvasViewportFrame, viewport: UiViewport): UiPoint {
  const zoom = Math.max(0.01, finiteOr(viewport.zoom, 1))
  const left = finiteOr(frame.left, 0)
  const top = finiteOr(frame.top, 0)
  const scrollLeft = finiteOr(frame.scrollLeft, 0)
  const scrollTop = finiteOr(frame.scrollTop, 0)
  const margin = Math.max(0, finiteOr(frame.stageMargin, 0))
  return {
    x: (finiteOr(point.x, left) - left + scrollLeft - margin - finiteOr(viewport.panX, 0)) / zoom,
    y: (finiteOr(point.y, top) - top + scrollTop - margin - finiteOr(viewport.panY, 0)) / zoom,
  }
}

/** Convert a world-space point into absolute content coordinates of the scroll viewport. */
export function worldPointToViewport(point: UiPoint, frame: Pick<UiCanvasViewportFrame, 'stageMargin'>, viewport: UiViewport): UiPoint {
  const zoom = Math.max(0.01, finiteOr(viewport.zoom, 1))
  return {
    x: Math.max(0, finiteOr(frame.stageMargin, 0)) + finiteOr(viewport.panX, 0) + finiteOr(point.x, 0) * zoom,
    y: Math.max(0, finiteOr(frame.stageMargin, 0)) + finiteOr(viewport.panY, 0) + finiteOr(point.y, 0) * zoom,
  }
}

/** Convert a world rect to content coordinates (before scroll clipping). */
export function worldRectToViewport(rect: UiRect, frame: Pick<UiCanvasViewportFrame, 'stageMargin'>, viewport: UiViewport): UiRect {
  const topLeft = worldPointToViewport({ x: rect.x, y: rect.y }, frame, viewport)
  const zoom = Math.max(0.01, finiteOr(viewport.zoom, 1))
  return { x: topLeft.x, y: topLeft.y, width: Math.max(0, finiteOr(rect.width, 0) * zoom), height: Math.max(0, finiteOr(rect.height, 0) * zoom) }
}

export interface SmartSnapTarget {
  id: string
  rect: UiRect
}

export interface SnapOptions {
  gridEnabled: boolean
  gridSize: number
  smartEnabled: boolean
  sensitivity: number
  guides: UiGuide[]
  canvasWidth?: number
  canvasHeight?: number
  targets?: SmartSnapTarget[]
}

export function nodeRect(node: UiNode): UiRect {
  const width = Math.max(0, Math.abs(node.props.width * (Number.isFinite(node.props.scaleX) ? node.props.scaleX : 1)))
  const height = Math.max(0, Math.abs(node.props.height * (Number.isFinite(node.props.scaleY) ? node.props.scaleY : 1)))
  return {
    x: node.props.x - width * node.props.anchorX,
    y: node.props.y - height * node.props.anchorY,
    width,
    height,
  }
}

/** Select nodes intersecting a world-space rectangle; the root canvas shell is never selectable by default. */
export function nodesIntersectingRect(document: UiDesignerDocument, selection: UiRect, includeRoot = false): string[] {
  return document.nodes.filter((node) => (includeRoot || node.id !== 'node_root')).filter((node) => {
    const rect = nodeRect(node)
    return rect.x < selection.x + selection.width && rect.x + rect.width > selection.x && rect.y < selection.y + selection.height && rect.y + rect.height > selection.y
  }).map((node) => node.id)
}

export function rectCenter(rect: UiRect): UiPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function snapPoint(point: UiPoint, options: SnapOptions): UiSnapResult {
  const safeX = Number.isFinite(point.x) ? point.x : 0
  const safeY = Number.isFinite(point.y) ? point.y : 0
  const sensitivity = Number.isFinite(options.sensitivity) && options.sensitivity >= 0 ? options.sensitivity : 0
  const xCandidates: Array<{ value: number; guide?: UiGuide }> = []
  const yCandidates: Array<{ value: number; guide?: UiGuide }> = []
  if (options.gridEnabled && Number.isFinite(options.gridSize) && options.gridSize > 0) {
    xCandidates.push({ value: Math.round(safeX / options.gridSize) * options.gridSize })
    yCandidates.push({ value: Math.round(safeY / options.gridSize) * options.gridSize })
  }
  if (options.canvasWidth !== undefined && Number.isFinite(options.canvasWidth)) xCandidates.push({ value: options.canvasWidth / 2 })
  if (options.canvasHeight !== undefined && Number.isFinite(options.canvasHeight)) yCandidates.push({ value: options.canvasHeight / 2 })
  for (const guide of options.guides) {
    if (guide.locked || !Number.isFinite(guide.position)) continue
    if (guide.type === 'vertical') xCandidates.push({ value: guide.position, guide })
    else yCandidates.push({ value: guide.position, guide })
  }
  if (options.smartEnabled) {
    for (const target of options.targets ?? []) {
      const rect = target.rect
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) continue
      const center = rectCenter(rect)
      xCandidates.push({ value: rect.x }, { value: rect.x + rect.width }, { value: center.x })
      yCandidates.push({ value: rect.y }, { value: rect.y + rect.height }, { value: center.y })
    }
  }
  const nearest = (current: number, candidates: Array<{ value: number; guide?: UiGuide }>) => candidates.reduce<{ value: number; delta: number; guide?: UiGuide } | undefined>((best, candidate) => {
    const delta = Math.abs(candidate.value - current)
    if (!Number.isFinite(delta) || delta > sensitivity || (best && delta >= best.delta)) return best
    return { value: candidate.value, delta, guide: candidate.guide }
  }, undefined)
  const xSnap = nearest(safeX, xCandidates)
  const ySnap = nearest(safeY, yCandidates)
  const guides = [xSnap?.guide, ySnap?.guide].filter((guide): guide is UiGuide => Boolean(guide))
  const distances = [xSnap?.delta, ySnap?.delta].filter((value): value is number => value !== undefined)
  return { x: xSnap?.value ?? safeX, y: ySnap?.value ?? safeY, snapped: Boolean(xSnap || ySnap), guides, distance: distances.length ? Math.min(...distances) : undefined }
}

export function zoomViewport(viewport: UiViewport, scale: number, anchor: UiPoint = { x: 0, y: 0 }): UiViewport {
  const safeViewportZoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
  const zoom = Math.min(3, Math.max(0.1, Number.isFinite(scale) && scale > 0 ? scale : safeViewportZoom))
  const safeAnchor = { x: Number.isFinite(anchor.x) ? anchor.x : 0, y: Number.isFinite(anchor.y) ? anchor.y : 0 }
  const worldX = (safeAnchor.x - (Number.isFinite(viewport.panX) ? viewport.panX : 0)) / safeViewportZoom
  const worldY = (safeAnchor.y - (Number.isFinite(viewport.panY) ? viewport.panY : 0)) / safeViewportZoom
  return {
    ...viewport,
    zoom,
    panX: safeAnchor.x - worldX * zoom,
    panY: safeAnchor.y - worldY * zoom,
  }
}

export function panViewport(viewport: UiViewport, delta: UiPoint): UiViewport {
  return { ...viewport, panX: viewport.panX + delta.x, panY: viewport.panY + delta.y }
}

export function fitViewport(viewport: UiViewport, canvasWidth: number, canvasHeight: number, padding = 48): UiViewport {
  const width = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 1
  const height = Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : 1
  const viewportWidth = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : width
  const viewportHeight = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : height
  const safePadding = Number.isFinite(padding) && padding >= 0 ? padding : 0
  const zoom = Math.min(3, Math.max(0.1, Math.min((viewportWidth - safePadding * 2) / width, (viewportHeight - safePadding * 2) / height)))
  return { ...viewport, zoom, panX: Math.max(0, (viewportWidth - width * zoom) / 2), panY: Math.max(0, (viewportHeight - height * zoom) / 2) }
}

export function updateNodePosition(document: UiDesignerDocument, nodeId: string, position: UiPoint): UiDesignerDocument {
  const next = cloneUiDocument(document)
  const node = findNode(next, nodeId)
  if (!node) throw new Error(`Unknown node: ${nodeId}`)
  node.props.x = Number.isFinite(position.x) ? position.x : node.props.x
  node.props.y = Number.isFinite(position.y) ? position.y : node.props.y
  return next
}

export function updateNodeRect(document: UiDesignerDocument, nodeId: string, rect: UiRect): UiDesignerDocument {
  const next = cloneUiDocument(document)
  const node = findNode(next, nodeId)
  if (!node) throw new Error(`Unknown node: ${nodeId}`)
  node.props.x = rect.x + rect.width * node.props.anchorX
  node.props.y = rect.y + rect.height * node.props.anchorY
  node.props.width = Math.max(0, rect.width / Math.max(Math.abs(node.props.scaleX), 0.0001))
  node.props.height = Math.max(0, rect.height / Math.max(Math.abs(node.props.scaleY), 0.0001))
  return next
}

export function alignNodes(
  document: UiDesignerDocument,
  ids: readonly string[],
  alignment: UiAlignment,
  reference: 'canvas' | 'selection' = 'selection',
): UiDesignerDocument {
  const next = cloneUiDocument(document)
  const nodes = next.nodes.filter((node) => ids.includes(node.id))
  if (!nodes.length) return next
  const bounds = nodes.reduce<UiRect>((acc, node) => {
    const rect = nodeRect(node)
    return {
      x: Math.min(acc.x, rect.x),
      y: Math.min(acc.y, rect.y),
      width: Math.max(acc.x + acc.width, rect.x + rect.width) - Math.min(acc.x, rect.x),
      height: Math.max(acc.y + acc.height, rect.y + rect.height) - Math.min(acc.y, rect.y),
    }
  }, nodeRect(nodes[0]))
  for (const node of nodes) {
    const rect = nodeRect(node)
    if (alignment === 'left') node.props.x = (reference === 'canvas' ? 0 : bounds.x) + rect.width * node.props.anchorX
    if (alignment === 'centerX') node.props.x = (reference === 'canvas' ? document.canvas.width : bounds.x + bounds.width / 2) - rect.width / 2 + rect.width * node.props.anchorX
    if (alignment === 'right') node.props.x = (reference === 'canvas' ? document.canvas.width : bounds.x + bounds.width) - rect.width + rect.width * node.props.anchorX
    if (alignment === 'top') node.props.y = (reference === 'canvas' ? 0 : bounds.y) + rect.height * node.props.anchorY
    if (alignment === 'centerY') node.props.y = (reference === 'canvas' ? document.canvas.height : bounds.y + bounds.height / 2) - rect.height / 2 + rect.height * node.props.anchorY
    if (alignment === 'bottom') node.props.y = (reference === 'canvas' ? document.canvas.height : bounds.y + bounds.height) - rect.height + rect.height * node.props.anchorY
  }
  return next
}

export function distributeNodes(document: UiDesignerDocument, ids: readonly string[], axis: UiDistributionAxis): UiDesignerDocument {
  const next = cloneUiDocument(document)
  const nodes = next.nodes.filter((node) => ids.includes(node.id))
  if (nodes.length < 3) return next
  const sorted = [...nodes].sort((a, b) => (axis === 'horizontal' ? a.props.x - b.props.x : a.props.y - b.props.y))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const firstRect = nodeRect(first)
  const lastRect = nodeRect(last)
  const firstEdge = axis === 'horizontal' ? firstRect.x : firstRect.y
  const lastEdge = axis === 'horizontal' ? lastRect.x + lastRect.width : lastRect.y + lastRect.height
  const totalSize = sorted.reduce((sum, node) => sum + (axis === 'horizontal' ? nodeRect(node).width : nodeRect(node).height), 0)
  const gap = (lastEdge - firstEdge - totalSize) / (sorted.length - 1)
  let cursor = firstEdge
  for (const node of sorted) {
    if (axis === 'horizontal') node.props.x = cursor + node.props.width * node.props.scaleX * node.props.anchorX
    else node.props.y = cursor + node.props.height * node.props.scaleY * node.props.anchorY
    const rect = nodeRect(node)
    cursor += (axis === 'horizontal' ? rect.width : rect.height) + gap
  }
  return next
}
