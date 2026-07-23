<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { Aim, Download, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import type {
  MapOverviewLayoutId,
  MapOverviewLayoutParameters,
  MapOverviewNode,
  MapOverviewScanProgressPhase,
  MapOverviewSnapshot,
} from '@contract/types'
import {
  classifyMapOverviewEdgeConditions,
  classifyMapOverviewTransferConditions,
  summarizeMapOverviewTransferConditions,
  type MapOverviewTransferConditionCategory,
  type MapOverviewTransferConditionType,
} from '@contract/map-overview-transfer-condition'
import { maps, workspaceSurfaces } from '../api/client'
import MapOverviewSvgCanvas from '../components/map-overview/MapOverviewSvgCanvas.vue'
import type { MapOverviewSvgCanvasApi } from '../components/map-overview/mapOverviewSvgCanvasApi'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useMapOverviewExportStore } from '../stores/mapOverviewExport'
import { useWorkspaceStore } from '../stores/workspace'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'
import { formatMapOverviewExportError } from '../utils/mapOverviewExportError'
import { findMapOverviewMatches } from '../utils/mapOverviewSearch'
import { MapOverviewMoveHistory, type MapOverviewNodePosition } from '../utils/mapOverviewMoveHistory'
import { MAP_OVERVIEW_LAYOUT_VERSION, mapOverviewNodeSize } from '../utils/mapOverviewNodeSize'
import {
  isMapOverviewThumbnailVersionChanged,
  mapOverviewPreparationPercent,
  validateMapOverviewLayoutNoOverlap,
  validateMapOverviewLayoutPositions,
} from '../utils/mapOverviewPreparation'
import {
  DEFAULT_MAP_OVERVIEW_LAYOUT_ID,
  MAP_OVERVIEW_LAYOUTS,
  MAP_OVERVIEW_LAYOUT_CONFIRM_I18N,
} from '../utils/mapOverviewLayouts'
import {
  defaultMapOverviewLayoutParameters,
  MapOverviewLayoutParameterError,
  type MapOverviewLayoutParameterField,
  parseMapOverviewLayoutParameters,
} from '../utils/mapOverviewLayoutParameters'
import {
  executeMapOverviewLayout,
  type MapOverviewLayoutRunHandle,
} from '../utils/mapOverviewLayoutExecute'
import { MapOverviewLayeredGridError } from '../utils/mapOverviewLayeredGrid'
import type { MapOverviewLayoutPositions } from '../utils/mapOverviewLayoutModel'
import { MapOverviewLayoutTaskError } from '../utils/mapOverviewLayoutWorkerClient'
import {
  clampMapOverviewZoom,
  clampMapOverviewZoomPercent,
  formatMapOverviewZoomPercent,
  MAP_OVERVIEW_MAX_ZOOM,
  MAP_OVERVIEW_MIN_ZOOM,
  MAP_OVERVIEW_ZOOM_STEP,
  mapOverviewZoomFromPercent,
  parseMapOverviewZoomPercent,
} from '../utils/mapOverviewViewport'

const projectStore = useProjectStore()
const mapOverviewExportStore = useMapOverviewExportStore()
const workspaceStore = useWorkspaceStore()
const router = useRouter()
const { language, t } = useI18n()
const graphHost = ref<HTMLElement | null>(null)
const snapshot = ref<MapOverviewSnapshot | null>(null)
const loading = ref(false)
const validating = ref(false)
const refreshing = ref(false)
const loadError = ref('')
const layoutError = ref('')
const searchQuery = ref('')
const selectedLayoutId = ref<MapOverviewLayoutId>(DEFAULT_MAP_OVERVIEW_LAYOUT_ID)
const appliedLayoutId = ref<MapOverviewLayoutId>(DEFAULT_MAP_OVERVIEW_LAYOUT_ID)
const failedLayoutId = ref<MapOverviewLayoutId | null>(null)
const layoutElapsedSeconds = ref(0)
const zoomPercent = ref(100)
const zoomDraft = ref('100')
const zoomInput = ref<HTMLInputElement | null>(null)
const selectedNodeId = ref<number | null>(null)
const selectedEdgeId = ref<string | null>(null)
const contextMenu = ref<{ mapId: number; x: number; y: number } | null>(null)
const thumbnailProgressCompleted = ref(0)
const thumbnailProgressTotal = ref(0)
const thumbnailFailures = ref<ReadonlyMap<number, string>>(new Map())
const retryingThumbnailIds = ref<ReadonlySet<number>>(new Set())
const overviewProgressPhase = ref<MapOverviewScanProgressPhase | 'starting'>('starting')
const overviewProgressCompleted = ref(0)
const overviewProgressTotal = ref(0)
const preparationPhase = ref<'images' | 'layout' | 'ready' | 'error'>('images')
const layoutRunning = ref(false)
const hasPresentedGraph = ref(false)
const layoutParametersOpen = ref(false)
const layoutParameterDraft = ref<Record<string, unknown>>({})
const layoutParameterErrors = ref<Partial<Record<MapOverviewLayoutParameterField, string>>>({})

let graph: MapOverviewSvgCanvasApi | null = null
let graphBoundContainer: HTMLElement | null = null
let layoutRequestId = 0
let loadGeneration = 0
let overviewProgressSessionId = createOverviewSessionId()
let stopOverviewProgress: (() => void) | null = null
let thumbnailSessionId = createThumbnailSessionId()
let zoomPersistTimer: ReturnType<typeof setTimeout> | null = null
let layoutElapsedTimer: ReturnType<typeof setInterval> | null = null
let viewportReady = false
let surfaceActive = false
let surfaceVersion = ''
let savedViewport: { zoom: number; pan: [number, number] } | null = null
let activeLayoutHandle: MapOverviewLayoutRunHandle | null = null
let failedLayoutParameters: MapOverviewLayoutParameters | null = null
const grabbedPositions = new Map<string, MapOverviewNodePosition>()
const moveHistory = new MapOverviewMoveHistory(100)
const thumbnailImages = new Map<number, HTMLImageElement>()
const thumbnailRetrySessions = new Map<number, string>()

const currentProject = computed(() => projectStore.currentProject || '')
const selectedNode = computed(() => snapshot.value?.nodes.find((node) => node.id === selectedNodeId.value) || null)
const selectedEdge = computed(() => snapshot.value?.edges.find((edge) => edge.id === selectedEdgeId.value) || null)
const selectedThumbnailFailure = computed(() => selectedNode.value
  ? thumbnailFailures.value.get(selectedNode.value.id) || ''
  : '')
const failedThumbnailCount = computed(() => thumbnailFailures.value.size)
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
const thumbnailProgressPercent = computed(() => mapOverviewPreparationPercent(
  thumbnailProgressCompleted.value,
  thumbnailProgressTotal.value,
))
const overviewProgressPercent = computed(() => mapOverviewPreparationPercent(
  overviewProgressCompleted.value,
  overviewProgressTotal.value,
))
const overviewProgressLabel = computed(() => {
  switch (overviewProgressPhase.value) {
    case 'checking-cache': return t('mapOverview.preparing.checkingCache')
    case 'reading-maps': return t('mapOverview.preparing.readingMaps')
    case 'scanning-relations': return t('mapOverview.preparing.scanningRelations')
    case 'preparing-images': return t('mapOverview.preparing.preparingImageVersions')
    case 'verifying-project': return t('mapOverview.preparing.verifyingProject')
    default: return t('mapOverview.preparing.reading')
  }
})
const layoutRunningLabel = computed(() => t('mapOverview.layout.running', {
  layout: layoutName(selectedLayoutId.value),
  seconds: layoutElapsedSeconds.value,
}))
const exportStatus = computed(() => mapOverviewExportStore.status)
const exportFailureLabel = computed(() => exportStatus.value
  ? formatMapOverviewExportError(exportStatus.value, t as Parameters<typeof formatMapOverviewExportError>[1])
  : '')
const exportRunningLabel = computed(() => {
  const status = exportStatus.value
  if (!status) return ''
  const size = status.width && status.height ? `${status.width} × ${status.height}` : ''
  if (status.phase === 'rendering') {
    return t('mapOverview.export.rendering', {
      completed: status.completed,
      total: status.total,
      size,
      seconds: mapOverviewExportStore.elapsedSeconds,
    })
  }
  if (status.phase === 'encoding') return t('mapOverview.export.encoding', {
    size,
    seconds: mapOverviewExportStore.elapsedSeconds,
  })
  return t('mapOverview.export.preflight', { seconds: mapOverviewExportStore.elapsedSeconds })
})

