<script setup lang="ts">
import type { MapOverviewEdge, MapOverviewNode, MapOverviewSnapshot } from '@contract/types'
import {
  classifyMapOverviewEdgeConditions,
  MAP_OVERVIEW_TRANSFER_CONDITION_CATEGORIES,
  mapOverviewTransferConditionVisual,
  type MapOverviewTransferConditionCategory,
} from '@contract/map-overview-transfer-condition'
import {
  buildMapOverviewSvgEdgeRoutes,
  mapOverviewSvgEdgeGeometry,
  mapOverviewSvgExportBounds,
  mapOverviewSvgNodeGeometry,
  mapOverviewSvgPortPoint,
  type MapOverviewSvgEdgeGeometry,
  type MapOverviewSvgNodeGeometry,
  type MapOverviewSvgPosition,
} from '@contract/map-overview-svg-geometry'
import { drag, type D3DragEvent } from 'd3-drag'
import { select } from 'd3-selection'
import 'd3-transition'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  MAP_OVERVIEW_MAX_ZOOM,
  MAP_OVERVIEW_MIN_ZOOM,
  MAP_OVERVIEW_WHEEL_SENSITIVITY,
} from '../../utils/mapOverviewViewport'
import {
  buildMapOverviewIncidentEdgeIndex,
  shouldStartMapOverviewNodeDrag,
  shouldStartMapOverviewPan,
} from '../../utils/mapOverviewSvgInteraction'
import type { MapOverviewSvgCanvasApi } from './mapOverviewSvgCanvasApi'

const emit = defineEmits<{
  nodeClick: [mapId: number]
  nodeDblclick: [mapId: number]
  edgeClick: [edgeId: string]
  canvasClick: []
  nodeContextmenu: [payload: { mapId: number; x: number; y: number }]
  nodeDragStart: [payload: { mapId: number; position: MapOverviewSvgPosition }]
  nodeDragEnd: [payload: { mapId: number; before: MapOverviewSvgPosition; after: MapOverviewSvgPosition }]
  viewportChange: []
}>()

const root = ref<HTMLDivElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
const world = ref<SVGGElement | null>(null)
const snapshot = shallowRef<MapOverviewSnapshot | null>(null)
const images = new Map<number, string>()
const thumbnailErrors = new Map<number, string>()
const positions = new Map<number, MapOverviewSvgPosition>()
const renderVersion = ref(0)
const selectedNodeId = ref<number | null>(null)
const selectedEdgeId = ref<string | null>(null)
const hoveredNodeId = ref<number | null>(null)
const hoveredEdgeId = ref<string | null>(null)
const explicitWidth = ref(0)
const explicitHeight = ref(0)
const currentTransform = ref<ZoomTransform>(zoomIdentity)
const gestureState = ref<'idle' | 'node-drag' | 'pan'>('idle')
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null
let resizeObserver: ResizeObserver | null = null
let destroyed = false
let spacePressed = false
let pointerInsideCanvas: boolean = false
let suppressClickUntil = 0
let suppressClickMapId: number | null = null
let panStartTransform: ZoomTransform | null = null
let panMoved = false
let incidentEdgesByMap: ReadonlyMap<number, readonly MapOverviewEdge[]> = new Map()
let nodesById = new Map<number, MapOverviewNode>()
let pendingIncidentMapId: number | null = null
let incidentAnimationFrame = 0

const geometryNodes = computed(() => {
  void renderVersion.value
  const next = snapshot.value
  if (!next) return []
  return next.nodes.map(node => mapOverviewSvgNodeGeometry(
    node,
    positions.get(node.id) || { x: 0, y: 0 },
  ))
})

const geometryNodeMap = computed(() => new Map(geometryNodes.value.map(node => [node.id, node])))
const routes = computed(() => buildMapOverviewSvgEdgeRoutes(snapshot.value?.edges || []))
const geometryEdges = computed(() => {
  const next = snapshot.value
  if (!next) return []
  return next.edges.flatMap(edge => {
    try {
      const condition = classifyMapOverviewEdgeConditions(edge.sources)
      return [{
        edge,
        condition,
        geometry: mapOverviewSvgEdgeGeometry(edge, geometryNodeMap.value, routes.value.get(edge.id)),
      }]
    } catch {
      return []
    }
  })
})

