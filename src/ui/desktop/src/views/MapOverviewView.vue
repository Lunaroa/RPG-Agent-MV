<script setup lang="ts">
import { Graph, type IElementEvent, type NodeData } from '@antv/g6'
import { ElMessageBox } from 'element-plus'
import { Aim, Refresh, Search } from '@element-plus/icons-vue'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type {
  MapOverviewChunk,
  MapOverviewEdge,
  MapOverviewLayoutId,
  MapOverviewNode,
  MapOverviewSnapshot,
} from '@contract/types'
import { maps, workspaceSurfaces } from '../api/client'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'
import { findMapOverviewMatches } from '../utils/mapOverviewSearch'
import { MapOverviewMoveHistory, type MapOverviewNodePosition } from '../utils/mapOverviewMoveHistory'
import { MAP_OVERVIEW_LAYOUT_VERSION, mapOverviewNodeSize } from '../utils/mapOverviewNodeSize'
import {
  DEFAULT_MAP_OVERVIEW_LAYOUT_ID,
  MAP_OVERVIEW_LAYOUTS,
  MAP_OVERVIEW_LAYOUT_CONFIRM_I18N,
  buildMapOverviewLayoutOptions,
  mapOverviewLayoutSizePayload,
  sortMapOverviewLayoutNodesByMapId,
} from '../utils/mapOverviewLayouts'
import {
  executeMapOverviewGraphLayout,
  type MapOverviewLayoutRunHandle,
} from '../utils/mapOverviewLayoutExecute'
import {
  mapOverviewChunkCellKey,
  mapOverviewChunkKey,
  mapOverviewChunkKeyBelongsToMap,
  prioritizeMapOverviewChunks,
  shouldRetainStaleMapOverviewChunk,
  type MapOverviewChunkRequest,
  type MapOverviewViewportBox,
} from '../utils/mapOverviewChunkScheduler'
import { MapOverviewDecodedChunkCache } from '../utils/mapOverviewDecodedChunkCache'
import { mapOverviewPortKey, mapOverviewPortRelative } from '../utils/mapOverviewPorts'
import {
  clampMapOverviewZoom,
  clampMapOverviewZoomPercent,
  formatMapOverviewZoomPercent,
  MAP_OVERVIEW_MAX_ZOOM,
  MAP_OVERVIEW_MIN_ZOOM,
  MAP_OVERVIEW_WHEEL_SENSITIVITY,
  MAP_OVERVIEW_ZOOM_STEP,
  mapOverviewZoomFromPercent,
  parseMapOverviewZoomPercent,
} from '../utils/mapOverviewViewport'

const projectStore = useProjectStore()
const workspaceStore = useWorkspaceStore()
const router = useRouter()
const { language, t } = useI18n()
const graphHost = ref<HTMLElement | null>(null)
const chunkHost = ref<HTMLCanvasElement | null>(null)
const snapshot = ref<MapOverviewSnapshot | null>(null)
const loading = ref(false)
const validating = ref(false)
const refreshing = ref(false)
const loadError = ref('')
const layoutError = ref('')
const searchQuery = ref('')
const selectedLayoutId = ref<MapOverviewLayoutId>(DEFAULT_MAP_OVERVIEW_LAYOUT_ID)
const zoomPercent = ref(100)
const zoomDraft = ref('100')
const zoomInput = ref<HTMLInputElement | null>(null)
const selectedNodeId = ref<number | null>(null)
const selectedEdgeId = ref<string | null>(null)
const contextMenu = ref<{ mapId: number; x: number; y: number } | null>(null)
const chunkErrors = ref<Record<number, string>>({})

let graph: Graph | null = null
let graphBoundContainer: HTMLElement | null = null
let layoutRequestId = 0
let loadGeneration = 0
let chunkGeneration = 0
let chunkSessionId = createChunkSessionId()
let activeChunkLoads = 0
let chunkScheduleTimer: ReturnType<typeof setTimeout> | null = null
let lastGraphInteractionAt = Date.now()
let zoomPersistTimer: ReturnType<typeof setTimeout> | null = null
let viewportReady = false
let layoutMigrationPending = false
let surfaceActive = false
let surfaceVersion = ''
let surfaceValidated = false
let savedViewport: { zoom: number; pan: [number, number] } | null = null
let layoutRunning = false
let activeLayoutHandle: MapOverviewLayoutRunHandle | null = null
const grabbedPositions = new Map<string, MapOverviewNodePosition>()
const moveHistory = new MapOverviewMoveHistory(100)
const decodedChunks = new MapOverviewDecodedChunkCache()
const displayedChunkKeys = new Map<string, MapOverviewChunkRequest & { url: string; logicalX: number; logicalY: number; logicalWidth: number; logicalHeight: number }>()
const inflightChunkKeys = new Set<string>()
const failedDecodeChunkKeys = new Set<string>()
const preferredLevelByMap = new Map<number, number>()
const paintFrame = { pending: false }

const currentProject = computed(() => projectStore.currentProject || '')
const selectedNode = computed(() => snapshot.value?.nodes.find((node) => node.id === selectedNodeId.value) || null)
const selectedEdge = computed(() => snapshot.value?.edges.find((edge) => edge.id === selectedEdgeId.value) || null)
const searchMatches = computed(() => {
  if (!snapshot.value) return []
  return findMapOverviewMatches(snapshot.value.nodes, searchQuery.value)
})
const selectedNodeEdges = computed(() => {
  if (!snapshot.value || selectedNodeId.value == null) return { incoming: [], outgoing: [] }
  return {
    incoming: snapshot.value.edges.filter((edge) => edge.targetMapId === selectedNodeId.value),
    outgoing: snapshot.value.edges.filter((edge) => edge.sourceMapId === selectedNodeId.value),
  }
})

onMounted(() => {
  // Graph is created lazily when snapshot/host are ready.
})

onActivated(() => {
  surfaceActive = true
  if (currentProject.value) {
    selectedLayoutId.value = workspaceStore.readMapOverviewLayout(currentProject.value)
    const persisted = workspaceStore.readMapOverviewSelection(currentProject.value)
    selectedNodeId.value = persisted.selectedNodeId
    selectedEdgeId.value = persisted.selectedEdgeId
    void activateOverview()
  }
})

onDeactivated(() => {
  surfaceActive = false
  captureSessionViewport()
  loadGeneration += 1
  chunkGeneration += 1
  inflightChunkKeys.clear()
  activeChunkLoads = 0
  cancelChunkSession()
  if (chunkScheduleTimer) clearTimeout(chunkScheduleTimer)
  chunkScheduleTimer = null
  persistZoomNow()
  persistViewportSelectionNow()
  layoutRequestId += 1
  activeLayoutHandle?.stop()
  activeLayoutHandle = null
  if (graph && !graph.destroyed) graph.stopLayout()
  // Keep graph instance / snapshot / selection / pan / zoom; only cancel layout+chunks.
})

onUnmounted(() => {
  loadGeneration += 1
  cancelChunkSession()
  if (chunkScheduleTimer) clearTimeout(chunkScheduleTimer)
  chunkScheduleTimer = null
  persistZoomNow()
  persistViewportSelectionNow()
  layoutRequestId += 1
  activeLayoutHandle?.stop()
  activeLayoutHandle = null
  if (graph && !graph.destroyed) graph.stopLayout()
  moveHistory.clear()
  decodedChunks.clear()
  displayedChunkKeys.clear()
  destroyGraph()
})

watch(currentProject, (next, previous) => {
  if (next === previous) return
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = null
  if (previous && graph && viewportReady) {
    workspaceStore.patchMapOverviewZoom(previous, graph.getZoom())
    const pan = graph.getPosition() as [number, number]
    workspaceStore.patchMapOverviewPan(previous, pan)
    workspaceStore.patchMapOverviewSelection(previous, {
      selectedNodeId: selectedNodeId.value,
      selectedEdgeId: selectedEdgeId.value,
    })
  }
  resetGraphState()
  moveHistory.clear()
  surfaceVersion = ''
  if (next) {
    selectedLayoutId.value = workspaceStore.readMapOverviewLayout(next)
    const persisted = workspaceStore.readMapOverviewSelection(next)
    selectedNodeId.value = persisted.selectedNodeId
    selectedEdgeId.value = persisted.selectedEdgeId
    if (surfaceActive) void activateOverview()
  }
})

