<script setup lang="ts">
import cytoscape, { type Core, type EventObject, type NodeSingular } from 'cytoscape'
import { ElMessageBox } from 'element-plus'
import { Aim, Refresh, Search } from '@element-plus/icons-vue'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { MapOverviewNode, MapOverviewSnapshot, MapOverviewThumbnailQuality } from '@contract/types'
import { maps, workspaceSurfaces } from '../api/client'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'
import { findMapOverviewMatches } from '../utils/mapOverviewSearch'
import { MapOverviewMoveHistory, type MapOverviewNodePosition } from '../utils/mapOverviewMoveHistory'
import { MAP_OVERVIEW_LAYOUT_VERSION, mapOverviewNodeSize } from '../utils/mapOverviewNodeSize'
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
import MapOverviewLayoutWorker from '../workers/mapOverviewLayout.worker.ts?worker'

const THUMBNAIL_IDLE_DELAY_MS = 500

const projectStore = useProjectStore()
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
const thumbnailQuality = ref<MapOverviewThumbnailQuality>('high')
const zoomPercent = ref(100)
const zoomDraft = ref('100')
const zoomInput = ref<HTMLInputElement | null>(null)
const selectedNodeId = ref<number | null>(null)
const selectedEdgeId = ref<string | null>(null)
const contextMenu = ref<{ mapId: number; x: number; y: number } | null>(null)
const thumbnailErrors = ref<Record<number, string>>({})
const thumbnailUrls = new Map<number, string>()
const thumbnailLoadedQuality = new Map<number, MapOverviewThumbnailQuality>()
const thumbnailPending = new Set<number>()
let cy: Core | null = null
let layoutWorker: Worker | null = null
let layoutRequestId = 0
let loadGeneration = 0
let activeThumbnailLoads = 0
let thumbnailScheduleTimer: ReturnType<typeof setTimeout> | null = null
let thumbnailGeneration = 0
let thumbnailSessionId = createThumbnailSessionId()
let lastGraphInteractionAt = Date.now()
let zoomPersistTimer: ReturnType<typeof setTimeout> | null = null
let viewportReady = false
let layoutMigrationPending = false
let surfaceActive = false
let surfaceVersion = ''
let surfaceValidated = false
let savedViewport: { zoom: number; pan: { x: number; y: number } } | null = null
let pendingLayout: {
  snapshot: MapOverviewSnapshot
  mode: 'layered' | 'incremental'
  positions: Record<string, { x: number; y: number }>
  restoreViewport: boolean
} | null = null
const grabbedPositions = new Map<string, MapOverviewNodePosition>()
const moveHistory = new MapOverviewMoveHistory(100)

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
  ensureLayoutWorker()
})

onActivated(() => {
  surfaceActive = true
  ensureLayoutWorker()
  if (currentProject.value) thumbnailQuality.value = workspaceStore.readMapOverviewThumbnailQuality(currentProject.value)
  void activateOverview()
})

onDeactivated(() => {
  surfaceActive = false
  captureSessionViewport()
  loadGeneration += 1
  thumbnailGeneration += 1
  thumbnailPending.clear()
  activeThumbnailLoads = 0
  cancelThumbnailSession()
  if (thumbnailScheduleTimer) clearTimeout(thumbnailScheduleTimer)
  thumbnailScheduleTimer = null
  persistZoomNow()
  layoutRequestId += 1
  layoutWorker?.terminate()
  layoutWorker = null
})

function ensureLayoutWorker(): void {
  if (layoutWorker) return
  layoutWorker = new MapOverviewLayoutWorker()
  layoutWorker.onmessage = handleLayoutResponse
}

onUnmounted(() => {
  loadGeneration += 1
  cancelThumbnailSession()
  if (thumbnailScheduleTimer) clearTimeout(thumbnailScheduleTimer)
  thumbnailScheduleTimer = null
  persistZoomNow()
  layoutWorker?.terminate()
  layoutWorker = null
  moveHistory.clear()
  cy?.destroy()
  cy = null
})

