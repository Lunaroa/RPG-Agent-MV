import type { UiDesignerDocument, UiGuide, UiNode, UiPoint, UiRect, UiSnapResult, UiViewport } from '@contract/ui-designer'
import { resolveTreeOrderRanks } from './tree'
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

export function normalizeRotationDegrees(rotation: number): number {
  const safeRotation = Number.isFinite(rotation) ? rotation : 0
  return ((safeRotation % 360) + 360) % 360
}

/** Convert wrapped Fabric angles into the shortest signed per-frame delta. */
export function shortestRotationDelta(previous: number, current: number): number {
  const rawDelta = normalizeRotationDegrees(current) - normalizeRotationDegrees(previous)
  const delta = ((rawDelta + 540) % 360) - 180
  return delta === -180 && rawDelta > 0 ? 180 : delta
}

export function accumulateRotationDegrees(accumulated: number, previousWrapped: number, currentWrapped: number): number {
  const safeAccumulated = Number.isFinite(accumulated) ? accumulated : 0
  return safeAccumulated + shortestRotationDelta(previousWrapped, currentWrapped)
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
  stageOffsetX?: number
  stageOffsetY?: number
}

const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback
const stageOffset = (frame: Pick<UiCanvasViewportFrame, 'stageMargin' | 'stageOffsetX' | 'stageOffsetY'>, axis: 'x' | 'y') => {
  const offset = axis === 'x' ? frame.stageOffsetX : frame.stageOffsetY
  return Math.max(0, finiteOr(offset ?? frame.stageMargin, 0))
}

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
  return { x: content.x - stageOffset(frame, 'x'), y: content.y - stageOffset(frame, 'y') }
}

/** Convert a client-space pointer into the document's canvas world space. */
export function viewportClientToWorld(point: UiPoint, frame: UiCanvasViewportFrame, viewport: UiViewport): UiPoint {
  const zoom = Math.max(0.01, finiteOr(viewport.zoom, 1))
  const content = viewportClientToContent(point, frame)
  return {
    x: (content.x - stageOffset(frame, 'x') - finiteOr(viewport.panX, 0)) / zoom,
    y: (content.y - stageOffset(frame, 'y') - finiteOr(viewport.panY, 0)) / zoom,
  }
}

/** Convert a world-space point into absolute content coordinates of the scroll viewport. */
export function worldPointToViewport(point: UiPoint, frame: Pick<UiCanvasViewportFrame, 'stageMargin' | 'stageOffsetX' | 'stageOffsetY'>, viewport: UiViewport): UiPoint {
  const zoom = Math.max(0.01, finiteOr(viewport.zoom, 1))
  return {
    x: stageOffset(frame, 'x') + finiteOr(viewport.panX, 0) + finiteOr(point.x, 0) * zoom,
    y: stageOffset(frame, 'y') + finiteOr(viewport.panY, 0) + finiteOr(point.y, 0) * zoom,
  }
}

/** Convert a world-space point directly to client coordinates. */
export function worldPointToClient(point: UiPoint, frame: UiCanvasViewportFrame, viewport: UiViewport): UiPoint {
  return viewportContentToClient(worldPointToViewport(point, frame, viewport), frame)
}