const activeNodeId = computed(() => selectedNodeId.value ?? (selectedEdgeId.value ? null : hoveredNodeId.value))
const activeEdgeId = computed(() => selectedEdgeId.value ?? (selectedNodeId.value == null ? hoveredEdgeId.value : null))
const activeEdgeIds = computed(() => {
  const ids = new Set<string>()
  if (activeEdgeId.value) ids.add(activeEdgeId.value)
  if (activeNodeId.value != null) {
    for (const edge of snapshot.value?.edges || []) {
      if (edge.sourceMapId === activeNodeId.value || edge.targetMapId === activeNodeId.value) ids.add(edge.id)
    }
  }
  return ids
})
const hasFocus = computed(() => selectedNodeId.value != null || selectedEdgeId.value != null)

const focusedNodeIds = computed(() => {
  const ids = new Set<number>()
  if (selectedNodeId.value != null) ids.add(selectedNodeId.value)
  for (const edge of snapshot.value?.edges || []) {
    if ((selectedNodeId.value != null && (edge.sourceMapId === selectedNodeId.value || edge.targetMapId === selectedNodeId.value))
      || edge.id === selectedEdgeId.value) {
      ids.add(edge.sourceMapId)
      ids.add(edge.targetMapId)
    }
  }
  return ids
})

const activePorts = computed(() => {
  const ports = new Map<string, { key: string; mapId: number; x: number; y: number; role: 'source' | 'target' | 'both'; point: MapOverviewSvgPosition }>()
  const mark = (mapId: number, x: number, y: number, role: 'source' | 'target') => {
    const node = geometryNodeMap.value.get(mapId)
    if (!node) return
    try {
      const key = `${mapId}:${x}:${y}`
      const existing = ports.get(key)
      if (existing) {
        if (existing.role !== role) existing.role = 'both'
        return
      }
      ports.set(key, { key, mapId, x, y, role, point: mapOverviewSvgPortPoint(node, x, y) })
    } catch {
      // Invalid coordinates remain represented by the snapshot issue node, not an SVG port.
    }
  }
  for (const edge of snapshot.value?.edges || []) {
    if (!activeEdgeIds.value.has(edge.id)) continue
    mark(edge.sourceMapId, edge.sourceX, edge.sourceY, 'source')
    mark(edge.targetMapId, edge.targetX, edge.targetY, 'target')
  }
  return [...ports.values()]
})

function nodeTransform(node: MapOverviewSvgNodeGeometry): string {
  return `translate(${node.position.x} ${node.position.y})`
}

function labelWidth(node: MapOverviewSvgNodeGeometry): number {
  return node.labelWidth
}

function nodeLabel(node: MapOverviewSvgNodeGeometry): string {
  return `${node.name} MAP${String(node.id).padStart(3, '0')}`
}

function nodeOpacity(nodeId: number): number {
  return hasFocus.value && !focusedNodeIds.value.has(nodeId) ? 0.16 : 1
}

function edgeOpacity(edgeId: string): number {
  if (activeEdgeIds.value.has(edgeId)) return 0
  if (!hasFocus.value) return 1
  return 0.16
}

function edgeMarkerId(category: MapOverviewTransferConditionCategory, active = false): string {
  return `map-overview-arrow-${category}${active ? '-active' : ''}`
}

function edgeAriaLabel(edge: MapOverviewEdge, category: MapOverviewTransferConditionCategory): string {
  return `MAP${String(edge.sourceMapId).padStart(3, '0')} (${edge.sourceX}, ${edge.sourceY}) → MAP${String(edge.targetMapId).padStart(3, '0')} (${edge.targetX}, ${edge.targetY}); ${category}`
}

function edgeVisualStyle(category: MapOverviewTransferConditionCategory): Record<string, string> {
  const visual = mapOverviewTransferConditionVisual(category)
  return {
    stroke: visual.stroke,
    ...(visual.dashArray ? { strokeDasharray: visual.dashArray } : {}),
  }
}

function foregroundEdgeState(edge: MapOverviewEdge): string {
  if (selectedEdgeId.value === edge.id) return 'edge-selected'
  if (hoveredEdgeId.value === edge.id) return 'edge-hovered'
  if (selectedNodeId.value != null
    && (edge.sourceMapId === selectedNodeId.value || edge.targetMapId === selectedNodeId.value)) {
    return 'node-selected'
  }
  if (hoveredNodeId.value != null
    && (edge.sourceMapId === hoveredNodeId.value || edge.targetMapId === hoveredNodeId.value)) {
    return 'node-hovered'
  }
  return ''
}

function onNodeClick(event: MouseEvent, mapId: number): void {
  event.stopPropagation()
  if (performance.now() < suppressClickUntil && suppressClickMapId === mapId) return
  emit('nodeClick', mapId)
}

function onNodeContextmenu(event: MouseEvent, mapId: number): void {
  event.preventDefault()
  event.stopPropagation()
  emit('nodeContextmenu', { mapId, x: event.clientX, y: event.clientY })
}