watch(currentProject, (next, previous) => {
  if (next === previous) return
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = null
  if (previous && cy && viewportReady) workspaceStore.patchMapOverviewZoom(previous, cy.zoom())
  resetGraph()
  moveHistory.clear()
  surfaceVersion = ''
  if (next) {
    thumbnailQuality.value = workspaceStore.readMapOverviewThumbnailQuality(next)
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
      if (pendingLayout) resumePendingLayout()
      else if (!viewportReady) requestInitialLayout(snapshot.value)
      else scheduleThumbnails(0)
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
    snapshot.value = next
    loading.value = false
    refreshing.value = false
    await nextTick()
    createGraph(next)
    ensureLayoutWorker()
    requestInitialLayout(next)
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
  // Keep the existing Cytoscape instance when the canvas host DOM identity is unchanged.
  if (cy && cy.container() === graphHost.value) {
    cy.resize()
    restoreSelectionClasses()
    syncZoomDisplay()
    return
  }
  createGraph(cachedSnapshot)
  const stored = workspaceStore.readMapOverviewPositions(currentProject.value)
  const hasCompleteStoredPositions = cachedSnapshot.nodes.every((node) => Boolean(stored[String(node.id)]))
  if (Object.keys(stored).length && cy) {
    cy.batch(() => {
      for (const [id, position] of Object.entries(stored)) cy?.getElementById(id).position(position)
    })
  }
  if (hasCompleteStoredPositions) {
    restoreSavedViewport()
  } else {
    viewportReady = false
  }
  restoreSelectionClasses()
}

function captureSessionViewport(): void {
  if (!cy || !viewportReady) return
  savedViewport = { zoom: cy.zoom(), pan: cy.pan() }
}

function restoreSavedViewport(): void {
  if (!cy) return
  if (savedViewport) {
    cy.zoom(savedViewport.zoom)
    cy.pan(savedViewport.pan)
    viewportReady = true
    syncZoomDisplay()
    return
  }
  restoreInitialViewport()
}

function restoreSelectionClasses(): void {
  if (selectedNodeId.value != null) selectNode(selectedNodeId.value)
  else if (selectedEdgeId.value) {
    const edge = cy?.getElementById(selectedEdgeId.value)
    if (edge?.length) applyFocus([edge.id(), edge.source().id(), edge.target().id()])
  }
}

function createGraph(next: MapOverviewSnapshot): void {
  cy?.destroy()
  if (!graphHost.value) return
  cy = cytoscape({
    container: graphHost.value,
    minZoom: MAP_OVERVIEW_MIN_ZOOM,
    maxZoom: MAP_OVERVIEW_MAX_ZOOM,
    wheelSensitivity: MAP_OVERVIEW_WHEEL_SENSITIVITY,
    boxSelectionEnabled: false,
    autoungrabify: false,
    elements: [
      ...next.nodes.map((node) => {
        const size = mapOverviewNodeSize(node)
        return {
          group: 'nodes' as const,
          data: {
            id: String(node.id),
            label: `${node.name}\nMAP${String(node.id).padStart(3, '0')}`,
            readState: node.readState,
            nodeWidth: size.width,
            imageHeight: size.imageHeight,
            textMaxWidth: Math.max(176, size.width - 4),
          },
        }
      }),
      ...next.edges.map((edge) => ({
        group: 'edges' as const,
        data: {
          id: edge.id,
          source: String(edge.sourceMapId),
          target: String(edge.targetMapId),
          countLabel: edge.count > 1 ? `×${edge.count}` : '',
        },
      })),
    ],
    style: [
      {
        selector: 'node',
        style: {
          width: 'data(nodeWidth)',
          height: 'data(imageHeight)',
          shape: 'rectangle',
          'background-color': 'transparent',
          'background-fit': 'contain',
          'background-width': '100%',
          'background-height': '100%',
          'border-width': 0,
          'border-color': 'transparent',
          label: 'data(label)',
          color: '#282923',
          'font-size': 13,
          'font-weight': 600,
          'text-wrap': 'wrap',
          'text-max-width': 'data(textMaxWidth)',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 24,
          'text-background-color': '#f7f7f4',
          'text-background-opacity': 0.9,
          'text-background-padding': '3px',
          'text-background-shape': 'roundrectangle',
          'overlay-opacity': 0,
        },
      },
      {
        selector: 'node[readState != "ready"]',
        style: {
          'border-color': '#c2412d',
          'border-style': 'dashed',
          'border-width': 2,
        },
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'curve-style': 'bezier',
          'line-color': '#8c8d86',
          'target-arrow-color': '#8c8d86',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          label: 'data(countLabel)',
          color: '#5f605a',
          'font-size': 11,
          'text-background-color': '#f7f7f4',
          'text-background-opacity': 0.9,
          'text-background-padding': '3px',
          'loop-direction': '-45deg',
          'loop-sweep': '70deg',
          'overlay-opacity': 0,
        },
      },
      {
        selector: '.focused',
        style: {
          'border-width': 3,
          'border-color': '#c65f3d',
          'line-color': '#c65f3d',
          'target-arrow-color': '#c65f3d',
          opacity: 1,
        },
      },
      { selector: '.dimmed', style: { opacity: 0.16 } },
    ],
  })
  cy.on('tap', 'node', handleNodeTap)
  cy.on('dbltap', 'node', (event) => openMap(Number(event.target.id())))
  cy.on('tap', 'edge', handleEdgeTap)
  cy.on('tap', (event) => {
    if (event.target !== cy) return
    clearSelection()
  })
  cy.on('cxttap', 'node', (event) => {
    const original = event.originalEvent as MouseEvent
    contextMenu.value = { mapId: Number(event.target.id()), x: original.clientX, y: original.clientY }
  })
  cy.on('grab', 'node', (event) => {
    grabbedPositions.set(event.target.id(), roundedPosition(event.target))
  })
  cy.on('dragfree', 'node', (event) => {
    const node = event.target as NodeSingular
    const before = grabbedPositions.get(node.id())
    const after = roundedPosition(node)
    grabbedPositions.delete(node.id())
    if (before) moveHistory.record({ nodeId: node.id(), before, after })
    persistGraphPositions()
  })
  cy.on('zoom', handleGraphZoom)
  cy.on('pan zoom drag grab', markGraphInteraction)
  cy.on('render', () => scheduleThumbnails(32))
}

function requestInitialLayout(next: MapOverviewSnapshot): void {
  viewportReady = false
  const stored = workspaceStore.readMapOverviewPositions(currentProject.value)
  const validStored = Object.fromEntries(Object.entries(stored).filter(([id]) => next.nodes.some((node) => String(node.id) === id)))
  if (workspaceStore.readMapOverviewLayoutVersion(currentProject.value) !== MAP_OVERVIEW_LAYOUT_VERSION) {
    layoutMigrationPending = true
    moveHistory.clear()
    if (Object.keys(validStored).length && cy) {
      cy.batch(() => {
        for (const [id, position] of Object.entries(validStored)) cy?.getElementById(id).position(position)
      })
      restoreSavedViewport()
    }
    requestLayout(next, 'layered', {}, true)
    return
  }
  const hasNewNodes = next.nodes.some((node) => !validStored[String(node.id)])
  if (Object.keys(validStored).length && !hasNewNodes && cy) {
    cy.batch(() => {
      for (const [id, position] of Object.entries(validStored)) cy?.getElementById(id).position(position)
    })
    persistGraphPositions()
    restoreInitialViewport()
    scheduleThumbnails()
    return
  }
  requestLayout(next, Object.keys(validStored).length ? 'incremental' : 'layered', validStored, true)
}

let restoreViewportAfterLayout = false

function requestLayout(
  next: MapOverviewSnapshot,
  mode: 'layered' | 'incremental',
  positions: Record<string, { x: number; y: number }> = {},
  restoreViewport = false,
): void {
  pendingLayout = { snapshot: next, mode, positions, restoreViewport }
  const requestId = ++layoutRequestId
  restoreViewportAfterLayout = restoreViewport
  layoutWorker?.postMessage({
    requestId,
    mode,
    nodes: next.nodes.map((node) => {
      const size = mapOverviewNodeSize(node)
      return {
        id: node.id,
        width: size.width,
        height: size.collisionHeight,
        position: positions[String(node.id)],
      }
    }),
    edges: next.edges.map((edge) => ({ id: edge.id, sourceMapId: edge.sourceMapId, targetMapId: edge.targetMapId })),
  })
}

function handleLayoutResponse(event: MessageEvent<{
  requestId: number
  positions?: Record<string, { x: number; y: number }>
  error?: string
}>): void {
  if (event.data.requestId !== layoutRequestId || !cy) return
  pendingLayout = null
  if (event.data.error) {
    layoutError.value = event.data.error
    return
  }
  cy.batch(() => {
    for (const [id, position] of Object.entries(event.data.positions || {})) {
      cy?.getElementById(id).position(position)
    }
  })
  persistGraphPositions()
  if (layoutMigrationPending) {
    workspaceStore.patchMapOverviewLayoutVersion(currentProject.value, MAP_OVERVIEW_LAYOUT_VERSION)
    layoutMigrationPending = false
  }
  if (restoreViewportAfterLayout) restoreInitialViewport()
  else fitGraph()
  scheduleThumbnails()
}

function resumePendingLayout(): void {
  const pending = pendingLayout
  if (!pending || pending.snapshot !== snapshot.value) {
    pendingLayout = null
    return
  }
  ensureLayoutWorker()
  requestLayout(pending.snapshot, pending.mode, pending.positions, pending.restoreViewport)
}

function persistGraphPositions(): void {
  if (!cy || !currentProject.value) return
  const positions = Object.fromEntries(cy.nodes().map((node) => [node.id(), roundedPosition(node)]))
  workspaceStore.patchMapOverviewPositions(currentProject.value, positions)
}

function roundedPosition(node: NodeSingular): { x: number; y: number } {
  const position = node.position()
  return { x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10 }
}

async function confirmRelayout(): Promise<void> {
  if (!snapshot.value) return
  await ElMessageBox.confirm(
    t('mapOverview.relayout.confirmBody'),
    t('mapOverview.relayout.confirmTitle'),
    { confirmButtonText: t('mapOverview.relayout.confirm'), cancelButtonText: t('common.cancel'), type: 'warning' },
  )
  moveHistory.clear()
  requestLayout(snapshot.value, 'layered')
}

function retryLayout(): void {
  if (!snapshot.value) return
  requestLayout(snapshot.value, 'layered', {}, !viewportReady)
}

function fitGraph(): void {
  if (!cy) return
  cy.fit(undefined, 42)
  syncZoomDisplay()
  if (viewportReady) persistZoomSoon()
}

function restoreInitialViewport(): void {
  if (!cy) return
  const storedZoom = workspaceStore.readMapOverviewZoom(currentProject.value)
  if (storedZoom == null) {
    cy.fit(undefined, 42)
  } else {
    cy.center()
    setGraphZoom(storedZoom, false)
  }
  viewportReady = true
  syncZoomDisplay()
}

function handleGraphZoom(): void {
  syncZoomDisplay()
  markGraphInteraction()
  if (viewportReady) persistZoomSoon()
}

function syncZoomDisplay(): void {
  if (!cy) return
  const zoom = clampMapOverviewZoom(cy.zoom())
  zoomPercent.value = Math.round(zoom * 1000) / 10
  if (document.activeElement !== zoomInput.value) zoomDraft.value = formatMapOverviewZoomPercent(zoom)
}

function setGraphZoom(value: number, persist = true): void {
  if (!cy || !graphHost.value) return
  const level = clampMapOverviewZoom(value)
  cy.zoom({
    level,
    renderedPosition: {
      x: graphHost.value.clientWidth / 2,
      y: graphHost.value.clientHeight / 2,
    },
  })
  syncZoomDisplay()
  if (persist && viewportReady) persistZoomSoon()
}

function zoomIn(): void {
  if (cy) setGraphZoom(cy.zoom() + MAP_OVERVIEW_ZOOM_STEP)
}

function zoomOut(): void {
  if (cy) setGraphZoom(cy.zoom() - MAP_OVERVIEW_ZOOM_STEP)
}

function applyZoomDraft(): void {
  const parsed = parseMapOverviewZoomPercent(zoomDraft.value)
  if (parsed == null) {
    zoomDraft.value = formatMapOverviewZoomPercent(cy?.zoom() || mapOverviewZoomFromPercent(zoomPercent.value))
    zoomInput.value?.blur()
    return
  }
  const zoom = mapOverviewZoomFromPercent(clampMapOverviewZoomPercent(parsed))
  setGraphZoom(zoom)
  zoomDraft.value = formatMapOverviewZoomPercent(zoom)
  zoomInput.value?.blur()
}

function cancelZoomDraft(): void {
  zoomDraft.value = formatMapOverviewZoomPercent(cy?.zoom() || mapOverviewZoomFromPercent(zoomPercent.value))
  zoomInput.value?.blur()
}

function selectZoomInput(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select()
}

function persistZoomSoon(): void {
  if (!cy || !currentProject.value || !viewportReady) return
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = setTimeout(() => {
    zoomPersistTimer = null
    persistZoomNow()
  }, 250)
}

function persistZoomNow(): void {
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = null
  if (!cy || !currentProject.value || !viewportReady) return
  workspaceStore.patchMapOverviewZoom(currentProject.value, cy.zoom())
}

function handleNodeTap(event: EventObject): void {
  selectNode(Number(event.target.id()))
}

function handleEdgeTap(event: EventObject): void {
  selectedNodeId.value = null
  selectedEdgeId.value = String(event.target.id())
  contextMenu.value = null
  applyFocus([event.target.id(), event.target.source().id(), event.target.target().id()])
}

function selectNode(mapId: number): void {
  selectedNodeId.value = mapId
  selectedEdgeId.value = null
  contextMenu.value = null
  const node = cy?.getElementById(String(mapId))
  if (!node?.length) return
  const related = node.closedNeighborhood()
  applyFocus(related.map((element) => element.id()))
}

function clearSelection(): void {
  selectedNodeId.value = null
  selectedEdgeId.value = null
  contextMenu.value = null
  cy?.elements().removeClass('focused dimmed')
}

function applyFocus(ids: string[]): void {
  if (!cy) return
  const focused = new Set(ids)
  cy.batch(() => {
    cy?.elements().forEach((element) => {
      element.toggleClass('focused', focused.has(element.id()))
      element.toggleClass('dimmed', !focused.has(element.id()))
    })
  })
}

function focusSearchResult(node: MapOverviewNode): void {
  searchQuery.value = `${node.name} · MAP${String(node.id).padStart(3, '0')}`
  selectNode(node.id)
  const target = cy?.getElementById(String(node.id))
  if (target?.length) cy?.animate({ center: { eles: target }, zoom: Math.max(cy.zoom(), 0.7), duration: 220 })
}

function openMap(mapId: number): void {
  contextMenu.value = null
  void router.push({ path: '/workbench', query: { mapId: String(mapId) } })
}

function openEvent(mapId: number, eventId: number): void {
  void router.push({ path: '/workbench', query: { mapId: String(mapId), eventId: String(eventId) } })
}

function onGraphKeydown(event: KeyboardEvent): void {
  if (!cy || !snapshot.value?.nodes.length) return
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
    const node = cy.getElementById(String(selectedNodeId.value))
    const before = roundedPosition(node)
    const step = event.shiftKey ? 32 : 8
    node.shift({
      x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    })
    moveHistory.record({ nodeId: node.id(), before, after: roundedPosition(node) })
    persistGraphPositions()
    return
  }
  const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
  const nextId = ids[(index + delta + ids.length) % ids.length]
  selectNode(nextId)
  const node = cy.getElementById(String(nextId))
  cy.animate({ center: { eles: node }, duration: 160 })
}