/** Convert a world rect to content coordinates (before scroll clipping). */
export function worldRectToViewport(rect: UiRect, frame: Pick<UiCanvasViewportFrame, 'stageMargin' | 'stageOffsetX' | 'stageOffsetY'>, viewport: UiViewport): UiRect {
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

/**
 * Keep an editable node inside a parent that explicitly clips its children.
 * The root canvas never constrains editing: it crops at render time only, so
 * nodes may sit outside the scene while being edited.
 */
export function clampNodeRectToParent(document: UiDesignerDocument, nodeId: string, rect: UiRect, preserveAspect = false): UiRect {
  const node = findDocumentNode(document, nodeId)
  if (!node || node.parentId === null) return normalizeGeometryRect(rect, rect)
  const parent = findDocumentNode(document, node.parentId)
  if (!parent || parent.id === 'node_root' || parent.type !== 'container' || !parent.props.clip) return normalizeGeometryRect(rect, rect)
  const parentRect = nodeRect(parent)
  const requestedWidth = Math.max(1, rect.width)
  const requestedHeight = Math.max(1, rect.height)
  const scale = preserveAspect ? Math.min(1, parentRect.width / requestedWidth, parentRect.height / requestedHeight) : 1
  const width = preserveAspect ? requestedWidth * scale : Math.min(requestedWidth, Math.max(1, parentRect.width))
  const height = preserveAspect ? requestedHeight * scale : Math.min(requestedHeight, Math.max(1, parentRect.height))
  return normalizeGeometryRect({
    x: Math.min(Math.max(parentRect.x, rect.x), parentRect.x + parentRect.width - width),
    y: Math.min(Math.max(parentRect.y, rect.y), parentRect.y + parentRect.height - height),
    width,
    height,
  }, rect)
}

export function clampNodePositionToParent(document: UiDesignerDocument, nodeId: string, position: UiPoint): UiPoint {
  const node = findDocumentNode(document, nodeId)
  if (!node) return normalizeGeometryPoint(position)
  const parent = node.parentId === null ? undefined : findDocumentNode(document, node.parentId)
  if (!parent || parent.id === 'node_root' || parent.type !== 'container' || !parent.props.clip) return normalizeGeometryPoint(position)
  const rect = nodeRect(node)
  const parentRect = nodeRect(parent)
  const requestedX = position.x - rect.width * node.props.anchorX
  const requestedY = position.y - rect.height * node.props.anchorY
  const minimumVisible = 24
  const clampedX = rect.width >= parentRect.width
    ? Math.min(
      Math.max(parentRect.x - rect.width + Math.min(minimumVisible, parentRect.width), requestedX),
      parentRect.x + parentRect.width - Math.min(minimumVisible, parentRect.width),
    )
    : Math.min(Math.max(parentRect.x, requestedX), parentRect.x + parentRect.width - rect.width)
  const clampedY = rect.height >= parentRect.height
    ? Math.min(
      Math.max(parentRect.y - rect.height + Math.min(minimumVisible, parentRect.height), requestedY),
      parentRect.y + parentRect.height - Math.min(minimumVisible, parentRect.height),
    )
    : Math.min(Math.max(parentRect.y, requestedY), parentRect.y + parentRect.height - rect.height)
  return normalizeGeometryPoint({
    x: clampedX + rect.width * node.props.anchorX,
    y: clampedY + rect.height * node.props.anchorY,
  }, position)
}

export function nodeRotationRadians(node: UiNode): number {
  return (Number.isFinite(node.props.rotate) ? node.props.rotate : 0) * Math.PI / 180
}

/** Axis-aligned scene-space bounds of the rotated visual rect; identical to nodeRect when unrotated. */
export function nodeVisualRect(node: UiNode): UiRect {
  const rect = nodeRect(node)
  const theta = nodeRotationRadians(node)
  if (theta % Math.PI === 0) return rect
  const cosine = Math.abs(Math.cos(theta))
  const sine = Math.abs(Math.sin(theta))
  const center = rectCenter(rect)
  const width = rect.width * cosine + rect.height * sine
  const height = rect.width * sine + rect.height * cosine
  return { x: center.x - width / 2, y: center.y - height / 2, width, height }
}

/** Exact scene-space center of a node's visual rect, honoring scale, rotation, and anchor. */
export function nodeVisualCenter(node: UiNode): UiPoint {
  const width = Math.max(1, Math.abs(node.props.width * (Number.isFinite(node.props.scaleX) ? node.props.scaleX : 1)))
  const height = Math.max(1, Math.abs(node.props.height * (Number.isFinite(node.props.scaleY) ? node.props.scaleY : 1)))
  const offsetX = width * (0.5 - node.props.anchorX)
  const offsetY = height * (0.5 - node.props.anchorY)
  const theta = nodeRotationRadians(node)
  const cosine = Math.cos(theta)
  const sine = Math.sin(theta)
  return {
    x: node.props.x + offsetX * cosine - offsetY * sine,
    y: node.props.y + offsetX * sine + offsetY * cosine,
  }
}

export function rotatePointAround(point: UiPoint, center: UiPoint, deltaDegrees: number): UiPoint {
  const safeDelta = Number.isFinite(deltaDegrees) ? deltaDegrees : 0
  if (safeDelta % 360 === 0) return { ...point }
  const theta = safeDelta * Math.PI / 180
  const dx = point.x - center.x
  const dy = point.y - center.y
  const cosine = Math.cos(theta)
  const sine = Math.sin(theta)
  return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine }
}