function onEdgeClick(event: MouseEvent, edgeId: string): void {
  event.stopPropagation()
  if (performance.now() < suppressClickUntil) return
  emit('edgeClick', edgeId)
}

function onCanvasClick(event: MouseEvent): void {
  if (performance.now() < suppressClickUntil) return
  const target = event.target instanceof Element ? event.target : null
  if (!target?.closest('.map-overview-svg-node, .map-overview-svg-edge-hit')) emit('canvasClick')
}

function onNodePointerEnter(mapId: number): void {
  if (gestureState.value !== 'idle') return
  hoveredNodeId.value = selectedNodeId.value == null && !selectedEdgeId.value ? mapId : null
}

function onNodePointerLeave(): void {
  if (gestureState.value !== 'idle') return
  hoveredNodeId.value = null
}

function onEdgePointerEnter(edgeId: string): void {
  if (gestureState.value !== 'idle') return
  hoveredEdgeId.value = selectedNodeId.value == null && !selectedEdgeId.value ? edgeId : null
}

function onEdgePointerLeave(): void {
  if (gestureState.value !== 'idle') return
  hoveredEdgeId.value = null
}

async function setScene(
  next: MapOverviewSnapshot,
  imageUrls: ReadonlyMap<number, string>,
  initialPositions: Record<string, MapOverviewSvgPosition> = {},
  nextThumbnailErrors: ReadonlyMap<number, string> = new Map(),
): Promise<void> {
  snapshot.value = next
  nodesById = new Map(next.nodes.map(node => [node.id, node]))
  incidentEdgesByMap = buildMapOverviewIncidentEdgeIndex(next.edges)
  images.clear()
  for (const [mapId, imageUrl] of imageUrls) images.set(mapId, imageUrl)
  thumbnailErrors.clear()
  for (const [mapId, error] of nextThumbnailErrors) thumbnailErrors.set(mapId, error)
  const validIds = new Set(next.nodes.map(node => node.id))
  for (const id of [...positions.keys()]) if (!validIds.has(id)) positions.delete(id)
  for (const node of next.nodes) {
    const position = initialPositions[String(node.id)] || positions.get(node.id) || { x: 0, y: 0 }
    positions.set(node.id, { x: position.x, y: position.y })
  }
  renderVersion.value += 1
  await nextTick()
  bindNodeDrag()
}

function imageUrl(mapId: number): string | undefined {
  return images.get(mapId)
}

function thumbnailError(mapId: number): string | undefined {
  return thumbnailErrors.get(mapId)
}

async function setThumbnailState(mapId: number, imageUrl: string | null, error: string | null): Promise<void> {
  if (!nodesById.has(mapId)) return
  if (imageUrl) images.set(mapId, imageUrl)
  else images.delete(mapId)
  if (error) thumbnailErrors.set(mapId, error)
  else thumbnailErrors.delete(mapId)
  renderVersion.value += 1
  await nextTick()
  bindNodeDrag()
}

function setSelection(nodeId: number | null, edgeId: string | null): void {
  selectedNodeId.value = nodeId
  selectedEdgeId.value = edgeId
  if (nodeId != null || edgeId) {
    hoveredNodeId.value = null
    hoveredEdgeId.value = null
  }
}

function setSize(width: number, height: number): void {
  explicitWidth.value = Math.max(1, width)
  explicitHeight.value = Math.max(1, height)
}

function getViewportSize(): { width: number; height: number } {
  return {
    width: Math.max(1, explicitWidth.value || root.value?.clientWidth || 1),
    height: Math.max(1, explicitHeight.value || root.value?.clientHeight || 1),
  }
}

function getPositions(): Record<string, MapOverviewSvgPosition> {
  return Object.fromEntries([...positions.entries()].map(([id, position]) => [String(id), { ...position }]))
}

function getNodePosition(nodeId: string | number): MapOverviewSvgPosition | null {
  const position = positions.get(Number(nodeId))
  return position ? { ...position } : null
}

async function applyPositions(nextPositions: Record<string, MapOverviewSvgPosition>): Promise<void> {
  for (const [id, position] of Object.entries(nextPositions)) {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue
    if (positions.has(Number(id))) positions.set(Number(id), { x: position.x, y: position.y })
  }
  renderVersion.value += 1
  await nextTick()
  bindNodeDrag()
}

function applyTransform(transform: ZoomTransform, animate = false, duration = 180): Promise<void> {
  const element = svg.value
  if (!element || !zoomBehavior) return Promise.resolve()
  const selection = select(element)
  if (animate) {
    return new Promise(resolve => {
      selection.transition().duration(duration).call(zoomBehavior!.transform, transform).on('end interrupt', () => resolve())
    })
  }
  selection.call(zoomBehavior.transform, transform)
  return Promise.resolve()
}