function scheduleThumbnails(delayMs = 0): void {
  if (!surfaceActive || !surfaceValidated || !cy || !snapshot.value || activeThumbnailLoads >= 1 || thumbnailScheduleTimer) return
  thumbnailScheduleTimer = setTimeout(() => {
    thumbnailScheduleTimer = null
    if (!surfaceActive || !surfaceValidated || !cy || !snapshot.value || activeThumbnailLoads >= 1) return
    const extent = cy.extent()
    const center = { x: (extent.x1 + extent.x2) / 2, y: (extent.y1 + extent.y2) / 2 }
    const candidates = snapshot.value.nodes
      .filter((candidate) => candidate.thumbnailVersion
        && thumbnailLoadedQuality.get(candidate.id) !== thumbnailQuality.value
        && !thumbnailPending.has(candidate.id))
    const nearViewport = candidates
      .filter(candidate => isNearViewport(candidate.id, extent))
      .sort((left, right) => distanceToCenter(left.id, center) - distanceToCenter(right.id, center))
    let node = nearViewport[0]
    if (!node) {
      const idleFor = Date.now() - lastGraphInteractionAt
      if (idleFor < THUMBNAIL_IDLE_DELAY_MS) {
        scheduleThumbnails(THUMBNAIL_IDLE_DELAY_MS - idleFor)
        return
      }
      node = candidates.sort((left, right) => distanceToCenter(left.id, center) - distanceToCenter(right.id, center))[0]
    }
    if (node) void loadThumbnail(node)
  }, Math.max(0, delayMs))
}