async function activateOverview(): Promise<void> {
  const project = currentProject.value
  if (!project || !surfaceActive) return
  const hasCachedSnapshot = Boolean(snapshot.value)
  if (hasCachedSnapshot) {
    surfaceValidated = false
    validating.value = true
    await restoreGraphAfterActivation()
  } else {
    loading.value = true
    loadError.value = ''
  }
  try {
    const validation = await workspaceSurfaces.validate({
      surface: 'mapOverview',
      loadedVersion: surfaceVersion || undefined,
    }, project)
    if (!surfaceActive || currentProject.value !== project) return
    if (snapshot.value && validation.unchanged) {
      surfaceVersion = validation.version
      surfaceValidated = true
      validating.value = false
      await restoreGraphAfterActivation()
      if (!viewportReady) void requestInitialLayout(snapshot.value)
      else scheduleChunks(0)
      return
    }
    await loadOverview(validation.version)
  } catch (error) {
    if (!surfaceActive || currentProject.value !== project) return
    loadError.value = formatUserFacingErrorMessage(error, 'general', language.value)
    validating.value = false
    if (!snapshot.value) loading.value = false
  }
}

async function loadOverview(startVersion?: string): Promise<void> {
  const project = currentProject.value
  if (!project) return
  const generation = ++loadGeneration
  const preserveSnapshot = Boolean(snapshot.value)
  loading.value = !preserveSnapshot
  refreshing.value = preserveSnapshot
  validating.value = false
  surfaceValidated = false
  loadError.value = ''
  layoutError.value = ''
  try {
    const next = await maps.overview(project)
    const settled = await workspaceSurfaces.validate({
      surface: 'mapOverview',
      loadedVersion: startVersion,
    }, project)
    if (generation !== loadGeneration || !surfaceActive || currentProject.value !== project) return
    if (startVersion && !settled.unchanged) throw new Error(t('story.workspaceChangedDuringLoad'))
    surfaceVersion = settled.version
    surfaceValidated = true
    const previous = snapshot.value
    const changed = !previous || previous.snapshotVersion !== next.snapshotVersion
    if (changed) {
      snapshot.value = next
      await nextTick()
      await ensureGraph(next, true)
      void requestInitialLayout(next)
    } else {
      snapshot.value = next
      await restoreGraphAfterActivation()
      scheduleChunks(0)
    }
    loading.value = false
    refreshing.value = false
  } catch (error) {
    if (generation !== loadGeneration) return
    loadError.value = formatUserFacingErrorMessage(error, 'general', language.value)
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      refreshing.value = false
      validating.value = false
    }
  }
}

async function restoreGraphAfterActivation(): Promise<void> {
  const cachedSnapshot = snapshot.value
  if (!cachedSnapshot) return
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (!surfaceActive || !graphHost.value) return
  if (graph && !graph.destroyed && graphBoundContainer === graphHost.value) {
    const width = graphHost.value.clientWidth
    const height = graphHost.value.clientHeight
    if (width > 0 && height > 0) graph.setSize(width, height)
    restoreSelectionVisuals()
    syncZoomDisplay()
    paintChunksSoon()
    return
  }
  await ensureGraph(cachedSnapshot, false)
  const stored = workspaceStore.readMapOverviewPositions(currentProject.value)
  const hasCompleteStoredPositions = cachedSnapshot.nodes.every((node) => Boolean(stored[String(node.id)]))
  if (Object.keys(stored).length) applyPositions(stored)
  if (hasCompleteStoredPositions) restoreSavedViewport()
  else viewportReady = false
  restoreSelectionVisuals()
}

function captureSessionViewport(): void {
  if (!graph || !viewportReady) return
  savedViewport = { zoom: graph.getZoom(), pan: graph.getPosition() as [number, number] }
  if (currentProject.value) {
    workspaceStore.patchMapOverviewZoom(currentProject.value, savedViewport.zoom)
    workspaceStore.patchMapOverviewPan(currentProject.value, savedViewport.pan)
  }
}

function restoreSavedViewport(): void {
  if (!graph) return
  if (savedViewport) {
    void graph.zoomTo(savedViewport.zoom, false)
    void graph.translateTo(savedViewport.pan, false)
    viewportReady = true
    syncZoomDisplay()
    paintChunksSoon()
    return
  }
  const project = currentProject.value
  const persistedPan = project ? workspaceStore.readMapOverviewPan(project) : null
  const persistedZoom = project ? workspaceStore.readMapOverviewZoom(project) : null
  if (persistedPan) {
    void graph.zoomTo(persistedZoom ?? clampMapOverviewZoom(graph.getZoom()), false)
    void graph.translateTo(persistedPan, false)
    viewportReady = true
    syncZoomDisplay()
    paintChunksSoon()
    return
  }
  restoreInitialViewport()
}

async function ensureGraph(next: MapOverviewSnapshot, forceRebuild: boolean): Promise<void> {
  if (!graphHost.value) return
  if (graph && !graph.destroyed && !forceRebuild && graphBoundContainer === graphHost.value) {
    graph.setData(buildGraphData(next))
    await graph.draw()
    return
  }
  destroyGraph()
  const width = Math.max(1, graphHost.value.clientWidth)
  const height = Math.max(1, graphHost.value.clientHeight)
  graphBoundContainer = graphHost.value
  graph = new Graph({
    container: graphHost.value,
    width,
    height,
    animation: false,
    autoFit: false,
    padding: 42,
    zoomRange: [MAP_OVERVIEW_MIN_ZOOM, MAP_OVERVIEW_MAX_ZOOM],
    data: buildGraphData(next),
    node: {
      type: 'rect',
      style: {
        size: (datum: NodeData) => {
          const size = datum.data?.size as { width: number; imageHeight: number } | undefined
          return size ? [size.width, size.imageHeight] : [48, 48]
        },
        fill: '#f0efe8',
        stroke: (datum: NodeData) => (datum.data?.readState === 'ready' ? 'transparent' : '#c2412d'),
        lineWidth: (datum: NodeData) => (datum.data?.readState === 'ready' ? 0 : 2),
        lineDash: (datum: NodeData) => (datum.data?.readState === 'ready' ? undefined : [6, 4]),
        radius: 2,
        labelText: (datum: NodeData) => String(datum.data?.label || ''),
        labelPlacement: 'bottom',
        labelOffsetY: 8,
        labelFill: '#282923',
        labelFontSize: 13,
        labelFontWeight: 600,
        labelWordWrap: true,
        labelMaxWidth: '100%',
        labelBackground: true,
        labelBackgroundFill: '#f7f7f4',
        labelBackgroundOpacity: 0.9,
        labelPadding: [3, 6],
        labelBackgroundRadius: 4,
        badge: true,
        badges: [],
        ports: (datum: NodeData) => (datum.data?.ports as Array<{ key: string; placement: [number, number]; kind: string }>) || [],
        port: true,
        portR: 0,
        portFill: 'transparent',
        portStroke: 'transparent',
        portLineWidth: 0,
      },
      state: {
        selected: {
          stroke: '#c65f3d',
          lineWidth: 3,
          lineDash: undefined,
        },
        dimmed: { opacity: 0.16 },
        focused: {
          stroke: '#c65f3d',
          lineWidth: 3,
        },
      },
    },
    edge: {
      type: 'quadratic',
      style: {
        stroke: '#8c8d86',
        lineWidth: 3,
        endArrow: true,
        endArrowSize: 10,
        labelText: (datum) => {
          const count = Number(datum.data?.count || 0)
          return count > 1 ? `×${count}` : ''
        },
        labelFill: '#5f605a',
        labelFontSize: 11,
        labelBackground: true,
        labelBackgroundFill: '#f7f7f4',
        labelBackgroundOpacity: 0.9,
        labelPadding: 3,
        halo: true,
        haloStroke: '#8c8d86',
        haloLineWidth: 11,
        haloStrokeOpacity: 0,
        haloPointerEvents: 'stroke',
        sourcePort: (datum) => String(datum.data?.sourcePort || ''),
        targetPort: (datum) => String(datum.data?.targetPort || ''),
        loop: true,
      },
      state: {
        selected: {
          stroke: '#c65f3d',
          lineWidth: 5,
          haloLineWidth: 13,
          haloStroke: '#c65f3d',
          haloPointerEvents: 'stroke',
        },
        dimmed: { opacity: 0.16 },
        focused: {
          stroke: '#c65f3d',
          lineWidth: 5,
        },
      },
    },
    behaviors: [
      { type: 'drag-canvas' },
      {
        type: 'zoom-canvas',
        sensitivity: MAP_OVERVIEW_WHEEL_SENSITIVITY,
        preventDefault: true,
      },
      {
        type: 'drag-element',
        animation: false,
        dropEffect: 'none',
      },
      {
        type: 'click-select',
        multiple: false,
        state: 'selected',
      },
    ],
  })
  graph.on('node:click', (event: IElementEvent) => {
    const id = Number(event.target.id)
    if (Number.isFinite(id)) selectNode(id)
  })
  graph.on('node:dblclick', (event: IElementEvent) => {
    openMap(Number(event.target.id))
  })
  graph.on('edge:click', (event: IElementEvent) => {
    selectEdge(String(event.target.id))
  })
  graph.on('canvas:click', () => clearSelection())
  graph.on('node:contextmenu', (event: IElementEvent) => {
    const original = (event as unknown as { nativeEvent?: MouseEvent }).nativeEvent
      || (event as unknown as { originalEvent?: MouseEvent }).originalEvent
    if (original && typeof original.preventDefault === 'function') original.preventDefault()
    if (!original) return
    contextMenu.value = { mapId: Number(event.target.id), x: original.clientX, y: original.clientY }
  })
  graph.on('node:pointerenter', (event: IElementEvent) => {
    const mapId = Number(event.target.id)
    if (!Number.isFinite(mapId)) return
    if (selectedNodeId.value === mapId || selectedEdgeId.value) return
    updatePortVisibility(mapId)
  })
  graph.on('node:pointerleave', () => {
    if (selectedNodeId.value != null) updatePortVisibility(selectedNodeId.value)
    else if (selectedEdgeId.value) {
      const edge = snapshot.value?.edges.find((item) => item.id === selectedEdgeId.value)
      if (edge) updatePortVisibility(null, edge)
      else hideAllPorts()
    } else {
      hideAllPorts()
      void graph?.draw()
    }
  })
  graph.on('node:dragstart', (event: IElementEvent) => {
    const id = String(event.target.id)
    grabbedPositions.set(id, roundedPosition(id))
  })
  graph.on('node:dragend', (event: IElementEvent) => {
    const id = String(event.target.id)
    const before = grabbedPositions.get(id)
    const after = roundedPosition(id)
    grabbedPositions.delete(id)
    if (before) moveHistory.record({ nodeId: id, before, after })
    persistGraphPositions()
    scheduleChunks(0)
  })
  graph.on('aftertransform', () => {
    handleGraphZoom()
    markGraphInteraction()
  })
  graph.on('afterelementtranslate', () => {
    markGraphInteraction()
    paintChunksSoon()
  })
  await graph.render()
}