function zoomTo(level: number, animate = false, origin?: [number, number]): Promise<void> {
  const clamped = Math.max(MAP_OVERVIEW_MIN_ZOOM, Math.min(MAP_OVERVIEW_MAX_ZOOM, level))
  const point = origin || [getViewportSize().width / 2, getViewportSize().height / 2]
  const current = currentTransform.value
  const graphPoint = current.invert(point)
  const transform = zoomIdentity
    .translate(point[0] - graphPoint[0] * clamped, point[1] - graphPoint[1] * clamped)
    .scale(clamped)
  return applyTransform(transform, animate)
}

function translateTo(position: [number, number], animate = false): Promise<void> {
  const transform = zoomIdentity.translate(position[0], position[1]).scale(currentTransform.value.k)
  return applyTransform(transform, animate)
}

function fitTransform(centerOnly = false): ZoomTransform {
  const nodeMap = geometryNodeMap.value
  const edgeItems = geometryEdges.value.map(item => item.geometry)
  const bounds = mapOverviewSvgExportBounds(nodeMap.values(), edgeItems, 42)
  const viewport = getViewportSize()
  const scale = centerOnly
    ? currentTransform.value.k
    : Math.max(MAP_OVERVIEW_MIN_ZOOM, Math.min(
      MAP_OVERVIEW_MAX_ZOOM,
      Math.min(viewport.width / bounds.width, viewport.height / bounds.height),
    ))
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return zoomIdentity
    .translate(viewport.width / 2 - centerX * scale, viewport.height / 2 - centerY * scale)
    .scale(scale)
}

function fitView(animate = false): Promise<void> {
  return applyTransform(fitTransform(false), animate)
}

function fitCenter(animate = false): Promise<void> {
  return applyTransform(fitTransform(true), animate)
}

function focusNode(nodeId: string | number, duration = 180): Promise<void> {
  const position = positions.get(Number(nodeId))
  if (!position) return Promise.resolve()
  const viewport = getViewportSize()
  const scale = Math.max(currentTransform.value.k, 0.7)
  const transform = zoomIdentity
    .translate(viewport.width / 2 - position.x * scale, viewport.height / 2 - position.y * scale)
    .scale(scale)
  return applyTransform(transform, true, duration)
}

function bindNodeDrag(): void {
  if (!world.value) return
  const behavior = drag<SVGGElement, number>()
    .filter(event => shouldStartMapOverviewNodeDrag({
      type: event.type,
      button: 'button' in event ? Number(event.button) : undefined,
      spacePressed,
      interactiveTarget: true,
    }))
    .container(() => world.value!)
    .subject((_event, mapId) => positions.get(mapId) || { x: 0, y: 0 })
    .on('start', function (event: D3DragEvent<SVGGElement, number, MapOverviewSvgPosition>, mapId) {
      event.sourceEvent?.stopPropagation()
      const position = positions.get(mapId) || { x: 0, y: 0 }
      this.dataset.dragStartX = String(position.x)
      this.dataset.dragStartY = String(position.y)
      this.dataset.dragMoved = 'false'
      hoveredNodeId.value = null
      hoveredEdgeId.value = null
      setGestureState('node-drag')
      emit('nodeDragStart', { mapId, position: { ...position } })
    })
    .on('drag', function (event: D3DragEvent<SVGGElement, number, MapOverviewSvgPosition>, mapId) {
      const position = { x: event.x, y: event.y }
      positions.set(mapId, position)
      this.setAttribute('transform', `translate(${position.x} ${position.y})`)
      const startX = Number(this.dataset.dragStartX || position.x)
      const startY = Number(this.dataset.dragStartY || position.y)
      if (Math.hypot(position.x - startX, position.y - startY) >= 2) this.dataset.dragMoved = 'true'
      scheduleIncidentGeometry(mapId)
    })
    .on('end', function (_event: D3DragEvent<SVGGElement, number, MapOverviewSvgPosition>, mapId) {
      flushPendingIncidentGeometry()
      const after = positions.get(mapId) || { x: 0, y: 0 }
      const before = {
        x: Number(this.dataset.dragStartX || after.x),
        y: Number(this.dataset.dragStartY || after.y),
      }
      if (this.dataset.dragMoved === 'true') suppressNextClick(mapId)
      setGestureState('idle')
      emit('nodeDragEnd', { mapId, before, after: { ...after } })
    })
  select(world.value)
    .selectAll<SVGGElement, number>('.map-overview-svg-node')
    .datum(function () { return Number(this.dataset.mapId) })
    .call(behavior)
}