function isNearViewport(mapId: number, extent: { x1: number; y1: number; x2: number; y2: number; w: number; h: number }): boolean {
  const bounds = cy?.getElementById(String(mapId)).boundingBox({ includeLabels: false })
  if (!bounds) return false
  return bounds.x2 >= extent.x1 - extent.w
    && bounds.x1 <= extent.x2 + extent.w
    && bounds.y2 >= extent.y1 - extent.h
    && bounds.y1 <= extent.y2 + extent.h
}

function markGraphInteraction(): void {
  lastGraphInteractionAt = Date.now()
  scheduleThumbnails(48)
}

function distanceToCenter(mapId: number, center: { x: number; y: number }): number {
  const position = cy?.getElementById(String(mapId)).position() || { x: 0, y: 0 }
  return (position.x - center.x) ** 2 + (position.y - center.y) ** 2
}

async function loadThumbnail(node: MapOverviewNode): Promise<void> {
  const generation = loadGeneration
  const qualityGeneration = thumbnailGeneration
  const quality = thumbnailQuality.value
  thumbnailPending.add(node.id)
  activeThumbnailLoads += 1
  try {
    const result = await maps.overviewThumbnail(
      node.id,
      node.thumbnailVersion || undefined,
      quality,
      currentProject.value,
      thumbnailSessionId,
    )
    if (!surfaceActive || generation !== loadGeneration || qualityGeneration !== thumbnailGeneration || !cy) return
    const url = result.resourceUrl
    thumbnailUrls.set(node.id, url)
    thumbnailLoadedQuality.set(node.id, quality)
    if (thumbnailErrors.value[node.id]) {
      const nextErrors = { ...thumbnailErrors.value }
      delete nextErrors[node.id]
      thumbnailErrors.value = nextErrors
    }
    cy.getElementById(String(node.id)).style('background-image', url)
  } catch (error) {
    if (generation === loadGeneration && qualityGeneration === thumbnailGeneration) {
      const issue = formatUserFacingErrorMessage(error, 'general', language.value)
      thumbnailErrors.value = { ...thumbnailErrors.value, [node.id]: issue }
      cy?.getElementById(String(node.id)).data('thumbnailError', issue)
    }
  } finally {
    if (generation === loadGeneration && qualityGeneration === thumbnailGeneration) {
      thumbnailPending.delete(node.id)
      activeThumbnailLoads -= 1
      scheduleThumbnails(0)
    }
  }
}