/**
 * Translate a scene-space pointer into the resize delta of the node's local frame. The delta
 * tracks the pointer only, so driving a dimension to its floor of 1 keeps the gesture live and
 * dragging back out recovers immediately instead of deadlocking on clamped object scale.
 */
export function pointerResizeDelta(node: UiNode, origin: UiRect, handle: UiResizeHandle, pointer: UiPoint, fromCenter: boolean): UiPoint {
  const theta = nodeRotationRadians(node)
  const cosine = Math.cos(theta)
  const sine = Math.sin(theta)
  const dx = pointer.x - node.props.x
  const dy = pointer.y - node.props.y
  const localX = dx * cosine + dy * sine + origin.width * node.props.anchorX
  const localY = -dx * sine + dy * cosine + origin.height * node.props.anchorY
  const centerX = fromCenter ? origin.width / 2 : origin.width
  const centerY = fromCenter ? origin.height / 2 : origin.height
  return {
    x: handle.includes('e') ? localX - centerX : handle.includes('w') ? localX : 0,
    y: handle.includes('s') ? localY - centerY : handle.includes('n') ? localY : 0,
  }
}

/**
 * Rebuild a node rect from resized local dimensions. The anchor displacement is computed in the
 * node's rotated local frame so rotated nodes grow along their own axes instead of drifting
 * diagonally in scene axes.
 */
export function localResizeNodeRect(node: UiNode, origin: UiRect, handle: UiResizeHandle, width: number, height: number, fromCenter: boolean): UiRect {
  const originWidth = Math.max(1, origin.width)
  const originHeight = Math.max(1, origin.height)
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const offsetXShift = fromCenter ? (safeWidth - originWidth) / 2 : handle.includes('w') ? safeWidth - originWidth : 0
  const offsetYShift = fromCenter ? (safeHeight - originHeight) / 2 : handle.includes('n') ? safeHeight - originHeight : 0
  const theta = nodeRotationRadians(node)
  const cosine = Math.cos(theta)
  const sine = Math.sin(theta)
  const anchorOffsetX = safeWidth * node.props.anchorX - offsetXShift - originWidth * node.props.anchorX
  const anchorOffsetY = safeHeight * node.props.anchorY - offsetYShift - originHeight * node.props.anchorY
  const anchorX = node.props.x + anchorOffsetX * cosine - anchorOffsetY * sine
  const anchorY = node.props.y + anchorOffsetX * sine + anchorOffsetY * cosine
  return {
    x: anchorX - safeWidth * node.props.anchorX,
    y: anchorY - safeHeight * node.props.anchorY,
    width: safeWidth,
    height: safeHeight,
  }
}

/**
 * Scale a container's descendants with its resized bounds: positions and dimensions map through
 * the container's local frame, so children keep their relative placement for any rotation.
 */