onMounted(() => {
  stopOverviewProgress = maps.onOverviewProgress((progress) => {
    if (progress.sessionId !== overviewProgressSessionId) return
    overviewProgressPhase.value = progress.phase
    overviewProgressCompleted.value = progress.completed
    overviewProgressTotal.value = progress.total
  })
})

onActivated(() => {
  surfaceActive = true
  if (currentProject.value) {
    restoreStoredLayoutPreference(currentProject.value)
    const persisted = workspaceStore.readMapOverviewSelection(currentProject.value)
    selectedNodeId.value = persisted.selectedNodeId
    selectedEdgeId.value = persisted.selectedEdgeId
    void activateOverview()
  }
})

onDeactivated(() => {
  surfaceActive = false
  overviewProgressSessionId = createOverviewSessionId()
  captureSessionViewport()
  loadGeneration += 1
  cancelThumbnailSession()
  persistZoomNow()
  persistViewportSelectionNow()
  cancelActiveLayout(false)
  // Keep graph instance / snapshot / selection / pan / zoom; only cancel layout+thumbnail subscriptions.
})

onUnmounted(() => {
  loadGeneration += 1
  cancelThumbnailSession()
  persistZoomNow()
  persistViewportSelectionNow()
  cancelActiveLayout(false)
  moveHistory.clear()
  thumbnailImages.clear()
  stopOverviewProgress?.()
  stopOverviewProgress = null
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
    restoreStoredLayoutPreference(next)
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
      validating.value = false
      await restoreGraphAfterActivation()
      if (!viewportReady) await requestInitialLayout(snapshot.value)
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
  loadError.value = ''
  layoutError.value = ''
  overviewProgressSessionId = createOverviewSessionId()
  overviewProgressPhase.value = 'starting'
  overviewProgressCompleted.value = 0
  overviewProgressTotal.value = 0
  preparationPhase.value = 'images'
  try {
    const next = await maps.overview(project, overviewProgressSessionId)
    const settled = await workspaceSurfaces.validate({
      surface: 'mapOverview',
      loadedVersion: startVersion,
    }, project)
    if (generation !== loadGeneration || !surfaceActive || currentProject.value !== project) return
    if (startVersion && !settled.unchanged) throw new Error(t('story.workspaceChangedDuringLoad'))
    surfaceVersion = settled.version
    const previous = snapshot.value
    const changed = !previous || previous.snapshotVersion !== next.snapshotVersion || !hasPresentedGraph.value
    if (changed) {
      if (!previous) {
        snapshot.value = next
        await nextTick()
      }
      let layoutReady = false
      const thumbnailsReady = prepareThumbnails(next, project, generation).then(() => {
        if (!layoutReady) preparationPhase.value = 'layout'
      })
      const positionsReady = prepareInitialPositions(next).then((result) => {
        layoutReady = true
        return result
      })
      const [, preparedPositions] = await Promise.all([thumbnailsReady, positionsReady])
      if (generation !== loadGeneration || !surfaceActive || currentProject.value !== project) return
      snapshot.value = next
      await nextTick()
      await ensureGraph(next, true, preparedPositions.positions)
      appliedLayoutId.value = preparedPositions.layoutId
      selectedLayoutId.value = preparedPositions.layoutId
      if (preparedPositions.generated) {
        persistGraphPositions()
        workspaceStore.patchMapOverviewLayout(project, preparedPositions.layoutId)
        workspaceStore.patchMapOverviewLayoutVersion(project, MAP_OVERVIEW_LAYOUT_VERSION)
        workspaceStore.patchMapOverviewLayoutParameters(
          project,
          preparedPositions.layoutId,
          workspaceStore.readMapOverviewLayoutParameters(project, preparedPositions.layoutId),
        )
      }
      await restoreInitialViewport()
      await maps.finalizeOverviewThumbnails(project)
      preparationPhase.value = 'ready'
      hasPresentedGraph.value = true
    } else {
      snapshot.value = next
      await restoreGraphAfterActivation()
      preparationPhase.value = 'ready'
      hasPresentedGraph.value = true
    }
    loading.value = false
    refreshing.value = false
  } catch (error) {
    if (generation !== loadGeneration) return
    preparationPhase.value = 'error'
    loadError.value = formatUserFacingErrorMessage(error, 'general', language.value)
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      refreshing.value = false
      validating.value = false
    }
  }
}

async function prepareInitialPositions(next: MapOverviewSnapshot): Promise<{
  positions: Record<string, { x: number; y: number }>
  generated: boolean
  layoutId: MapOverviewLayoutId
}> {
  const stored = workspaceStore.readMapOverviewPositions(currentProject.value)
  const validStored = Object.fromEntries(Object.entries(stored).filter(([id, position]) => (
    next.nodes.some((node) => String(node.id) === id)
    && Number.isFinite(position.x)
    && Number.isFinite(position.y)
  )))
  const currentVersion = workspaceStore.readMapOverviewLayoutVersion(currentProject.value)
  const complete = Object.keys(stored).length === next.nodes.length
    && next.nodes.every((node) => Boolean(validStored[String(node.id)]))
  const storedLayoutId = workspaceStore.readMapOverviewLayout(currentProject.value)
  if (next.nodes.length === 0) {
    return { positions: {}, generated: false, layoutId: storedLayoutId }
  }
  if (currentVersion === MAP_OVERVIEW_LAYOUT_VERSION && complete) {
    return { positions: validStored, generated: false, layoutId: storedLayoutId }
  }

  const width = Math.max(1, graphHost.value?.clientWidth || document.documentElement.clientWidth)
  const height = Math.max(1, graphHost.value?.clientHeight || document.documentElement.clientHeight)
  const positions = await executeMapOverviewLayout(next, 'layered-grid', {
    requestId: `initial-${crypto.randomUUID()}`,
    width,
    height,
  })
  validateLayoutPositions(next, positions)
  return { positions, generated: true, layoutId: 'layered-grid' }
}

async function prepareThumbnails(next: MapOverviewSnapshot, project: string, generation: number): Promise<void> {
  rotateThumbnailSession()
  const sessionId = thumbnailSessionId
  const renderable = next.nodes.filter((node) => node.readState === 'ready' && Boolean(node.thumbnailVersion))
  thumbnailProgressTotal.value = renderable.length
  thumbnailProgressCompleted.value = 0
  const prepared = new Map<number, HTMLImageElement>()
  const failures = new Map<number, string>()
  await Promise.all(renderable.map(async (node) => {
    try {
      const image = await requestThumbnailImage(node, project, sessionId)
      if (generation !== loadGeneration || sessionId !== thumbnailSessionId) throw thumbnailAbortError()
      prepared.set(node.id, image)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error
      failures.set(node.id, formatThumbnailFailure(error))
    } finally {
      if (generation === loadGeneration && sessionId === thumbnailSessionId) {
        thumbnailProgressCompleted.value += 1
      }
    }
  }))
  thumbnailImages.clear()
  for (const [mapId, image] of prepared) thumbnailImages.set(mapId, image)
  thumbnailFailures.value = failures
}

async function requestThumbnailImage(
  node: MapOverviewNode,
  project: string,
  sessionId: string,
): Promise<HTMLImageElement> {
  const result = await maps.overviewThumbnail(node.id, node.thumbnailVersion!, project, sessionId)
  if (node.width == null || node.height == null) throw new Error(`Map ${node.id} has no valid overview dimensions.`)
  if (result.scaleDivisor !== 4 || result.width !== node.width * 12 || result.height !== node.height * 12) {
    throw new Error(`Map ${node.id} returned an invalid overview thumbnail size.`)
  }
  const image = new Image()
  image.src = result.dataUrl
  await image.decode()
  if (image.naturalWidth !== result.width || image.naturalHeight !== result.height) {
    throw new Error(`Map ${node.id} overview thumbnail decoded with an unexpected size.`)
  }
  return image
}

function formatThumbnailFailure(error: unknown): string {
  return isMapOverviewThumbnailVersionChanged(error)
    ? t('mapOverview.preparing.versionChanged')
    : formatUserFacingErrorMessage(error, 'general', language.value)
}

