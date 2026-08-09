import type { UiDesignerDocument, UiGuide, UiNode, UiPoint, UiRect, UiSnapResult, UiViewport } from '@contract/ui-designer'
import {
  UI_DESIGNER_PANE_LIMITS,
  normalizeUiDesignerDocumentGeometry,
  normalizeUiDesignerInteger,
  normalizeUiDesignerPaneSize,
  type UiDesignerPane,
} from '@contract/ui-designer-geometry'

export { UI_DESIGNER_PANE_LIMITS, normalizeUiDesignerDocumentGeometry as normalizeDocumentGeometry, normalizeUiDesignerInteger as normalizeGeometryInteger, normalizeUiDesignerPaneSize as normalizePaneSize }
export type { UiDesignerPane }

export type UiAlignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'
export type UiDistributionAxis = 'horizontal' | 'vertical'
export type UiResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface UiResizeModifiers {
  preserveAspect: boolean
  fromCenter: boolean
}

export interface UiSnapRectResult extends UiRect {
  snapped: boolean
  guides: UiGuide[]
  distance?: number
}

const cloneDocument = (document: UiDesignerDocument): UiDesignerDocument => JSON.parse(JSON.stringify(document)) as UiDesignerDocument
const findDocumentNode = (document: UiDesignerDocument, id: string): UiNode | undefined => document.nodes.find((node) => node.id === id)

export function normalizeGeometryPoint(point: UiPoint, fallback: UiPoint = { x: 0, y: 0 }): UiPoint {
  return {
    x: normalizeUiDesignerInteger(point.x, fallback.x),
    y: normalizeUiDesignerInteger(point.y, fallback.y),
  }
}

export function normalizeGeometryRect(rect: UiRect, fallback: UiRect = { x: 0, y: 0, width: 1, height: 1 }): UiRect {
  return {
    x: normalizeUiDesignerInteger(rect.x, fallback.x),
    y: normalizeUiDesignerInteger(rect.y, fallback.y),
    width: normalizeUiDesignerInteger(rect.width, fallback.width, 1),
    height: normalizeUiDesignerInteger(rect.height, fallback.height, 1),
  }
}

export type UiNodeGeometryTransaction =
  | { kind: 'properties'; patch: Partial<Pick<UiNode['props'], 'x' | 'y' | 'width' | 'height'>> }
  | { kind: 'rect'; rect: UiRect }

/** The sole document mutation path for node x/y/width/height. */
export function applyNodeGeometryTransaction(document: UiDesignerDocument, nodeId: string, transaction: UiNodeGeometryTransaction): UiDesignerDocument {
  const next = cloneDocument(document)
  const node = findDocumentNode(next, nodeId)
  if (!node) throw new Error(`Unknown node: ${nodeId}`)
  if (transaction.kind === 'properties') {
    const patch = transaction.patch
    if (patch.x !== undefined) node.props.x = normalizeUiDesignerInteger(patch.x, node.props.x)
    if (patch.y !== undefined) node.props.y = normalizeUiDesignerInteger(patch.y, node.props.y)
    if (patch.width !== undefined) node.props.width = normalizeUiDesignerInteger(patch.width, node.props.width, 1)
    if (patch.height !== undefined) node.props.height = normalizeUiDesignerInteger(patch.height, node.props.height, 1)
    return normalizeUiDesignerDocumentGeometry(next)
  }
  const rect = normalizeGeometryRect(transaction.rect, nodeRect(node))
  const scaleX = Math.max(Math.abs(Number.isFinite(node.props.scaleX) ? node.props.scaleX : 1), 0.0001)
  const scaleY = Math.max(Math.abs(Number.isFinite(node.props.scaleY) ? node.props.scaleY : 1), 0.0001)
  node.props.x = normalizeUiDesignerInteger(rect.x + rect.width * node.props.anchorX, node.props.x)
  node.props.y = normalizeUiDesignerInteger(rect.y + rect.height * node.props.anchorY, node.props.y)
  node.props.width = normalizeUiDesignerInteger(rect.width / scaleX, node.props.width, 1)
  node.props.height = normalizeUiDesignerInteger(rect.height / scaleY, node.props.height, 1)
  return normalizeUiDesignerDocumentGeometry(next)
}

/** Browser viewport metrics used at the DOM boundary of the canvas. */
export interface UiCanvasViewportFrame {
  left: number
  top: number
  scrollLeft: number
  scrollTop: number
  stageMargin: number
}