export function scaleSubtreeRects(document: UiDesignerDocument, subtreeIds: readonly string[], nodeId: string, origin: UiRect, final: UiRect, handle: UiResizeHandle, fromCenter: boolean): Record<string, UiRect> {
  const node = findDocumentNode(document, nodeId)
  if (!node) return {}
  const originWidth = Math.max(1, origin.width)
  const originHeight = Math.max(1, origin.height)
  const finalWidth = Math.max(1, final.width)
  const finalHeight = Math.max(1, final.height)
  const scaleX = finalWidth / originWidth
  const scaleY = finalHeight / originHeight
  const offsetXShift = fromCenter ? (finalWidth - originWidth) / 2 : handle.includes('w') ? finalWidth - originWidth : 0
  const offsetYShift = fromCenter ? (finalHeight - originHeight) / 2 : handle.includes('n') ? finalHeight - originHeight : 0
  const theta = nodeRotationRadians(node)
  const cosine = Math.cos(theta)
  const sine = Math.sin(theta)
  const anchorOffsetX = finalWidth * node.props.anchorX - offsetXShift - originWidth * node.props.anchorX
  const anchorOffsetY = finalHeight * node.props.anchorY - offsetYShift - originHeight * node.props.anchorY
  const anchorX = node.props.x + anchorOffsetX * cosine - anchorOffsetY * sine
  const anchorY = node.props.y + anchorOffsetX * sine + anchorOffsetY * cosine
  const result: Record<string, UiRect> = {}
  for (const id of subtreeIds) {
    if (id === nodeId) continue
    const child = findDocumentNode(document, id)
    if (!child) continue
    const dx = child.props.x - node.props.x
    const dy = child.props.y - node.props.y
    const localX = (dx * cosine + dy * sine + originWidth * node.props.anchorX) * scaleX
    const localY = (-dx * sine + dy * cosine + originHeight * node.props.anchorY) * scaleY
    const relX = localX - finalWidth * node.props.anchorX
    const relY = localY - finalHeight * node.props.anchorY
    const childAnchorX = anchorX + relX * cosine - relY * sine
    const childAnchorY = anchorY + relX * sine + relY * cosine
    const childRect = nodeRect(child)
    const width = Math.max(1, childRect.width * scaleX)
    const height = Math.max(1, childRect.height * scaleY)
    result[id] = normalizeGeometryRect({
      x: childAnchorX - width * child.props.anchorX,
      y: childAnchorY - height * child.props.anchorY,
      width,
      height,
    }, childRect)
  }
  return result
}

export interface UiSubtreeRotationDrafts {
  positions: Record<string, UiPoint>
  rotations: Record<string, number>
}

/**
 * Rotate a node's subtree around the node's visual center. Every member's anchor rotates rigidly
 * around that center and gains the same angle delta, matching the runtime's absolute-coordinate
 * contract while keeping the group visually coherent.
 */
export function rotateSubtreeTransforms(document: UiDesignerDocument, subtreeIds: readonly string[], nodeId: string, deltaDegrees: number): UiSubtreeRotationDrafts {
  const node = findDocumentNode(document, nodeId)
  const positions: Record<string, UiPoint> = {}
  const rotations: Record<string, number> = {}
  if (!node) return { positions, rotations }
  const center = nodeVisualCenter(node)
  for (const id of subtreeIds) {
    const member = findDocumentNode(document, id)
    if (!member) continue
    const origin = { x: member.props.x, y: member.props.y }
    positions[id] = normalizeGeometryPoint(rotatePointAround(origin, center, deltaDegrees), origin)
    rotations[id] = normalizeUiDesignerInteger(member.props.rotate + deltaDegrees, member.props.rotate)
  }
  return { positions, rotations }
}

/** A clipping container cannot be resized past the current bounds of its direct children. */
export function containContainerChildren(document: UiDesignerDocument, nodeId: string, rect: UiRect): UiRect {
  const node = findDocumentNode(document, nodeId)
  if (!node || node.type !== 'container' || !node.props.clip || !node.children.length) return normalizeGeometryRect(rect, rect)
  const children = node.children.map((id) => findDocumentNode(document, id)).filter((child): child is UiNode => Boolean(child))
  if (!children.length) return normalizeGeometryRect(rect, rect)
  const childRects = children.map(nodeRect)
  const left = Math.min(rect.x, ...childRects.map((child) => child.x))
  const top = Math.min(rect.y, ...childRects.map((child) => child.y))
  const right = Math.max(rect.x + rect.width, ...childRects.map((child) => child.x + child.width))
  const bottom = Math.max(rect.y + rect.height, ...childRects.map((child) => child.y + child.height))
  return normalizeGeometryRect({ x: left, y: top, width: right - left, height: bottom - top }, rect)
}