function thumbnailAbortError(): Error {
  const error = new Error('Map overview thumbnail preparation was canceled.')
  error.name = 'AbortError'
  return error
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
    return
  }
  await ensureGraph(cachedSnapshot, false)
  const stored = workspaceStore.readMapOverviewPositions(currentProject.value)
  const hasCompleteStoredPositions = cachedSnapshot.nodes.every((node) => Boolean(stored[String(node.id)]))
  if (Object.keys(stored).length) applyPositions(stored)
  if (hasCompleteStoredPositions) await restoreSavedViewport()
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

async function restoreSavedViewport(): Promise<void> {
  if (!graph) return
  if (savedViewport) {
    await graph.zoomTo(savedViewport.zoom, false)
    await graph.translateTo(savedViewport.pan, false)
    viewportReady = true
    syncZoomDisplay()
    return
  }
  const project = currentProject.value
  const persistedPan = project ? workspaceStore.readMapOverviewPan(project) : null
  const persistedZoom = project ? workspaceStore.readMapOverviewZoom(project) : null
  if (persistedPan) {
    await graph.zoomTo(persistedZoom ?? clampMapOverviewZoom(graph.getZoom()), false)
    await graph.translateTo(persistedPan, false)
    viewportReady = true
    syncZoomDisplay()
    return
  }
  await restoreInitialViewport()
}

async function ensureGraph(
  next: MapOverviewSnapshot,
  forceRebuild: boolean,
  initialPositions: Record<string, { x: number; y: number }> = {},
): Promise<void> {
  if (!graphHost.value || !graph) return
  if (forceRebuild) {
    await graph.setScene(next, thumbnailImageUrls(), initialPositions, thumbnailFailures.value)
  } else {
    await graph.setScene(
      next,
      thumbnailImageUrls(),
      Object.keys(initialPositions).length ? initialPositions : graph.getPositions(),
      thumbnailFailures.value,
    )
  }
  graphBoundContainer = graphHost.value
  graph.setSize(Math.max(1, graphHost.value.clientWidth), Math.max(1, graphHost.value.clientHeight))
  graph.setSelection(selectedNodeId.value, selectedEdgeId.value)
}

function thumbnailImageUrls(): Map<number, string> {
  return new Map([...thumbnailImages.entries()].map(([mapId, image]) => [mapId, image.src]))
}

function setGraphRef(value: Element | ComponentPublicInstance | null): void {
  graph = value as MapOverviewSvgCanvasApi | null
}

function onSvgNodeDragStart(payload: { mapId: number; position: MapOverviewNodePosition }): void {
  cancelActiveLayout(false)
  grabbedPositions.set(String(payload.mapId), payload.position)
}

function onSvgNodeDragEnd(payload: { mapId: number; before: MapOverviewNodePosition; after: MapOverviewNodePosition }): void {
  const id = String(payload.mapId)
  const before = grabbedPositions.get(id) || payload.before
  grabbedPositions.delete(id)
  moveHistory.record({ nodeId: id, before, after: payload.after })
  persistGraphPositions()
}

async function requestInitialLayout(next: MapOverviewSnapshot): Promise<void> {
  viewportReady = false
  const stored = workspaceStore.readMapOverviewPositions(currentProject.value)
  const validStored = Object.fromEntries(Object.entries(stored).filter(([id, position]) => (
    next.nodes.some((node) => String(node.id) === id)
    && Number.isFinite(position.x)
    && Number.isFinite(position.y)
  )))
  const currentVersion = workspaceStore.readMapOverviewLayoutVersion(currentProject.value)
  const complete = Object.keys(stored).length === next.nodes.length
    && next.nodes.every((node) => Boolean(validStored[String(node.id)]))
  if (currentVersion === MAP_OVERVIEW_LAYOUT_VERSION && complete) {
    applyPositions(validStored)
    restoreStoredLayoutPreference(currentProject.value)
    persistGraphPositions()
    await restoreInitialViewport()
    return
  }
  await runLayout(next, 'layered-grid', validStored, true)
}

async function runLayout(
  next: MapOverviewSnapshot,
  layoutId: MapOverviewLayoutId,
  seedPositions: MapOverviewLayoutPositions = {},
  restoreViewport = false,
  inputParameters?: MapOverviewLayoutParameters,
): Promise<void> {
  if (!graph || graph.destroyed) return
  cancelActiveLayout(false)
  const requestId = ++layoutRequestId
  selectedLayoutId.value = layoutId
  layoutRunning.value = true
  layoutError.value = ''
  failedLayoutId.value = null
  failedLayoutParameters = null
  const parameters = parseMapOverviewLayoutParameters(
    layoutId,
    inputParameters ?? workspaceStore.readMapOverviewLayoutParameters(currentProject.value, layoutId),
  )
  startLayoutClock()
  try {
    const positions = await executeMapOverviewLayout(next, layoutId, {
      requestId: String(requestId),
      seedPositions,
      width: graphHost.value?.clientWidth,
      height: graphHost.value?.clientHeight,
      isCancelled: () => requestId !== layoutRequestId,
      onHandle: (handle) => { activeLayoutHandle = handle },
      parameters,
    })
    if (requestId !== layoutRequestId) return
    validateLayoutPositions(next, positions)
    await applyPositionsAtomic(positions)
    if (requestId !== layoutRequestId) return
    persistGraphPositions()
    workspaceStore.patchMapOverviewLayout(currentProject.value, layoutId)
    workspaceStore.patchMapOverviewLayoutVersion(currentProject.value, MAP_OVERVIEW_LAYOUT_VERSION)
    workspaceStore.patchMapOverviewLayoutParameters(currentProject.value, layoutId, parameters)
    appliedLayoutId.value = layoutId
    selectedLayoutId.value = layoutId
    moveHistory.clear()
    if (restoreViewport) await restoreInitialViewport()
    else await fitGraph()
  } catch (error) {
    if (requestId !== layoutRequestId) return
    failedLayoutId.value = layoutId
    failedLayoutParameters = parameters
    selectedLayoutId.value = appliedLayoutId.value
    layoutError.value = formatLayoutError(error)
    throw error
  } finally {
    if (requestId === layoutRequestId) {
      layoutRunning.value = false
      activeLayoutHandle = null
      stopLayoutClock()
    }
  }
}

function validateLayoutPositions(next: MapOverviewSnapshot, positions: MapOverviewLayoutPositions): void {
  validateMapOverviewLayoutPositions(
    next.nodes.map((node) => String(node.id)),
    Object.entries(positions).map(([id, position]) => ({ id, x: position.x, y: position.y })),
  )
  validateMapOverviewLayoutNoOverlap(
    next.nodes.map((node) => {
      const size = mapOverviewNodeSize(node)
      return {
        id: String(node.id),
        width: size.width,
        height: size.collisionHeight,
      }
    }),
    positions,
  )
}

function applyPositions(positions: Record<string, { x: number; y: number }>): void {
  if (!graph) return
  void graph.applyPositions(positions)
}

async function applyPositionsAtomic(positions: MapOverviewLayoutPositions): Promise<void> {
  if (!graph) return
  await graph.applyPositions(positions)
}

function persistGraphPositions(): void {
  if (!graph || !currentProject.value) return
  workspaceStore.patchMapOverviewPositions(currentProject.value, Object.fromEntries(
    Object.entries(graph.getPositions()).map(([id, position]) => [id, rounded(position)]),
  ))
}

function roundedPosition(nodeId: string): { x: number; y: number } {
  return rounded(graph?.getNodePosition(nodeId) || { x: 0, y: 0 })
}

function rounded(position: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10 }
}

async function confirmLayoutChange(nextId: MapOverviewLayoutId): Promise<void> {
  layoutParametersOpen.value = false
  if (layoutRunning.value) {
    cancelActiveLayout(false)
    selectedLayoutId.value = nextId
    if (snapshot.value) {
      await runLayoutSafe(
        snapshot.value,
        nextId,
        {},
        !viewportReady,
        workspaceStore.readMapOverviewLayoutParameters(currentProject.value, nextId),
      )
    }
    return
  }
  const previous = appliedLayoutId.value
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
  const ok = await runLayoutSafe(snapshot.value, nextId, {}, !viewportReady)
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
  const layoutId = selectedLayoutId.value
  if (layoutRunning.value) cancelActiveLayout(false)
  await runLayoutSafe(snapshot.value, layoutId, {}, false)
}