function scheduleIncidentGeometry(mapId: number): void {
  pendingIncidentMapId = mapId
  if (incidentAnimationFrame) return
  incidentAnimationFrame = requestAnimationFrame(() => {
    incidentAnimationFrame = 0
    const pendingMapId = pendingIncidentMapId
    pendingIncidentMapId = null
    if (pendingMapId != null) updateIncidentGeometry(pendingMapId)
  })
}

function flushPendingIncidentGeometry(): void {
  if (incidentAnimationFrame) cancelAnimationFrame(incidentAnimationFrame)
  incidentAnimationFrame = 0
  const pendingMapId = pendingIncidentMapId
  pendingIncidentMapId = null
  if (pendingMapId != null) updateIncidentGeometry(pendingMapId)
}

function updateIncidentGeometry(mapId: number): void {
  const rootSvg = svg.value
  if (!rootSvg) return
  const incidentEdges = incidentEdgesByMap.get(mapId) || []
  if (!incidentEdges.length) return
  const nodeMap = new Map<number, MapOverviewSvgNodeGeometry>()
  const resolveNodeGeometry = (nodeId: number): MapOverviewSvgNodeGeometry | null => {
    const cached = nodeMap.get(nodeId)
    if (cached) return cached
    const node = nodesById.get(nodeId)
    if (!node) return null
    const geometry = mapOverviewSvgNodeGeometry(node, positions.get(nodeId) || { x: 0, y: 0 })
    nodeMap.set(nodeId, geometry)
    return geometry
  }
  const geometries = new Map<string, MapOverviewSvgEdgeGeometry>()
  for (const edge of incidentEdges) {
    try {
      const source = resolveNodeGeometry(edge.sourceMapId)
      const target = resolveNodeGeometry(edge.targetMapId)
      if (!source || !target) continue
      geometries.set(edge.id, mapOverviewSvgEdgeGeometry(
        edge,
        new Map([[source.id, source], [target.id, target]]),
        routes.value.get(edge.id),
      ))
    } catch {
      // Invalid endpoints are omitted consistently with the declarative render.
    }
  }
  rootSvg.querySelectorAll<SVGPathElement>(`[data-edge-source="${mapId}"], [data-edge-target="${mapId}"]`).forEach(element => {
    const geometry = geometries.get(element.dataset.edgeId || '')
    if (geometry) element.setAttribute('d', geometry.path)
  })
  rootSvg.querySelectorAll<SVGTextElement>(`text[data-edge-source="${mapId}"], text[data-edge-target="${mapId}"]`).forEach(element => {
    const geometry = geometries.get(element.dataset.edgeId || '')
    if (!geometry) return
    element.setAttribute('x', String(geometry.label.x))
    element.setAttribute('y', String(geometry.label.y))
  })
  rootSvg.querySelectorAll<SVGGraphicsElement>(`[data-port-map="${mapId}"]`).forEach(element => {
    const x = Number(element.dataset.portX)
    const y = Number(element.dataset.portY)
    const node = resolveNodeGeometry(mapId)
    if (!node) return
    try {
      const point = mapOverviewSvgPortPoint(node, x, y)
      if (element instanceof SVGCircleElement) {
        element.setAttribute('cx', String(point.x))
        element.setAttribute('cy', String(point.y))
      } else {
        element.setAttribute('transform', `translate(${point.x} ${point.y - 12})`)
      }
    } catch {
      // Ignore invalid active ports.
    }
  })
}

function setGestureState(state: 'idle' | 'node-drag' | 'pan'): void {
  gestureState.value = state
  root.value?.classList.toggle('gesture-node-drag', state === 'node-drag')
  root.value?.classList.toggle('gesture-pan', state === 'pan')
}

function suppressNextClick(mapId: number | null = null): void {
  suppressClickUntil = performance.now() + 120
  suppressClickMapId = mapId
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('.map-overview-svg-node, .map-overview-svg-edge-hit'))
}