function retryThumbnail(node: MapOverviewNode): void {
  thumbnailUrls.delete(node.id)
  thumbnailLoadedQuality.delete(node.id)
  thumbnailPending.delete(node.id)
  const nextErrors = { ...thumbnailErrors.value }
  delete nextErrors[node.id]
  thumbnailErrors.value = nextErrors
  cy?.getElementById(String(node.id)).removeData('thumbnailError')
  void loadThumbnail(node)
}

function resetGraph(): void {
  rotateThumbnailSession()
  loadGeneration += 1
  thumbnailGeneration += 1
  snapshot.value = null
  clearSelection()
  thumbnailUrls.clear()
  thumbnailLoadedQuality.clear()
  thumbnailPending.clear()
  if (thumbnailScheduleTimer) clearTimeout(thumbnailScheduleTimer)
  thumbnailScheduleTimer = null
  thumbnailErrors.value = {}
  activeThumbnailLoads = 0
  viewportReady = false
  layoutMigrationPending = false
  pendingLayout = null
  savedViewport = null
  surfaceValidated = false
  cy?.destroy()
  cy = null
}

function applyHistoryMove(move: { nodeId: string; before: MapOverviewNodePosition; after: MapOverviewNodePosition } | null, redo: boolean): void {
  if (!move || !cy) return
  const node = cy.getElementById(move.nodeId)
  if (!node.length) return
  node.position(redo ? move.after : move.before)
  persistGraphPositions()
}