function buildGraphData(next: MapOverviewSnapshot) {
  const portsByMap = collectPorts(next)
  const nodes = sortMapOverviewLayoutNodesByMapId(next.nodes).map((node) => {
    const size = mapOverviewNodeSize(node)
    return {
      id: String(node.id),
      data: {
        mapId: node.id,
        label: `${node.name} MAP${String(node.id).padStart(3, '0')}`,
        readState: node.readState,
        size: { width: size.width, imageHeight: size.imageHeight, collisionHeight: size.collisionHeight },
        layoutSize: mapOverviewLayoutSizePayload(size),
        ports: portsByMap.get(node.id) || [],
      },
      style: {
        x: 0,
        y: 0,
        size: [size.width, size.imageHeight],
        ports: (portsByMap.get(node.id) || []).map((port) => ({
          key: port.key,
          placement: port.placement,
          r: 0,
          fill: 'transparent',
          stroke: 'transparent',
        })),
      },
    }
  })
  const edges = next.edges.map((edge) => ({
    id: edge.id,
    source: String(edge.sourceMapId),
    target: String(edge.targetMapId),
    data: {
      count: edge.count,
      sourcePort: mapOverviewPortKey(edge.sourceX, edge.sourceY),
      targetPort: mapOverviewPortKey(edge.targetX, edge.targetY),
    },
    style: {
      sourcePort: mapOverviewPortKey(edge.sourceX, edge.sourceY),
      targetPort: mapOverviewPortKey(edge.targetX, edge.targetY),
    },
  }))
  return { nodes, edges }
}

function collectPorts(next: MapOverviewSnapshot): Map<number, Array<{ key: string; placement: [number, number]; kind: 'source' | 'target' | 'both' }>> {
  const byMap = new Map<number, Map<string, { key: string; placement: [number, number]; kind: 'source' | 'target' | 'both' }>>()
  const ensure = (mapId: number, x: number, y: number, kind: 'source' | 'target') => {
    const node = next.nodes.find((item) => item.id === mapId)
    if (!node?.width || !node.height) return
    try {
      const relative = mapOverviewPortRelative(x, y, node.width, node.height)
      const key = mapOverviewPortKey(x, y)
      let ports = byMap.get(mapId)
      if (!ports) {
        ports = new Map()
        byMap.set(mapId, ports)
      }
      const existing = ports.get(key)
      if (!existing) {
        ports.set(key, { key, placement: [relative.x, relative.y], kind })
        return
      }
      if (existing.kind !== kind) existing.kind = 'both'
    } catch {
      // Out-of-bounds coordinates never create ports or edges.
    }
  }
  for (const edge of next.edges) {
    ensure(edge.sourceMapId, edge.sourceX, edge.sourceY, 'source')
    ensure(edge.targetMapId, edge.targetX, edge.targetY, 'target')
  }
  return new Map([...byMap.entries()].map(([mapId, ports]) => [mapId, [...ports.values()]]))
}

async function requestInitialLayout(next: MapOverviewSnapshot): Promise<void> {
  viewportReady = false
  const stored = workspaceStore.readMapOverviewPositions(currentProject.value)
  const validStored = Object.fromEntries(Object.entries(stored).filter(([id]) => next.nodes.some((node) => String(node.id) === id)))
  if (workspaceStore.readMapOverviewLayoutVersion(currentProject.value) !== MAP_OVERVIEW_LAYOUT_VERSION) {
    layoutMigrationPending = true
    moveHistory.clear()
    if (Object.keys(validStored).length) {
      applyPositions(validStored)
      restoreSavedViewport()
    }
    try {
      await runLayout(next, {}, true)
    } catch {
      // layoutError set; positions rolled back inside runLayout
    }
    return
  }
  const hasNewNodes = next.nodes.some((node) => !validStored[String(node.id)])
  if (Object.keys(validStored).length && !hasNewNodes) {
    applyPositions(validStored)
    persistGraphPositions()
    restoreInitialViewport()
    scheduleChunks()
    return
  }
  try {
    await runLayout(next, validStored, true)
  } catch {
    // layoutError set; positions rolled back inside runLayout
  }
}

async function runLayout(
  next: MapOverviewSnapshot,
  seedPositions: Record<string, { x: number; y: number }> = {},
  restoreViewport = false,
): Promise<void> {
  if (!graph || graph.destroyed) return
  const requestId = ++layoutRequestId
  const beforePositions = Object.fromEntries(
    graph.getNodeData().map((node) => [String(node.id), roundedPosition(String(node.id))]),
  )
  layoutRunning = true
  layoutError.value = ''
  try {
    if (Object.keys(seedPositions).length) applyPositions(seedPositions)
    const layoutNodes = next.nodes.map((node) => {
      const size = mapOverviewNodeSize(node)
      return { mapId: node.id, width: size.width, collisionHeight: size.collisionHeight }
    })
    const options = buildMapOverviewLayoutOptions(selectedLayoutId.value, {
      nodes: layoutNodes,
      width: graphHost.value?.clientWidth,
      height: graphHost.value?.clientHeight,
    })
    await executeMapOverviewGraphLayout(graph, options, {
      isCancelled: () => requestId !== layoutRequestId,
      onHandle: (handle) => { activeLayoutHandle = handle },
    })
    if (requestId !== layoutRequestId) {
      applyPositions(beforePositions)
      return
    }
    persistGraphPositions()
    workspaceStore.patchMapOverviewLayout(currentProject.value, selectedLayoutId.value)
    if (layoutMigrationPending) {
      workspaceStore.patchMapOverviewLayoutVersion(currentProject.value, MAP_OVERVIEW_LAYOUT_VERSION)
      layoutMigrationPending = false
    }
    if (restoreViewport) restoreInitialViewport()
    else await fitGraph()
    scheduleChunks()
  } catch (error) {
    if (requestId !== layoutRequestId) return
    applyPositions(beforePositions)
    layoutError.value = formatUserFacingErrorMessage(error, 'general', language.value)
    throw error
  } finally {
    if (requestId === layoutRequestId) {
      layoutRunning = false
      activeLayoutHandle = null
    }
  }
}