/** Resolve the visible top-most node under a canvas-space pointer, preferring canonical renderer bounds when available. */
export function topmostNodeAtPoint(
  document: UiDesignerDocument,
  point: UiPoint,
  includeRoot = false,
  renderedBounds?: Record<string, UiRect & { visible?: boolean }>,
): UiNode | undefined {
  const order = resolveTreeOrderRanks(document)
  return document.nodes
    .filter((node) => (includeRoot || node.id !== 'node_root') && node.props.visible !== false && renderedBounds?.[node.id]?.visible !== false)
    .filter((node) => {
      const rect = renderedBounds?.[node.id] ?? nodeRect(node)
      return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
    })
    .sort((left, right) => right.props.zIndex - left.props.zIndex || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))[0]
}

/** Smart-snap peers must share the same parent-local coordinate space and be editable visual targets. */
/**
 * Sibling rects worth snapping to. `excludeIds` removes nodes that move with
 * the drag (the rest of a multi-selection) so a group never snaps onto its
 * own members' pre-drag positions.
 */
export function smartSnapTargetsForNode(document: UiDesignerDocument, nodeId: string, excludeIds: readonly string[] = []): SmartSnapTarget[] {
  const source = findDocumentNode(document, nodeId)
  if (!source) return []
  return document.nodes
    .filter((node) => node.id !== nodeId
      && !excludeIds.includes(node.id)
      && node.id !== 'node_root'
      && node.parentId === source.parentId
      && node.props.visible !== false
      && !node.locked)
    .map((node) => ({ id: node.id, rect: nodeRect(node) }))
}

interface SnapCandidate {
  value: number
  guide?: UiGuide
  source?: 'canvas' | 'node'
  nodeId?: string
}

interface AxisSnap {
  axis: 'x' | 'y'
  value: number
  delta: number
  guide?: UiGuide
  source?: 'canvas' | 'node'
  nodeId?: string
}

/** What one snap hit aligned to, so the canvas can draw transient feedback for it. */
export interface UiSnapHit {
  axis: 'x' | 'y'
  value: number
  source: 'canvas' | 'node' | 'guide'
  guideId?: string
  nodeId?: string
}

export interface UiSnapFeedbackLine {
  axis: 'x' | 'y'
  position: number
  start: number
  end: number
  source: 'canvas' | 'node'
}

export interface UiSnapFeedback {
  lines: UiSnapFeedbackLine[]
  guideIds: string[]
}

export interface UiSnapPointResult extends UiSnapResult {
  hits: UiSnapHit[]
}

function snapCandidates(options: SnapOptions): { x: SnapCandidate[]; y: SnapCandidate[] } {
  const x: SnapCandidate[] = []
  const y: SnapCandidate[] = []
  const pushFinite = (list: SnapCandidate[], value: number, guide?: UiGuide, source?: 'canvas' | 'node', nodeId?: string) => {
    if (Number.isFinite(value)) list.push({ value: Math.round(value), guide, source, nodeId })
  }
  if (options.canvasWidth !== undefined && Number.isFinite(options.canvasWidth)) {
    pushFinite(x, 0, undefined, 'canvas')
    pushFinite(x, options.canvasWidth / 2, undefined, 'canvas')
    pushFinite(x, options.canvasWidth, undefined, 'canvas')
  }
  if (options.canvasHeight !== undefined && Number.isFinite(options.canvasHeight)) {
    pushFinite(y, 0, undefined, 'canvas')
    pushFinite(y, options.canvasHeight / 2, undefined, 'canvas')
    pushFinite(y, options.canvasHeight, undefined, 'canvas')
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
      pushFinite(x, rect.x, undefined, 'node', target.id)
      pushFinite(x, rect.x + rect.width, undefined, 'node', target.id)
      pushFinite(x, center.x, undefined, 'node', target.id)
      pushFinite(y, rect.y, undefined, 'node', target.id)
      pushFinite(y, rect.y + rect.height, undefined, 'node', target.id)
      pushFinite(y, center.y, undefined, 'node', target.id)
    }
  }
  return { x, y }
}