function isTextControl(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function changeThumbnailQuality(): void {
  if (!currentProject.value || !cy) return
  workspaceStore.patchMapOverviewThumbnailQuality(currentProject.value, thumbnailQuality.value)
  rotateThumbnailSession()
  thumbnailGeneration += 1
  thumbnailPending.clear()
  thumbnailErrors.value = {}
  activeThumbnailLoads = 0
  if (thumbnailScheduleTimer) clearTimeout(thumbnailScheduleTimer)
  thumbnailScheduleTimer = null
  lastGraphInteractionAt = Date.now()
  scheduleThumbnails(0)
}

function createThumbnailSessionId(): string {
  return crypto.randomUUID()
}

function cancelThumbnailSession(): void {
  const sessionId = thumbnailSessionId
  void maps.cancelOverviewThumbnails(sessionId).catch(() => undefined)
}

function rotateThumbnailSession(): void {
  cancelThumbnailSession()
  thumbnailSessionId = createThumbnailSessionId()
}

function mapLabel(mapId: number): string {
  const node = snapshot.value?.nodes.find((item) => item.id === mapId)
  return node ? `${node.name} · MAP${String(node.id).padStart(3, '0')}` : `MAP${String(mapId).padStart(3, '0')}`
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
        <label class="quality-control">
          <span>{{ t('mapOverview.quality.label') }}</span>
          <select
            v-model="thumbnailQuality"
            :aria-label="t('mapOverview.quality.label')"
            data-ui-id="map-overview-quality"
            @change="changeThumbnailQuality"
          >
            <option value="standard">{{ t('mapOverview.quality.standard') }}</option>
            <option value="high">{{ t('mapOverview.quality.high') }}</option>
            <option value="ultra">{{ t('mapOverview.quality.ultra') }}</option>
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
          ref="graphHost"
          class="overview-canvas"
          tabindex="0"
          role="application"
          :aria-label="t('mapOverview.canvasAria')"
          data-ui-id="map-overview-canvas"
          @keydown="onGraphKeydown"
          @click.self="contextMenu = null"
        />
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
              <p v-for="issue in selectedNode.issues" :key="`${issue.code}-${issue.targetMapId || ''}`">{{ issue.message }}</p>
            </div>
            <div v-if="thumbnailErrors[selectedNode.id]" class="issue-list thumbnail-failure" role="alert">
              <strong>{{ t('mapOverview.thumbnail.failed') }}</strong>
              <p>{{ thumbnailErrors[selectedNode.id] }}</p>
              <button type="button" @click="retryThumbnail(selectedNode)">{{ t('common.retry') }}</button>
            </div>
            <div class="relation-list">
              <strong>{{ t('mapOverview.inspector.outgoing') }}</strong>
              <button v-for="edge in selectedNodeEdges.outgoing" :key="edge.id" type="button" @click="selectedEdgeId = edge.id; selectedNodeId = null">
                {{ mapLabel(edge.targetMapId) }} <span>×{{ edge.count }}</span>
              </button>
              <strong>{{ t('mapOverview.inspector.incoming') }}</strong>
              <button v-for="edge in selectedNodeEdges.incoming" :key="edge.id" type="button" @click="selectedEdgeId = edge.id; selectedNodeId = null">
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
                <span>{{ t('mapOverview.source.target', { x: source.targetX, y: source.targetY }) }}</span>
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
.quality-control { min-height:34px; display:inline-flex; align-items:center; gap:6px; padding:0 8px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); color:var(--app-ink-muted); font-size:12px; }
.quality-control select { border:0; outline:0; background:transparent; color:var(--app-ink); font:inherit; cursor:pointer; }
.quality-control:focus-within { outline:2px solid var(--app-accent); outline-offset:2px; }
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
.overview-canvas { min-width:0; min-height:0; flex:1; background-image:radial-gradient(circle, color-mix(in srgb,var(--app-ink-muted) 22%,transparent) 1px, transparent 1px); background-size:18px 18px; outline:none; }
.overview-canvas:focus-visible { box-shadow:inset 0 0 0 3px var(--app-accent); }
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
.issue-list p { margin:0; padding:7px; border-left:2px solid var(--app-danger); background:color-mix(in srgb,var(--app-danger) 7%,transparent); color:var(--app-danger); font-size:11.5px; line-height:1.45; }
.thumbnail-failure button { justify-self:start; padding:0; border:0; background:transparent; color:var(--app-accent); font:inherit; font-size:12px; cursor:pointer; }
.relation-list button { display:flex; justify-content:space-between; gap:10px; padding:6px; border:0; border-radius:5px; background:transparent; color:var(--app-ink-soft); font:inherit; font-size:11.5px; text-align:left; cursor:pointer; }
.relation-list button:hover { background:var(--app-bg-soft); color:var(--app-ink); }
.inspector-primary,.source-list button { min-height:32px; margin-top:14px; padding:0 10px; border:1px solid var(--app-border); border-radius:7px; background:var(--app-bg-elevated); color:var(--app-accent); font:inherit; font-size:12px; cursor:pointer; }
.source-list article { display:grid; gap:5px; padding:10px; border:1px solid var(--app-border); border-radius:8px; background:var(--app-bg-elevated); font-size:11.5px; }
.source-list article strong { color:var(--app-ink); }
.source-list code { max-height:64px; overflow:auto; color:var(--app-ink-muted); font-size:10px; white-space:pre-wrap; word-break:break-all; }
.source-list button { justify-self:start; margin-top:3px; }
.overview-state { min-height:0; flex:1; display:grid; place-content:center; justify-items:center; gap:10px; padding:28px; color:var(--app-ink-soft); text-align:center; }
.overview-state strong { color:var(--app-ink); font-size:17px; }
.overview-state a,.overview-state button { min-height:34px; display:inline-flex; align-items:center; padding:0 13px; border:0; border-radius:8px; background:var(--app-accent); color:var(--app-accent-ink); font:inherit; text-decoration:none; cursor:pointer; }
.overview-state.error span { max-width:620px; color:var(--app-danger); }
.layout-error { position:absolute; left:12px; bottom:12px; display:flex; align-items:center; gap:9px; padding:8px 10px; border:1px solid var(--app-danger); border-radius:8px; background:var(--app-bg); color:var(--app-danger); font-size:12px; box-shadow:var(--app-shadow-2); }
.layout-error button { border:0; background:transparent; color:var(--app-accent); cursor:pointer; }
.overview-context-menu { position:fixed; z-index:40; min-width:160px; padding:4px; border:1px solid var(--app-border); border-radius:7px; background:var(--app-bg-elevated); box-shadow:var(--app-shadow-2); }
.overview-context-menu button { width:100%; min-height:32px; padding:0 9px; border:0; border-radius:4px; background:transparent; color:var(--app-ink); text-align:left; cursor:pointer; }
.overview-context-menu button:hover { background:var(--app-bg-soft); }
@media (max-width:900px) { .overview-summary{display:none}.overview-inspector{width:260px;min-width:260px}.toolbar-action span,.quality-control>span{display:none}.overview-search{width:min(320px,55vw)} }
@media (prefers-reduced-motion:reduce) { .toolbar-action,.search-results button{transition:none} }
</style>