async function runLayoutSafe(
  next: MapOverviewSnapshot,
  layoutId: MapOverviewLayoutId,
  seed: MapOverviewLayoutPositions,
  restoreViewport: boolean,
  parameters?: MapOverviewLayoutParameters,
): Promise<boolean> {
  try {
    await runLayout(next, layoutId, seed, restoreViewport, parameters)
    return !layoutError.value
  } catch {
    selectedLayoutId.value = appliedLayoutId.value
    return false
  }
}

function retryLayout(): void {
  if (!snapshot.value) return
  const layoutId = failedLayoutId.value || appliedLayoutId.value
  void runLayout(
    snapshot.value,
    layoutId,
    {},
    !viewportReady,
    failedLayoutParameters ?? workspaceStore.readMapOverviewLayoutParameters(currentProject.value, layoutId),
  ).catch(() => undefined)
}

function stopLayout(): void {
  cancelActiveLayout(true)
}

function cancelActiveLayout(showFeedback: boolean): void {
  if (!layoutRunning.value && !activeLayoutHandle) return
  const cancelledLayoutId = selectedLayoutId.value
  layoutRequestId += 1
  activeLayoutHandle?.stop()
  activeLayoutHandle = null
  layoutRunning.value = false
  failedLayoutId.value = cancelledLayoutId
  selectedLayoutId.value = appliedLayoutId.value
  stopLayoutClock()
  if (showFeedback) layoutError.value = t('mapOverview.layout.cancelled')
}

function startLayoutClock(): void {
  stopLayoutClock()
  const startedAt = Date.now()
  layoutElapsedSeconds.value = 0
  layoutElapsedTimer = setInterval(() => {
    layoutElapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 1000)
}

function stopLayoutClock(): void {
  if (layoutElapsedTimer) clearInterval(layoutElapsedTimer)
  layoutElapsedTimer = null
}

function formatLayoutError(error: unknown): string {
  if (error instanceof MapOverviewLayoutTaskError) {
    if (error.code === 'timeout') return t('mapOverview.layout.timeout')
    if (error.code === 'cancelled') return t('mapOverview.layout.cancelled')
  }
  if (error instanceof MapOverviewLayeredGridError && error.code === 'parent-cycle') {
    return t('mapOverview.layout.parentCycle')
  }
  return formatUserFacingErrorMessage(error, 'general', language.value)
}

async function fitGraph(): Promise<void> {
  if (!graph) return
  await graph.fitView(false)
  const zoom = clampMapOverviewZoom(Math.max(graph.getZoom(), MAP_OVERVIEW_MIN_ZOOM))
  if (zoom !== graph.getZoom()) await graph.zoomTo(zoom, false)
  syncZoomDisplay()
  if (viewportReady) persistZoomSoon()
}

async function restoreInitialViewport(): Promise<void> {
  if (!graph) return
  const storedZoom = workspaceStore.readMapOverviewZoom(currentProject.value)
  const storedPan = workspaceStore.readMapOverviewPan(currentProject.value)
  if (storedZoom == null) {
    await fitGraph()
  } else if (storedPan) {
    await graph.zoomTo(storedZoom, false)
    await graph.translateTo(storedPan, false)
  } else {
    await graph.fitCenter(false)
    await setGraphZoom(storedZoom, false)
  }
  viewportReady = true
  syncZoomDisplay()
}

function handleGraphZoom(): void {
  syncZoomDisplay()
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
  graph?.setSelection(mapId, null)
}

function selectEdge(edgeId: string): void {
  selectedNodeId.value = null
  selectedEdgeId.value = edgeId
  contextMenu.value = null
  persistViewportSelectionNow()
  const edge = snapshot.value?.edges.find((item) => item.id === edgeId)
  if (!edge) return
  graph?.setSelection(null, edgeId)
}

function clearSelection(): void {
  selectedNodeId.value = null
  selectedEdgeId.value = null
  contextMenu.value = null
  persistViewportSelectionNow()
  graph?.setSelection(null, null)
}

function restoreSelectionVisuals(): void {
  graph?.setSelection(selectedNodeId.value, selectedEdgeId.value)
}

function focusSearchResult(node: MapOverviewNode): void {
  searchQuery.value = `${node.name} · MAP${String(node.id).padStart(3, '0')}`
  selectNode(node.id)
  if (!graph) return
  void graph.focusNode(node.id, 220)
}

function openMap(mapId: number): void {
  contextMenu.value = null
  const node = snapshot.value?.nodes.find((item) => item.id === mapId)
  if (!node || node.readState !== 'ready') {
    ElMessage.warning(t('mapOverview.openEditorUnavailable'))
    return
  }
  void router.push({ path: '/workbench', query: { mapId: String(mapId) } })
}

function canOpenMap(mapId: number): boolean {
  return snapshot.value?.nodes.find((node) => node.id === mapId)?.readState === 'ready'
}

function openEvent(mapId: number, eventId: number): void {
  void router.push({ path: '/workbench', query: { mapId: String(mapId), eventId: String(eventId) } })
}

function onGraphKeydown(event: KeyboardEvent): void {
  if (!graph || !snapshot.value?.nodes.length) return
  if (isTextControl(event.target)) return
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    cancelActiveLayout(false)
    applyHistoryMove(event.shiftKey ? moveHistory.redo() : moveHistory.undo(), event.shiftKey)
    return
  }
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    cancelActiveLayout(false)
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
    cancelActiveLayout(false)
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
    return
  }
  const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
  const nextId = ids[(index + delta + ids.length) % ids.length]
  selectNode(nextId)
  void graph.focusNode(nextId, 160)
}

function resetGraphState(): void {
  rotateThumbnailSession()
  loadGeneration += 1
  snapshot.value = null
  selectedNodeId.value = null
  selectedEdgeId.value = null
  contextMenu.value = null
  thumbnailImages.clear()
  thumbnailFailures.value = new Map()
  retryingThumbnailIds.value = new Set()
  thumbnailProgressCompleted.value = 0
  thumbnailProgressTotal.value = 0
  overviewProgressSessionId = createOverviewSessionId()
  overviewProgressPhase.value = 'starting'
  overviewProgressCompleted.value = 0
  overviewProgressTotal.value = 0
  preparationPhase.value = 'images'
  hasPresentedGraph.value = false
  viewportReady = false
  savedViewport = null
  cancelActiveLayout(false)
  destroyGraph()
}

function destroyGraph(): void {
  cancelActiveLayout(false)
  if (graph && !graph.destroyed) {
    graph.destroy()
  }
  graph = null
  graphBoundContainer = null
}

function applyHistoryMove(move: { nodeId: string; before: MapOverviewNodePosition; after: MapOverviewNodePosition } | null, redo: boolean): void {
  if (!move || !graph) return
  cancelActiveLayout(false)
  applyPositions({ [move.nodeId]: redo ? move.after : move.before })
  persistGraphPositions()
}