function nearestAxisSnap(current: number, candidates: SnapCandidate[], sensitivity: number): (SnapCandidate & { delta: number }) | undefined {
  return candidates.reduce<(SnapCandidate & { delta: number }) | undefined>((best, candidate) => {
    const delta = Math.abs(candidate.value - current)
    if (!Number.isFinite(delta) || delta > sensitivity || (best && delta >= best.delta)) return best
    return { ...candidate, delta }
  }, undefined)
}

function snapAxis(current: number, axis: 'x' | 'y', options: SnapOptions): AxisSnap | undefined {
  const sensitivity = Number.isFinite(options.sensitivity) && options.sensitivity >= 0 ? options.sensitivity : 0
  const withAxis = (candidate?: SnapCandidate & { delta: number }): AxisSnap | undefined => candidate ? { axis, ...candidate } : undefined
  if (options.gridEnabled && Number.isFinite(options.gridSize) && options.gridSize > 0) {
    const gridValue = Math.round(current / options.gridSize) * options.gridSize
    const gridSnap = nearestAxisSnap(current, [{ value: Math.round(gridValue) }], sensitivity)
    const candidates = snapCandidates(options)[axis]
    return withAxis(nearestAxisSnap(current, gridSnap ? [{ value: gridSnap.value }, ...candidates] : candidates, sensitivity))
  }
  return withAxis(nearestAxisSnap(current, snapCandidates(options)[axis], sensitivity))
}

function snapHitFor(snap: AxisSnap): UiSnapHit | undefined {
  if (snap.guide) return { axis: snap.axis, value: snap.value, source: 'guide', guideId: snap.guide.id }
  if (snap.source) return snap.nodeId ? { axis: snap.axis, value: snap.value, source: snap.source, nodeId: snap.nodeId } : { axis: snap.axis, value: snap.value, source: snap.source }
  return undefined
}

/** Transient world-space feedback for the hits of an active snap: dashed alignment lines plus ruler guides to highlight. */
export function snapFeedbackFor(document: UiDesignerDocument, draggedRect: UiRect, hits: readonly UiSnapHit[]): UiSnapFeedback {
  const lines: UiSnapFeedbackLine[] = []
  const guideIds: string[] = []
  for (const hit of hits) {
    if (hit.source === 'guide') {
      if (hit.guideId) guideIds.push(hit.guideId)
      continue
    }
    let start: number
    let end: number
    if (hit.source === 'node') {
      const target = findDocumentNode(document, hit.nodeId ?? '')
      if (!target) continue
      const rect = nodeRect(target)
      if (hit.axis === 'x') {
        start = Math.min(draggedRect.y, rect.y)
        end = Math.max(draggedRect.y + draggedRect.height, rect.y + rect.height)
      } else {
        start = Math.min(draggedRect.x, rect.x)
        end = Math.max(draggedRect.x + draggedRect.width, rect.x + rect.width)
      }
    } else if (hit.axis === 'x') {
      start = 0
      end = document.canvas.height
    } else {
      start = 0
      end = document.canvas.width
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end - start > 0) lines.push({ axis: hit.axis, position: hit.value, start, end, source: hit.source })
  }
  return { lines, guideIds }
}