function applyPositions(positions: Record<string, { x: number; y: number }>): void {
  if (!graph) return
  graph.updateNodeData(Object.entries(positions).map(([id, position]) => ({
    id,
    style: { x: position.x, y: position.y },
  })))
  void graph.draw()
}

function persistGraphPositions(): void {
  if (!graph || !currentProject.value) return
  const positions = Object.fromEntries(
    graph.getNodeData().map((node) => [String(node.id), roundedPosition(String(node.id))]),
  )
  workspaceStore.patchMapOverviewPositions(currentProject.value, positions)
}

function roundedPosition(nodeId: string): { x: number; y: number } {
  const node = graph?.getNodeData(nodeId)
  const x = Number(node?.style?.x || 0)
  const y = Number(node?.style?.y || 0)
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}

async function confirmLayoutChange(nextId: MapOverviewLayoutId): Promise<void> {
  const previous = selectedLayoutId.value
  if (nextId === previous) return
  selectedLayoutId.value = nextId
  if (!snapshot.value) return
  try {
    await ElMessageBox.confirm(
      t(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.body),
      t(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.title),
      {
        confirmButtonText: t(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.apply),
        cancelButtonText: t(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.cancel),
        type: 'warning',
      },
    )
  } catch {
    selectedLayoutId.value = previous
    return
  }
  moveHistory.clear()
  const ok = await runLayoutSafe(snapshot.value, {}, !viewportReady)
  if (!ok) selectedLayoutId.value = previous
}