function isTextControl(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function createThumbnailSessionId(): string {
  return crypto.randomUUID()
}

function createOverviewSessionId(): string {
  return crypto.randomUUID()
}

function cancelThumbnailSession(): void {
  const sessionId = thumbnailSessionId
  void maps.cancelOverviewThumbnails(sessionId).catch(() => undefined)
  cancelThumbnailRetries()
}

function rotateThumbnailSession(): void {
  cancelThumbnailSession()
  thumbnailSessionId = createThumbnailSessionId()
}

function cancelThumbnailRetries(): void {
  for (const sessionId of thumbnailRetrySessions.values()) {
    void maps.cancelOverviewThumbnails(sessionId).catch(() => undefined)
  }
  thumbnailRetrySessions.clear()
  retryingThumbnailIds.value = new Set()
}

async function retryMapThumbnail(mapId: number): Promise<void> {
  const node = snapshot.value?.nodes.find((item) => item.id === mapId)
  const project = currentProject.value
  if (!node || node.readState !== 'ready' || !node.thumbnailVersion || !project) return
  const previousSession = thumbnailRetrySessions.get(mapId)
  if (previousSession) await maps.cancelOverviewThumbnails(previousSession).catch(() => undefined)
  const sessionId = createThumbnailSessionId()
  const generation = loadGeneration
  thumbnailRetrySessions.set(mapId, sessionId)
  retryingThumbnailIds.value = new Set([...retryingThumbnailIds.value, mapId])
  try {
    const image = await requestThumbnailImage(node, project, sessionId)
    if (
      thumbnailRetrySessions.get(mapId) !== sessionId
      || generation !== loadGeneration
      || !surfaceActive
      || currentProject.value !== project
    ) return
    thumbnailImages.set(mapId, image)
    const failures = new Map(thumbnailFailures.value)
    failures.delete(mapId)
    thumbnailFailures.value = failures
    await graph?.setThumbnailState(mapId, image.src, null)
    ElMessage.success(t('mapOverview.thumbnailRetrySucceeded', {
      mapId: String(mapId).padStart(3, '0'),
    }))
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    if (
      thumbnailRetrySessions.get(mapId) !== sessionId
      || generation !== loadGeneration
      || !surfaceActive
      || currentProject.value !== project
    ) return
    const reason = formatThumbnailFailure(error)
    const failures = new Map(thumbnailFailures.value)
    failures.set(mapId, reason)
    thumbnailFailures.value = failures
    await graph?.setThumbnailState(mapId, null, reason)
  } finally {
    if (thumbnailRetrySessions.get(mapId) === sessionId) {
      thumbnailRetrySessions.delete(mapId)
      const retrying = new Set(retryingThumbnailIds.value)
      retrying.delete(mapId)
      retryingThumbnailIds.value = retrying
    }
  }
}

function mapLabel(mapId: number): string {
  const node = snapshot.value?.nodes.find((item) => item.id === mapId)
  return node ? `${node.name} · MAP${String(node.id).padStart(3, '0')}` : `MAP${String(mapId).padStart(3, '0')}`
}

function conditionCategoryLabel(category: MapOverviewTransferConditionCategory): string {
  return t(`mapOverview.condition.category.${category}` as Parameters<typeof t>[0])
}

function conditionTypeLabel(type: MapOverviewTransferConditionType): string {
  return t(`mapOverview.condition.type.${type}` as Parameters<typeof t>[0])
}

function sourceConditionPresentation(pageConditions: Record<string, unknown>): {
  category: MapOverviewTransferConditionCategory
  badges: string[]
  details: string[]
} {
  const summary = summarizeMapOverviewTransferConditions(pageConditions)
  const details = summary.switchIds.map(id => t('mapOverview.condition.switchDetail', { id }))
  if (summary.variable) {
    details.push(t('mapOverview.condition.variableDetail', {
      id: summary.variable.id,
      operator: summary.variable.operator,
      value: summary.variable.value,
    }))
  }
  if (summary.selfSwitch) {
    details.push(t('mapOverview.condition.selfSwitchDetail', { channel: summary.selfSwitch }))
  }
  if (!summary.types.length) {
    details.push(summary.hasOtherPageConditions
      ? t('mapOverview.condition.noneRelevantWithOther')
      : t('mapOverview.condition.noneRelevant'))
  }
  return {
    category: classifyMapOverviewTransferConditions(pageConditions),
    badges: summary.types.map(conditionTypeLabel),
    details,
  }
}

function restoreStoredLayoutPreference(project: string): void {
  const layoutId = workspaceStore.readMapOverviewLayout(project)
  appliedLayoutId.value = layoutId
  selectedLayoutId.value = layoutId
  loadLayoutParameterDraft(layoutId)
}

function layoutName(layoutId: MapOverviewLayoutId): string {
  const descriptor = MAP_OVERVIEW_LAYOUTS.find((layout) => layout.id === layoutId)
  return descriptor
    ? t(descriptor.labelKey as Parameters<typeof t>[0])
    : layoutId
}

function onLayoutSelect(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as MapOverviewLayoutId
  void confirmLayoutChange(value)
}

function loadLayoutParameterDraft(layoutId: MapOverviewLayoutId): void {
  if (!currentProject.value) {
    layoutParameterDraft.value = { ...defaultMapOverviewLayoutParameters(layoutId) }
  } else {
    layoutParameterDraft.value = {
      ...workspaceStore.readMapOverviewLayoutParameters(currentProject.value, layoutId),
    }
  }
  layoutParameterErrors.value = {}
}

function toggleLayoutParameters(): void {
  if (!layoutParametersOpen.value) loadLayoutParameterDraft(selectedLayoutId.value)
  layoutParametersOpen.value = !layoutParametersOpen.value
}

async function applyLayoutParameterDraft(): Promise<void> {
  if (!snapshot.value) return
  try {
    const parameters = parseMapOverviewLayoutParameters(selectedLayoutId.value, layoutParameterDraft.value)
    layoutParameterErrors.value = {}
    if (!layoutRunning.value) {
      try {
        await ElMessageBox.confirm(
          t(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.body),
          t('mapOverview.relayout.confirmTitle'),
          {
            confirmButtonText: t('mapOverview.layout.parameters.apply'),
            cancelButtonText: t('common.cancel'),
            type: 'warning',
          },
        )
      } catch {
        return
      }
    }
    layoutParametersOpen.value = false
    if (layoutRunning.value) cancelActiveLayout(false)
    const ok = await runLayoutSafe(snapshot.value, selectedLayoutId.value, {}, false, parameters)
    if (!ok) loadLayoutParameterDraft(selectedLayoutId.value)
  } catch (error) {
    if (!(error instanceof MapOverviewLayoutParameterError)) throw error
    layoutParameterErrors.value = {
      [error.field]: formatLayoutParameterError(error),
    }
  }
}

async function restoreDefaultLayoutParameters(): Promise<void> {
  layoutParameterDraft.value = { ...defaultMapOverviewLayoutParameters(selectedLayoutId.value) }
  layoutParameterErrors.value = {}
  await applyLayoutParameterDraft()
}

function formatLayoutParameterError(error: MapOverviewLayoutParameterError): string {
  if (error.code === 'range') {
    return t('mapOverview.layout.parameters.range', {
      min: String(error.min ?? ''),
      max: String(error.max ?? ''),
    })
  }
  if (error.code === 'integer') return t('mapOverview.layout.parameters.integer')
  if (error.code === 'choice') return t('mapOverview.layout.parameters.choice')
  return t('mapOverview.layout.parameters.number')
}

function retryPreparation(): void {
  void loadOverview(surfaceVersion || undefined)
}

async function exportOverviewPng(): Promise<void> {
  if (!graph || !snapshot.value || !currentProject.value) return
  if (mapOverviewExportStore.running) return
  if (thumbnailFailures.value.size) {
    ElMessage.error(t('mapOverview.export.thumbnailFailures', { count: thumbnailFailures.value.size }))
    return
  }
  const positions = graph.getPositions()
  const missing = snapshot.value.nodes.find(node => !positions[String(node.id)])
  if (missing) {
    ElMessage.error(t('mapOverview.export.positionsIncomplete'))
    return
  }
  try {
    await mapOverviewExportStore.start({
      requestId: crypto.randomUUID(),
      project: currentProject.value,
      projectName: projectStore.currentProjectInfo?.name || 'project',
      snapshotVersion: snapshot.value.snapshotVersion,
      nodes: snapshot.value.nodes.map(node => ({
        id: node.id,
        name: node.name,
        readState: node.readState,
        mapWidth: node.width || 1,
        mapHeight: node.height || 1,
        thumbnailVersion: node.thumbnailVersion,
        position: positions[String(node.id)],
      })),
      edges: snapshot.value.edges.map(edge => ({
        id: edge.id,
        sourceMapId: edge.sourceMapId,
        sourceX: edge.sourceX,
        sourceY: edge.sourceY,
        targetMapId: edge.targetMapId,
        targetX: edge.targetX,
        targetY: edge.targetY,
        count: edge.count,
        conditionCategory: classifyMapOverviewEdgeConditions(edge.sources),
      })),
    })
  } catch (error) {
    ElMessage.error(t('mapOverview.export.failed', {
      message: formatUserFacingErrorMessage(error, 'general', language.value),
    }))
  }
}

async function cancelOverviewExport(): Promise<void> {
  try {
    await mapOverviewExportStore.cancel()
  } catch (error) {
    ElMessage.error(t('mapOverview.export.failed', {
      message: formatUserFacingErrorMessage(error, 'general', language.value),
    }))
  }
}

</script>

<template>
  <section class="map-overview" data-ui-id="map-overview-view" :aria-busy="validating || refreshing">
    <div v-if="!currentProject" class="overview-state" data-ui-id="map-overview-empty">
      <strong>{{ t('mapOverview.empty.title') }}</strong>
      <span>{{ t('mapOverview.empty.body') }}</span>
      <router-link :to="{ path: '/console', query: { page: 'home' } }">{{ t('mapOverview.empty.action') }}</router-link>
    </div>
    <template v-else>
      <header v-if="hasPresentedGraph && (snapshot || !loading)" class="overview-toolbar">
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
        <div class="layout-settings">
          <label class="layout-control">
            <span>{{ t('mapOverview.layout.label') }}</span>
            <select
              :value="selectedLayoutId"
              :aria-label="t('mapOverview.layout.label')"
              data-ui-id="map-overview-layout"
              @change="onLayoutSelect"
            >
              <option v-for="layout in MAP_OVERVIEW_LAYOUTS" :key="layout.id" :value="layout.id">
                {{ t(layout.labelKey as Parameters<typeof t>[0]) }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="layout-parameters-trigger"
            :aria-label="t('mapOverview.layout.parameters.action')"
            :aria-expanded="layoutParametersOpen"
            data-ui-id="map-overview-layout-parameters"
            @click="toggleLayoutParameters"
          ><Setting aria-hidden="true" /></button>
          <div
            v-if="layoutParametersOpen"
            class="layout-parameters-popover"
            role="dialog"
            :aria-label="t('mapOverview.layout.parameters.title', { layout: layoutName(selectedLayoutId) })"
            @click.stop
          >
            <header>
              <strong>{{ layoutName(selectedLayoutId) }}</strong>
              <span>{{ t('mapOverview.layout.parameters.titleShort') }}</span>
            </header>
            <div class="layout-parameter-fields">
              <template v-if="selectedLayoutId === 'layered-grid'">
                <label>
                  <span>{{ t('mapOverview.layout.parameters.horizontalSpacing') }}</span>
                  <input v-model="layoutParameterDraft.horizontalSpacing" type="number" min="8" max="256">
                  <small v-if="layoutParameterErrors.horizontalSpacing">{{ layoutParameterErrors.horizontalSpacing }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.layerSpacing') }}</span>
                  <input v-model="layoutParameterDraft.layerSpacing" type="number" min="8" max="256">
                  <small v-if="layoutParameterErrors.layerSpacing">{{ layoutParameterErrors.layerSpacing }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.groupSpacing') }}</span>
                  <input v-model="layoutParameterDraft.groupSpacing" type="number" min="32" max="512">
                  <small v-if="layoutParameterErrors.groupSpacing">{{ layoutParameterErrors.groupSpacing }}</small>
                </label>
              </template>
              <template v-else-if="selectedLayoutId === 'force-atlas2'">
                <label>
                  <span>{{ t('mapOverview.layout.parameters.nodeSpacing') }}</span>
                  <input v-model="layoutParameterDraft.nodeSpacing" type="number" min="8" max="256">
                  <small v-if="layoutParameterErrors.nodeSpacing">{{ layoutParameterErrors.nodeSpacing }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.repulsion') }}</span>
                  <input v-model="layoutParameterDraft.repulsion" type="number" min="0.1" max="100" step="0.1">
                  <small v-if="layoutParameterErrors.repulsion">{{ layoutParameterErrors.repulsion }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.centerGravity') }}</span>
                  <input v-model="layoutParameterDraft.centerGravity" type="number" min="0" max="20" step="0.1">
                  <small v-if="layoutParameterErrors.centerGravity">{{ layoutParameterErrors.centerGravity }}</small>
                </label>
              </template>
              <template v-else-if="selectedLayoutId === 'd3-force'">
                <label>
                  <span>{{ t('mapOverview.layout.parameters.nodeSpacing') }}</span>
                  <input v-model="layoutParameterDraft.nodeSpacing" type="number" min="8" max="256">
                  <small v-if="layoutParameterErrors.nodeSpacing">{{ layoutParameterErrors.nodeSpacing }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.linkDistance') }}</span>
                  <input v-model="layoutParameterDraft.linkDistance" type="number" min="20" max="2000">
                  <small v-if="layoutParameterErrors.linkDistance">{{ layoutParameterErrors.linkDistance }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.nodeRepulsion') }}</span>
                  <input v-model="layoutParameterDraft.nodeRepulsion" type="number" min="1" max="500">
                  <small v-if="layoutParameterErrors.nodeRepulsion">{{ layoutParameterErrors.nodeRepulsion }}</small>
                </label>
              </template>
              <template v-else-if="selectedLayoutId === 'antv-dagre'">
                <label>
                  <span>{{ t('mapOverview.layout.parameters.direction') }}</span>
                  <select v-model="layoutParameterDraft.direction">
                    <option value="LR">{{ t('mapOverview.layout.parameters.directionLR') }}</option>
                    <option value="RL">{{ t('mapOverview.layout.parameters.directionRL') }}</option>
                    <option value="TB">{{ t('mapOverview.layout.parameters.directionTB') }}</option>
                    <option value="BT">{{ t('mapOverview.layout.parameters.directionBT') }}</option>
                  </select>
                  <small v-if="layoutParameterErrors.direction">{{ layoutParameterErrors.direction }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.nodeSpacingAuto') }}</span>
                  <input v-model="layoutParameterDraft.nodeSpacing" type="number" min="8" max="512" :placeholder="t('mapOverview.layout.parameters.auto')">
                  <small v-if="layoutParameterErrors.nodeSpacing">{{ layoutParameterErrors.nodeSpacing }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.layerSpacingAuto') }}</span>
                  <input v-model="layoutParameterDraft.layerSpacing" type="number" min="8" max="512" :placeholder="t('mapOverview.layout.parameters.auto')">
                  <small v-if="layoutParameterErrors.layerSpacing">{{ layoutParameterErrors.layerSpacing }}</small>
                </label>
              </template>
              <template v-else-if="selectedLayoutId === 'grid'">
                <label>
                  <span>{{ t('mapOverview.layout.parameters.columns') }}</span>
                  <input v-model="layoutParameterDraft.columns" type="number" min="1" max="100" :placeholder="t('mapOverview.layout.parameters.auto')">
                  <small v-if="layoutParameterErrors.columns">{{ layoutParameterErrors.columns }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.nodeSpacing') }}</span>
                  <input v-model="layoutParameterDraft.nodeSpacing" type="number" min="8" max="256">
                  <small v-if="layoutParameterErrors.nodeSpacing">{{ layoutParameterErrors.nodeSpacing }}</small>
                </label>
              </template>
              <template v-else>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.radius') }}</span>
                  <input v-model="layoutParameterDraft.radius" type="number" min="100" max="100000" :placeholder="t('mapOverview.layout.parameters.auto')">
                  <small v-if="layoutParameterErrors.radius">{{ layoutParameterErrors.radius }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.direction') }}</span>
                  <select v-model="layoutParameterDraft.clockwise">
                    <option :value="true">{{ t('mapOverview.layout.parameters.clockwise') }}</option>
                    <option :value="false">{{ t('mapOverview.layout.parameters.counterclockwise') }}</option>
                  </select>
                  <small v-if="layoutParameterErrors.clockwise">{{ layoutParameterErrors.clockwise }}</small>
                </label>
                <label>
                  <span>{{ t('mapOverview.layout.parameters.startAngle') }}</span>
                  <input v-model="layoutParameterDraft.startAngle" type="number" min="0" max="359">
                  <small v-if="layoutParameterErrors.startAngle">{{ layoutParameterErrors.startAngle }}</small>
                </label>
              </template>
            </div>
            <footer>
              <button type="button" class="secondary" @click="restoreDefaultLayoutParameters">
                {{ t('mapOverview.layout.parameters.restore') }}
              </button>
              <button type="button" class="primary" data-ui-id="map-overview-layout-parameters-apply" @click="applyLayoutParameterDraft">
                {{ t('mapOverview.layout.parameters.apply') }}
              </button>
            </footer>
          </div>
        </div>
        <button type="button" class="toolbar-action" :aria-label="t('mapOverview.fit')" @click="fitGraph">
          <Aim /><span>{{ t('mapOverview.fit') }}</span>
        </button>
        <button type="button" class="toolbar-action" :aria-label="t('mapOverview.relayout.action')" @click="confirmRelayout">
          <Refresh /><span>{{ t('mapOverview.relayout.action') }}</span>
        </button>
        <button
          v-if="!mapOverviewExportStore.running && exportStatus?.phase !== 'failed'"
          type="button"
          class="toolbar-action"
          :aria-label="t('mapOverview.export.action')"
          data-ui-id="map-overview-export"
          @click="exportOverviewPng"
        >
          <Download /><span>{{ t('mapOverview.export.action') }}</span>
        </button>
        <div v-else-if="mapOverviewExportStore.running" class="layout-running export-running" role="status" aria-live="polite">
          <span>{{ exportRunningLabel }}</span>
          <button
            type="button"
            data-ui-id="map-overview-export-stop"
            @click="cancelOverviewExport"
          >{{ t('mapOverview.export.stop') }}</button>
        </div>
        <div v-if="exportStatus?.phase === 'failed' && !mapOverviewExportStore.running" class="layout-running export-failed" role="alert">
          <span>{{ exportFailureLabel }}</span>
          <button type="button" data-ui-id="map-overview-export-retry" @click="exportOverviewPng">
            {{ t('mapOverview.export.retry') }}
          </button>
        </div>
        <div v-if="layoutRunning" class="layout-running" role="status" aria-live="polite">
          <span>{{ layoutRunningLabel }}</span>
          <button
            type="button"
            data-ui-id="map-overview-layout-stop"
            @click="stopLayout"
          >{{ t('mapOverview.layout.stop') }}</button>
        </div>
        <span v-if="snapshot" class="overview-summary">
          {{ t('mapOverview.summary', { maps: snapshot.nodes.length, edges: snapshot.edges.length }) }}
          <template v-if="snapshot.unresolvedTransferCount"> · {{ t('mapOverview.unresolved', { count: snapshot.unresolvedTransferCount }) }}</template>
        </span>
      </header>

      <div v-if="loading && !snapshot" class="overview-preparing" role="status">
        <strong>{{ overviewProgressLabel }}</strong>
        <div
          v-if="overviewProgressTotal > 0"
          class="overview-progress"
          role="progressbar"
          :aria-label="overviewProgressLabel"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="overviewProgressPercent"
        >
          <span :style="{ width: `${overviewProgressPercent}%` }" />
        </div>
        <span v-if="overviewProgressTotal > 0">
          {{ overviewProgressPercent }}% · {{ t('mapOverview.preparing.scanCount', { completed: overviewProgressCompleted, total: overviewProgressTotal }) }}
        </span>
      </div>
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
          <div ref="graphHost" class="overview-canvas">
            <MapOverviewSvgCanvas
              :ref="setGraphRef"
              @node-click="selectNode"
              @node-dblclick="openMap"
              @edge-click="selectEdge"
              @canvas-click="clearSelection"
              @node-contextmenu="contextMenu = $event"
              @node-drag-start="onSvgNodeDragStart"
              @node-drag-end="onSvgNodeDragEnd"
              @viewport-change="handleGraphZoom"
            />
          </div>
        </div>
        <div
          v-if="!hasPresentedGraph && preparationPhase !== 'ready'"
          class="overview-preparing"
          :role="preparationPhase === 'error' ? 'alert' : 'status'"
          :aria-live="preparationPhase === 'error' ? 'assertive' : 'polite'"
          data-ui-id="map-overview-preparing"
        >
          <template v-if="preparationPhase === 'error'">
            <strong>{{ failedThumbnailCount ? t('mapOverview.preparing.failedTitle', { count: failedThumbnailCount }) : t('mapOverview.loadFailed') }}</strong>
            <span>{{ loadError }}</span>
            <button type="button" data-ui-id="map-overview-preparing-retry" @click="retryPreparation">{{ t('common.retry') }}</button>
          </template>
          <template v-else-if="preparationPhase === 'layout'">
            <strong>{{ t('mapOverview.preparing.arranging') }}</strong>
            <span>
              {{ failedThumbnailCount
                ? t('mapOverview.preparing.imagesAttemptedWithFailures', { count: failedThumbnailCount })
                : t('mapOverview.preparing.imagesReady') }}
            </span>
          </template>
          <template v-else>
            <strong>{{ t('mapOverview.preparing.images') }}</strong>
            <div
              class="overview-progress"
              role="progressbar"
              :aria-label="t('mapOverview.preparing.images')"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="thumbnailProgressPercent"
            >
              <span :style="{ width: `${thumbnailProgressPercent}%` }" />
            </div>
            <span>{{ thumbnailProgressPercent }}% · {{ t('mapOverview.preparing.count', { completed: thumbnailProgressCompleted, total: thumbnailProgressTotal }) }}</span>
          </template>
        </div>
        <div v-if="hasPresentedGraph && (refreshing || loadError)" class="overview-refresh-state" :class="{ error: loadError }" :role="loadError ? 'alert' : 'status'">
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
            <div v-if="selectedThumbnailFailure" class="thumbnail-issue" role="alert">
              <strong>{{ t('mapOverview.thumbnailFailed') }}</strong>
              <p>{{ selectedThumbnailFailure }}</p>
              <button
                type="button"
                :disabled="retryingThumbnailIds.has(selectedNode.id)"
                data-ui-id="map-overview-thumbnail-retry"
                @click="retryMapThumbnail(selectedNode.id)"
              >
                {{ retryingThumbnailIds.has(selectedNode.id)
                  ? t('mapOverview.thumbnailRetrying')
                  : t('mapOverview.thumbnailRetry') }}
              </button>
            </div>
            <div class="relation-list">
              <strong>{{ t('mapOverview.inspector.outgoing') }}</strong>
              <button v-for="edge in selectedNodeEdges.outgoing" :key="edge.id" type="button" @click="selectEdge(edge.id)">
                <span class="relation-route">
                  <small>{{ mapLabel(edge.sourceMapId) }} ({{ edge.sourceX }}, {{ edge.sourceY }})</small>
                  <span>→ {{ mapLabel(edge.targetMapId) }} ({{ edge.targetX }}, {{ edge.targetY }})</span>
                </span>
                <span>×{{ edge.count }}</span>
              </button>
              <strong>{{ t('mapOverview.inspector.incoming') }}</strong>
              <button v-for="edge in selectedNodeEdges.incoming" :key="edge.id" type="button" @click="selectEdge(edge.id)">
                <span class="relation-route">
                  <small>{{ mapLabel(edge.sourceMapId) }} ({{ edge.sourceX }}, {{ edge.sourceY }})</small>
                  <span>→ {{ mapLabel(edge.targetMapId) }} ({{ edge.targetX }}, {{ edge.targetY }})</span>
                </span>
                <span>×{{ edge.count }}</span>
              </button>
            </div>
            <button
              type="button"
              class="inspector-primary"
              :disabled="!canOpenMap(selectedNode.id)"
              :title="canOpenMap(selectedNode.id) ? t('mapOverview.openEditor') : t('mapOverview.openEditorUnavailable')"
              @click="openMap(selectedNode.id)"
            >{{ t('mapOverview.openEditor') }}</button>
            <p v-if="!canOpenMap(selectedNode.id)" class="open-editor-reason">
              {{ t('mapOverview.openEditorUnavailable') }}
            </p>
          </template>
          <template v-else-if="selectedEdge">
            <header>
              <strong>{{ mapLabel(selectedEdge.sourceMapId) }}</strong>
              <span>→ {{ mapLabel(selectedEdge.targetMapId) }} · ×{{ selectedEdge.count }}</span>
              <span
                class="condition-badge"
                :data-condition="classifyMapOverviewEdgeConditions(selectedEdge.sources)"
              >{{ conditionCategoryLabel(classifyMapOverviewEdgeConditions(selectedEdge.sources)) }}</span>
            </header>
            <div class="source-list">
              <article v-for="source in selectedEdge.sources" :key="`${source.eventId}-${source.pageIndex}-${source.commandIndex}`">
                <strong>{{ source.eventName }} · #{{ source.eventId }}</strong>
                <span>{{ t('mapOverview.source.location', { page: source.pageIndex + 1, command: source.commandIndex + 1 }) }}</span>
                <span>{{ source.sourceX }}, {{ source.sourceY }} → {{ source.targetX }}, {{ source.targetY }}</span>
                <div v-if="sourceConditionPresentation(source.pageConditions).badges.length" class="condition-badges">
                  <span
                    v-for="badge in sourceConditionPresentation(source.pageConditions).badges"
                    :key="badge"
                    class="condition-badge"
                    :data-condition="sourceConditionPresentation(source.pageConditions).category"
                  >{{ badge }}</span>
                </div>
                <span
                  v-for="detail in sourceConditionPresentation(source.pageConditions).details"
                  :key="detail"
                  class="condition-detail"
                >{{ detail }}</span>
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
          <button
            type="button"
            :disabled="!canOpenMap(contextMenu.mapId)"
            :title="canOpenMap(contextMenu.mapId) ? t('mapOverview.openEditor') : t('mapOverview.openEditorUnavailable')"
            @click="openMap(contextMenu.mapId)"
          >{{ t('mapOverview.openEditor') }}</button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.map-overview { position:relative; min-width:0; min-height:0; flex:1; display:flex; flex-direction:column; overflow:hidden; border-radius:12px; background:var(--app-bg); box-shadow:var(--app-shadow-1); }
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
.layout-settings { position:relative; display:inline-flex; align-items:center; gap:4px; }
.layout-parameters-trigger { width:34px; height:34px; display:grid; place-items:center; padding:0; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink-soft); cursor:pointer; }
.layout-parameters-trigger svg { width:15px; }
.layout-parameters-trigger:hover { border-color:var(--app-border-strong); color:var(--app-ink); }
.layout-parameters-trigger:focus-visible { outline:2px solid var(--app-accent); outline-offset:2px; }
.layout-parameters-popover { position:absolute; z-index:12; top:40px; left:0; width:290px; display:grid; gap:12px; padding:12px; border:1px solid var(--app-border); border-radius:10px; background:var(--app-bg-elevated); box-shadow:var(--app-shadow-2); }
.layout-parameters-popover header { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
.layout-parameters-popover header strong { color:var(--app-ink); font-size:13px; }
.layout-parameters-popover header span { color:var(--app-ink-muted); font-size:11px; }
.layout-parameter-fields { display:grid; gap:9px; }
.layout-parameter-fields label { display:grid; grid-template-columns:minmax(0,1fr) 92px; align-items:center; gap:4px 10px; color:var(--app-ink-soft); font-size:12px; }
.layout-parameter-fields input,.layout-parameter-fields select { width:100%; height:30px; min-width:0; box-sizing:border-box; padding:0 7px; border:1px solid var(--app-border); border-radius:6px; outline:0; background:var(--app-bg); color:var(--app-ink); font:inherit; font-variant-numeric:tabular-nums; }
.layout-parameter-fields input:focus,.layout-parameter-fields select:focus { border-color:var(--app-accent); box-shadow:0 0 0 2px color-mix(in srgb,var(--app-accent) 18%,transparent); }
.layout-parameter-fields small { grid-column:1 / -1; color:var(--app-danger); font-size:10.5px; }
.layout-parameters-popover footer { display:flex; justify-content:flex-end; gap:7px; padding-top:2px; }
.layout-parameters-popover footer button { min-height:31px; padding:0 10px; border:1px solid var(--app-border); border-radius:7px; background:var(--app-bg); color:var(--app-ink); font:inherit; font-size:11.5px; cursor:pointer; }
.layout-parameters-popover footer .primary { border-color:var(--app-accent); background:var(--app-accent); color:#fff; }
.layout-parameters-popover footer button:focus-visible { outline:2px solid var(--app-accent); outline-offset:1px; }
.toolbar-action { min-height:34px; display:inline-flex; align-items:center; gap:6px; padding:0 10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink-soft); font:inherit; font-size:12px; cursor:pointer; }
.toolbar-action svg { width:15px; }
.toolbar-action:hover { color:var(--app-ink); border-color:var(--app-border-strong); }
.toolbar-action:focus-visible { outline:2px solid var(--app-accent); outline-offset:2px; }
.layout-running { min-height:34px; display:inline-flex; align-items:center; gap:8px; padding:0 4px 0 9px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink-muted); font-size:11.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.layout-running button { min-height:26px; padding:0 8px; border:1px solid var(--app-border-strong); border-radius:6px; background:var(--app-bg); color:var(--app-ink); font:inherit; cursor:pointer; }
.layout-running button:hover { border-color:var(--app-accent); }
.layout-running button:focus-visible { outline:2px solid var(--app-accent); outline-offset:1px; }
.export-failed { max-width:min(420px, 32vw); border-color:var(--app-danger); color:var(--app-danger); }
.export-failed>span { overflow:hidden; text-overflow:ellipsis; }
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
.overview-preparing { position:absolute; inset:0; z-index:10; display:grid; place-content:center; justify-items:center; gap:14px; padding:32px; background:#080909; color:#f4f3ef; text-align:center; }
.overview-preparing>strong { font-size:16px; }
.overview-preparing>span { color:#aaa9a4; font-size:12px; font-variant-numeric:tabular-nums; }
.overview-preparing>button { min-height:34px; padding:0 14px; border:1px solid #65645f; border-radius:8px; background:#242522; color:#fff; font:inherit; cursor:pointer; }
.overview-progress { width:min(420px,60vw); height:8px; overflow:hidden; border-radius:999px; background:#30312e; }
.overview-progress>span { display:block; height:100%; border-radius:inherit; background:var(--app-accent); transition:width 140ms ease-out; }
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
.issue-list,.thumbnail-issue,.relation-list,.source-list { display:grid; gap:7px; margin-top:14px; }
.issue-list>strong,.thumbnail-issue>strong,.relation-list>strong { margin-top:5px; color:var(--app-ink); font-size:12px; }
.issue-list p,.thumbnail-issue p,.source-list span,.source-list code { margin:0; color:var(--app-ink-muted); font-size:12px; word-break:break-word; }
.thumbnail-issue { padding:10px; border:1px dashed var(--app-danger); border-radius:8px; background:color-mix(in srgb,var(--app-danger) 6%,var(--app-bg)); }
.relation-list button,.thumbnail-issue button,.source-list button,.inspector-primary,.overview-state button,.layout-error button,.overview-refresh-state button { min-height:32px; padding:0 10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink); font:inherit; font-size:12px; text-align:left; cursor:pointer; }
.relation-list button { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.relation-route { min-width:0; display:grid; gap:2px; }
.relation-route small { overflow:hidden; color:var(--app-ink-muted); font-size:10.5px; text-overflow:ellipsis; white-space:nowrap; }
.relation-route>span { word-break:break-word; }
.inspector-primary { margin-top:16px; width:100%; text-align:center; background:var(--app-accent); border-color:var(--app-accent); color:#fff; font-weight:600; }
.inspector-primary:hover:not(:disabled) { filter:brightness(.95); }
.inspector-primary:focus-visible { outline:2px solid var(--app-accent); outline-offset:2px; }
.inspector-primary:disabled,.thumbnail-issue button:disabled,.overview-context-menu button:disabled { opacity:.48; cursor:not-allowed; }
.open-editor-reason { margin:6px 0 0; color:var(--app-ink-muted); font-size:11px; text-align:center; }
.source-list article { display:grid; gap:5px; padding:10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); }
.condition-badges { display:flex; flex-wrap:wrap; gap:5px; }
.condition-badge { width:max-content; display:inline-flex; align-items:center; min-height:19px; padding:0 6px; border:1px solid currentColor; border-radius:999px; color:#6f706a; font-size:10px; font-weight:600; line-height:1; }
.condition-badge[data-condition="switch"] { color:#3f6fb5; }
.condition-badge[data-condition="variable"] { color:#9a5b0e; }
.condition-badge[data-condition="self-switch"] { color:#7b4bb3; }
.condition-badge[data-condition="combined"] { border-style:dashed; color:#b64b3b; }
.condition-detail { color:var(--app-ink-soft)!important; font-variant-numeric:tabular-nums; }
.overview-state { min-height:0; flex:1; display:grid; place-content:center; gap:8px; padding:24px; text-align:center; color:var(--app-ink-muted); }
.overview-state.error,.layout-error { color:var(--app-danger); }
.layout-error { position:absolute; left:14px; top:14px; z-index:4; display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg); }
.overview-context-menu { position:fixed; z-index:20; min-width:160px; padding:4px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); box-shadow:var(--app-shadow-2); }
.overview-context-menu button { width:100%; min-height:34px; border:0; border-radius:6px; background:transparent; color:var(--app-ink); font:inherit; text-align:left; padding:0 10px; cursor:pointer; }
.overview-context-menu button:hover:not(:disabled) { background:var(--app-accent-soft); }
</style>