export function snapPoint(point: UiPoint, options: SnapOptions): UiSnapPointResult {
  const safeX = Number.isFinite(point.x) ? point.x : 0
  const safeY = Number.isFinite(point.y) ? point.y : 0
  if (options.enabled === false) {
    const normalized = normalizeGeometryPoint({ x: safeX, y: safeY })
    return { ...normalized, snapped: false, guides: [], hits: [] }
  }
  const xSnap = snapAxis(safeX, 'x', options)
  const ySnap = snapAxis(safeY, 'y', options)
  const guides = [xSnap?.guide, ySnap?.guide].filter((guide): guide is UiGuide => Boolean(guide))
  const hits = [xSnap, ySnap].filter((snap): snap is AxisSnap => Boolean(snap)).map(snapHitFor).filter((hit): hit is UiSnapHit => Boolean(hit))
  const distances = [xSnap?.delta, ySnap?.delta].filter((value): value is number => value !== undefined)
  const normalized = normalizeGeometryPoint({ x: xSnap?.value ?? safeX, y: ySnap?.value ?? safeY }, { x: safeX, y: safeY })
  return { ...normalized, snapped: Boolean(xSnap || ySnap), guides, hits, distance: distances.length ? Math.min(...distances) : undefined }
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

/**
 * Align nodes on their rotated visual bounds. The reference edge comes from
 * the selection's visual union (or the canvas); each node is translated so
 * its visual rect lands on the reference, which keeps rotated nodes visually
 * flush instead of aligning their invisible unrotated frames.
 */
export function alignNodes(
  document: UiDesignerDocument,
  ids: readonly string[],
  alignment: UiAlignment,
  reference: 'canvas' | 'selection' | 'parent' = 'selection',
): UiDesignerDocument {
  const next = cloneDocument(document)
  const nodes = next.nodes.filter((node) => ids.includes(node.id))
  if (!nodes.length) return next
  const rects = nodes.map((node) => nodeVisualRect(node))
  const bounds = rects.reduce<UiRect>((acc, rect) => ({
    x: Math.min(acc.x, rect.x),
    y: Math.min(acc.y, rect.y),
    width: Math.max(acc.x + acc.width, rect.x + rect.width) - Math.min(acc.x, rect.x),
    height: Math.max(acc.y + acc.height, rect.y + rect.height) - Math.min(acc.y, rect.y),
  }), rects[0])
  const canvasRect: UiRect = { x: 0, y: 0, width: document.canvas.width, height: document.canvas.height }
  const referenceRectFor = (node: UiNode): UiRect => {
    if (reference === 'canvas') return canvasRect
    if (reference === 'selection') return bounds
    const parent = node.parentId === null ? undefined : findDocumentNode(next, node.parentId)
    if (!parent || parent.id === 'node_root') return canvasRect
    return nodeVisualRect(parent)
  }
  nodes.forEach((node, index) => {
    const rect = rects[index]
    const target = referenceRectFor(node)
    if (alignment === 'left') node.props.x += target.x - rect.x
    if (alignment === 'centerX') node.props.x += target.x + target.width / 2 - (rect.x + rect.width / 2)
    if (alignment === 'right') node.props.x += target.x + target.width - (rect.x + rect.width)
    if (alignment === 'top') node.props.y += target.y - rect.y
    if (alignment === 'centerY') node.props.y += target.y + target.height / 2 - (rect.y + rect.height / 2)
    if (alignment === 'bottom') node.props.y += target.y + target.height - (rect.y + rect.height)
  })
  return normalizeUiDesignerDocumentGeometry(next)
}

/** Distribute even gaps between the nodes' rotated visual bounds along one axis. */
export function distributeNodes(document: UiDesignerDocument, ids: readonly string[], axis: UiDistributionAxis): UiDesignerDocument {
  const next = cloneDocument(document)
  const nodes = next.nodes.filter((node) => ids.includes(node.id))
  if (nodes.length < 3) return next
  const entries = nodes.map((node) => ({ node, rect: nodeVisualRect(node) }))
  const sorted = [...entries].sort((a, b) => (axis === 'horizontal' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
  const lastRect = sorted[sorted.length - 1].rect
  const firstEdge = axis === 'horizontal' ? sorted[0].rect.x : sorted[0].rect.y
  const lastEdge = axis === 'horizontal' ? lastRect.x + lastRect.width : lastRect.y + lastRect.height
  const totalSize = sorted.reduce((sum, entry) => sum + (axis === 'horizontal' ? entry.rect.width : entry.rect.height), 0)
  const gap = (lastEdge - firstEdge - totalSize) / (sorted.length - 1)
  let cursor = firstEdge
  for (const entry of sorted) {
    const start = axis === 'horizontal' ? entry.rect.x : entry.rect.y
    const size = axis === 'horizontal' ? entry.rect.width : entry.rect.height
    if (axis === 'horizontal') entry.node.props.x += cursor - start
    else entry.node.props.y += cursor - start
    cursor += size + gap
  }
  return normalizeUiDesignerDocumentGeometry(next)
}