const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

/** Convert a client-space point into the scroll viewport's content space. */
export function viewportClientToContent(point: UiPoint, frame: Pick<UiCanvasViewportFrame, 'left' | 'top' | 'scrollLeft' | 'scrollTop'>): UiPoint {
  return {
    x: finiteOr(point.x, finiteOr(frame.left, 0)) - finiteOr(frame.left, 0) + finiteOr(frame.scrollLeft, 0),
    y: finiteOr(point.y, finiteOr(frame.top, 0)) - finiteOr(frame.top, 0) + finiteOr(frame.scrollTop, 0),
  }
}

/** Convert scroll viewport content coordinates back to client coordinates. */
export function viewportContentToClient(point: UiPoint, frame: Pick<UiCanvasViewportFrame, 'left' | 'top' | 'scrollLeft' | 'scrollTop'>): UiPoint {
  return {
    x: finiteOr(frame.left, 0) + finiteOr(point.x, 0) - finiteOr(frame.scrollLeft, 0),
    y: finiteOr(frame.top, 0) + finiteOr(point.y, 0) - finiteOr(frame.scrollTop, 0),
  }
}

/** Return the transform-space anchor consumed by zoomViewport. */
export function viewportClientToZoomAnchor(point: UiPoint, frame: UiCanvasViewportFrame): UiPoint {
  const content = viewportClientToContent(point, frame)
  const margin = Math.max(0, finiteOr(frame.stageMargin, 0))
  return { x: content.x - margin, y: content.y - margin }
}