function initializeZoom(): void {
  if (!svg.value) return
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([MAP_OVERVIEW_MIN_ZOOM, MAP_OVERVIEW_MAX_ZOOM])
    .wheelDelta(event => -event.deltaY * 0.002 * MAP_OVERVIEW_WHEEL_SENSITIVITY)
    .filter(event => shouldStartMapOverviewPan({
      type: event.type,
      button: 'button' in event ? Number(event.button) : undefined,
      spacePressed,
      interactiveTarget: isInteractiveTarget(event.target),
    }))
    .on('start.map-overview-gesture', event => {
      const sourceEvent = event.sourceEvent as Event | null
      if (!sourceEvent || sourceEvent.type === 'wheel') return
      panStartTransform = currentTransform.value
      panMoved = false
      hoveredNodeId.value = null
      hoveredEdgeId.value = null
      setGestureState('pan')
    })
    .on('zoom', event => {
      currentTransform.value = event.transform
      if (gestureState.value === 'pan' && panStartTransform) {
        panMoved = panMoved
          || Math.abs(event.transform.x - panStartTransform.x) >= 2
          || Math.abs(event.transform.y - panStartTransform.y) >= 2
          || Math.abs(event.transform.k - panStartTransform.k) >= 0.002
      }
      if (world.value) {
        world.value.setAttribute('transform', event.transform.toString())
        world.value.classList.toggle('map-overview-svg-low-detail', event.transform.k < 0.35)
      }
      emit('viewportChange')
    })
    .on('end.map-overview-gesture', () => {
      if (gestureState.value !== 'pan') return
      if (panMoved) suppressNextClick()
      panStartTransform = null
      panMoved = false
      setGestureState('idle')
    })
  select(svg.value).call(zoomBehavior).on('dblclick.zoom', null)
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) return
  if (!pointerInsideCanvas && !root.value?.contains(document.activeElement)) return
  event.preventDefault()
  spacePressed = true
  root.value?.classList.add('space-pan-ready')
}

function onWindowKeyup(event: KeyboardEvent): void {
  if (event.code !== 'Space') return
  clearSpacePanState()
}

function onWindowBlur(): void {
  clearSpacePanState()
  flushPendingIncidentGeometry()
  if (gestureState.value !== 'idle') setGestureState('idle')
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') onWindowBlur()
}

function clearSpacePanState(): void {
  spacePressed = false
  root.value?.classList.remove('space-pan-ready')
}

function setPointerInsideCanvas(value: boolean): void {
  pointerInsideCanvas = value
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function destroy(): void {
  if (destroyed) return
  destroyed = true
  resizeObserver?.disconnect()
  resizeObserver = null
  flushPendingIncidentGeometry()
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('keyup', onWindowKeyup)
  window.removeEventListener('blur', onWindowBlur)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (svg.value) select(svg.value).on('.zoom', null)
  if (world.value) select(world.value).selectAll('.map-overview-svg-node').on('.drag', null)
}

onMounted(() => {
  initializeZoom()
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('keyup', onWindowKeyup)
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)
  resizeObserver = new ResizeObserver(entries => {
    const entry = entries[0]
    if (!entry) return
    explicitWidth.value = Math.max(1, entry.contentRect.width)
    explicitHeight.value = Math.max(1, entry.contentRect.height)
  })
  if (root.value) resizeObserver.observe(root.value)
  void nextTick(bindNodeDrag)
})

onBeforeUnmount(destroy)

defineExpose<MapOverviewSvgCanvasApi>({
  get destroyed() { return destroyed },
  setScene,
  setThumbnailState,
  setSize,
  setSelection,
  getZoom: () => currentTransform.value.k,
  getPosition: () => [currentTransform.value.x, currentTransform.value.y],
  getPositions,
  getNodePosition,
  applyPositions,
  zoomTo,
  translateTo,
  fitView,
  fitCenter,
  focusNode,
  destroy,
})
</script>