async function confirmRelayout(): Promise<void> {
  if (!snapshot.value) return
  try {
    await ElMessageBox.confirm(
      t(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.body),
      t('mapOverview.relayout.confirmTitle'),
      {
        confirmButtonText: t('mapOverview.relayout.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }
  moveHistory.clear()
  await runLayoutSafe(snapshot.value, {}, false)
}

async function runLayoutSafe(
  next: MapOverviewSnapshot,
  seed: Record<string, { x: number; y: number }>,
  restoreViewport: boolean,
): Promise<boolean> {
  const beforePositions = workspaceStore.readMapOverviewPositions(currentProject.value)
  const beforeLayout = workspaceStore.readMapOverviewLayout(currentProject.value)
  try {
    await runLayout(next, seed, restoreViewport)
    return !layoutError.value
  } catch {
    applyPositions(beforePositions)
    selectedLayoutId.value = beforeLayout
    return false
  }
}

function retryLayout(): void {
  if (!snapshot.value) return
  void runLayout(snapshot.value, {}, !viewportReady).catch(() => undefined)
}

async function fitGraph(): Promise<void> {
  if (!graph) return
  await graph.fitView({ padding: 42 }, false)
  const zoom = clampMapOverviewZoom(Math.max(graph.getZoom(), MAP_OVERVIEW_MIN_ZOOM))
  if (zoom !== graph.getZoom()) await graph.zoomTo(zoom, false)
  syncZoomDisplay()
  if (viewportReady) persistZoomSoon()
  paintChunksSoon()
}

function restoreInitialViewport(): void {
  if (!graph) return
  const storedZoom = workspaceStore.readMapOverviewZoom(currentProject.value)
  const storedPan = workspaceStore.readMapOverviewPan(currentProject.value)
  if (storedZoom == null) {
    void fitGraph()
  } else if (storedPan) {
    void graph.zoomTo(storedZoom, false)
    void graph.translateTo(storedPan, false)
  } else {
    void graph.fitCenter(false).then(() => setGraphZoom(storedZoom, false))
  }
  viewportReady = true
  syncZoomDisplay()
  paintChunksSoon()
}

function handleGraphZoom(): void {
  syncZoomDisplay()
  markGraphInteraction()
  if (viewportReady) persistZoomSoon()
}

function syncZoomDisplay(): void {
  if (!graph) return
  const zoom = clampMapOverviewZoom(graph.getZoom())
  zoomPercent.value = Math.round(zoom * 1000) / 10
  if (document.activeElement !== zoomInput.value) zoomDraft.value = formatMapOverviewZoomPercent(zoom)
}

function setGraphZoom(value: number, persist = true): void {
  if (!graph || !graphHost.value) return
  const level = clampMapOverviewZoom(value)
  const origin: [number, number] = [graphHost.value.clientWidth / 2, graphHost.value.clientHeight / 2]
  void graph.zoomTo(level, false, origin)
  syncZoomDisplay()
  if (persist && viewportReady) persistZoomSoon()
  paintChunksSoon()
}

function zoomIn(): void {
  if (graph) setGraphZoom(graph.getZoom() + MAP_OVERVIEW_ZOOM_STEP)
}

function zoomOut(): void {
  if (graph) setGraphZoom(graph.getZoom() - MAP_OVERVIEW_ZOOM_STEP)
}

function applyZoomDraft(): void {
  const parsed = parseMapOverviewZoomPercent(zoomDraft.value)
  if (parsed == null) {
    zoomDraft.value = formatMapOverviewZoomPercent(graph?.getZoom() || mapOverviewZoomFromPercent(zoomPercent.value))
    zoomInput.value?.blur()
    return
  }
  const zoom = mapOverviewZoomFromPercent(clampMapOverviewZoomPercent(parsed))
  setGraphZoom(zoom)
  zoomDraft.value = formatMapOverviewZoomPercent(zoom)
  zoomInput.value?.blur()
}

function cancelZoomDraft(): void {
  zoomDraft.value = formatMapOverviewZoomPercent(graph?.getZoom() || mapOverviewZoomFromPercent(zoomPercent.value))
  zoomInput.value?.blur()
}

function selectZoomInput(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select()
}

function persistZoomSoon(): void {
  if (!graph || !currentProject.value || !viewportReady) return
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = setTimeout(() => {
    zoomPersistTimer = null
    persistZoomNow()
  }, 250)
}

function persistZoomNow(): void {
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = null
  if (!graph || !currentProject.value || !viewportReady) return
  workspaceStore.patchMapOverviewZoom(currentProject.value, graph.getZoom())
  workspaceStore.patchMapOverviewPan(currentProject.value, graph.getPosition() as [number, number])
}

function persistViewportSelectionNow(): void {
  if (!currentProject.value) return
  workspaceStore.patchMapOverviewSelection(currentProject.value, {
    selectedNodeId: selectedNodeId.value,
    selectedEdgeId: selectedEdgeId.value,
  })
}

function selectNode(mapId: number): void {
  selectedNodeId.value = mapId
  selectedEdgeId.value = null
  contextMenu.value = null
  persistViewportSelectionNow()
  if (!graph || !snapshot.value) return
  const related = new Set<string>([String(mapId)])
  for (const edge of snapshot.value.edges) {
    if (edge.sourceMapId === mapId || edge.targetMapId === mapId) {
      related.add(edge.id)
      related.add(String(edge.sourceMapId))
      related.add(String(edge.targetMapId))
    }
  }
  applyFocus(related)
  updatePortVisibility(mapId)
}

function selectEdge(edgeId: string): void {
  selectedNodeId.value = null
  selectedEdgeId.value = edgeId
  contextMenu.value = null
  persistViewportSelectionNow()
  const edge = snapshot.value?.edges.find((item) => item.id === edgeId)
  if (!edge || !graph) return
  applyFocus(new Set([edgeId, String(edge.sourceMapId), String(edge.targetMapId)]))
  updatePortVisibility(null, edge)
}

function clearSelection(): void {
  selectedNodeId.value = null
  selectedEdgeId.value = null
  contextMenu.value = null
  persistViewportSelectionNow()
  if (!graph) return
  const nodeIds = graph.getNodeData().map((node) => String(node.id))
  const edgeIds = graph.getEdgeData().map((edge) => String(edge.id))
  void graph.setElementState(Object.fromEntries([
    ...nodeIds.map((id) => [id, []]),
    ...edgeIds.map((id) => [id, []]),
  ]))
  hideAllPorts()
}

function applyFocus(ids: Set<string>): void {
  if (!graph) return
  const states: Record<string, string[]> = {}
  for (const node of graph.getNodeData()) {
    const id = String(node.id)
    states[id] = ids.has(id) ? ['focused', 'selected'] : ['dimmed']
  }
  for (const edge of graph.getEdgeData()) {
    const id = String(edge.id)
    states[id] = ids.has(id) ? ['focused', 'selected'] : ['dimmed']
  }
  void graph.setElementState(states)
}

function restoreSelectionVisuals(): void {
  if (selectedNodeId.value != null) selectNode(selectedNodeId.value)
  else if (selectedEdgeId.value) selectEdge(selectedEdgeId.value)
  else clearSelection()
}

function updatePortVisibility(mapId: number | null, edge?: MapOverviewEdge): void {
  if (!graph || !snapshot.value) return
  const highlighted = new Map<number, Map<string, { x: number; y: number; role: 'source' | 'target' | 'both' }>>()
  const mark = (nodeId: number, x: number, y: number, role: 'source' | 'target') => {
    const key = mapOverviewPortKey(x, y)
    let ports = highlighted.get(nodeId)
    if (!ports) {
      ports = new Map()
      highlighted.set(nodeId, ports)
    }
    const existing = ports.get(key)
    if (!existing) {
      ports.set(key, { x, y, role })
      return
    }
    if (existing.role !== role) existing.role = 'both'
  }
  if (edge) {
    mark(edge.sourceMapId, edge.sourceX, edge.sourceY, 'source')
    mark(edge.targetMapId, edge.targetX, edge.targetY, 'target')
  } else if (mapId != null) {
    for (const item of snapshot.value.edges) {
      if (item.sourceMapId === mapId) mark(mapId, item.sourceX, item.sourceY, 'source')
      if (item.targetMapId === mapId) mark(mapId, item.targetX, item.targetY, 'target')
    }
  }
  const portsByMap = collectPorts(snapshot.value)
  graph.updateNodeData(snapshot.value.nodes.map((node) => {
    const size = mapOverviewNodeSize(node)
    const allPorts = portsByMap.get(node.id) || []
    const active = highlighted.get(node.id) || new Map()
    return {
      id: String(node.id),
      style: {
        ports: allPorts.map((port) => {
          const activePort = active.get(port.key)
          const hollow = !activePort || activePort.role === 'source'
          return {
            key: port.key,
            placement: port.placement,
            r: activePort ? 5 : 0,
            fill: activePort ? (hollow ? 'transparent' : '#c65f3d') : 'transparent',
            stroke: activePort ? '#c65f3d' : 'transparent',
            lineWidth: activePort ? 2 : 0,
          }
        }),
        badges: [...active.entries()].flatMap(([key, port]) => {
          const meta = allPorts.find((item) => item.key === key)
          if (!meta) return []
          return [{
            text: `${port.x},${port.y}`,
            placement: 'left' as const,
            offsetX: (meta.placement[0] - 0.5) * size.width,
            offsetY: (meta.placement[1] - 0.5) * size.imageHeight - 12,
            fontSize: 10,
            fill: '#5f605a',
            background: true,
            backgroundFill: '#f7f7f4',
            backgroundOpacity: 0.92,
            padding: [2, 4],
          }]
        }),
      },
    }
  }))
  void graph.draw()
}

function hideAllPorts(): void {
  if (!graph || !snapshot.value) return
  const portsByMap = collectPorts(snapshot.value)
  graph.updateNodeData(snapshot.value.nodes.map((node) => {
    const ports = portsByMap.get(node.id) || []
    return {
      id: String(node.id),
      style: {
        ports: ports.map((port) => ({
          key: port.key,
          placement: port.placement,
          r: 0,
          fill: 'transparent',
          stroke: 'transparent',
          lineWidth: 0,
        })),
        badges: [],
      },
    }
  }))
  void graph.draw()
}

function focusSearchResult(node: MapOverviewNode): void {
  searchQuery.value = `${node.name} · MAP${String(node.id).padStart(3, '0')}`
  selectNode(node.id)
  if (!graph) return
  void graph.focusElement(String(node.id), { duration: 220 })
  const zoom = Math.max(graph.getZoom(), 0.7)
  void graph.zoomTo(zoom, false)
}

function openMap(mapId: number): void {
  contextMenu.value = null
  void router.push({ path: '/workbench', query: { mapId: String(mapId) } })
}

function openEvent(mapId: number, eventId: number): void {
  void router.push({ path: '/workbench', query: { mapId: String(mapId), eventId: String(eventId) } })
}

function onGraphKeydown(event: KeyboardEvent): void {
  if (!graph || !snapshot.value?.nodes.length) return
  if (isTextControl(event.target)) return
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    applyHistoryMove(event.shiftKey ? moveHistory.redo() : moveHistory.undo(), event.shiftKey)
    return
  }
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    applyHistoryMove(moveHistory.redo(), true)
    return
  }
  const ids = snapshot.value.nodes.map((node) => node.id)
  const index = Math.max(0, ids.indexOf(selectedNodeId.value || ids[0]))
  if (event.key === 'Enter' && selectedNodeId.value != null) {
    event.preventDefault()
    openMap(selectedNodeId.value)
    return
  }
  if (event.key === 'Escape') {
    clearSelection()
    return
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  if (event.altKey && selectedNodeId.value != null) {
    const nodeId = String(selectedNodeId.value)
    const before = roundedPosition(nodeId)
    const step = event.shiftKey ? 32 : 8
    const next = {
      x: before.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      y: before.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
    }
    applyPositions({ [nodeId]: next })
    moveHistory.record({ nodeId, before, after: next })
    persistGraphPositions()
    paintChunksSoon()
    return
  }
  const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
  const nextId = ids[(index + delta + ids.length) % ids.length]
  selectNode(nextId)
  void graph.focusElement(String(nextId), { duration: 160 })
}

function scheduleChunks(delayMs = 0): void {
  if (!surfaceActive || !surfaceValidated || !graph || !snapshot.value) return
  const cameraForUnload = readCameraBox()
  if (cameraForUnload) {
    const positionsForUnload = Object.fromEntries(
      graph.getNodeData().map((node) => [String(node.id), {
        x: Number(node.style?.x || 0),
        y: Number(node.style?.y || 0),
      }]),
    )
    unloadOffscreenChunks(cameraForUnload, positionsForUnload)
  }
  if (activeChunkLoads >= 1 || chunkScheduleTimer) return
  chunkScheduleTimer = setTimeout(() => {
    chunkScheduleTimer = null
    if (!surfaceActive || !surfaceValidated || !graph || !snapshot.value || activeChunkLoads >= 1) return
    const camera = readCameraBox()
    if (!camera) return
    const positions = Object.fromEntries(
      graph.getNodeData().map((node) => [String(node.id), {
        x: Number(node.style?.x || 0),
        y: Number(node.style?.y || 0),
      }]),
    )
    const requests = prioritizeMapOverviewChunks(
      snapshot.value.nodes,
      positions,
      camera,
      graph.getZoom(),
      window.devicePixelRatio || 1,
    )
    for (const request of requests) preferredLevelByMap.set(request.mapId, request.level)
    const next = requests.find((request) => {
      const key = mapOverviewChunkKey(request.mapId, request.version, request.chunkX, request.chunkY, request.level)
      return !displayedChunkKeys.has(key) && !inflightChunkKeys.has(key) && !failedDecodeChunkKeys.has(key)
    })
    if (next) void loadChunk(next)
    else paintChunksSoon()
  }, Math.max(0, delayMs))
}

function readCameraBox(): MapOverviewViewportBox | null {
  if (!graph || !graphHost.value) return null
  const width = graphHost.value.clientWidth
  const height = graphHost.value.clientHeight
  if (width <= 0 || height <= 0) return null
  const topLeft = graph.getCanvasByViewport([0, 0])
  const bottomRight = graph.getCanvasByViewport([width, height])
  return {
    x: Math.min(topLeft[0], bottomRight[0]),
    y: Math.min(topLeft[1], bottomRight[1]),
    width: Math.abs(bottomRight[0] - topLeft[0]),
    height: Math.abs(bottomRight[1] - topLeft[1]),
  }
}

async function loadChunk(request: MapOverviewChunkRequest): Promise<void> {
  const key = mapOverviewChunkKey(request.mapId, request.version, request.chunkX, request.chunkY, request.level)
  const generation = loadGeneration
  const qualityGeneration = chunkGeneration
  inflightChunkKeys.add(key)
  activeChunkLoads += 1
  let failed = false
  try {
    const result = await maps.overviewChunk(
      request.mapId,
      request.version,
      request.chunkX,
      request.chunkY,
      request.level,
      currentProject.value,
      chunkSessionId,
    )
    if (!surfaceActive || generation !== loadGeneration || qualityGeneration !== chunkGeneration) return
    await rememberChunk(key, request, result)
    if (chunkErrors.value[request.mapId]) {
      const nextErrors = { ...chunkErrors.value }
      delete nextErrors[request.mapId]
      chunkErrors.value = nextErrors
    }
    paintChunksSoon()
  } catch (error) {
    failed = true
    if (generation === loadGeneration && qualityGeneration === chunkGeneration) {
      // IPC / resource / decode failure: park this chunk only; keep any older displayed level.
      failedDecodeChunkKeys.add(key)
      chunkErrors.value = {
        ...chunkErrors.value,
        [request.mapId]: formatUserFacingErrorMessage(error, 'general', language.value),
      }
    }
  } finally {
    if (generation === loadGeneration && qualityGeneration === chunkGeneration) {
      inflightChunkKeys.delete(key)
      activeChunkLoads = Math.max(0, activeChunkLoads - 1)
      // Failed keys stay out of the queue until explicit retry; still drain other pending chunks.
      if (failed) paintChunksSoon()
      scheduleChunks(0)
    }
  }
}

async function rememberChunk(
  key: string,
  request: MapOverviewChunkRequest,
  result: MapOverviewChunk,
): Promise<void> {
  try {
    const response = await fetch(result.resourceUrl)
    if (!response.ok) throw new Error(`Chunk fetch failed (${response.status}).`)
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    decodedChunks.set({
      key,
      bytes: Math.max(1, bitmap.width * bitmap.height * 4),
      bitmap,
    })
    displayedChunkKeys.set(key, {
      ...request,
      url: result.resourceUrl,
      logicalX: result.logicalX,
      logicalY: result.logicalY,
      logicalWidth: result.logicalWidth,
      logicalHeight: result.logicalHeight,
    })
    failedDecodeChunkKeys.delete(key)
  } catch (error) {
    failedDecodeChunkKeys.add(key)
    displayedChunkKeys.delete(key)
    decodedChunks.delete(key)
    throw error
  }
}

function unloadOffscreenChunks(
  camera: MapOverviewViewportBox,
  positions: Record<string, { x: number; y: number }>,
): void {
  if (!snapshot.value || !graph) return
  const preferredRequests = prioritizeMapOverviewChunks(
    snapshot.value.nodes,
    positions,
    camera,
    graph.getZoom(),
    window.devicePixelRatio || 1,
  )
  const preferredKeys = new Set(
    preferredRequests.map((request) => (
      mapOverviewChunkKey(request.mapId, request.version, request.chunkX, request.chunkY, request.level)
    )),
  )
  const preferredCells = new Set(
    preferredRequests.map((request) => (
      mapOverviewChunkCellKey(request.mapId, request.version, request.chunkX, request.chunkY)
    )),
  )

  for (const [key, entry] of [...displayedChunkKeys.entries()]) {
    const cell = mapOverviewChunkCellKey(entry.mapId, entry.version, entry.chunkX, entry.chunkY)
    const preferredLevel = preferredLevelByMap.get(entry.mapId) as MapOverviewChunkRequest['level'] | undefined
    const preferredKey = preferredLevel == null
      ? null
      : mapOverviewChunkKey(entry.mapId, entry.version, entry.chunkX, entry.chunkY, preferredLevel)
    const preferredReady = Boolean(
      preferredKey
      && displayedChunkKeys.has(preferredKey)
      && decodedChunks.get(preferredKey)?.bitmap,
    )
    const retain = shouldRetainStaleMapOverviewChunk({
      entryKey: key,
      entryLevel: entry.level,
      preferredKeys,
      preferredCells,
      preferredLevel,
      preferredReady,
      cellKey: cell,
    })
    if (retain) continue
    displayedChunkKeys.delete(key)
    decodedChunks.delete(key)
  }
}

function paintChunksSoon(): void {
  if (paintFrame.pending) return
  paintFrame.pending = true
  requestAnimationFrame(() => {
    paintFrame.pending = false
    paintChunkOverlay()
  })
}

function paintChunkOverlay(): void {
  const canvas = chunkHost.value
  const host = graphHost.value
  if (!canvas || !host || !graph || !snapshot.value) return
  const width = host.clientWidth
  const height = host.clientHeight
  if (width <= 0 || height <= 0) return
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  for (const entry of displayedChunkKeys.values()) {
    const node = snapshot.value.nodes.find((item) => item.id === entry.mapId)
    if (!node) continue
    const position = roundedPosition(String(entry.mapId))
    const size = mapOverviewNodeSize(node)
    const left = position.x - size.width / 2 + entry.logicalX
    const top = position.y - size.imageHeight / 2 + entry.logicalY
    const topLeft = graph.getViewportByCanvas([left, top])
    const bottomRight = graph.getViewportByCanvas([left + entry.logicalWidth, top + entry.logicalHeight])
    const dx = Math.min(topLeft[0], bottomRight[0])
    const dy = Math.min(topLeft[1], bottomRight[1])
    const dw = Math.abs(bottomRight[0] - topLeft[0])
    const dh = Math.abs(bottomRight[1] - topLeft[1])
    const decoded = decodedChunks.get(mapOverviewChunkKey(entry.mapId, entry.version, entry.chunkX, entry.chunkY, entry.level))
    if (decoded?.bitmap) {
      ctx.drawImage(decoded.bitmap as CanvasImageSource, dx, dy, dw, dh)
    }
  }
}

function markGraphInteraction(): void {
  lastGraphInteractionAt = Date.now()
  scheduleChunks(48)
  paintChunksSoon()
}

function retryChunks(node: MapOverviewNode): void {
  for (const [key, entry] of [...displayedChunkKeys.entries()]) {
    if (entry.mapId === node.id) {
      displayedChunkKeys.delete(key)
      decodedChunks.delete(key)
    }
  }
  for (const key of [...failedDecodeChunkKeys]) {
    if (mapOverviewChunkKeyBelongsToMap(key, node.id)) failedDecodeChunkKeys.delete(key)
  }
  const nextErrors = { ...chunkErrors.value }
  delete nextErrors[node.id]
  chunkErrors.value = nextErrors
  scheduleChunks(0)
}

function resetGraphState(): void {
  rotateChunkSession()
  loadGeneration += 1
  chunkGeneration += 1
  snapshot.value = null
  selectedNodeId.value = null
  selectedEdgeId.value = null
  contextMenu.value = null
  displayedChunkKeys.clear()
  decodedChunks.clear()
  inflightChunkKeys.clear()
  failedDecodeChunkKeys.clear()
  preferredLevelByMap.clear()
  if (chunkScheduleTimer) clearTimeout(chunkScheduleTimer)
  chunkScheduleTimer = null
  chunkErrors.value = {}
  activeChunkLoads = 0
  viewportReady = false
  layoutMigrationPending = false
  savedViewport = null
  surfaceValidated = false
  activeLayoutHandle?.stop()
  activeLayoutHandle = null
  destroyGraph()
}

function destroyGraph(): void {
  activeLayoutHandle?.stop()
  activeLayoutHandle = null
  if (graph && !graph.destroyed) {
    graph.stopLayout()
    graph.destroy()
  }
  graph = null
  graphBoundContainer = null
  const canvas = chunkHost.value
  if (canvas) {
    const ctx = canvas.getContext('2d')
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
  }
}

function applyHistoryMove(move: { nodeId: string; before: MapOverviewNodePosition; after: MapOverviewNodePosition } | null, redo: boolean): void {
  if (!move || !graph) return
  applyPositions({ [move.nodeId]: redo ? move.after : move.before })
  persistGraphPositions()
  paintChunksSoon()
}

function isTextControl(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function createChunkSessionId(): string {
  return crypto.randomUUID()
}

function cancelChunkSession(): void {
  const sessionId = chunkSessionId
  void maps.cancelOverviewChunks(sessionId).catch(() => undefined)
}

function rotateChunkSession(): void {
  cancelChunkSession()
  chunkSessionId = createChunkSessionId()
}

function mapLabel(mapId: number): string {
  const node = snapshot.value?.nodes.find((item) => item.id === mapId)
  return node ? `${node.name} · MAP${String(node.id).padStart(3, '0')}` : `MAP${String(mapId).padStart(3, '0')}`
}

function onLayoutSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as MapOverviewLayoutId
  void confirmLayoutChange(value)
}
</script>

<template>
  <section class="map-overview" data-ui-id="map-overview-view" :aria-busy="validating || refreshing || layoutRunning">
    <div v-if="!currentProject" class="overview-state" data-ui-id="map-overview-empty">
      <strong>{{ t('mapOverview.empty.title') }}</strong>
      <span>{{ t('mapOverview.empty.body') }}</span>
      <router-link :to="{ path: '/console', query: { page: 'home' } }">{{ t('mapOverview.empty.action') }}</router-link>
    </div>
    <template v-else>
      <header v-if="snapshot || !loading" class="overview-toolbar">
        <div class="overview-search">
          <Search aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="t('mapOverview.search.placeholder')"
            :aria-label="t('mapOverview.search.label')"
            data-ui-id="map-overview-search"
          >
          <div v-if="searchMatches.length" class="search-results" role="listbox">
            <button
              v-for="node in searchMatches"
              :key="node.id"
              type="button"
              role="option"
              @click="focusSearchResult(node)"
            >
              <span>{{ node.name }}</span>
              <small>MAP{{ String(node.id).padStart(3, '0') }}</small>
            </button>
          </div>
        </div>
        <label class="layout-control">
          <span>{{ t('mapOverview.layout.label') }}</span>
          <select
            :value="selectedLayoutId"
            :aria-label="t('mapOverview.layout.label')"
            data-ui-id="map-overview-layout"
            @change="onLayoutSelect"
          >
            <option v-for="layout in MAP_OVERVIEW_LAYOUTS" :key="layout.id" :value="layout.id">
              {{ t(layout.labelKey) }}
            </option>
          </select>
        </label>
        <button type="button" class="toolbar-action" :aria-label="t('mapOverview.fit')" @click="fitGraph">
          <Aim /><span>{{ t('mapOverview.fit') }}</span>
        </button>
        <button type="button" class="toolbar-action" :aria-label="t('mapOverview.relayout.action')" @click="confirmRelayout">
          <Refresh /><span>{{ t('mapOverview.relayout.action') }}</span>
        </button>
        <span v-if="snapshot" class="overview-summary">
          {{ t('mapOverview.summary', { maps: snapshot.nodes.length, edges: snapshot.edges.length }) }}
          <template v-if="snapshot.unresolvedTransferCount"> · {{ t('mapOverview.unresolved', { count: snapshot.unresolvedTransferCount }) }}</template>
        </span>
      </header>

      <div v-if="loading && !snapshot" class="overview-state" role="status">{{ t('mapOverview.loading') }}</div>
      <div v-else-if="loadError && !snapshot" class="overview-state error" role="alert" data-ui-id="map-overview-load-error">
        <strong>{{ t('mapOverview.loadFailed') }}</strong>
        <span>{{ loadError }}</span>
        <button type="button" data-ui-id="map-overview-retry" @click="activateOverview()">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="snapshot" class="overview-body">
        <div
          class="overview-canvas-stack"
          tabindex="0"
          role="application"
          :aria-label="t('mapOverview.canvasAria')"
          data-ui-id="map-overview-canvas"
          @keydown="onGraphKeydown"
          @click.self="contextMenu = null"
        >
          <div ref="graphHost" class="overview-canvas" />
          <canvas ref="chunkHost" class="overview-chunk-layer" aria-hidden="true" />
        </div>
        <div v-if="refreshing || loadError" class="overview-refresh-state" :class="{ error: loadError }" :role="loadError ? 'alert' : 'status'">
          <template v-if="loadError">
            <strong>{{ t('mapOverview.loadFailed') }}</strong>
            <span>{{ loadError }}</span>
            <button type="button" data-ui-id="map-overview-retry" @click="activateOverview()">{{ t('common.retry') }}</button>
          </template>
          <span v-else>{{ t('mapOverview.loading') }}</span>
        </div>
        <div class="overview-zoom" data-ui-id="map-overview-zoom">
          <button
            type="button"
            :disabled="zoomPercent <= MAP_OVERVIEW_MIN_ZOOM * 100"
            :title="t('mapOverview.zoom.out')"
            :aria-label="t('mapOverview.zoom.out')"
            @click="zoomOut"
          >−</button>
          <label :aria-label="t('mapOverview.zoom.input')">
            <input
              ref="zoomInput"
              v-model="zoomDraft"
              type="text"
              inputmode="numeric"
              :aria-label="t('mapOverview.zoom.input')"
              data-ui-id="map-overview-zoom-input"
              @focus="selectZoomInput"
              @keydown.enter.prevent="applyZoomDraft"
              @keydown.esc.prevent="cancelZoomDraft"
              @blur="applyZoomDraft"
            >
            <span>%</span>
          </label>
          <button
            type="button"
            :disabled="zoomPercent >= MAP_OVERVIEW_MAX_ZOOM * 100"
            :title="t('mapOverview.zoom.in')"
            :aria-label="t('mapOverview.zoom.in')"
            @click="zoomIn"
          >+</button>
        </div>
        <aside v-if="selectedNode || selectedEdge" class="overview-inspector" data-ui-id="map-overview-inspector">
          <template v-if="selectedNode">
            <header>
              <strong>{{ selectedNode.name }}</strong>
              <span>MAP{{ String(selectedNode.id).padStart(3, '0') }}</span>
            </header>
            <dl>
              <div><dt>{{ t('mapOverview.inspector.parent') }}</dt><dd>{{ selectedNode.parentId ? mapLabel(selectedNode.parentId) : '—' }}</dd></div>
              <div><dt>{{ t('mapOverview.inspector.incoming') }}</dt><dd>{{ selectedNode.incomingCount }}</dd></div>
              <div><dt>{{ t('mapOverview.inspector.outgoing') }}</dt><dd>{{ selectedNode.outgoingCount }}</dd></div>
              <div><dt>{{ t('mapOverview.inspector.unresolved') }}</dt><dd>{{ selectedNode.unresolvedCount }}</dd></div>
            </dl>
            <div v-if="selectedNode.issues.length" class="issue-list">
              <strong>{{ t('mapOverview.inspector.issues') }}</strong>
              <p v-for="issue in selectedNode.issues" :key="`${issue.code}-${issue.targetMapId || ''}-${issue.eventId || ''}-${issue.commandIndex || ''}`">{{ issue.message }}</p>
            </div>
            <div v-if="chunkErrors[selectedNode.id]" class="issue-list thumbnail-failure" role="alert">
              <strong>{{ t('mapOverview.thumbnail.failed') }}</strong>
              <p>{{ chunkErrors[selectedNode.id] }}</p>
              <button type="button" @click="retryChunks(selectedNode)">{{ t('common.retry') }}</button>
            </div>
            <div class="relation-list">
              <strong>{{ t('mapOverview.inspector.outgoing') }}</strong>
              <button v-for="edge in selectedNodeEdges.outgoing" :key="edge.id" type="button" @click="selectEdge(edge.id)">
                {{ mapLabel(edge.targetMapId) }} <span>×{{ edge.count }}</span>
              </button>
              <strong>{{ t('mapOverview.inspector.incoming') }}</strong>
              <button v-for="edge in selectedNodeEdges.incoming" :key="edge.id" type="button" @click="selectEdge(edge.id)">
                {{ mapLabel(edge.sourceMapId) }} <span>×{{ edge.count }}</span>
              </button>
            </div>
            <button type="button" class="inspector-primary" @click="openMap(selectedNode.id)">{{ t('mapOverview.openEditor') }}</button>
          </template>
          <template v-else-if="selectedEdge">
            <header>
              <strong>{{ mapLabel(selectedEdge.sourceMapId) }}</strong>
              <span>→ {{ mapLabel(selectedEdge.targetMapId) }} · ×{{ selectedEdge.count }}</span>
            </header>
            <div class="source-list">
              <article v-for="source in selectedEdge.sources" :key="`${source.eventId}-${source.pageIndex}-${source.commandIndex}`">
                <strong>{{ source.eventName }} · #{{ source.eventId }}</strong>
                <span>{{ t('mapOverview.source.location', { page: source.pageIndex + 1, command: source.commandIndex + 1 }) }}</span>
                <span>{{ source.sourceX }}, {{ source.sourceY }} → {{ source.targetX }}, {{ source.targetY }}</span>
                <code>{{ JSON.stringify(source.pageConditions) }}</code>
                <button type="button" @click="openEvent(source.sourceMapId, source.eventId)">{{ t('mapOverview.openEvent') }}</button>
              </article>
            </div>
          </template>
        </aside>
        <div v-if="layoutError" class="layout-error" role="alert">
          <span>{{ layoutError }}</span>
          <button type="button" @click="retryLayout">{{ t('common.retry') }}</button>
        </div>
        <div
          v-if="contextMenu"
          class="overview-context-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        >
          <button type="button" @click="openMap(contextMenu.mapId)">{{ t('mapOverview.openEditor') }}</button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.map-overview { min-width:0; min-height:0; flex:1; display:flex; flex-direction:column; overflow:hidden; border-radius:12px; background:var(--app-bg); box-shadow:var(--app-shadow-1); }
.overview-toolbar { position:relative; z-index:5; min-height:48px; display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--app-border); background:var(--app-bg); }
.overview-search { position:relative; width:min(360px, 42vw); height:34px; display:flex; align-items:center; gap:7px; padding:0 10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); }
.overview-search>svg { width:15px; color:var(--app-ink-muted); }
.overview-search input { min-width:0; flex:1; border:0; outline:0; background:transparent; color:var(--app-ink); font:inherit; font-size:13px; }
.search-results { position:absolute; top:38px; left:0; right:0; max-height:320px; overflow:auto; padding:4px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); box-shadow:var(--app-shadow-2); }
.search-results button { width:100%; min-height:36px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 8px; border:0; border-radius:5px; background:transparent; color:var(--app-ink); text-align:left; cursor:pointer; }
.search-results button:hover,.search-results button:focus-visible { background:var(--app-accent-soft); outline:none; }
.search-results small { color:var(--app-ink-muted); font-variant-numeric:tabular-nums; }
.layout-control { min-height:34px; display:inline-flex; align-items:center; gap:6px; padding:0 8px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink-muted); font-size:12px; }
.layout-control select { border:0; outline:0; background:transparent; color:var(--app-ink); font:inherit; cursor:pointer; }
.layout-control:focus-within { outline:2px solid var(--app-accent); outline-offset:2px; }
.toolbar-action { min-height:34px; display:inline-flex; align-items:center; gap:6px; padding:0 10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink-soft); font:inherit; font-size:12px; cursor:pointer; }
.toolbar-action svg { width:15px; }
.toolbar-action:hover { color:var(--app-ink); border-color:var(--app-border-strong); }
.toolbar-action:focus-visible { outline:2px solid var(--app-accent); outline-offset:2px; }
.overview-summary { margin-left:auto; color:var(--app-ink-muted); font-size:11.5px; white-space:nowrap; }
.overview-body { position:relative; min-height:0; flex:1; display:flex; overflow:hidden; background:var(--app-bg-sunken); }
.overview-refresh-state {
  position:absolute;
  inset:12px auto auto 50%;
  z-index:5;
  max-width:min(560px, calc(100% - 32px));
  transform:translateX(-50%);
  display:flex;
  align-items:center;
  gap:10px;
  padding:9px 12px;
  border:1px solid var(--app-border);
  border-radius:10px;
  background:color-mix(in srgb, var(--app-bg) 94%, transparent);
  box-shadow:0 8px 24px rgba(35,30,24,.12);
  color:var(--app-text-muted);
}
.overview-refresh-state.error { color:var(--app-danger); }
.overview-refresh-state button { flex:none; }
.overview-canvas-stack { position:relative; min-width:0; min-height:0; flex:1; outline:none; background-image:radial-gradient(circle, color-mix(in srgb,var(--app-ink-muted) 22%,transparent) 1px, transparent 1px); background-size:18px 18px; }
.overview-canvas-stack:focus-visible { box-shadow:inset 0 0 0 3px var(--app-accent); }
.overview-canvas { position:absolute; inset:0; }
.overview-chunk-layer { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:1; }
.overview-zoom { position:absolute; left:14px; bottom:14px; z-index:3; display:flex; align-items:center; gap:2px; padding:3px; border-radius:var(--app-radius-md); background:var(--app-bg-elevated); box-shadow:var(--app-shadow-2); }
.overview-zoom button { height:28px; min-width:30px; padding:0 7px; border:0; border-radius:var(--app-radius-sm); background:transparent; color:var(--app-ink-soft); font:600 11px var(--app-font-mono); cursor:pointer; }
.overview-zoom button:hover:not(:disabled) { background:var(--app-bg-soft); color:var(--app-ink); }
.overview-zoom button:focus-visible,.overview-zoom label:focus-within { outline:2px solid var(--app-accent); outline-offset:1px; }
.overview-zoom button:disabled { opacity:.4; cursor:default; }
.overview-zoom label { height:28px; min-width:54px; display:flex; align-items:center; justify-content:center; gap:1px; border-radius:var(--app-radius-sm); color:var(--app-ink); font:600 11px var(--app-font-mono); }
.overview-zoom input { width:34px; padding:0; border:0; outline:0; background:transparent; color:inherit; font:inherit; text-align:right; font-variant-numeric:tabular-nums; }
.overview-zoom label span { padding-right:4px; color:var(--app-ink-muted); }
.overview-inspector { z-index:2; width:310px; min-width:310px; overflow:auto; padding:16px; border-left:1px solid var(--app-border); background:var(--app-bg); color:var(--app-ink-soft); }
.overview-inspector header { display:grid; gap:4px; padding-bottom:13px; border-bottom:1px solid var(--app-border); }
.overview-inspector header strong { color:var(--app-ink); font-size:15px; }
.overview-inspector header span { color:var(--app-ink-muted); font-size:11px; }
.overview-inspector dl { display:grid; gap:8px; margin:14px 0; }
.overview-inspector dl div { display:flex; justify-content:space-between; gap:12px; }
.overview-inspector dt,.overview-inspector dd { margin:0; font-size:12px; }
.overview-inspector dd { color:var(--app-ink); text-align:right; }
.issue-list,.relation-list,.source-list { display:grid; gap:7px; margin-top:14px; }
.issue-list>strong,.relation-list>strong { margin-top:5px; color:var(--app-ink); font-size:12px; }
.issue-list p,.source-list span,.source-list code { margin:0; color:var(--app-ink-muted); font-size:12px; word-break:break-word; }
.relation-list button,.source-list button,.inspector-primary,.overview-state button,.layout-error button,.overview-refresh-state button { min-height:32px; padding:0 10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink); font:inherit; font-size:12px; text-align:left; cursor:pointer; }
.relation-list button { display:flex; justify-content:space-between; gap:8px; }
.inspector-primary { margin-top:16px; width:100%; text-align:center; background:var(--app-accent-soft); border-color:transparent; color:var(--app-accent-ink, var(--app-ink)); }
.source-list article { display:grid; gap:5px; padding:10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); }
.overview-state { min-height:0; flex:1; display:grid; place-content:center; gap:8px; padding:24px; text-align:center; color:var(--app-ink-muted); }
.overview-state.error,.layout-error { color:var(--app-danger); }
.layout-error { position:absolute; left:14px; top:14px; z-index:4; display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg); }
.overview-context-menu { position:fixed; z-index:20; min-width:160px; padding:4px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); box-shadow:var(--app-shadow-2); }
.overview-context-menu button { width:100%; min-height:34px; border:0; border-radius:6px; background:transparent; color:var(--app-ink); font:inherit; text-align:left; padding:0 10px; cursor:pointer; }
.overview-context-menu button:hover { background:var(--app-accent-soft); }
</style>