/** Convert a client-space pointer into the document's canvas world space. */
export function viewportClientToWorld(point: UiPoint, frame: UiCanvasViewportFrame, viewport: UiViewport): UiPoint {
  const zoom = Math.max(0.01, finiteOr(viewport.zoom, 1))
  const margin = Math.max(0, finiteOr(frame.stageMargin, 0))
  const content = viewportClientToContent(point, frame)
  return {
    x: (content.x - margin - finiteOr(viewport.panX, 0)) / zoom,
    y: (content.y - margin - finiteOr(viewport.panY, 0)) / zoom,
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

/** Convert a world-space point directly to client coordinates. */
export function worldPointToClient(point: UiPoint, frame: UiCanvasViewportFrame, viewport: UiViewport): UiPoint {
  return viewportContentToClient(worldPointToViewport(point, frame, viewport), frame)
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
  enabled?: boolean
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

interface SnapCandidate {
  value: number
  guide?: UiGuide
}

interface AxisSnap {
  value: number
  delta: number
  guide?: UiGuide
}

function snapCandidates(options: SnapOptions): { x: SnapCandidate[]; y: SnapCandidate[] } {
  const x: SnapCandidate[] = []
  const y: SnapCandidate[] = []
  const pushFinite = (list: SnapCandidate[], value: number, guide?: UiGuide) => {
    if (Number.isFinite(value)) list.push({ value: Math.round(value), guide })
  }
  if (options.canvasWidth !== undefined && Number.isFinite(options.canvasWidth)) {
    pushFinite(x, 0)
    pushFinite(x, options.canvasWidth / 2)
    pushFinite(x, options.canvasWidth)
  }
  if (options.canvasHeight !== undefined && Number.isFinite(options.canvasHeight)) {
    pushFinite(y, 0)
    pushFinite(y, options.canvasHeight / 2)
    pushFinite(y, options.canvasHeight)
  }
  for (const guide of options.guides) {
    if (guide.locked || !Number.isFinite(guide.position)) continue
    pushFinite(guide.type === 'vertical' ? x : y, guide.position, guide)
  }
  if (options.smartEnabled) {
    for (const target of options.targets ?? []) {
      const rect = target.rect
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) continue
      const center = rectCenter(rect)
      pushFinite(x, rect.x)
      pushFinite(x, rect.x + rect.width)
      pushFinite(x, center.x)
      pushFinite(y, rect.y)
      pushFinite(y, rect.y + rect.height)
      pushFinite(y, center.y)
    }
  }
  return { x, y }
}

function nearestAxisSnap(current: number, candidates: SnapCandidate[], sensitivity: number): AxisSnap | undefined {
  return candidates.reduce<AxisSnap | undefined>((best, candidate) => {
    const delta = Math.abs(candidate.value - current)
    if (!Number.isFinite(delta) || delta > sensitivity || (best && delta >= best.delta)) return best
    return { value: candidate.value, delta, guide: candidate.guide }
  }, undefined)
}

function snapAxis(current: number, axis: 'x' | 'y', options: SnapOptions): AxisSnap | undefined {
  const sensitivity = Number.isFinite(options.sensitivity) && options.sensitivity >= 0 ? options.sensitivity : 0
  if (options.gridEnabled && Number.isFinite(options.gridSize) && options.gridSize > 0) {
    const gridValue = Math.round(current / options.gridSize) * options.gridSize
    const gridSnap = nearestAxisSnap(current, [{ value: Math.round(gridValue) }], sensitivity)
    const candidates = snapCandidates(options)[axis]
    return nearestAxisSnap(current, gridSnap ? [{ value: gridSnap.value }, ...candidates] : candidates, sensitivity)
  }
  return nearestAxisSnap(current, snapCandidates(options)[axis], sensitivity)
}

export function snapPoint(point: UiPoint, options: SnapOptions): UiSnapResult {
  const safeX = Number.isFinite(point.x) ? point.x : 0
  const safeY = Number.isFinite(point.y) ? point.y : 0
  if (options.enabled === false) {
    const normalized = normalizeGeometryPoint({ x: safeX, y: safeY })
    return { ...normalized, snapped: false, guides: [] }
  }
  const xSnap = snapAxis(safeX, 'x', options)
  const ySnap = snapAxis(safeY, 'y', options)
  const guides = [xSnap?.guide, ySnap?.guide].filter((guide): guide is UiGuide => Boolean(guide))
  const distances = [xSnap?.delta, ySnap?.delta].filter((value): value is number => value !== undefined)
  const normalized = normalizeGeometryPoint({ x: xSnap?.value ?? safeX, y: ySnap?.value ?? safeY }, { x: safeX, y: safeY })
  return { ...normalized, snapped: Boolean(xSnap || ySnap), guides, distance: distances.length ? Math.min(...distances) : undefined }
}

const activeXEdge = (rect: UiRect, handle: UiResizeHandle): number | undefined => handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : undefined
const activeYEdge = (rect: UiRect, handle: UiResizeHandle): number | undefined => handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : undefined

function resizeFromDimensions(origin: UiRect, handle: UiResizeHandle, width: number, height: number, fromCenter: boolean): UiRect {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const center = rectCenter(origin)
  if (fromCenter) return { x: center.x - safeWidth / 2, y: center.y - safeHeight / 2, width: safeWidth, height: safeHeight }
  const x = handle.includes('w') ? origin.x + origin.width - safeWidth : handle.includes('e') ? origin.x : center.x - safeWidth / 2
  const y = handle.includes('n') ? origin.y + origin.height - safeHeight : handle.includes('s') ? origin.y : center.y - safeHeight / 2
  return { x, y, width: safeWidth, height: safeHeight }
}

/** Resize in node-local axes. Side handles also change the other dimension when aspect is preserved. */
export function resizeRect(origin: UiRect, handle: UiResizeHandle, delta: UiPoint, modifiers: UiResizeModifiers): UiRect {
  const safeOrigin = { ...origin, width: Math.max(1, origin.width), height: Math.max(1, origin.height) }
  const dx = Number.isFinite(delta.x) ? delta.x : 0
  const dy = Number.isFinite(delta.y) ? delta.y : 0
  let width = safeOrigin.width
  let height = safeOrigin.height
  const multiplier = modifiers.fromCenter ? 2 : 1
  if (handle.includes('w')) width -= dx * multiplier
  if (handle.includes('e')) width += dx * multiplier
  if (handle.includes('n')) height -= dy * multiplier
  if (handle.includes('s')) height += dy * multiplier
  width = Math.max(1, width)
  height = Math.max(1, height)
  if (modifiers.preserveAspect) {
    const ratio = safeOrigin.width / safeOrigin.height
    const hasX = handle.includes('w') || handle.includes('e')
    const hasY = handle.includes('n') || handle.includes('s')
    if (hasX && !hasY) height = width / ratio
    else if (hasY && !hasX) width = height * ratio
    else {
      const xScale = width / safeOrigin.width
      const yScale = height / safeOrigin.height
      const scale = Math.abs(xScale - 1) >= Math.abs(yScale - 1) ? xScale : yScale
      width = safeOrigin.width * scale
      height = safeOrigin.height * scale
    }
  }
  return resizeFromDimensions(safeOrigin, handle, Math.max(1, width), Math.max(1, height), modifiers.fromCenter)
}

function deltaForSnappedEdges(origin: UiRect, handle: UiResizeHandle, x?: number, y?: number): UiPoint {
  const originX = activeXEdge(origin, handle)
  const originY = activeYEdge(origin, handle)
  return {
    x: x === undefined || originX === undefined ? 0 : x - originX,
    y: y === undefined || originY === undefined ? 0 : y - originY,
  }
}

/** Snap only the actively dragged resize edges, then reapply the same aspect/center semantics. */
export function snapRect(requested: UiRect, origin: UiRect, handle: UiResizeHandle, modifiers: UiResizeModifiers, options: SnapOptions): UiSnapRectResult {
  if (options.enabled === false) {
    return { ...normalizeGeometryRect(requested, origin), snapped: false, guides: [] }
  }
  const requestedX = activeXEdge(requested, handle)
  const requestedY = activeYEdge(requested, handle)
  const xSnap = requestedX === undefined ? undefined : snapAxis(requestedX, 'x', options)
  const ySnap = requestedY === undefined ? undefined : snapAxis(requestedY, 'y', options)
  let result = requested
  let used: AxisSnap[] = []
  if (!modifiers.preserveAspect) {
    result = resizeRect(origin, handle, deltaForSnappedEdges(origin, handle, xSnap?.value ?? requestedX, ySnap?.value ?? requestedY), modifiers)
    used = [xSnap, ySnap].filter((snap): snap is AxisSnap => Boolean(snap))
  } else if (xSnap || ySnap) {
    const candidates: Array<{ rect: UiRect; snap: AxisSnap; score: number }> = []
    if (xSnap) {
      const rect = resizeRect(origin, handle, deltaForSnappedEdges(origin, handle, xSnap.value, undefined), modifiers)
      const score = Math.hypot((activeXEdge(rect, handle) ?? 0) - (requestedX ?? 0), (activeYEdge(rect, handle) ?? 0) - (requestedY ?? 0))
      candidates.push({ rect, snap: xSnap, score })
    }
    if (ySnap) {
      const rect = resizeRect(origin, handle, deltaForSnappedEdges(origin, handle, undefined, ySnap.value), modifiers)
      const score = Math.hypot((activeXEdge(rect, handle) ?? 0) - (requestedX ?? 0), (activeYEdge(rect, handle) ?? 0) - (requestedY ?? 0))
      candidates.push({ rect, snap: ySnap, score })
    }
    candidates.sort((left, right) => left.score - right.score)
    if (candidates[0]) { result = candidates[0].rect; used = [candidates[0].snap] }
  }
  const normalized = normalizeGeometryRect(result, origin)
  const guides = used.map((snap) => snap.guide).filter((guide): guide is UiGuide => Boolean(guide))
  const distances = used.map((snap) => snap.delta)
  return { ...normalized, snapped: used.length > 0, guides, distance: distances.length ? Math.min(...distances) : undefined }
}

/** Quantize a rotated handle to the closest platform resize cursor. */
export function resizeCursor(handle: UiResizeHandle, rotation = 0): string {
  const baseAngles: Record<UiResizeHandle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }
  const directions = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const
  const normalized = ((baseAngles[handle] + (Number.isFinite(rotation) ? rotation : 0)) % 180 + 180) % 180
  return directions[Math.round(normalized / 45) % directions.length]
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
  return applyNodeGeometryTransaction(document, nodeId, { kind: 'properties', patch: position })
}

export function updateNodeRect(document: UiDesignerDocument, nodeId: string, rect: UiRect): UiDesignerDocument {
  return applyNodeGeometryTransaction(document, nodeId, { kind: 'rect', rect })
}

export function alignNodes(
  document: UiDesignerDocument,
  ids: readonly string[],
  alignment: UiAlignment,
  reference: 'canvas' | 'selection' = 'selection',
): UiDesignerDocument {
  const next = cloneDocument(document)
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
  return normalizeUiDesignerDocumentGeometry(next)
}

export function distributeNodes(document: UiDesignerDocument, ids: readonly string[], axis: UiDistributionAxis): UiDesignerDocument {
  const next = cloneDocument(document)
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
  return normalizeUiDesignerDocumentGeometry(next)
}