<template>
  <div
    ref="root"
    class="map-overview-svg-root"
    @pointerenter="setPointerInsideCanvas(true)"
    @pointerleave="setPointerInsideCanvas(false)"
  >
    <svg
      ref="svg"
      class="map-overview-svg"
      :width="explicitWidth || '100%'"
      :height="explicitHeight || '100%'"
      @click="onCanvasClick"
      @auxclick.prevent
    >
      <defs>
        <template v-for="category in MAP_OVERVIEW_TRANSFER_CONDITION_CATEGORIES" :key="category">
          <marker :id="edgeMarkerId(category)" markerWidth="7" markerHeight="7" refX="6" refY="2" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L0,4 L6,2 z" :fill="mapOverviewTransferConditionVisual(category).stroke" />
          </marker>
          <marker :id="edgeMarkerId(category, true)" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L0,6 L8,3 z" :fill="mapOverviewTransferConditionVisual(category).stroke" />
          </marker>
        </template>
      </defs>
      <g ref="world" class="map-overview-svg-world">
        <g class="map-overview-svg-edges">
          <g v-for="item in geometryEdges" :key="item.edge.id" :style="{ opacity: edgeOpacity(item.edge.id) }">
            <path
              class="map-overview-svg-edge"
              :d="item.geometry.path"
              :data-edge-id="item.edge.id"
              :data-edge-source="item.edge.sourceMapId"
              :data-edge-target="item.edge.targetMapId"
              :marker-end="`url(#${edgeMarkerId(item.condition)})`"
              :style="edgeVisualStyle(item.condition)"
              role="img"
              :aria-label="edgeAriaLabel(item.edge, item.condition)"
            />
            <path
              class="map-overview-svg-edge-hit"
              :d="item.geometry.path"
              :data-edge-id="item.edge.id"
              :data-edge-source="item.edge.sourceMapId"
              :data-edge-target="item.edge.targetMapId"
              aria-hidden="true"
              @click="onEdgeClick($event, item.edge.id)"
              @pointerenter="onEdgePointerEnter(item.edge.id)"
              @pointerleave="onEdgePointerLeave"
            />
            <text
              v-if="item.edge.count > 1"
              class="map-overview-svg-edge-label"
              :x="item.geometry.label.x"
              :y="item.geometry.label.y"
              :data-edge-id="item.edge.id"
              :data-edge-source="item.edge.sourceMapId"
              :data-edge-target="item.edge.targetMapId"
            >×{{ item.edge.count }}</text>
          </g>
        </g>

        <g class="map-overview-svg-nodes">
          <g
            v-for="node in geometryNodes"
            :key="node.id"
            class="map-overview-svg-node"
            :class="{
              selected: selectedNodeId === node.id,
              invalid: node.readState !== 'ready',
              'thumbnail-failed': Boolean(thumbnailError(node.id)),
            }"
            :transform="nodeTransform(node)"
            :style="{ opacity: nodeOpacity(node.id) }"
            :data-map-id="node.id"
            @click="onNodeClick($event, node.id)"
            @dblclick.stop="emit('nodeDblclick', node.id)"
            @contextmenu="onNodeContextmenu($event, node.id)"
            @pointerenter="onNodePointerEnter(node.id)"
            @pointerleave="onNodePointerLeave"
          >
            <title v-if="thumbnailError(node.id)">{{ thumbnailError(node.id) }}</title>
            <rect
              class="map-overview-svg-node-placeholder"
              :x="-node.width / 2"
              :y="-node.imageHeight / 2"
              :width="node.width"
              :height="node.imageHeight"
              rx="2"
            />
            <image
              v-if="imageUrl(node.id)"
              :href="imageUrl(node.id)"
              :x="-node.width / 2"
              :y="-node.imageHeight / 2"
              :width="node.width"
              :height="node.imageHeight"
              preserveAspectRatio="none"
              draggable="false"
            />
            <g v-if="thumbnailError(node.id)" class="map-overview-svg-node-error-mark" aria-hidden="true">
              <circle cx="0" cy="0" r="14" />
              <text x="0" y="5">!</text>
            </g>
            <rect
              class="map-overview-svg-node-frame"
              :x="-node.width / 2"
              :y="-node.imageHeight / 2"
              :width="node.width"
              :height="node.imageHeight"
              rx="2"
            />
            <rect
              class="map-overview-svg-node-label-bg"
              :x="-labelWidth(node) / 2"
              :y="node.imageHeight / 2 + 6"
              :width="labelWidth(node)"
              height="20"
              rx="3"
            />
            <text
              class="map-overview-svg-node-label"
              x="0"
              :y="node.imageHeight / 2 + 20"
              :textLength="labelWidth(node) - 10"
              lengthAdjust="spacingAndGlyphs"
            >{{ nodeLabel(node) }}</text>
          </g>
        </g>

        <g class="map-overview-svg-foreground" pointer-events="none">
          <template v-for="item in geometryEdges" :key="`active-${item.edge.id}`">
            <path
              v-if="activeEdgeIds.has(item.edge.id)"
              :class="['map-overview-svg-edge', 'active', foregroundEdgeState(item.edge)]"
              :d="item.geometry.path"
              :data-edge-id="item.edge.id"
              :data-edge-source="item.edge.sourceMapId"
              :data-edge-target="item.edge.targetMapId"
              :marker-end="`url(#${edgeMarkerId(item.condition, true)})`"
              :style="edgeVisualStyle(item.condition)"
            />
            <text
              v-if="activeEdgeIds.has(item.edge.id) && item.edge.count > 1"
              :class="['map-overview-svg-edge-label', 'active', foregroundEdgeState(item.edge)]"
              :x="item.geometry.label.x"
              :y="item.geometry.label.y"
              :data-edge-id="item.edge.id"
              :data-edge-source="item.edge.sourceMapId"
              :data-edge-target="item.edge.targetMapId"
            >×{{ item.edge.count }}</text>
          </template>
          <template v-for="port in activePorts" :key="port.key">
            <circle
              :class="['map-overview-svg-port', port.role]"
              :cx="port.point.x"
              :cy="port.point.y"
              r="5"
              :data-port-map="port.mapId"
              :data-port-x="port.x"
              :data-port-y="port.y"
            />
            <g
              class="map-overview-svg-port-label"
              :transform="`translate(${port.point.x} ${port.point.y - 12})`"
              :data-port-map="port.mapId"
              :data-port-x="port.x"
              :data-port-y="port.y"
            >
              <rect x="-17" y="-11" width="34" height="16" rx="3" />
              <text x="0" y="1">{{ port.x }},{{ port.y }}</text>
            </g>
          </template>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.map-overview-svg-root { position:absolute; inset:0; min-width:0; min-height:0; overflow:hidden; }
