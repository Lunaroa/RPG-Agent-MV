import { computed, ref, type Ref, type UnwrapNestedRefs } from 'vue'
import type {
  UiAnimationConfig,
  UiDesignerAdapterBundle,
  UiDesignerDocument,
  UiDesignerNodeType,
  UiConditionFrequency,
  UiDesignerFileMetadata,
  UiDesignerFileConflict,
  UiDesignerRecentFileRecord,
  UiDesignerRecoveryRecord,
  UiDesignerResourceRequest,
  UiEventMap,
  UiFileStatus,
  UiPreviewState,
  UiProjectResourceCatalog,
  UiPropertyMode,
  UiPoint,
  UiRect,
  UiGuide,
  UiRuntimeStatus,
  UiRuntimeDiagnostic,
  UiDesignerRuntimeStageResult,
  UiTreeDropPosition,
  UiValidationReport,
  UiViewport,
  UiVisibilityCondition,
} from '@contract/ui-designer'
import { createUiDesignerAdapters, type UiDesignerResourceLoadResult } from '../adapters'
import {
  cloneUiDocument,
  createDefaultNode,
  createUiDocument,
  findNode,
  nextNodeId,
  touchDocument,
} from '../models/document'
import { importRuntimeSceneDocument } from '../models/export'
import { alignNodes, distributeNodes, fitViewport, panViewport, snapPoint, updateNodePosition, zoomViewport } from '../models/geometry'
import { UiDesignerHistory } from '../models/history'
import { analyzePerformance } from '../models/performance'
import { copySelection, groupNodes, moveNodeStep, moveNodeToEdge, pasteClipboard, reparentNode, ungroupNodes } from '../models/tree'
import { validateDocument } from '../models/validation'
import { UI_DESIGNER_BUILT_IN_TEMPLATES, createBuiltInUiDesignerTemplate, isBuiltInUiDesignerTemplate } from '../models/templates'
import { createUiDesignerDraftCoordinator, type UiDesignerDraftCoordinator } from './draftCoordinator'
import { createUiDesignerPreviewPoller } from './previewLifecycle'
import { createUiDesignerPreviewOperations } from './previewOperations'
import { createUiDesignerEditorPreviewState } from './editorPreviewState'
import { createUiDesignerSceneHistoryOperations } from './sceneHistoryOperations'
import { createUiDesignerPersistenceOperations } from './persistenceOperations'
import { createUiDesignerRuntimeOperations } from './runtimeOperations'
import { clearRecoverySnapshot } from './recoveryLifecycle'

export interface UiDesignerSceneState {
  id: string
  document: UiDesignerDocument
  history: UiDesignerHistory | UnwrapNestedRefs<UiDesignerHistory>
  sourcePath?: string
  openedMetadata?: UiDesignerFileMetadata
  recoveryId?: string
}

export interface UiDesignerPreferences {
  historyLimit: number
  gridEnabled: boolean
  snapEnabled: boolean
  tourCompleted: boolean
  autoSaveIntervalMinutes: number
  gridSize: number
  gridColor: string
  snapSensitivity: number
  defaultCanvasWidth: number
  defaultCanvasHeight: number
  codeFontFamily: string
  codeFontSize: number
  codeTabSize: number
  theme: 'system' | 'light' | 'dark'
  defaultAuthor: string
  autoFormat: boolean
  leftPaneWidth: number
  centerPaneWidth: number
  rightPaneWidth: number
  [key: string]: unknown
}

export interface UseUiDesignerOptions {
  adapters?: UiDesignerAdapterBundle
  projectPath?: string
  confirmDiscard?: (sceneId?: string) => Promise<boolean>
}

const cloneCatalog = (catalog: UiProjectResourceCatalog): UiProjectResourceCatalog => ({
  ...catalog,
  resources: catalog.resources.map((resource) => ({ ...resource })),
})

let sceneSequence = 0
const DEFAULT_HISTORY_LIMIT = 100
const MAX_HISTORY_LIMIT = 500

function normalizeHistoryLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_HISTORY_LIMIT
  return Math.min(MAX_HISTORY_LIMIT, Math.max(1, Math.floor(value)))
}

const RESOURCE_PROPERTY_KEYS = new Set([
  'path', 'backgroundPath', 'imagePath', 'fontFile', 'hoverSe', 'clickSe', 'posterPath', 'trackImage', 'fillImage',
])

function collectReferencedResourcePaths(document: UiDesignerDocument): string[] {
  const paths = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string') return
    const normalized = value.replaceAll('\\', '/').trim()
    if (!normalized || normalized.includes('://') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return
    const lower = normalized.toLocaleLowerCase()
    if (lower.startsWith('img/') || lower.startsWith('audio/') || lower.startsWith('movies/') || lower.startsWith('fonts/') || lower.startsWith('www/img/') || lower.startsWith('www/audio/') || lower.startsWith('www/movies/') || lower.startsWith('www/fonts/')) paths.add(normalized)
  }
  for (const node of document.nodes) {
    const props = node.props as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(props)) if (RESOURCE_PROPERTY_KEYS.has(key)) add(value)
    if (node.type === 'frameAnimation') for (const frame of node.props.frames) add(frame.path)
  }
  return [...paths]
}

function createSceneState(document = createUiDocument(), id = `scene_tab_${++sceneSequence}`, metadata: { sourcePath?: string; openedMetadata?: UiDesignerFileMetadata; recoveryId?: string } = {}, historyLimit = DEFAULT_HISTORY_LIMIT): UiDesignerSceneState {
  return { id, document, history: new UiDesignerHistory(document, historyLimit), ...metadata }
}