.map-overview-svg { display:block; width:100%; height:100%; overflow:hidden; touch-action:none; user-select:none; cursor:grab; }
.map-overview-svg:active { cursor:grabbing; }
.map-overview-svg-root.space-pan-ready .map-overview-svg,
.map-overview-svg-root.space-pan-ready .map-overview-svg-node { cursor:grab; }
.map-overview-svg-root.gesture-pan .map-overview-svg,
.map-overview-svg-root.gesture-pan .map-overview-svg-node { cursor:grabbing; }
.map-overview-svg-world { transform-origin:0 0; }
.map-overview-svg-edge { fill:none; stroke:#8c8d86; stroke-width:1; stroke-linecap:round; stroke-linejoin:round; opacity:.22; vector-effect:non-scaling-stroke; }
.map-overview-svg-edge.active { stroke:#c65f3d; opacity:.65; }
.map-overview-svg-edge.active.node-hovered { stroke-width:1.25; opacity:.65; }
.map-overview-svg-edge.active.node-selected { stroke-width:1.5; opacity:.8; }
.map-overview-svg-edge.active.edge-hovered { stroke-width:2; opacity:.9; }
.map-overview-svg-edge.active.edge-selected { stroke-width:2.5; opacity:1; }
.map-overview-svg-edge-hit { fill:none; stroke:transparent; stroke-width:13; pointer-events:stroke; cursor:pointer; vector-effect:non-scaling-stroke; }
.map-overview-svg-edge-label { fill:#5f605a; stroke:#f7f7f4; stroke-width:2.5; opacity:.55; paint-order:stroke; text-anchor:middle; dominant-baseline:middle; font:600 10px var(--app-font-mono); pointer-events:none; }
.map-overview-svg-edge-label.active { fill:#a5452b; opacity:.8; }
.map-overview-svg-edge-label.active.edge-selected { opacity:1; }
.map-overview-svg-low-detail .map-overview-svg-edge-label { display:none; }
.map-overview-svg-node { cursor:move; transition:opacity 120ms ease; }
.map-overview-svg-root.gesture-node-drag .map-overview-svg-node { transition:none; }
.map-overview-svg-node-placeholder { fill:#e9e8e3; pointer-events:none; }
.map-overview-svg-node-frame { fill:transparent; stroke:transparent; stroke-width:0; vector-effect:non-scaling-stroke; pointer-events:none; }
.map-overview-svg-node.invalid .map-overview-svg-node-frame { stroke:#c2412d; stroke-width:2; stroke-dasharray:6 4; }
.map-overview-svg-node.thumbnail-failed .map-overview-svg-node-frame { stroke:#c2412d; stroke-width:2; stroke-dasharray:6 4; }
.map-overview-svg-node.selected .map-overview-svg-node-frame { stroke:#c65f3d; stroke-width:3; stroke-dasharray:none; }
.map-overview-svg-node-error-mark circle { fill:#f7f7f4; fill-opacity:.92; stroke:#c2412d; stroke-width:2; vector-effect:non-scaling-stroke; }
.map-overview-svg-node-error-mark text { fill:#c2412d; text-anchor:middle; font:700 16px var(--app-font-sans); }
.map-overview-svg-node-label-bg { fill:#f7f7f4; fill-opacity:.78; }
.map-overview-svg-node-label { fill:#282923; text-anchor:middle; font:600 12px var(--app-font-sans); }
.map-overview-svg-port { stroke:#c65f3d; stroke-width:2; vector-effect:non-scaling-stroke; }
.map-overview-svg-port.source { fill:transparent; }
.map-overview-svg-port.target,.map-overview-svg-port.both { fill:#c65f3d; }
.map-overview-svg-port-label rect { fill:#f7f7f4; fill-opacity:.92; }
.map-overview-svg-port-label text { fill:#5f605a; text-anchor:middle; font:600 10px var(--app-font-mono); }
</style>