export function useUiDesigner(options: UseUiDesignerOptions = {}) {
  const adapters = createUiDesignerAdapters(options.adapters)
  const projectPath = ref(options.projectPath)
  const scenes = ref<UiDesignerSceneState[]>([createSceneState()])
  const activeSceneId = ref(scenes.value[0].id)
  const selectedIds = ref<string[]>(['node_root'])
  const hoveredNodeId = ref<string | undefined>()
  const clipboard = ref<ReturnType<typeof copySelection> | null>(null)
  const viewport = ref<UiViewport>({ zoom: 1, panX: 0, panY: 0, width: 816, height: 624 })
  const draftPositions = ref<Record<string, UiPoint>>({})
  const draftCode = ref<Record<string, string>>({})
  const draftRects = ref<Record<string, UiRect>>({})
  const draftRotations = ref<Record<string, number>>({})
  const editingMode = ref<'design' | 'code'>('design')
  const codeTab = ref<'ready' | 'update'>('ready')
  const isPreviewing = ref(false)
  const isEditorPreviewing = ref(false)
  const editorPreviewStatus = ref<'idle' | 'running' | 'stopped'>('idle')
  const editorPreview = createUiDesignerEditorPreviewState()
  const fileStatus = ref<UiFileStatus>('idle')
  const fileMessage = ref('')
  const previewStatus = ref<UiPreviewState>('idle')
  const previewMessage = ref('')
  const previewSessionId = ref<string | undefined>()
  const previewDiagnostics = ref<UiRuntimeDiagnostic[]>([])
  const runtimeStatus = ref<UiRuntimeStatus>({ state: 'unknown', message: 'Runtime has not been inspected.' })
  const runtimeStaging = ref<UiDesignerRuntimeStageResult | null>(null)
  const resourceCatalog = ref<UiProjectResourceCatalog | null>(null)
  const resourceStatus = ref<UiFileStatus>('idle')
  const resourceMessage = ref('')
  const actionError = ref('')
  const fileConflict = ref<UiDesignerFileConflict | null>(null)
  const runtimeConflict = ref(false)
  const runtimeConflictPath = ref<string | undefined>()
  const runtimeConflictOperation = ref<'stage' | 'export' | null>(null)
  const runtimeConflictFiles = ref<string[]>([])
  const runtimeProofMissing = ref(false)
  const recentFiles = ref<UiDesignerRecentFileRecord[]>([])
  const recoveryRecords = ref<UiDesignerRecoveryRecord[]>([])
  const recoveryCleanupPending = ref(false)
  const templates = ref<string[]>([...UI_DESIGNER_BUILT_IN_TEMPLATES])
  const preferences = ref<UiDesignerPreferences>({ historyLimit: DEFAULT_HISTORY_LIMIT, gridEnabled: true, snapEnabled: true, tourCompleted: false, autoSaveIntervalMinutes: 1, gridSize: 16, gridColor: '#394150', snapSensitivity: 8, defaultCanvasWidth: 816, defaultCanvasHeight: 624, codeFontFamily: 'ui-monospace', codeFontSize: 12, codeTabSize: 2, theme: 'system', defaultAuthor: '', autoFormat: false, leftPaneWidth: 260, centerPaneWidth: 640, rightPaneWidth: 320 })
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const projectGeneration = ref(0)
  const draftCoordinator: UiDesignerDraftCoordinator = createUiDesignerDraftCoordinator()
  const previewPoller = createUiDesignerPreviewPoller(() => adapters.preview, { isPreviewing, previewStatus, previewMessage, previewSessionId, previewDiagnostics, projectGeneration })

  const historyLimit = () => normalizeHistoryLimit(preferences.value.historyLimit)
  const applyHistoryLimit = (limit = historyLimit()) => {
    const normalized = normalizeHistoryLimit(limit)
    for (const scene of scenes.value) scene.history.setMaxSteps(normalized)
    preferences.value = { ...preferences.value, historyLimit: normalized }
    return normalized
  }

  const activeScene = computed(() => scenes.value.find((scene) => scene.id === activeSceneId.value) ?? scenes.value[0])
  const document = computed(() => activeScene.value?.document ?? createUiDocument())
  const selectedNodes = computed(() => document.value.nodes.filter((node) => selectedIds.value.includes(node.id)))
  const selectedNode = computed(() => selectedNodes.value[0])
  const validation = computed<UiValidationReport>(() => validateDocument(document.value))
  const performance = computed(() => analyzePerformance(document.value))
  const hasSceneDraft = (sceneId: string) => {
    const sourceDraft = Object.keys(draftCode.value).some((key) => key.startsWith(`${sceneId}:`))
    // CodeMirror/property editors are mounted for the active tab.  Their
    // coordinator registrations are intentionally scene-agnostic, so only
    // attribute those pending values to the active scene here.
    return sourceDraft || (sceneId === activeSceneId.value && draftCoordinator.hasPending())
  }
  const sceneIsDirty = (scene: UiDesignerSceneState) => scene.history.isDirty || hasSceneDraft(scene.id)
  const isSceneDirty = (sceneId: string) => {
    const scene = scenes.value.find((item) => item.id === sceneId)
    return scene ? sceneIsDirty(scene) : false
  }
  const isDirty = computed(() => scenes.value.some((scene) => sceneIsDirty(scene)))
  const hasProject = computed(() => Boolean(projectPath.value?.trim()))
  const canSave = computed(() => adapters.file !== undefined && adapters.file !== createUiDesignerAdapters().file)
  const canExport = computed(() => hasProject.value && adapters.runtime.stageScene !== undefined && adapters.runtime !== createUiDesignerAdapters().runtime)
  const canManageRuntime = computed(() => hasProject.value && adapters.runtime !== createUiDesignerAdapters().runtime)
  const canLoadResources = computed(() => hasProject.value && adapters.resource !== createUiDesignerAdapters().resource)
  const canPreview = computed(() => hasProject.value && adapters.preview !== createUiDesignerAdapters().preview)
  const canEditCode = computed(() => adapters.code.available)

  const persistenceOperations = createUiDesignerPersistenceOperations({
    getFile: () => adapters.file,
    canSave,
    generation: projectGeneration,
    recentFiles,
    recoveryRecords,
    preferences,
    setFileStatus: (status, message) => { fileStatus.value = status; fileMessage.value = message },
    normalizeHistoryLimit,
    applyHistoryLimit,
    onRecoveryRemoved: () => { recoveryCleanupPending.value = false },
  })
  const { removeRecentFile, removeRecovery, loadPreferences, savePreferences } = persistenceOperations

  const loadReferencedResources = async (sourceDocument = document.value) => {
    const referencedPaths = collectReferencedResourcePaths(sourceDocument)
    if (!hasProject.value || !referencedPaths.length || !adapters.resource?.loadReferenced) return true
    const generation = projectGeneration.value
    try {
      const result = await adapters.resource.loadReferenced({ referencedPaths })
      if (generation !== projectGeneration.value) return false
      if (result?.status !== 'success' || !result.value) return false
      const incoming = cloneCatalog(result.value)
      const previous = resourceCatalog.value
      const incomingIds = new Set(incoming.resources.map((resource) => resource.id))
      resourceCatalog.value = {
        ...incoming,
        resources: [...(previous?.resources ?? []).filter((resource) => !incomingIds.has(resource.id)), ...incoming.resources],
      }
      resourceStatus.value = 'success'
      resourceMessage.value = result.message
      return true
    } catch (error) {
      if (generation !== projectGeneration.value) return false
      resourceStatus.value = 'error'
      resourceMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const setProjectContext = async (nextProjectPath: string | undefined, nextAdapters?: UiDesignerAdapterBundle) => {
    if (projectPath.value === nextProjectPath && !nextAdapters) return true
    if (isDirty.value && options.confirmDiscard && !(await options.confirmDiscard())) return false
    projectGeneration.value += 1
    previewDiagnostics.value = []
    previewPoller.clear()
    let previewStopFailed = false
    const previousPreviewSessionId = previewSessionId.value
    if (isPreviewing.value || previewSessionId.value) {
      try {
        const result = await adapters.preview.stop(previewSessionId.value)
        if (result.state !== 'stopped') {
          previewStopFailed = true
          previewDiagnostics.value = result.diagnostics ? [...result.diagnostics] : previewDiagnostics.value
          previewStatus.value = 'error'
          previewMessage.value = result.message
        } else {
          isPreviewing.value = false
          previewSessionId.value = undefined
        }
      } catch (error) {
        previewStopFailed = true
        previewStatus.value = 'error'
        previewMessage.value = error instanceof Error ? error.message : String(error)
      }
    }
    if (!previewStopFailed) {
      previewStatus.value = 'idle'
      previewMessage.value = ''
    }
    resourceCatalog.value = null
    runtimeStatus.value = { state: 'unknown', message: 'Runtime has not been inspected.' }
    runtimeStaging.value = null
    Object.assign(adapters, createUiDesignerAdapters(nextAdapters))
    projectPath.value = nextProjectPath
    if (previewStopFailed && previousPreviewSessionId) {
      // Keep polling the retained session after a project switch.  The next
      // explicit Stop can still clean it up; a failed stop must not strand a
      // running process behind a new project context.
      isPreviewing.value = true
      previewSessionId.value = previousPreviewSessionId
      previewPoller.start(projectGeneration.value, previousPreviewSessionId)
    }
    void loadWelcomeRecords()
    void loadReferencedResources()
    void checkRuntime()
    return true
  }

  const writeRecovery = async (scene: UiDesignerSceneState) => {
    if (!canSave.value || !scene.history.isDirty) return true
    try {
      const result = await adapters.file.writeRecovery(cloneUiDocument(scene.document), {
        sourcePath: scene.sourcePath,
        sourceMetadata: scene.openedMetadata ? { digest: scene.openedMetadata.digest, mtimeMs: scene.openedMetadata.mtimeMs } : undefined,
        key: scene.id,
      })
      if (result.status === 'success' && result.value) scene.recoveryId = result.value.id
      if (result.status !== 'success') fileMessage.value = result.message
      return result.status === 'success'
    } catch (error) {
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const scheduleRecovery = (scene: UiDesignerSceneState) => {
    if (!canSave.value || !scene.history.isDirty) return
    const previous = recoveryTimers.get(scene.id)
    if (previous) clearTimeout(previous)
    const minutes = Number.isFinite(preferences.value.autoSaveIntervalMinutes) ? Math.min(120, Math.max(0, preferences.value.autoSaveIntervalMinutes)) : 1
    if (minutes <= 0) return
    const interval = minutes * 60000
    recoveryTimers.set(scene.id, setTimeout(() => {
      recoveryTimers.delete(scene.id)
      void writeRecovery(scene)
    }, interval))
  }

  const flushRecovery = async (scene?: UiDesignerSceneState) => {
    const targets = scene ? [scene] : [...scenes.value]
    let ok = true
    for (const target of targets) {
      const timer = recoveryTimers.get(target.id)
      if (timer) { clearTimeout(timer); recoveryTimers.delete(target.id) }
      if (!(await writeRecovery(target))) ok = false
    }
    return ok
  }

  const clearSceneRecovery = async (scene: UiDesignerSceneState) => {
    if (!scene.recoveryId) return true
    const recoveryId = scene.recoveryId
    const result = await clearRecoverySnapshot(adapters.file, recoveryId)
    if (!result.ok) {
      recoveryCleanupPending.value = true
      fileStatus.value = result.status
      fileMessage.value = result.message
      return false
    }
    recoveryCleanupPending.value = false
    scene.recoveryId = undefined
    return true
  }

  const replaceActiveDocument = (next: UiDesignerDocument, description: string, markSaved = false) => {
    const scene = activeScene.value
    if (!scene) return
    scene.document = scene.history.commit(next, description)
    if (markSaved) scene.history.markSaved()
    selectedIds.value = selectedIds.value.filter((id) => Boolean(findNode(scene.document, id)))
    if (!selectedIds.value.length) selectedIds.value = [scene.document.zOrder[0] ?? 'node_root']
    actionError.value = ''
    if (markSaved) { const timer = recoveryTimers.get(scene.id); if (timer) { clearTimeout(timer); recoveryTimers.delete(scene.id) } }
    else scheduleRecovery(scene)
  }

  const setSceneMeta = (key: 'sceneName' | 'description' | 'author' | 'sceneBase', value: string) => {
    const next = cloneUiDocument(document.value)
    next.meta[key] = value
    replaceActiveDocument(touchDocument(next), `Update ${key}`)
  }

  const setSourceCode = (key: 'ready' | 'update', value: string) => {
    const next = cloneUiDocument(document.value)
    next.code[key] = value
    replaceActiveDocument(next, `Edit ${key} code`)
  }

  const previewSourceCode = (key: 'ready' | 'update', value: string, sceneId = activeSceneId.value) => {
    const sceneKey = `${sceneId}:${key}`
    draftCode.value = { ...draftCode.value, [sceneKey]: value }
  }

  const commitSourceCode = (key: 'ready' | 'update', sceneId = activeSceneId.value) => {
    const sceneKey = `${sceneId}:${key}`
    const value = draftCode.value[sceneKey]
    if (value === undefined) return
    draftCode.value = Object.fromEntries(Object.entries(draftCode.value).filter(([draftKey]) => draftKey !== sceneKey))
    const scene = scenes.value.find((item) => item.id === sceneId)
    if (!scene) return
    const next = cloneUiDocument(scene.document)
    next.code[key] = value
    scene.document = scene.history.commit(next, `Edit ${key} code`)
    scheduleRecovery(scene)
  }

  /**
   * Flush editor drafts before any operation that serializes a document.  CodeMirror
   * editors debounce their changes for a friendlier undo stack; persistence/runtime
   * actions must nevertheless observe the latest value, even when the user clicks
   * the action before the debounce expires.
   */
  const flushDrafts = (sceneId?: string) => {
    draftCoordinator.flush(sceneId)
    const pending = Object.keys(draftCode.value).filter((key) => sceneId === undefined || key.startsWith(`${sceneId}:`))
    for (const key of pending) {
      const separator = key.lastIndexOf(':')
      if (separator <= 0) continue
      const sceneId = key.slice(0, separator)
      const codeKey = key.slice(separator + 1)
      if (codeKey === 'ready' || codeKey === 'update') commitSourceCode(codeKey, sceneId)
    }
    return true
  }

  const runtimeOperations = createUiDesignerRuntimeOperations({
    getRuntime: () => adapters.runtime,
    getFile: () => adapters.file,
    projectPath,
    projectGeneration,
    hasProject,
    canSave,
    canExport,
    canManageRuntime,
    document,
    flushDrafts,
    fileStatus,
    fileMessage,
    runtimeStatus,
    runtimeStaging,
    runtimeProofMissing,
    runtimeConflict,
    runtimeConflictPath,
    runtimeConflictOperation,
    runtimeConflictFiles,
    fileConflict,
  })
  const {
    exportRuntime,
    exportRuntimeJson,
    installRuntime,
    stageRuntime,
    resolveRuntimeConflict,
    clearConflictState,
    checkRuntime,
  } = runtimeOperations

  const setGridEnabled = (enabled: boolean) => {
    const next = cloneUiDocument(document.value)
    next.canvas.grid.enabled = enabled
    replaceActiveDocument(next, 'Toggle grid')
    void savePreferences({ gridEnabled: enabled })
  }

  const setSnapEnabled = (enabled: boolean) => {
    const next = cloneUiDocument(document.value)
    next.canvas.snap.enabled = enabled
    replaceActiveDocument(next, 'Toggle snap')
    void savePreferences({ snapEnabled: enabled })
  }

  const setCanvasSetting = (key: 'width' | 'height' | 'backgroundColor' | 'backgroundPattern' | 'rulers' | 'guidesVisible', value: unknown) => {
    const next = cloneUiDocument(document.value)
    const canvas = next.canvas as unknown as Record<string, unknown>
    canvas[key] = value
    if (key === 'width' || key === 'height') {
      next.meta.canvasWidth = next.canvas.width
      next.meta.canvasHeight = next.canvas.height
      const root = next.nodes.find((node) => node.id === 'node_root')
      if (root) { if (key === 'width') root.props.width = next.canvas.width; else root.props.height = next.canvas.height }
    }
    replaceActiveDocument(next, `Update canvas ${key}`)
  }
  const setMapBackground = (key: 'mapId' | 'blur' | 'switchId', value: number) => {
    const next = cloneUiDocument(document.value)
    next.canvas.mapBackground[key] = Number.isFinite(value) ? Math.max(0, value) : 0
    replaceActiveDocument(next, `Update map background ${key}`)
  }
  const setGlobalFilter = (key: 'blur' | 'glow' | 'preset', value: number | string) => {
    const next = cloneUiDocument(document.value)
    if (key === 'preset') next.globalFilter.preset = String(value)
    else next.globalFilter[key] = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
    replaceActiveDocument(next, `Update global filter ${key}`)
  }
  const setTransition = (which: 'enter' | 'exit', key: 'type' | 'duration', value: string | number) => {
    const next = cloneUiDocument(document.value)
    if (key === 'type') next.transitions[which].type = value as typeof next.transitions[typeof which]['type']
    else next.transitions[which].duration = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
    replaceActiveDocument(next, `Update ${which} transition ${key}`)
  }

  let guideSequence = 0
  const addGuide = (type: UiGuide['type'], position: number) => {
    const next = cloneUiDocument(document.value)
    const used = new Set(next.guides.map((guide) => guide.id))
    let id = `guide_${type}_${++guideSequence}`
    while (used.has(id)) id = `guide_${type}_${++guideSequence}`
    next.guides.push({ id, type, position: Math.max(0, Math.round(position)), locked: false })
    replaceActiveDocument(next, 'Add guide')
    return id
  }
  const setGuidePosition = (id: string, position: number) => {
    const guide = document.value.guides.find((item) => item.id === id)
    if (!guide || guide.locked || !Number.isFinite(position)) return false
    const next = cloneUiDocument(document.value)
    const target = next.guides.find((item) => item.id === id)
    if (!target) return false
    target.position = Math.max(0, Math.round(position))
    replaceActiveDocument(next, 'Move guide')
    return true
  }
  const setGuideLocked = (id: string, locked: boolean) => {
    const next = cloneUiDocument(document.value)
    const guide = next.guides.find((item) => item.id === id)
    if (!guide) return false
    guide.locked = locked
    replaceActiveDocument(next, locked ? 'Lock guide' : 'Unlock guide')
    return true
  }
  const removeGuide = (id: string) => {
    const guide = document.value.guides.find((item) => item.id === id)
    if (!guide || guide.locked) return false
    const next = cloneUiDocument(document.value)
    next.guides = next.guides.filter((item) => item.id !== id)
    replaceActiveDocument(next, 'Remove guide')
    return true
  }
  const clearGuides = () => {
    const next = cloneUiDocument(document.value)
    next.guides = next.guides.filter((guide) => guide.locked)
    replaceActiveDocument(next, 'Clear guides')
  }

  const newScene = (name = `Scene_New_${scenes.value.length + 1}`, options: { width?: number; height?: number; sceneBase?: string; template?: string } = {}) => {
    const nextDocument = options.template && isBuiltInUiDesignerTemplate(options.template) ? createBuiltInUiDesignerTemplate(options.template) : createUiDocument(name)
    nextDocument.meta.sceneName = name.trim() || nextDocument.meta.sceneName
    const defaultWidth = Number.isFinite(preferences.value.defaultCanvasWidth) ? preferences.value.defaultCanvasWidth : nextDocument.canvas.width
    const defaultHeight = Number.isFinite(preferences.value.defaultCanvasHeight) ? preferences.value.defaultCanvasHeight : nextDocument.canvas.height
    const width = Number.isFinite(options.width) && (options.width ?? 0) > 0 ? Math.round(options.width as number) : Math.round(defaultWidth)
    const height = Number.isFinite(options.height) && (options.height ?? 0) > 0 ? Math.round(options.height as number) : Math.round(defaultHeight)
    nextDocument.canvas.width = width
    nextDocument.canvas.height = height
    nextDocument.meta.canvasWidth = width
    nextDocument.meta.canvasHeight = height
    nextDocument.meta.sceneBase = options.sceneBase?.trim() || nextDocument.meta.sceneBase
    nextDocument.canvas.grid.enabled = preferences.value.gridEnabled
    nextDocument.canvas.grid.size = Number.isFinite(preferences.value.gridSize) ? preferences.value.gridSize : nextDocument.canvas.grid.size
    nextDocument.canvas.grid.color = typeof preferences.value.gridColor === 'string' ? preferences.value.gridColor : nextDocument.canvas.grid.color
    nextDocument.canvas.snap.enabled = preferences.value.snapEnabled
    nextDocument.canvas.snap.sensitivity = Number.isFinite(preferences.value.snapSensitivity) ? preferences.value.snapSensitivity : nextDocument.canvas.snap.sensitivity
    const root = nextDocument.nodes.find((node) => node.id === 'node_root')
    if (root) { root.props.width = width; root.props.height = height }
    const scene = createSceneState(nextDocument, undefined, {}, historyLimit())
    if (options.template) scene.document = scene.history.commit(nextDocument, 'Create scene from template')
    scenes.value.push(scene)
    activateScene(scene.id)
    viewport.value = { zoom: 1, panX: 0, panY: 0, width: nextDocument.canvas.width, height: nextDocument.canvas.height }
  }

  const closeScene = async (sceneId: string) => {
    const scene = scenes.value.find((item) => item.id === sceneId)
    if (!scene) return true
    const previousActiveId = activeSceneId.value
    let discarding = false
    if (sceneIsDirty(scene)) {
      // Capture the latest editor value before asking for confirmation.  A
      // confirmed discard then cancels the debounce instead of letting an
      // unmount emit the value back after history.discard().
      flushDrafts(scene.id)
      const approved = options.confirmDiscard ? await options.confirmDiscard(sceneId) : false
      if (!approved) { activeSceneId.value = previousActiveId; return false }
      draftCoordinator.cancel(scene.id)
      for (const key of Object.keys(draftCode.value)) if (key.startsWith(`${scene.id}:`)) delete draftCode.value[key]
      discarding = true
    }
    // A discard must not create a new recovery snapshot from the just-rejected
    // draft.  Clear the existing snapshot and keep the tab open on failure so
    // the user can retry/recover instead of silently losing it.
    const recoveryOk = discarding || scene.recoveryId ? await clearSceneRecovery(scene) : await flushRecovery(scene)
    if (!recoveryOk) return false
    const timer = recoveryTimers.get(scene.id)
    if (timer) { clearTimeout(timer); recoveryTimers.delete(scene.id) }
    if (scenes.value.length === 1) {
      // Keep one clean tab available, but never retain the closed file's identity
      // or recovery snapshot.  Reusing the old object here made Save target the
      // previously opened path after the user closed its only tab.
      if (scene.recoveryId) {
        const recoveryResult = await clearRecoverySnapshot(adapters.file, scene.recoveryId)
        if (!recoveryResult.ok) { fileMessage.value = recoveryResult.message; return false }
      }
      const replacement = createSceneState(createUiDocument(), undefined, {}, historyLimit())
      scenes.value[0] = replacement
      activeSceneId.value = replacement.id
      selectedIds.value = ['node_root']
      return true
    }
    const index = scenes.value.indexOf(scene)
    scenes.value.splice(index, 1)
    if (activeSceneId.value === sceneId) activeSceneId.value = scenes.value[Math.max(0, index - 1)].id
    else if (previousActiveId && scenes.value.some((item) => item.id === previousActiveId)) activeSceneId.value = previousActiveId
    selectedIds.value = [activeScene.value?.document.zOrder[0] ?? 'node_root']
    return true
  }

  const reorderScenes = (sceneId: string, targetSceneId: string) => {
    if (sceneId === targetSceneId) return false
    const from = scenes.value.findIndex((scene) => scene.id === sceneId)
    const to = scenes.value.findIndex((scene) => scene.id === targetSceneId)
    if (from < 0 || to < 0) return false
    const next = [...scenes.value]
    const [scene] = next.splice(from, 1)
    next.splice(to, 0, scene)
    scenes.value = next
    return true
  }

  const activateScene = (sceneId: string) => {
    if (sceneId === activeSceneId.value) return true
    const next = scenes.value.find((scene) => scene.id === sceneId)
    if (!next) return false
    // Commit drafts against the scene that owns the mounted editor before the
    // active scene identity changes; delayed editor callbacks must not write
    // a pending A draft into tab B.
    flushDrafts(activeSceneId.value)
    activeSceneId.value = sceneId
    selectedIds.value = [next.document.zOrder[0] ?? 'node_root']
    return true
  }
  const selectScene = activateScene

  const selectNodes = (ids: readonly string[], additive = false) => {
    const valid = ids.filter((id) => Boolean(findNode(document.value, id)))
    selectedIds.value = additive ? [...new Set([...selectedIds.value, ...valid])] : [...new Set(valid)]
  }
  const setHoveredNode = (nodeId: string | undefined) => { hoveredNodeId.value = nodeId }

  const addNode = (type: UiDesignerNodeType, parentId?: string | null, position?: UiPoint) => {
    try {
      const parent = parentId === undefined ? selectedNode.value?.type === 'container' ? selectedNode.value.id : 'node_root' : parentId
      const next = cloneUiDocument(document.value)
      const nodeId = nextNodeId(next, type)
      const label = `${type[0].toUpperCase()}${type.slice(1)}`
      const node = createDefaultNode(type, { id: nodeId, name: `${label}_${next.nodes.filter((item) => item.type === type).length + 1}`, parentId: parent ?? null })
      if (position) { node.props.x = position.x; node.props.y = position.y }
      next.nodes.push(node)
      if (node.parentId === null) next.zOrder.push(node.id)
      else {
        const destination = findNode(next, node.parentId)
        if (!destination || destination.type !== 'container') throw new Error('Only a container can receive child nodes')
        destination.children.push(node.id)
      }
      replaceActiveDocument(next, `Add ${type}`)
      selectedIds.value = [node.id]
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const removeSelected = () => {
    const removeIds = new Set<string>()
    const collect = (id: string) => {
      if (id === 'node_root' || removeIds.has(id)) return
      const node = findNode(document.value, id)
      if (!node) return
      removeIds.add(id)
      node.children.forEach(collect)
    }
    selectedIds.value.forEach(collect)
    if (!removeIds.size) return
    const next = cloneUiDocument(document.value)
    next.nodes = next.nodes.filter((node) => !removeIds.has(node.id))
    next.zOrder = next.zOrder.filter((id) => !removeIds.has(id))
    next.nodes.forEach((node) => { node.children = node.children.filter((id) => !removeIds.has(id)) })
    replaceActiveDocument(next, 'Delete nodes')
  }

  const updateNodeProperty = (nodeId: string, property: string, value: unknown) => {
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    const props = node.props as unknown as Record<string, unknown>
    if (!(property in props)) return
    if (typeof value === 'string' && ['path', 'backgroundPath', 'trackImage', 'fillImage', 'posterPath', 'imagePath', 'fontFile'].includes(property)) {
      const normalizedPath = value.replaceAll('\\', '/').trim()
      if (normalizedPath.includes('://') || normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath)) {
        actionError.value = 'Resource properties require project-relative paths such as img/... or audio/...; preview URIs are not persisted.'
        return
      }
      value = normalizedPath
    }
    props[property] = value
    replaceActiveDocument(next, `Update ${property}`)
  }

  const renameNode = (nodeId: string, name: string) => {
    const normalized = name.trim()
    if (!normalized) return
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.name = normalized
    replaceActiveDocument(next, 'Rename node')
  }

  const setNodeLocked = (nodeId: string, locked: boolean) => {
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.locked = locked
    replaceActiveDocument(next, locked ? 'Lock node' : 'Unlock node')
  }

  const setPropertyMode = (nodeId: string, property: string, mode: UiPropertyMode) => {
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.propModes[property] = mode
    replaceActiveDocument(next, `Set ${property} mode`)
  }

  const setPropertyCode = (nodeId: string, property: string, code: string, sceneId = activeSceneId.value) => {
    const scene = scenes.value.find((item) => item.id === sceneId)
    if (!scene) return
    const next = cloneUiDocument(scene.document)
    const node = findNode(next, nodeId)
    if (!node) return
    node.propCodes[property] = code
    scene.document = scene.history.commit(next, `Edit ${property} expression`)
    scheduleRecovery(scene)
  }

  const setNodeCondition = (nodeId: string, condition: UiVisibilityCondition) => {
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.condition = condition
    replaceActiveDocument(next, 'Update visibility condition')
  }

  const setNodeConditionFrequency = (nodeId: string, frequency: UiConditionFrequency) => {
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.conditionFrequency = frequency
    replaceActiveDocument(next, 'Update condition frequency')
  }

  const setNodeAnimation = (nodeId: string, phase: 'enterAnim' | 'exitAnim', animation: UiAnimationConfig) => {
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node[phase] = animation
    replaceActiveDocument(next, `Update ${phase}`)
  }

  const setNodeEvents = (nodeId: string, events: UiEventMap) => {
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.events = events
    replaceActiveDocument(next, 'Update events')
  }

  const reparent = (nodeId: string, targetId: string | null, position: UiTreeDropPosition) => {
    try {
      replaceActiveDocument(reparentNode(document.value, nodeId, targetId, position), 'Reparent node')
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const moveToEdge = (nodeId: string, edge: 'top' | 'bottom') => replaceActiveDocument(moveNodeToEdge(document.value, nodeId, edge), edge === 'top' ? 'Bring to front' : 'Send to back')
  const moveStep = (nodeId: string, direction: 'up' | 'down') => replaceActiveDocument(moveNodeStep(document.value, nodeId, direction), direction === 'up' ? 'Move up' : 'Move down')

  const nudgeSelected = (delta: UiPoint) => {
    if (!selectedIds.value.length) return
    const next = cloneUiDocument(document.value)
    let moved = false
    for (const id of selectedIds.value) {
      const node = findNode(next, id)
      if (!node || node.id === 'node_root' || node.locked) continue
      node.props.x += delta.x
      node.props.y += delta.y
      moved = true
    }
    if (moved) replaceActiveDocument(next, 'Nudge nodes')
  }

  const group = () => {
    try {
      const result = groupNodes(document.value, selectedIds.value)
      replaceActiveDocument(result.document, 'Group nodes')
      selectedIds.value = [result.groupId]
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const ungroup = () => {
    try {
      const groupedChildren = selectedIds.value.flatMap((id) => document.value.nodes.find((node) => node.id === id)?.type === 'container' ? document.value.nodes.find((node) => node.id === id)?.children ?? [] : [])
      const next = ungroupNodes(document.value, selectedIds.value)
      replaceActiveDocument(next, 'Ungroup nodes')
      selectedIds.value = groupedChildren.filter((id) => Boolean(findNode(next, id)))
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const copy = () => { clipboard.value = copySelection(document.value, selectedIds.value) }

  const duplicateSelected = () => {
    copy()
    paste()
  }

  const paste = (parentId?: string | null) => {
    if (!clipboard.value) return
    try {
      const destination = parentId === undefined ? selectedNode.value?.type === 'container' ? selectedNode.value.id : 'node_root' : parentId
      const result = pasteClipboard(document.value, clipboard.value, destination ?? null)
      replaceActiveDocument(result.document, 'Paste nodes')
      selectedIds.value = result.ids
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const undo = () => {
    const scene = activeScene.value
    if (!scene || !scene.history.canUndo) return
    scene.document = scene.history.undo()
    selectedIds.value = selectedIds.value.filter((id) => Boolean(findNode(scene.document, id)))
  }

  const redo = () => {
    const scene = activeScene.value
    if (!scene || !scene.history.canRedo) return
    scene.document = scene.history.redo()
    selectedIds.value = selectedIds.value.filter((id) => Boolean(findNode(scene.document, id)))
  }

  const markSaved = () => activeScene.value?.history.markSaved()

  const discard = async () => {
    draftCoordinator.cancel()
    draftCode.value = {}
    for (const scene of scenes.value) scene.document = scene.history.discard()
    let cleared = true
    for (const scene of scenes.value) if (!(await clearSceneRecovery(scene))) cleared = false
    selectedIds.value = selectedIds.value.filter((id) => Boolean(findNode(document.value, id)))
    if (!selectedIds.value.length) selectedIds.value = [document.value.zOrder[0] ?? 'node_root']
    if (cleared) fileMessage.value = 'Current designer changes were discarded.'
    return cleared
  }

  const saveScene = async (sceneId: string, mode: 'save' | 'saveAs' = 'save', options: { force?: boolean } = {}) => {
    if (!canSave.value) {
      fileStatus.value = 'unavailable'
      fileMessage.value = 'File adapter is not connected; no project file was written.'
      return false
    }
    fileStatus.value = 'busy'
    fileConflict.value = null
    runtimeConflict.value = false
    try {
      const scene = scenes.value.find((item) => item.id === sceneId)
      if (!scene) return false
      const capturedSceneId = scene.id
      flushDrafts(capturedSceneId)
      const sourceBefore = JSON.stringify(scene.document)
      const generation = projectGeneration.value
      const request = {
        path: mode === 'saveAs' ? undefined : scene?.sourcePath,
        expected: mode === 'saveAs' || !scene?.openedMetadata ? undefined : { digest: scene.openedMetadata.digest, mtimeMs: scene.openedMetadata.mtimeMs },
        force: options.force,
      }
      const result = mode === 'saveAs' ? await adapters.file.saveAs(cloneUiDocument(scene.document), request) : await adapters.file.save(cloneUiDocument(scene.document), request)
      if (generation !== projectGeneration.value) return false
      fileStatus.value = result.status
      fileMessage.value = result.message
      if (result.conflict) fileConflict.value = result.conflict
      if (result.status === 'success') {
        const currentScene = scenes.value.find((item) => item.id === capturedSceneId)
        if (!currentScene || JSON.stringify(currentScene.document) !== sourceBefore) {
          fileMessage.value = 'The tab changed while saving; its newer edits remain dirty and were not marked saved.'
          return false
        }
        if (result.value) currentScene.document = currentScene.history.commit(result.value, 'Save source')
        currentScene.history.markSaved()
        currentScene.sourcePath = result.sourcePath ?? result.path ?? currentScene.sourcePath
        currentScene.openedMetadata = result.metadata
        const previousRecoveryId = currentScene.recoveryId
        currentScene.recoveryId = result.recoveryId
        const timer = recoveryTimers.get(currentScene.id)
        if (timer) { clearTimeout(timer); recoveryTimers.delete(currentScene.id) }
        if (previousRecoveryId && previousRecoveryId !== result.recoveryId) {
          const cleanup = await clearRecoverySnapshot(adapters.file, previousRecoveryId)
          if (!cleanup.ok) {
            currentScene.recoveryId = previousRecoveryId
            fileStatus.value = cleanup.status
            fileMessage.value = cleanup.message
            return false
          }
        }
        currentScene.recoveryId = result.recoveryId
        return true
      }
      return false
    } catch (error) {
      fileStatus.value = 'error'
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (fileStatus.value === 'busy') fileStatus.value = 'error'
    }
  }

  const save = async (mode: 'save' | 'saveAs' = 'save', options: { force?: boolean } = {}) => {
    const scene = activeScene.value
    return scene ? saveScene(scene.id, mode, options) : false
  }

  const discardScene = async (sceneId: string) => {
    const scene = scenes.value.find((item) => item.id === sceneId)
    if (!scene) return false
    draftCoordinator.cancel(sceneId)
    for (const key of Object.keys(draftCode.value)) if (key.startsWith(`${sceneId}:`)) delete draftCode.value[key]
    scene.document = scene.history.discard()
    return clearSceneRecovery(scene)
  }

  const { saveAllDirtyScenes } = createUiDesignerSceneHistoryOperations({
    scenes,
    activeSceneId,
    isDirty: sceneIsDirty,
    saveScene,
  })
  const discardAllDirtyScenes = () => discard()

  const open = async (request: { path?: string } = {}) => {
    if (!canSave.value) {
      fileStatus.value = 'unavailable'
      fileMessage.value = 'File adapter is not connected; open is disabled.'
      return false
    }
    fileStatus.value = 'busy'
    const generation = projectGeneration.value
    try {
      const result = await adapters.file.open(request)
      if (generation !== projectGeneration.value) return false
      if (!result) {
        fileStatus.value = 'idle'
        fileMessage.value = 'No source file was selected.'
        return false
      }
      fileStatus.value = result.status
      fileMessage.value = result.message
      if ((result.status === 'success' || result.status === 'ready') && result.value) {
        const report = validateDocument(result.value)
        if (!report.valid) {
          fileStatus.value = 'error'
          fileMessage.value = report.errors.map((issue) => issue.message).join(' ')
          return false
        }
        const scene = createSceneState(result.value, `scene_tab_${++sceneSequence}`, { sourcePath: result.sourcePath ?? result.path, openedMetadata: result.metadata, recoveryId: result.recoveryId }, historyLimit())
        scene.history.markSaved()
        scenes.value.push(scene)
        activateScene(scene.id)
        void loadReferencedResources(result.value)
        void loadWelcomeRecords()
        return true
      }
      return false
    } catch (error) {
      fileStatus.value = 'error'
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (fileStatus.value === 'busy') fileStatus.value = 'error'
    }
  }

  const loadWelcomeRecords = async () => {
    if (!canSave.value) return false
    const generation = projectGeneration.value
    try {
      const [recent, recovery] = await Promise.all([
        adapters.file.listRecentFiles(),
        adapters.file.listRecovery(),
      ])
      if (generation !== projectGeneration.value) return false
      if (recent.status === 'success' && recent.value) recentFiles.value = recent.value
      if (recovery.status === 'success' && recovery.value) recoveryRecords.value = recovery.value
      templates.value = [...UI_DESIGNER_BUILT_IN_TEMPLATES]
      return true
    } catch (error) {
      fileStatus.value = 'error'
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const restoreRecovery = async (recoveryId: string) => {
    if (!canSave.value) return false
    try {
      const result = await adapters.file.readRecovery(recoveryId)
      if (result.status !== 'success' || !result.value) return false
      const report = validateDocument(result.value.document)
      if (!report.valid) {
        fileMessage.value = report.errors.map((item) => item.message).join(' ')
        return false
      }
      const record = result.value.record
      const scene = createSceneState(createUiDocument(result.value.document.meta.sceneName), `scene_tab_${++sceneSequence}`, {
        sourcePath: record.sourcePath,
        recoveryId: record.id,
        openedMetadata: { path: record.sourcePath, digest: record.digest, mtimeMs: record.mtimeMs, size: 0 },
      }, historyLimit())
      scene.document = scene.history.commit(result.value.document, 'Restore recovery draft')
      scenes.value.push(scene)
      activateScene(scene.id)
      void loadReferencedResources(result.value.document)
      return true
    } catch (error) {
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const loadTemplate = async (name: string) => {
    if (!isBuiltInUiDesignerTemplate(name)) return false
    try {
      const result = { status: 'success' as const, value: createBuiltInUiDesignerTemplate(name) }
      if (result.status !== 'success' || !result.value) return false
      const report = validateDocument(result.value)
      if (!report.valid) return false
      const scene = createSceneState(createUiDocument(result.value.meta.sceneName), `scene_tab_${++sceneSequence}`, {}, historyLimit())
      scene.document = scene.history.commit(result.value, 'Load template')
      scenes.value.push(scene)
      activateScene(scene.id)
      return true
    } catch (error) {
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const reloadConflict = async () => {
    const scene = activeScene.value
    if (!scene?.sourcePath || !canSave.value) return false
    draftCoordinator.cancel(scene.id)
    for (const key of Object.keys(draftCode.value)) if (key.startsWith(`${scene.id}:`)) delete draftCode.value[key]
    fileStatus.value = 'busy'
    try {
      const result = await adapters.file.open({ path: scene.sourcePath })
      fileStatus.value = result?.status ?? 'error'
      fileMessage.value = result?.message ?? 'The source file could not be reloaded.'
      if (!result || result.status !== 'success' || !result.value) return false
      scene.document = result.value
      scene.history = new UiDesignerHistory(result.value, historyLimit())
      scene.history.markSaved()
      scene.openedMetadata = result.metadata
      scene.recoveryId = result.recoveryId
      fileConflict.value = null
      return true
    } catch (error) {
      fileStatus.value = 'error'
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (fileStatus.value === 'busy') fileStatus.value = 'error'
    }
  }

  const resolveFileConflict = async (choice: 'reload' | 'saveAs' | 'force') => {
    if (runtimeConflict.value) {
      if (choice !== 'force') return false
      return resolveRuntimeConflict()
    }
    if (choice === 'reload') return reloadConflict()
    if (choice === 'saveAs') return save('saveAs')
    return save('save', { force: true })
  }
  const clearFileConflict = () => clearConflictState()

  const loadResources = async (request: UiDesignerResourceRequest = {}) => {
    if (!hasProject.value) {
      resourceStatus.value = 'unavailable'
      resourceMessage.value = 'Select a project before loading resources.'
      resourceCatalog.value = null
      return null
    }
    if (!canLoadResources.value) {
      resourceStatus.value = 'unavailable'
      resourceMessage.value = 'Resource adapter is not connected.'
      return null
    }
    resourceStatus.value = 'busy'
    const generation = projectGeneration.value
    try {
      const result: UiDesignerResourceLoadResult = await adapters.resource.loadProject(request)
      if (generation !== projectGeneration.value) return null
      if (!result) {
        resourceStatus.value = 'idle'
        resourceMessage.value = 'No project resources were selected.'
        return null
      }
      resourceStatus.value = result.status
      resourceMessage.value = result.message
      if ((result.status === 'success' || result.status === 'ready') && result.value) {
        const incoming = cloneCatalog(result.value)
        const incomingIds = new Set(incoming.resources.map((resource) => resource.id))
        const previous = resourceCatalog.value
        resourceCatalog.value = {
          ...incoming,
          resources: [...(previous?.resources ?? []).filter((resource) => !incomingIds.has(resource.id)), ...incoming.resources],
        }
        return incoming
      }
      return null
    } catch (error) {
      resourceStatus.value = 'error'
      resourceMessage.value = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      if (resourceStatus.value === 'busy') resourceStatus.value = 'error'
    }
  }

  const importSceneData = async (path: string, confirmedLossy = false) => {
    if (!confirmedLossy || !path || !hasProject.value || !adapters.resource.readSceneData) return false
    resourceStatus.value = 'busy'
    const generation = projectGeneration.value
    try {
      const result = await adapters.resource.readSceneData({ path })
      if (generation !== projectGeneration.value) return false
      resourceStatus.value = result?.status ?? 'error'
      resourceMessage.value = result?.message ?? 'Scene data import failed.'
      if (!result || result.status !== 'success' || !result.value) return false
      const imported = importRuntimeSceneDocument(result.value.scene)
      const report = validateDocument(imported)
      if (!report.valid) {
        actionError.value = report.errors.map((issue) => issue.message).join(' ')
        return false
      }
      // Start from a fresh baseline so the imported Runtime JSON is a dirty
      // lossy editor copy and Save/route guards remain active.
      const scene = createSceneState(createUiDocument(imported.meta.sceneName), `scene_tab_${++sceneSequence}`, {}, historyLimit())
      scene.document = scene.history.commit(imported, 'Import Runtime scene data')
      scenes.value.push(scene)
      activateScene(scene.id)
      scheduleRecovery(scene)
      return true
    } catch (error) {
      resourceStatus.value = 'error'
      resourceMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (resourceStatus.value === 'busy') resourceStatus.value = 'error'
    }
  }

  const setHistoryLimit = async (value: number) => {
    const normalized = applyHistoryLimit(value)
    return savePreferences({ historyLimit: normalized })
  }

  const setGridPreference = async (enabled: boolean) => {
    preferences.value = { ...preferences.value, gridEnabled: enabled }
    return savePreferences({ gridEnabled: enabled })
  }

  const setSnapPreference = async (enabled: boolean) => {
    preferences.value = { ...preferences.value, snapEnabled: enabled }
    return savePreferences({ snapEnabled: enabled })
  }

  const { startPreview, stopPreview, startEditorPreview: startRawEditorPreview, stopEditorPreview: stopRawEditorPreview } = createUiDesignerPreviewOperations({
    getPreview: () => adapters.preview,
    projectPath,
    projectGeneration,
    document,
    canPreview,
    isPreviewing,
    isEditorPreviewing,
    editorPreviewStatus,
    previewStatus,
    previewMessage,
    previewSessionId,
    previewDiagnostics,
    poller: previewPoller,
    flushDrafts,
  })

  // Editor preview always renders the design canvas. Keep the user's source
  // mode outside the document/history so leaving preview restores code mode
  // exactly when that was the entry point.
  let editorPreviewModeBefore: 'design' | 'code' | undefined
  const startEditorPreview = () => {
    if (isEditorPreviewing.value) return true
    editorPreviewModeBefore = editingMode.value
    editingMode.value = 'design'
    return startRawEditorPreview()
  }
  const stopEditorPreview = () => {
    const result = stopRawEditorPreview()
    if (editorPreviewModeBefore) editingMode.value = editorPreviewModeBefore
    editorPreviewModeBefore = undefined
    return result
  }

  const updateNodePositionWithSnap = (nodeId: string, position: { x: number; y: number }) => {
    const settings = document.value.canvas
    const result = snapPoint(position, {
      gridEnabled: typeof preferences.value.gridEnabled === 'boolean' ? preferences.value.gridEnabled : settings.snap.enabled,
      gridSize: settings.grid.size,
      smartEnabled: typeof preferences.value.snapEnabled === 'boolean' ? preferences.value.snapEnabled && settings.snap.smartEnabled : settings.snap.smartEnabled,
      sensitivity: settings.snap.sensitivity,
      guides: document.value.guides,
      canvasWidth: settings.width,
      canvasHeight: settings.height,
      targets: document.value.nodes.filter((node) => node.id !== nodeId).map((node) => ({ id: node.id, rect: { x: node.props.x, y: node.props.y, width: node.props.width, height: node.props.height } })),
    })
    replaceActiveDocument(updateNodePosition(document.value, nodeId, result), 'Move node')
    return result
  }

  const previewNodePositionWithSnap = (nodeId: string, position: UiPoint) => {
    const settings = document.value.canvas
    const result = snapPoint(position, {
      gridEnabled: typeof preferences.value.gridEnabled === 'boolean' ? preferences.value.gridEnabled : settings.snap.enabled,
      gridSize: settings.grid.size,
      smartEnabled: typeof preferences.value.snapEnabled === 'boolean' ? preferences.value.snapEnabled && settings.snap.smartEnabled : settings.snap.smartEnabled,
      sensitivity: settings.snap.sensitivity,
      guides: document.value.guides,
      canvasWidth: settings.width,
      canvasHeight: settings.height,
      targets: document.value.nodes.filter((node) => node.id !== nodeId).map((node) => ({ id: node.id, rect: { x: node.props.x, y: node.props.y, width: node.props.width, height: node.props.height } })),
    })
    draftPositions.value = { ...draftPositions.value, [nodeId]: result }
    return result
  }

  const commitDraftPosition = (nodeId: string) => {
    const position = draftPositions.value[nodeId]
    if (!position) return
    draftPositions.value = Object.fromEntries(Object.entries(draftPositions.value).filter(([id]) => id !== nodeId))
    replaceActiveDocument(updateNodePosition(document.value, nodeId, position), 'Move node')
  }

  const previewSelectedPositionsWithSnap = (ids: readonly string[], origins: Record<string, UiPoint>, delta: UiPoint) => {
    const validIds = ids.filter((id) => Boolean(findNode(document.value, id)))
    if (!validIds.length) return {}
    const anchorId = validIds[0]
    const anchorOrigin = origins[anchorId] ?? findNode(document.value, anchorId)?.props ?? { x: 0, y: 0 }
    const requested = { x: anchorOrigin.x + delta.x, y: anchorOrigin.y + delta.y }
    const snapped = previewNodePositionWithSnap(anchorId, requested)
    const snapDelta = { x: snapped.x - requested.x, y: snapped.y - requested.y }
    const nextDrafts = { ...draftPositions.value }
    for (const id of validIds) {
      const origin = origins[id] ?? findNode(document.value, id)?.props ?? { x: 0, y: 0 }
      nextDrafts[id] = { x: origin.x + delta.x + snapDelta.x, y: origin.y + delta.y + snapDelta.y }
    }
    draftPositions.value = nextDrafts
    return nextDrafts
  }

  const commitDraftPositions = (ids: readonly string[]) => {
    const next = cloneUiDocument(document.value)
    let changed = false
    for (const id of ids) {
      const position = draftPositions.value[id]
      const node = findNode(next, id)
      if (!position || !node) continue
      node.props.x = position.x
      node.props.y = position.y
      changed = true
    }
    draftPositions.value = Object.fromEntries(Object.entries(draftPositions.value).filter(([id]) => !ids.includes(id)))
    if (changed) replaceActiveDocument(next, ids.length > 1 ? 'Move nodes' : 'Move node')
  }

  const previewNodeRect = (nodeId: string, rect: UiRect) => { draftRects.value = { ...draftRects.value, [nodeId]: rect } }
  const commitDraftRect = (nodeId: string) => {
    const rect = draftRects.value[nodeId]
    if (!rect) return
    draftRects.value = Object.fromEntries(Object.entries(draftRects.value).filter(([id]) => id !== nodeId))
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return
    node.props.x = rect.x + rect.width * node.props.anchorX
    node.props.y = rect.y + rect.height * node.props.anchorY
    node.props.width = rect.width / Math.max(Math.abs(node.props.scaleX), 0.0001)
    node.props.height = rect.height / Math.max(Math.abs(node.props.scaleY), 0.0001)
    replaceActiveDocument(next, 'Resize node')
  }
  const previewNodeRotation = (nodeId: string, rotation: number) => { draftRotations.value = { ...draftRotations.value, [nodeId]: rotation } }
  const commitDraftRotation = (nodeId: string) => {
    const rotation = draftRotations.value[nodeId]
    if (rotation === undefined) return
    draftRotations.value = Object.fromEntries(Object.entries(draftRotations.value).filter(([id]) => id !== nodeId))
    updateNodeProperty(nodeId, 'rotate', rotation)
  }

  const setZoom = (scale: number, anchor?: { x: number; y: number }) => { viewport.value = zoomViewport(viewport.value, scale, anchor) }
  const fitCanvas = () => { viewport.value = fitViewport(viewport.value, document.value.canvas.width, document.value.canvas.height) }
  const pan = (delta: { x: number; y: number }) => { viewport.value = panViewport(viewport.value, delta) }
  const align = (alignment: Parameters<typeof alignNodes>[2], reference: Parameters<typeof alignNodes>[3] = 'selection') => replaceActiveDocument(alignNodes(document.value, selectedIds.value, alignment, reference), `Align ${alignment}`)
  const distribute = (axis: Parameters<typeof distributeNodes>[2]) => replaceActiveDocument(distributeNodes(document.value, selectedIds.value, axis), `Distribute ${axis}`)

  return {
    adapters,
    scenes,
    activeSceneId,
    activeScene,
    document,
    selectedIds,
    hoveredNodeId,
    selectedNodes,
    selectedNode,
    clipboard,
    viewport,
    draftPositions,
    draftCode,
    draftRects,
    draftRotations,
    draftCoordinator,
    projectPath,
    editingMode,
    codeTab,
    isPreviewing,
    isEditorPreviewing,
    editorPreviewStatus,
    editorPreviewResolution: editorPreview.resolution,
    editorPreviewConditionMode: editorPreview.conditionMode,
    setEditorPreviewResolution: editorPreview.setResolution,
    setEditorPreviewConditionMode: editorPreview.setConditionMode,
    fileStatus,
    fileMessage,
    previewStatus,
    previewMessage,
    previewSessionId,
    previewDiagnostics,
    runtimeStatus,
    runtimeStaging,
    resourceCatalog,
    resourceStatus,
    resourceMessage,
    actionError,
    fileConflict,
    runtimeConflict,
    runtimeConflictPath,
    runtimeConflictOperation,
    runtimeConflictFiles,
    runtimeProofMissing,
    recentFiles,
    recoveryRecords,
    recoveryCleanupPending,
    templates,
    preferences,
    validation,
    performance,
    isDirty,
    isSceneDirty,
    canSave,
    hasProject,
    canExport,
    canManageRuntime,
    canLoadResources,
    canPreview,
    canEditCode,
    newScene,
    closeScene,
    reorderScenes,
    selectNodes,
    setHoveredNode,
    addNode,
    removeSelected,
    updateNodeProperty,
    renameNode,
    setNodeLocked,
    setPropertyMode,
    setPropertyCode,
    setNodeCondition,
    setNodeConditionFrequency,
    setNodeAnimation,
    setNodeEvents,
    setSceneMeta,
    setSourceCode,
    previewSourceCode,
    commitSourceCode,
    flushDrafts,
    setGridEnabled,
    setSnapEnabled,
    setCanvasSetting,
    setMapBackground,
    setGlobalFilter,
    setTransition,
    addGuide,
    setGuidePosition,
    setGuideLocked,
    removeGuide,
    clearGuides,
    reparent,
    moveToEdge,
    moveStep,
    nudgeSelected,
    group,
    ungroup,
    copy,
    duplicateSelected,
    paste,
    undo,
    redo,
    markSaved,
    saveAllDirtyScenes,
    discardAllDirtyScenes,
    discard,
    save,
    saveScene,
    discardScene,
    open,
    loadWelcomeRecords,
    removeRecentFile,
    removeRecovery,
    restoreRecovery,
    loadTemplate,
    loadPreferences,
    savePreferences,
    setHistoryLimit,
    setGridPreference,
    setSnapPreference,
    setProjectContext,
    activateScene,
    selectScene,
    writeRecovery,
    flushRecovery,
    reloadConflict,
    resolveFileConflict,
    clearFileConflict,
    exportRuntime,
    exportRuntimeJson,
    loadResources,
    importSceneData,
    checkRuntime,
    installRuntime,
    stageRuntime,
    startPreview,
    stopPreview,
    startEditorPreview,
    stopEditorPreview,
    updateNodePositionWithSnap,
    previewNodePositionWithSnap,
    commitDraftPosition,
    previewSelectedPositionsWithSnap,
    commitDraftPositions,
    previewNodeRect,
    commitDraftRect,
    previewNodeRotation,
    commitDraftRotation,
    setZoom,
    fitCanvas,
    pan,
    align,
    distribute,
  }
}

export type UiDesignerRawController = ReturnType<typeof useUiDesigner>
export type UiDesignerController = UnwrapNestedRefs<UiDesignerRawController>
export type UiDesignerControllerRef = Ref<UiDesignerRawController>
