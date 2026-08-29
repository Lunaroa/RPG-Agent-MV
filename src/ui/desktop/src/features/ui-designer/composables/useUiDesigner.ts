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
  UiDesignerSceneFileRecord,
  UiDesignerRecoveryRecord,
  UiDesignerProjectProfileResult,
  UiDesignerResourceRequest,
  UiEventMap,
  UiFileStatus,
  UiNode,
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
import type { UiDesignerRendererExecutionMode } from '@contract/ui-designer-renderer-bridge'
import type { ProjectAssetChangeManifest } from '@contract/types'
import { createUiDesignerAdapters, type UiDesignerResourceLoadResult } from '../adapters'
import {
  cloneUiDocument,
  createDefaultNode,
  createUiDocument,
  findNode,
  nextNodeId,
} from '../models/document'
import { exportRuntimeDocument, importRuntimeSceneDocument } from '../models/export'
import {
  alignNodes,
  applyNodeGeometryTransaction,
  clampNodePositionToParent,
  clampNodeRectToParent,
  distributeNodes,
  fitViewport,
  localResizeNodeRect,
  normalizeGeometryInteger,
  normalizeGeometryPoint,
  nodeRect,
  nodeVisualRect,
  panViewport,
  resizeRect,
  rotateSubtreeTransforms,
  smartSnapTargetsForNode,
  snapFeedbackFor,
  snapMoveRect,
  snapPoint,
  updateNodePosition,
  zoomViewport,
  type SnapOptions,
  type UiResizeHandle,
  type UiResizeModifiers,
  type UiSnapFeedback,
  type UiSnapHit,
} from '../models/geometry'
import { resolveNodeActionPolicy, type UiNodeActionCommand } from '../models/actions'
import { UiDesignerHistory } from '../models/history'
import { analyzePerformance } from '../models/performance'
import { nextSiblingCascadePosition } from '../models/placement'
import { normalizeNineSliceBorderValue } from '../models/nine-slice'
import { parseUiDocument } from '../models/parser'
import { collectNodeSubtreeIds, copySelection, groupNodes, moveNodeStep, moveNodeToEdge, pasteClipboard, reparentNode, selectionRootNodeIds, ungroupNodes } from '../models/tree'
import { isValidUiDesignerSceneName, validateDocument } from '../models/validation'
import { UI_DESIGNER_BUILT_IN_TEMPLATES, createBuiltInUiDesignerTemplate, isBuiltInUiDesignerTemplate } from '../models/templates'
import { createUiDesignerDraftCoordinator, type UiDesignerDraftCoordinator } from './draftCoordinator'
import { createUiDesignerSceneHistoryOperations } from './sceneHistoryOperations'
import { createUiDesignerPersistenceOperations, UI_DESIGNER_DEFAULT_CODE_FONT_FAMILY } from './persistenceOperations'
import { createUiDesignerRuntimeOperations } from './runtimeOperations'
import { clearRecoverySnapshot } from './recoveryLifecycle'
import {
  normalizeUiDesignerProjectRelativeResourcePath,
  normalizeUiDesignerResourceProperty,
  normalizeProjectAssetChangeManifest,
  UI_BUTTON_WINDOW_SKIN_RESOURCE_PATH,
} from '@contract/ui-designer-resources'

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

export type UiDesignerPreviewDisposeReason = 'project-change' | 'unload' | 'shutdown'

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
    let normalized = ''
    try { normalized = normalizeUiDesignerProjectRelativeResourcePath(value) } catch { return }
    if (!normalized) return
    const lower = normalized.toLocaleLowerCase()
    if (lower.startsWith('img/') || lower.startsWith('audio/') || lower.startsWith('movies/') || lower.startsWith('fonts/') || lower.startsWith('www/img/') || lower.startsWith('www/audio/') || lower.startsWith('www/movies/') || lower.startsWith('www/fonts/')) paths.add(normalized)
  }
  for (const node of document.nodes) {
    const props = node.props as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(props)) if (RESOURCE_PROPERTY_KEYS.has(key)) add(value)
    if (node.type === 'frameAnimation') for (const frame of node.props.frames) add(frame.path)
    if (node.type === 'button') {
      for (const path of Object.values(node.props.imageStates)) add(path)
      add(UI_BUTTON_WINDOW_SKIN_RESOURCE_PATH)
    }
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
  const snapFeedback = ref<UiSnapFeedback | null>(null)
  const editingMode = ref<'design' | 'code' | 'json'>('design')
  const isPreviewing = ref(false)
  const isEditorPreviewing = ref(false)
  const previewStatus = ref<UiPreviewState>('idle')
  const previewMessage = ref('')
  const previewExecutionMode = ref<UiDesignerRendererExecutionMode>('authoring')
  const previewCleanupPending = ref(false)
  const previewDisposalInFlight = ref(false)
  let previewModeBefore: 'design' | 'code' | 'json' | undefined
  let previewExitPending = false
  let gamePreviewRunId = ''
  let gamePreviewStartPromise: Promise<unknown> | undefined
  let removeGamePreviewStatusListener: (() => void) | undefined
  const fileStatus = ref<UiFileStatus>('idle')
  const fileMessage = ref('')
  const runtimeDiagnostics = ref<UiRuntimeDiagnostic[]>([])
  const previewDiagnostics = runtimeDiagnostics
  const runtimeStatus = ref<UiRuntimeStatus>({ state: 'unknown', message: 'Runtime has not been inspected.' })
  const runtimeStaging = ref<UiDesignerRuntimeStageResult | null>(null)
  const resourceCatalog = ref<UiProjectResourceCatalog | null>(null)
  const resourceStatus = ref<UiFileStatus>('idle')
  const resourceMessage = ref('')
  const projectProfile = ref<UiDesignerProjectProfileResult | null>(null)
  const projectProfileStatus = ref<UiFileStatus>('idle')
  const projectProfileMessage = ref('')
  const actionError = ref('')
  const fileConflict = ref<UiDesignerFileConflict | null>(null)
  const runtimeConflict = ref(false)
  const runtimeConflictPath = ref<string | undefined>()
  const runtimeConflictOperation = ref<'stage' | 'export' | null>(null)
  const runtimeConflictFiles = ref<string[]>([])
  const runtimeProofMissing = ref(false)
  const previewDisposers = new Set<(reason: UiDesignerPreviewDisposeReason) => Promise<boolean>>()
  const resourceMutationHandlers = new Set<(manifest: ProjectAssetChangeManifest) => Promise<void> | void>()
  let previewDisposePromise: Promise<boolean> | null = null
  const recentFiles = ref<UiDesignerRecentFileRecord[]>([])
  const sceneFiles = ref<UiDesignerSceneFileRecord[]>([])
  const recoveryRecords = ref<UiDesignerRecoveryRecord[]>([])
  const recoveryCleanupPending = ref(false)
  const templates = ref<string[]>([...UI_DESIGNER_BUILT_IN_TEMPLATES])
  const preferences = ref<UiDesignerPreferences>({ historyLimit: DEFAULT_HISTORY_LIMIT, gridEnabled: true, snapEnabled: true, tourCompleted: false, autoSaveIntervalMinutes: 1, gridSize: 16, gridColor: '#394150', snapSensitivity: 8, defaultCanvasWidth: 816, defaultCanvasHeight: 624, codeFontFamily: UI_DESIGNER_DEFAULT_CODE_FONT_FAMILY, codeFontSize: 12, codeTabSize: 2, theme: 'system', defaultAuthor: '', autoFormat: false, leftPaneWidth: 260, centerPaneWidth: 640, rightPaneWidth: 320 })
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const projectGeneration = ref(0)
  const draftCoordinator: UiDesignerDraftCoordinator = createUiDesignerDraftCoordinator()
  let propertyEdit: { sceneId: string; nodeId: string; property: string; description: string; reloadResources: boolean } | undefined
  let sceneThumbnailProvider: ((sceneId: string) => string | undefined) | undefined

  const registerSceneThumbnailProvider = (provider: (sceneId: string) => string | undefined) => {
    sceneThumbnailProvider = provider
    return () => { if (sceneThumbnailProvider === provider) sceneThumbnailProvider = undefined }
  }

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
    const sourceDraft = Object.prototype.hasOwnProperty.call(draftCode.value, sceneId)
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
  const canRenderCanvas = computed(() => hasProject.value && adapters.rendererHost !== createUiDesignerAdapters().rendererHost)
  const canPreview = computed(() => hasProject.value && adapters.gamePreview !== createUiDesignerAdapters().gamePreview)
  const previewOccupied = computed(() => previewCleanupPending.value || previewDisposalInFlight.value || previewStatus.value === 'preparing' || isPreviewing.value || isEditorPreviewing.value || previewExecutionMode.value !== 'authoring')
  const canStartPreview = computed(() => canPreview.value && !previewOccupied.value)
  const canStartEditorPreview = computed(() => canRenderCanvas.value && !previewOccupied.value)
  const canEditCode = computed(() => adapters.code.available)
  const newSceneCanvasSize = computed(() => projectProfile.value
    ? { width: projectProfile.value.screenWidth, height: projectProfile.value.screenHeight }
    : null)
  const canCreateScene = computed(() => Boolean(newSceneCanvasSize.value))

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

  const loadProjectProfile = async () => {
    const generation = projectGeneration.value
    const capturedProject = projectPath.value?.trim()
    if (!capturedProject) {
      projectProfile.value = null
      projectProfileStatus.value = 'idle'
      projectProfileMessage.value = ''
      return true
    }
    projectProfileStatus.value = 'busy'
    projectProfileMessage.value = ''
    try {
      const result = await adapters.project.getProfile({ project: capturedProject })
      if (generation !== projectGeneration.value || capturedProject !== projectPath.value?.trim()) return false
      const value = result.value
      if (result.status !== 'success' || !value || !Number.isSafeInteger(value.screenWidth) || value.screenWidth < 1 || !Number.isSafeInteger(value.screenHeight) || value.screenHeight < 1) {
        projectProfile.value = null
        projectProfileStatus.value = 'error'
        projectProfileMessage.value = result.message || 'The selected project did not expose valid UI canvas dimensions.'
        return false
      }
      projectProfile.value = { ...value }
      projectProfileStatus.value = 'success'
      projectProfileMessage.value = result.message
      return true
    } catch (error) {
      if (generation !== projectGeneration.value || capturedProject !== projectPath.value?.trim()) return false
      projectProfile.value = null
      projectProfileStatus.value = 'error'
      projectProfileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const restorePreviewMode = () => {
    if (previewModeBefore) editingMode.value = previewModeBefore
    previewModeBefore = undefined
  }

  const cancelPreviewForContextChange = () => {
    previewExecutionMode.value = 'authoring'
    previewCleanupPending.value = false
    isPreviewing.value = false
    isEditorPreviewing.value = false
    previewStatus.value = 'stopped'
    previewMessage.value = ''
    previewExitPending = false
    restorePreviewMode()
  }

  const registerPreviewDisposer = (disposer: (reason: UiDesignerPreviewDisposeReason) => Promise<boolean>) => {
    previewDisposers.add(disposer)
    return () => { previewDisposers.delete(disposer) }
  }

  const registerResourceMutationHandler = (handler: (manifest: ProjectAssetChangeManifest) => Promise<void> | void) => {
    resourceMutationHandlers.add(handler)
    return () => { resourceMutationHandlers.delete(handler) }
  }

  const notifyResourceMutation = async (manifest: ProjectAssetChangeManifest) => {
    const normalized = normalizeProjectAssetChangeManifest(manifest)
    await Promise.all([...resourceMutationHandlers].map((handler) => handler(normalized)))
  }

  const disposePreview = (reason: UiDesignerPreviewDisposeReason = 'unload'): Promise<boolean> => {
    if (previewDisposePromise) return previewDisposePromise
    if (!previewDisposers.size) return Promise.resolve(true)
    const recoveringCleanup = previewCleanupPending.value
    previewDisposalInFlight.value = true
    const operation = (async () => {
      const attempted = new Set<(reason: UiDesignerPreviewDisposeReason) => Promise<boolean>>()
      let allStopped = true
      while (true) {
        const disposers = [...previewDisposers].filter((disposer) => !attempted.has(disposer))
        if (!disposers.length) break
        disposers.forEach((disposer) => attempted.add(disposer))
        const results = await Promise.all(disposers.map(async (disposer) => {
          try { return await disposer(reason) }
          catch { return false }
        }))
        if (!results.every(Boolean)) allStopped = false
      }
      if (!allStopped) previewCleanupPending.value = true
      else if (recoveringCleanup) {
        previewCleanupPending.value = false
        previewStatus.value = 'stopped'
        previewMessage.value = ''
      }
      return allStopped
    })()
    const tracked = operation.finally(() => {
      previewDisposalInFlight.value = false
      if (previewDisposePromise === tracked) previewDisposePromise = null
    })
    previewDisposePromise = tracked
    return tracked
  }

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
    const previewWasOccupied = previewOccupied.value
    let previewDisposed = false
    if (previewWasOccupied) {
      if (isPreviewing.value && !(await stopPreview())) return false
      if (!(await disposePreview('project-change'))) {
        previewStatus.value = 'error'
        previewMessage.value = 'The isolated UI canvas could not finish closing; the project was not changed.'
        return false
      }
      // A host may not be mounted yet, so its execution-mode callback can be
      // absent.  Once the owner barrier has completed, make the controller
      // authoring state explicit before any dirty prompt or project mutation.
      cancelPreviewForContextChange()
      previewDisposed = true
    }
    if (isDirty.value && options.confirmDiscard && !(await options.confirmDiscard())) return false
    if (!previewDisposed && !(await disposePreview('project-change'))) {
      previewStatus.value = 'error'
      previewMessage.value = 'The isolated UI canvas could not finish closing; the project was not changed.'
      return false
    }
    projectGeneration.value += 1
    if (previewOccupied.value || previewStatus.value !== 'idle') cancelPreviewForContextChange()
    previewStatus.value = 'idle'
    previewMessage.value = ''
    runtimeDiagnostics.value = []
    resourceCatalog.value = null
    sceneFiles.value = []
    runtimeStatus.value = { state: 'unknown', message: 'Runtime has not been inspected.' }
    runtimeStaging.value = null
    projectProfile.value = null
    projectProfileStatus.value = nextProjectPath?.trim() ? 'busy' : 'idle'
    projectProfileMessage.value = ''
    Object.assign(adapters, createUiDesignerAdapters(nextAdapters))
    wireGamePreviewStatus()
    projectPath.value = nextProjectPath
    await loadProjectProfile()
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

  const commitPendingPropertyEdit = (nodeId?: string, property?: string) => {
    const pending = propertyEdit
    if (!pending || (nodeId !== undefined && pending.nodeId !== nodeId) || (property !== undefined && pending.property !== property)) return false
    propertyEdit = undefined
    const scene = scenes.value.find((item) => item.id === pending.sceneId)
    if (!scene) return false
    scene.document = scene.history.commitOwned(scene.document, pending.description)
    actionError.value = ''
    scheduleRecovery(scene)
    if (pending.reloadResources) void loadReferencedResources(scene.document)
    return true
  }

  const cancelPendingPropertyEdit = (nodeId?: string, property?: string) => {
    const pending = propertyEdit
    if (!pending || (nodeId !== undefined && pending.nodeId !== nodeId) || (property !== undefined && pending.property !== property)) return false
    propertyEdit = undefined
    const scene = scenes.value.find((item) => item.id === pending.sceneId)
    if (!scene) return false
    scene.document = scene.history.current
    actionError.value = ''
    return true
  }

  const replaceActiveDocument = (next: UiDesignerDocument, description: string, markSaved = false, owned = false) => {
    commitPendingPropertyEdit()
    const scene = activeScene.value
    if (!scene) return
    scene.document = owned ? scene.history.commitOwned(next, description) : scene.history.commit(next, description)
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
    next.meta.modified = new Date().toISOString()
    replaceActiveDocument(next, `Update ${key}`, false, true)
  }

  const setSourceCode = (value: string) => {
    const next = cloneUiDocument(document.value)
    next.sceneScript.source = value
    replaceActiveDocument(next, 'Edit scene script')
  }

  const applyJsonDocument = (source: string): { ok: boolean; message?: string } => {
    const scene = activeScene.value
    if (!scene) return { ok: false, message: 'No active scene.' }
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    const report = validateDocument(parsed as UiDesignerDocument)
    if (!report.valid) return { ok: false, message: report.errors.map((issue) => issue.message).join(' ') }
    replaceActiveDocument(parsed as UiDesignerDocument, 'Edit scene JSON')
    return { ok: true }
  }

  const previewSourceCode = (value: string, sceneId = activeSceneId.value) => {
    draftCode.value = { ...draftCode.value, [sceneId]: value }
  }

  const commitSourceCode = (sceneId = activeSceneId.value) => {
    const value = draftCode.value[sceneId]
    if (value === undefined) return
    draftCode.value = Object.fromEntries(Object.entries(draftCode.value).filter(([draftKey]) => draftKey !== sceneId))
    const scene = scenes.value.find((item) => item.id === sceneId)
    if (!scene) return
    const next = cloneUiDocument(scene.document)
    next.sceneScript.source = value
    scene.document = scene.history.commit(next, 'Edit scene script')
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
    const pending = Object.keys(draftCode.value).filter((key) => sceneId === undefined || key === sceneId)
    for (const pendingSceneId of pending) commitSourceCode(pendingSceneId)
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
    if (!isValidUiDesignerSceneName(name)) return false
    const nextDocument = options.template && isBuiltInUiDesignerTemplate(options.template) ? createBuiltInUiDesignerTemplate(options.template) : createUiDocument(name)
    nextDocument.meta.sceneName = name
    const defaults = newSceneCanvasSize.value
    const hasExplicitSize = Number.isFinite(options.width) && (options.width ?? 0) > 0
      && Number.isFinite(options.height) && (options.height ?? 0) > 0
    if (!defaults && !hasExplicitSize) {
      projectProfileStatus.value = 'error'
      projectProfileMessage.value ||= 'The selected project dimensions must be loaded before creating a scene.'
      return false
    }
    const defaultWidth = defaults?.width ?? nextDocument.canvas.width
    const defaultHeight = defaults?.height ?? nextDocument.canvas.height
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
    scene.history.markUnsaved()
    scenes.value.push(scene)
    activateScene(scene.id)
    viewport.value = { zoom: 1, panX: 0, panY: 0, width: nextDocument.canvas.width, height: nextDocument.canvas.height }
    scheduleRecovery(scene)
    return true
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
      delete draftCode.value[scene.id]
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
      // The final tab closes for real.  With no scene open the shell shows the
      // explicit home page instead of a freshly minted placeholder tab.
      scenes.value.splice(0, 1)
      activeSceneId.value = ''
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
    if (previewOccupied.value && previewExecutionMode.value !== 'editor-preview' && !isEditorPreviewing.value) return false
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
    const nextIds = additive ? [...new Set([...selectedIds.value, ...valid])] : [...new Set(valid)]
    if (nextIds.length === selectedIds.value.length && nextIds.every((id, index) => id === selectedIds.value[index])) return
    flushDrafts(activeSceneId.value)
    selectedIds.value = nextIds
  }
  const setHoveredNode = (nodeId: string | undefined) => { hoveredNodeId.value = nodeId }
  const getNodeActionPolicy = (targetId: string) => resolveNodeActionPolicy(document.value, selectedIds.value, targetId, Boolean(clipboard.value?.nodes.length && clipboard.value.nodes.every((node) => !node.locked)))

  const addNode = (type: UiDesignerNodeType, parentId?: string | null, position?: UiPoint) => {
    try {
      actionError.value = ''
      const parent = parentId === undefined ? selectedNode.value?.type === 'container' || selectedNode.value?.type === 'list' ? selectedNode.value.id : 'node_root' : parentId
      if (parent !== null && !resolveNodeActionPolicy(document.value, [parent], parent, false).allowed.addChild) throw new Error('Only a container outside locked ancestry can receive child nodes')
      let next = cloneUiDocument(document.value)
      const nodeId = nextNodeId(next, type)
      const label = `${type[0].toUpperCase()}${type.slice(1)}`
      const node = createDefaultNode(type, { id: nodeId, name: `${label}_${next.nodes.filter((item) => item.type === type).length + 1}`, parentId: parent ?? null })
      const initialPosition = position ?? nextSiblingCascadePosition(next, node)
      next.nodes.push(node)
      if (node.parentId === null) next.zOrder.push(node.id)
      else {
        const destination = findNode(next, node.parentId)
        if (!destination || destination.type !== 'container' && destination.type !== 'list' || destination.locked) throw new Error('Only an unlocked container or list can receive child nodes')
        destination.children.push(node.id)
      }
      next = applyNodeGeometryTransaction(next, node.id, { kind: 'properties', patch: initialPosition })
      replaceActiveDocument(next, `Add ${type}`)
      selectedIds.value = [node.id]
      if (type === 'button') void loadReferencedResources(next)
      return node.id
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
      return null
    }
  }

  const removeSelected = () => {
    const targetId = selectedIds.value[0]
    if (!targetId || !getNodeActionPolicy(targetId).allowed.delete) return false
    const removeIds = new Set<string>()
    const collect = (id: string) => {
      if (id === 'node_root' || removeIds.has(id)) return
      const node = findNode(document.value, id)
      if (!node) return
      removeIds.add(id)
      node.children.forEach(collect)
    }
    selectedIds.value.forEach(collect)
    if (!removeIds.size) return false
    const next = cloneUiDocument(document.value)
    next.nodes = next.nodes.filter((node) => !removeIds.has(node.id))
    next.zOrder = next.zOrder.filter((id) => !removeIds.has(id))
    next.nodes.forEach((node) => { node.children = node.children.filter((id) => !removeIds.has(id)) })
    replaceActiveDocument(next, 'Delete nodes')
    return true
  }

  const setEditingMode = (mode: 'design' | 'code' | 'json') => {
    if (editingMode.value === mode) return
    if (editingMode.value !== 'design') flushDrafts(activeSceneId.value)
    editingMode.value = mode
  }

  const updateNodeProperty = (nodeId: string, property: string, value: unknown) => {
    if (property === 'x' || property === 'y' || property === 'width' || property === 'height') {
      if (nodeId !== 'node_root' && !resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).canTransform) return
      const next = cloneUiDocument(document.value)
      const node = findNode(next, nodeId)
      if (!node) return
      const fallback = node.props[property]
      node.props[property] = normalizeGeometryInteger(Number(value), fallback, property === 'width' || property === 'height' ? 1 : Number.MIN_SAFE_INTEGER)
      replaceActiveDocument(next, `Update ${property}`, false, true)
      return
    }
    const sourceNode = findNode(document.value, nodeId)
    if (!sourceNode || !(property in (sourceNode.props as unknown as Record<string, unknown>))) return
    if (sourceNode.type === 'nineSlice' && ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'].includes(property)) {
      const props = sourceNode.props as unknown as Record<string, unknown>
      value = normalizeNineSliceBorderValue(value, Number(props[property]))
    }
    try {
      value = normalizeUiDesignerResourceProperty(property, value)
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : 'Resource properties require project-relative paths.'
      return
    }
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)!
    const props = node.props as unknown as Record<string, unknown>
    props[property] = value
    replaceActiveDocument(next, `Update ${property}`, false, true)
    if (RESOURCE_PROPERTY_KEYS.has(property) || property === 'frames' || property === 'imageStates') void loadReferencedResources(next)
  }

  const previewNodeProperty = (nodeId: string, property: string, value: unknown) => {
    const scene = activeScene.value
    if (!scene) return false
    if (propertyEdit && (propertyEdit.sceneId !== scene.id || propertyEdit.nodeId !== nodeId || propertyEdit.property !== property)) commitPendingPropertyEdit()
    const sourceNode = findNode(scene.document, nodeId)
    if (!sourceNode || !(property in (sourceNode.props as unknown as Record<string, unknown>))) return false
    if ((property === 'x' || property === 'y' || property === 'width' || property === 'height') && nodeId !== 'node_root' && !resolveNodeActionPolicy(scene.document, [nodeId], nodeId, false).canTransform) return false
    try {
      value = normalizeUiDesignerResourceProperty(property, value)
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : 'Resource properties require project-relative paths.'
      return false
    }
    if (sourceNode.type === 'nineSlice' && ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'].includes(property)) {
      const sourceProps = sourceNode.props as unknown as Record<string, unknown>
      value = normalizeNineSliceBorderValue(value, Number(sourceProps[property]))
    }
    const next = cloneUiDocument(scene.document)
    const node = findNode(next, nodeId)!
    const props = node.props as unknown as Record<string, unknown>
    if (property === 'x' || property === 'y' || property === 'width' || property === 'height') {
      const fallback = Number(props[property])
      props[property] = normalizeGeometryInteger(Number(value), fallback, property === 'width' || property === 'height' ? 1 : Number.MIN_SAFE_INTEGER)
    } else {
      props[property] = value
    }
    propertyEdit ??= {
      sceneId: scene.id,
      nodeId,
      property,
      description: `Update ${property}`,
      reloadResources: RESOURCE_PROPERTY_KEYS.has(property) || property === 'frames' || property === 'imageStates',
    }
    scene.document = next
    actionError.value = ''
    return true
  }

  const commitNodePropertyPreview = (nodeId: string, property: string) => commitPendingPropertyEdit(nodeId, property)
  const cancelNodePropertyPreview = (nodeId: string, property: string) => cancelPendingPropertyEdit(nodeId, property)

  const setSpriteResource = (nodeId: string, path: string, dimensions?: { width: number; height: number }) => {
    const sourceNode = findNode(document.value, nodeId)
    if (!sourceNode || sourceNode.type !== 'sprite') return false
    const sourceRect = nodeRect(sourceNode)
    const sourceCenter = { x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2 }
    let normalizedPath = ''
    try {
      normalizedPath = String(normalizeUiDesignerResourceProperty('path', path))
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : 'Resource properties require project-relative paths.'
      return false
    }
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node || node.type !== 'sprite') return false
    node.props.path = normalizedPath
    if (dimensions && Number.isFinite(dimensions.width) && Number.isFinite(dimensions.height) && dimensions.width > 0 && dimensions.height > 0) {
      const width = normalizeGeometryInteger(dimensions.width, node.props.width, 1)
      const height = normalizeGeometryInteger(dimensions.height, node.props.height, 1)
      const parent = node.parentId ? findNode(next, node.parentId) : undefined
      const constrainsChildren = parent?.type === 'container' && parent.props.clip
      const parentRect = parent?.type === 'container'
        ? nodeRect(parent)
        : { x: 0, y: 0, width: next.canvas.width, height: next.canvas.height }
      const fitScale = constrainsChildren ? Math.min(1, parentRect.width / width, parentRect.height / height) : 1
      node.props.width = width
      node.props.height = height
      node.props.scaleX = fitScale
      node.props.scaleY = fitScale
      node.props.anchorX = 0.5
      node.props.anchorY = 0.5
      node.props.x = sourceCenter.x
      node.props.y = sourceCenter.y
      node.props.fillMode = 'stretch'
      node.props.repeatMode = 'none'
      if (constrainsChildren) {
        const fitted = clampNodePositionToParent(next, nodeId, { x: node.props.x, y: node.props.y })
        node.props.x = fitted.x
        node.props.y = fitted.y
      }
    }
    replaceActiveDocument(next, 'Select sprite image', false, true)
    void loadReferencedResources(next)
    return true
  }

  const renameNode = (nodeId: string, name: string) => {
    const normalized = name.trim()
    if (!normalized || !resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).allowed.rename) return false
    const next = cloneUiDocument(document.value)
    const node = findNode(next, nodeId)
    if (!node) return false
    node.name = normalized
    replaceActiveDocument(next, 'Rename node')
    return true
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

  const setNodeAnimation = (nodeId: string, phase: 'enterAnim' | 'exitAnim' | 'focusAnim', animation: UiAnimationConfig) => {
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
    if (!resolveNodeActionPolicy(document.value, [nodeId], nodeId, Boolean(clipboard.value)).canReparent) return false
    try {
      let next = reparentNode(document.value, nodeId, targetId, position)
      const moved = findNode(next, nodeId)
      const destination = moved?.parentId ? findNode(next, moved.parentId) : undefined
      const destinationClips = Boolean(destination && destination.id !== 'node_root' && destination.type === 'container' && destination.props.clip)
      if (moved && destinationClips) {
        const original = { x: moved.props.x, y: moved.props.y }
        const clamped = clampNodeRectToParent(next, nodeId, nodeRect(moved))
        const targetPosition = {
          x: clamped.x + clamped.width * moved.props.anchorX,
          y: clamped.y + clamped.height * moved.props.anchorY,
        }
        const delta = { x: targetPosition.x - original.x, y: targetPosition.y - original.y }
        for (const id of collectNodeSubtreeIds(next, [nodeId])) {
          const member = findNode(next, id)
          if (!member) continue
          next = applyNodeGeometryTransaction(next, id, { kind: 'properties', patch: { x: member.props.x + delta.x, y: member.props.y + delta.y } })
        }
        next = applyNodeGeometryTransaction(next, nodeId, { kind: 'rect', rect: clamped })
      }
      replaceActiveDocument(next, 'Reparent node')
      return true
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const moveToEdge = (nodeId: string, edge: 'top' | 'bottom') => {
    const command = edge === 'top' ? 'moveTop' : 'moveBottom'
    if (!getNodeActionPolicy(nodeId).allowed[command]) return false
    replaceActiveDocument(moveNodeToEdge(document.value, nodeId, edge), edge === 'top' ? 'Bring to front' : 'Send to back')
    return true
  }
  const moveStep = (nodeId: string, direction: 'up' | 'down') => {
    const command = direction === 'up' ? 'moveUp' : 'moveDown'
    if (!getNodeActionPolicy(nodeId).allowed[command]) return false
    replaceActiveDocument(moveNodeStep(document.value, nodeId, direction), direction === 'up' ? 'Move up' : 'Move down')
    return true
  }

  const nudgeSelected = (delta: UiPoint) => {
    const targetId = selectedIds.value[0]
    if (!targetId || !getNodeActionPolicy(targetId).canTransform) return false
    let next = cloneUiDocument(document.value)
    for (const id of selectedIds.value) {
      const node = findNode(next, id)
      if (!node) continue
      next = applyNodeGeometryTransaction(next, id, { kind: 'properties', patch: { x: node.props.x + delta.x, y: node.props.y + delta.y } })
    }
    replaceActiveDocument(next, 'Nudge nodes')
    return true
  }

  const group = () => {
    const targetId = selectedIds.value[0]
    if (!targetId || !getNodeActionPolicy(targetId).allowed.group) return false
    try {
      const result = groupNodes(document.value, selectedIds.value)
      replaceActiveDocument(result.document, 'Group nodes')
      selectedIds.value = [result.groupId]
      return true
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const ungroup = () => {
    const targetId = selectedIds.value[0]
    if (!targetId || !getNodeActionPolicy(targetId).canUngroup) return false
    try {
      const groupedChildren = selectedIds.value.flatMap((id) => document.value.nodes.find((node) => node.id === id)?.type === 'container' ? document.value.nodes.find((node) => node.id === id)?.children ?? [] : [])
      const next = ungroupNodes(document.value, selectedIds.value)
      replaceActiveDocument(next, 'Ungroup nodes')
      selectedIds.value = groupedChildren.filter((id) => Boolean(findNode(next, id)))
      return true
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const copy = () => { clipboard.value = copySelection(document.value, selectedIds.value) }

  const duplicateSelected = () => {
    const targetId = selectedIds.value[0]
    if (!targetId || !getNodeActionPolicy(targetId).allowed.duplicate) return false
    const destination = findNode(document.value, targetId)?.parentId ?? null
    copy()
    paste(destination)
    return true
  }

  const paste = (parentId?: string | null) => {
    if (!clipboard.value) return
    try {
      const destination = parentId === undefined ? selectedNode.value?.type === 'container' || selectedNode.value?.type === 'list' ? selectedNode.value.id : 'node_root' : parentId
      if (destination !== null) {
        const target = findNode(document.value, destination)
        if (!target || target.type !== 'container' && target.type !== 'list' || target.locked) throw new Error('Paste destination must be an unlocked container or list')
      }
      const result = pasteClipboard(document.value, clipboard.value, destination ?? null)
      replaceActiveDocument(result.document, 'Paste nodes')
      selectedIds.value = result.ids
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error)
    }
  }

  const selectNodeActionTarget = (targetId: string) => {
    const policy = getNodeActionPolicy(targetId)
    selectedIds.value = [...policy.selectionIds]
    return policy
  }

  const executeNodeAction = (command: UiNodeActionCommand, targetId: string) => {
    const policy = selectNodeActionTarget(targetId)
    if (!policy.allowed[command]) return false
    if (command === 'copy') copy()
    else if (command === 'cut') { copy(); removeSelected() }
    else if (command === 'paste') paste(targetId)
    else if (command === 'addChild') addNode('text', targetId)
    else if (command === 'duplicate') duplicateSelected()
    else if (command === 'group') group()
    else if (command === 'sameType') {
      const type = findNode(document.value, targetId)?.type
      if (type) selectNodes(document.value.nodes.filter((node) => node.type === type).map((node) => node.id))
    }
    else if (command === 'moveUp') moveStep(targetId, 'up')
    else if (command === 'moveDown') moveStep(targetId, 'down')
    else if (command === 'moveTop') moveToEdge(targetId, 'top')
    else if (command === 'moveBottom') moveToEdge(targetId, 'bottom')
    else if (command === 'toggleVisibility') {
      const nodes = policy.selectionIds.map((id) => findNode(document.value, id)).filter((node): node is UiNode => Boolean(node))
      const visible = !nodes.every((node) => node.props.visible)
      const next = cloneUiDocument(document.value)
      for (const id of policy.selectionIds) {
        const node = findNode(next, id)
        if (node) node.props.visible = visible
      }
      replaceActiveDocument(next, visible ? 'Show nodes' : 'Hide nodes')
    }
    else if (command === 'toggleLock') {
      const nodes = policy.selectionIds.map((id) => findNode(document.value, id)).filter((node): node is UiNode => Boolean(node))
      const locked = !nodes.every((node) => node.locked)
      const next = cloneUiDocument(document.value)
      for (const id of policy.selectionIds) {
        const node = findNode(next, id)
        if (node) node.locked = locked
      }
      replaceActiveDocument(next, locked ? 'Lock nodes' : 'Unlock nodes')
    }
    else if (command === 'delete') removeSelected()
    else return false
    return true
  }

  const undo = () => {
    const sceneId = activeSceneId.value
    flushDrafts(sceneId)
    const scene = scenes.value.find((item) => item.id === sceneId)
    if (!scene || !scene.history.canUndo) return
    scene.document = scene.history.undo()
    selectedIds.value = selectedIds.value.filter((id) => Boolean(findNode(scene.document, id)))
  }

  const redo = () => {
    const sceneId = activeSceneId.value
    flushDrafts(sceneId)
    const scene = scenes.value.find((item) => item.id === sceneId)
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
        thumbnailDataUrl: sceneThumbnailProvider?.(scene.id),
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
        void refreshSceneFiles()
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
    delete draftCode.value[sceneId]
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
        const parsed = parseUiDocument(result.value)
        if (!parsed.ok) {
          fileStatus.value = 'error'
          fileMessage.value = parsed.issues.map((issue) => issue.message).join(' ')
          return false
        }
        const normalizedDocument = parsed.document
        const report = validateDocument(normalizedDocument)
        if (!report.valid) {
          fileStatus.value = 'error'
          fileMessage.value = report.errors.map((issue) => issue.message).join(' ')
          return false
        }
        const scene = createSceneState(normalizedDocument, `scene_tab_${++sceneSequence}`, { sourcePath: result.sourcePath ?? result.path, openedMetadata: result.metadata, recoveryId: result.recoveryId }, historyLimit())
        scene.history.markSaved()
        scenes.value.push(scene)
        activateScene(scene.id)
        void loadReferencedResources(normalizedDocument)
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
      void refreshSceneFiles()
      return true
    } catch (error) {
      fileStatus.value = 'error'
      fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  const refreshSceneFiles = async () => {
    if (!projectPath.value?.trim()) {
      sceneFiles.value = []
      return false
    }
    const generation = projectGeneration.value
    try {
      const result = await adapters.project.listSceneFiles()
      if (generation !== projectGeneration.value) return false
      if (result.status === 'success' && result.value) sceneFiles.value = result.value
      return true
    } catch {
      return false
    }
  }

  const restoreRecovery = async (recoveryId: string) => {
    if (!canSave.value) return false
    try {
      const result = await adapters.file.readRecovery(recoveryId)
      if (result.status !== 'success' || !result.value) return false
      const parsed = parseUiDocument(result.value.document)
      if (!parsed.ok) {
        fileMessage.value = parsed.issues.map((item) => item.message).join(' ')
        return false
      }
      const normalizedDocument = parsed.document
      const report = validateDocument(normalizedDocument)
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
      scene.document = scene.history.commit(normalizedDocument, 'Restore recovery draft')
      scenes.value.push(scene)
      activateScene(scene.id)
      void loadReferencedResources(normalizedDocument)
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
    delete draftCode.value[scene.id]
    fileStatus.value = 'busy'
    try {
      const result = await adapters.file.open({ path: scene.sourcePath })
      fileStatus.value = result?.status ?? 'error'
      fileMessage.value = result?.message ?? 'The source file could not be reloaded.'
      if (!result || result.status !== 'success' || !result.value) return false
      const parsed = parseUiDocument(result.value)
      if (!parsed.ok) {
        fileStatus.value = 'error'
        fileMessage.value = parsed.issues.map((item) => item.message).join(' ')
        return false
      }
      const normalizedDocument = parsed.document
      const report = validateDocument(normalizedDocument)
      if (!report.valid) {
        fileStatus.value = 'error'
        fileMessage.value = report.errors.map((item) => item.message).join(' ')
        return false
      }
      scene.document = normalizedDocument
      scene.history = new UiDesignerHistory(normalizedDocument, historyLimit())
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
    let relativePath = ''
    try {
      relativePath = normalizeUiDesignerProjectRelativeResourcePath(path)
    } catch (error) {
      resourceStatus.value = 'error'
      resourceMessage.value = error instanceof Error ? error.message : String(error)
      return false
    }
    if (!relativePath) return false
    resourceStatus.value = 'busy'
    const generation = projectGeneration.value
    try {
      const result = await adapters.resource.readSceneData({ path: relativePath })
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

  const finishGamePreview = (status: 'stopped' | 'error', message = '') => {
    gamePreviewRunId = ''
    isPreviewing.value = false
    previewCleanupPending.value = false
    previewStatus.value = status
    previewMessage.value = message.slice(0, 2_048)
  }

  function wireGamePreviewStatus() {
    removeGamePreviewStatusListener?.()
    removeGamePreviewStatusListener = adapters.gamePreview?.onStatus?.((session) => {
      if (!gamePreviewRunId || session.runId !== gamePreviewRunId) return
      if (session.status === 'running' || session.status === 'starting') {
        isPreviewing.value = true
        previewStatus.value = session.status === 'running' ? 'running' : 'preparing'
        return
      }
      if (session.status === 'failed' || session.status === 'stop_failed') finishGamePreview('error', session.error || 'The isolated game preview failed.')
      else if (session.status === 'stopped' || session.status === 'exited') finishGamePreview('stopped')
    })
  }
  wireGamePreviewStatus()

  const startPreview = async () => {
    if (previewOccupied.value) return isPreviewing.value
    if (!canStartPreview.value) {
      previewStatus.value = 'unavailable'
      previewMessage.value = 'The isolated game preview is not connected.'
      return false
    }
    flushDrafts(activeSceneId.value)
    previewCleanupPending.value = false
    previewMessage.value = ''
    previewExecutionMode.value = 'authoring'
    previewStatus.value = 'preparing'
    const startPromise = adapters.gamePreview.start(projectPath.value!.trim(), exportRuntimeDocument(document.value))
    gamePreviewStartPromise = startPromise
    try {
      const result = await startPromise
      if (result.status !== 'success' || !result.value) {
        finishGamePreview(result.status === 'idle' ? 'stopped' : 'error', result.message)
        return false
      }
      gamePreviewRunId = result.value.runId
      if (result.value.status === 'failed' || result.value.status === 'stop_failed') {
        finishGamePreview('error', result.value.error || result.message)
        return false
      }
      if (result.value.status === 'stopped' || result.value.status === 'exited') {
        finishGamePreview('stopped')
        return false
      }
      isPreviewing.value = true
      previewStatus.value = result.value.status === 'running' ? 'running' : 'preparing'
      return true
    } catch (error) {
      finishGamePreview('error', error instanceof Error ? error.message : String(error))
      return false
    } finally {
      if (gamePreviewStartPromise === startPromise) gamePreviewStartPromise = undefined
    }
  }

  const startEditorPreview = () => {
    if (previewOccupied.value) return isEditorPreviewing.value
    if (!canStartEditorPreview.value) return false
    flushDrafts(activeSceneId.value)
    previewModeBefore = editingMode.value
    previewExitPending = false
    previewCleanupPending.value = false
    previewMessage.value = ''
    previewExecutionMode.value = 'editor-preview'
    previewStatus.value = 'preparing'
    return true
  }

  const stopEditorPreview = () => {
    if (!isEditorPreviewing.value && previewExecutionMode.value !== 'editor-preview') return true
    previewExitPending = true
    previewExecutionMode.value = 'authoring'
    previewStatus.value = 'preparing'
    return true
  }

  const stopPreview = async () => {
    if (!isPreviewing.value && !gamePreviewRunId && !gamePreviewStartPromise) return true
    previewStatus.value = 'preparing'
    try {
      if (gamePreviewStartPromise) await gamePreviewStartPromise
      if (!isPreviewing.value && !gamePreviewRunId) return true
      const result = await adapters.gamePreview.stop()
      if (result.status !== 'success') {
        previewCleanupPending.value = true
        previewStatus.value = 'error'
        previewMessage.value = result.message.slice(0, 2_048)
        return false
      }
      finishGamePreview('stopped')
      return true
    } catch (error) {
      previewCleanupPending.value = true
      previewStatus.value = 'error'
      previewMessage.value = (error instanceof Error ? error.message : String(error)).slice(0, 2_048)
      return false
    }
  }

  const acknowledgePreviewExecutionMode = (mode: UiDesignerRendererExecutionMode) => {
    if (mode !== previewExecutionMode.value) return false
    if (mode === 'editor-preview') {
      if (previewStatus.value !== 'preparing') return false
      setEditingMode('design')
      isEditorPreviewing.value = true
      previewExitPending = false
      previewCleanupPending.value = false
      previewStatus.value = 'running'
      return true
    }
    if (!previewExitPending) {
      const recoveredCleanup = previewCleanupPending.value
      previewCleanupPending.value = false
      if (recoveredCleanup) {
        previewStatus.value = 'stopped'
        previewMessage.value = ''
      }
      return true
    }
    previewExitPending = false
    previewCleanupPending.value = false
    isPreviewing.value = false
    isEditorPreviewing.value = false
    previewStatus.value = 'stopped'
    previewMessage.value = ''
    restorePreviewMode()
    return true
  }

  const failPreview = (message = '', cleanupPending = false) => {
    previewExecutionMode.value = 'authoring'
    previewCleanupPending.value = cleanupPending
    previewStatus.value = 'error'
    previewMessage.value = String(message).trim().slice(0, 2_048)
    previewExitPending = false
    isPreviewing.value = false
    isEditorPreviewing.value = false
    restorePreviewMode()
  }

  const snapOptionsFor = (nodeId: string, excludeIds: readonly string[] = []): SnapOptions => {
    const settings = document.value.canvas
    const enabled = typeof preferences.value.snapEnabled === 'boolean' ? preferences.value.snapEnabled : settings.snap.enabled
    return {
      enabled,
      gridEnabled: enabled && (typeof preferences.value.gridEnabled === 'boolean' ? preferences.value.gridEnabled : settings.grid.enabled),
      gridSize: settings.grid.size,
      smartEnabled: enabled && settings.snap.smartEnabled,
      sensitivity: settings.snap.sensitivity,
      guides: document.value.guides,
      canvasWidth: settings.width,
      canvasHeight: settings.height,
      targets: smartSnapTargetsForNode(document.value, nodeId, excludeIds),
    }
  }

  const applySnapFeedback = (nodeId: string, position: UiPoint, hits: readonly UiSnapHit[]) => {
    const node = findNode(document.value, nodeId)
    if (!node) { snapFeedback.value = null; return }
    const rect = nodeRect(node)
    const draftRect = { x: position.x - rect.width * node.props.anchorX, y: position.y - rect.height * node.props.anchorY, width: rect.width, height: rect.height }
    const feedback = snapFeedbackFor(document.value, draftRect, hits)
    snapFeedback.value = feedback.lines.length || feedback.guideIds.length ? feedback : null
  }

  const clearSnapFeedback = () => { snapFeedback.value = null }

  const selectionVisualBounds = (ids: readonly string[]): UiRect | undefined => {
    const rects = ids
      .map((id) => findNode(document.value, id))
      .filter((node): node is UiDesignerDocument['nodes'][number] => Boolean(node))
      .map(nodeVisualRect)
    if (!rects.length) return undefined
    const left = Math.min(...rects.map((rect) => rect.x))
    const top = Math.min(...rects.map((rect) => rect.y))
    const right = Math.max(...rects.map((rect) => rect.x + rect.width))
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  const updateNodePositionWithSnap = (nodeId: string, position: { x: number; y: number }) => {
    if (!resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).canTransform) return undefined
    const result = snapPoint(position, snapOptionsFor(nodeId))
    replaceActiveDocument(updateNodePosition(document.value, nodeId, result), 'Move node')
    return result
  }

  const previewNodePositionWithSnap = (nodeId: string, position: UiPoint) => {
    if (!resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).canTransform) return undefined
    const snapped = snapPoint(position, snapOptionsFor(nodeId))
    const result = clampNodePositionToParent(document.value, nodeId, snapped)
    draftPositions.value = { ...draftPositions.value, [nodeId]: result }
    applySnapFeedback(nodeId, result, snapped.hits)
    return result
  }

  const commitDraftPosition = (nodeId: string) => {
    const position = draftPositions.value[nodeId]
    if (!position) return
    clearSnapFeedback()
    draftPositions.value = Object.fromEntries(Object.entries(draftPositions.value).filter(([id]) => id !== nodeId))
    if (!resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).canTransform) return false
    replaceActiveDocument(updateNodePosition(document.value, nodeId, position), 'Move node')
    return true
  }

  const previewSelectedPositionsWithSnap = (ids: readonly string[], origins: Record<string, UiPoint>, delta: UiPoint, axisLock?: 'x' | 'y') => {
    const validIds = ids.filter((id) => Boolean(findNode(document.value, id)))
    const rootIds = selectionRootNodeIds(document.value, validIds)
    if (!rootIds.length || !resolveNodeActionPolicy(document.value, rootIds, rootIds[0], false).canTransform) return {}
    const transformIds = collectNodeSubtreeIds(document.value, rootIds)
    const rootSet = new Set(rootIds)
    const anchorId = rootIds[0]
    const originBounds = selectionVisualBounds(rootIds)
    if (!originBounds) return {}
    const constrainedDelta = axisLock === 'x' ? { x: delta.x, y: 0 } : axisLock === 'y' ? { x: 0, y: delta.y } : delta
    const requestedBounds = { ...originBounds, x: originBounds.x + constrainedDelta.x, y: originBounds.y + constrainedDelta.y }
    const snapped = snapMoveRect(requestedBounds, snapOptionsFor(anchorId, rootIds), axisLock ? [axisLock] : ['x', 'y'])
    const snapDelta = { x: snapped.x - requestedBounds.x, y: snapped.y - requestedBounds.y }
    const nextDrafts = { ...draftPositions.value }
    for (const id of transformIds) {
      const origin = origins[id] ?? findNode(document.value, id)?.props ?? { x: 0, y: 0 }
      const position = normalizeGeometryPoint({ x: origin.x + constrainedDelta.x + snapDelta.x, y: origin.y + constrainedDelta.y + snapDelta.y }, origin)
      nextDrafts[id] = rootSet.has(id) ? clampNodePositionToParent(document.value, id, position) : position
    }
    draftPositions.value = nextDrafts
    const feedback = snapFeedbackFor(document.value, snapped, snapped.hits)
    snapFeedback.value = feedback.lines.length || feedback.guideIds.length ? feedback : null
    return Object.fromEntries(transformIds.map((id) => [id, nextDrafts[id]]))
  }

  const commitDraftPositions = (ids: readonly string[]) => {
    const validIds = ids.filter((id) => Boolean(findNode(document.value, id)))
    const rootIds = selectionRootNodeIds(document.value, validIds)
    const transformIds = collectNodeSubtreeIds(document.value, rootIds)
    if (!rootIds.length || !resolveNodeActionPolicy(document.value, rootIds, rootIds[0], false).canTransform) {
      draftPositions.value = Object.fromEntries(Object.entries(draftPositions.value).filter(([id]) => !transformIds.includes(id)))
      return false
    }
    clearSnapFeedback()
    let next = cloneUiDocument(document.value)
    let changed = false
    for (const id of transformIds) {
      const position = draftPositions.value[id]
      if (!position || !findNode(next, id)) continue
      next = applyNodeGeometryTransaction(next, id, { kind: 'properties', patch: position })
      changed = true
    }
    draftPositions.value = Object.fromEntries(Object.entries(draftPositions.value).filter(([id]) => !transformIds.includes(id)))
    if (changed) replaceActiveDocument(next, rootIds.length > 1 ? 'Move nodes' : 'Move node')
    return changed
  }

  const previewNodeResizeWithSnap = (nodeId: string, originRect: UiRect, handle: UiResizeHandle, delta: UiPoint, modifiers: UiResizeModifiers) => {
    if (!resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).canTransform) return undefined
    const node = findNode(document.value, nodeId)
    if (!node) return undefined
    const sized = resizeRect(originRect, handle, delta, modifiers)
    const result = clampNodeRectToParent(document.value, nodeId, localResizeNodeRect(node, originRect, handle, sized.width, sized.height, modifiers.fromCenter), modifiers.preserveAspect)
    draftRects.value = { ...draftRects.value, [nodeId]: result }
    return result
  }

  registerPreviewDisposer(async (reason) => {
    const stopped = await stopPreview()
    if (reason === 'unload') {
      removeGamePreviewStatusListener?.()
      removeGamePreviewStatusListener = undefined
    }
    return stopped
  })
  const commitDraftRect = (nodeId: string) => {
    const rect = draftRects.value[nodeId]
    if (!rect) return
    draftRects.value = Object.fromEntries(Object.entries(draftRects.value).filter(([id]) => id !== nodeId))
    if (!findNode(document.value, nodeId) || !resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).canTransform) return false
    const next = applyNodeGeometryTransaction(document.value, nodeId, { kind: 'rect', rect })
    replaceActiveDocument(next, 'Resize node')
    return true
  }
  const previewNodeRotation = (nodeId: string, rotation: number) => {
    const node = findNode(document.value, nodeId)
    if (!node) return
    const normalizedRotation = normalizeGeometryInteger(rotation, node.props.rotate)
    const subtree = rotateSubtreeTransforms(document.value, collectNodeSubtreeIds(document.value, [nodeId]), nodeId, normalizedRotation - node.props.rotate)
    draftRotations.value = { ...draftRotations.value, ...subtree.rotations }
    if (Object.keys(subtree.positions).length) draftPositions.value = { ...draftPositions.value, ...subtree.positions }
    return normalizedRotation
  }
  const commitDraftRotation = (nodeId: string) => {
    const rotation = draftRotations.value[nodeId]
    if (rotation === undefined) return
    const transformIds = collectNodeSubtreeIds(document.value, [nodeId])
    const pendingRotations = Object.fromEntries(Object.entries(draftRotations.value).filter(([id]) => transformIds.includes(id)))
    const pendingPositions = Object.fromEntries(Object.entries(draftPositions.value).filter(([id]) => transformIds.includes(id)))
    draftRotations.value = Object.fromEntries(Object.entries(draftRotations.value).filter(([id]) => !(id in pendingRotations)))
    draftPositions.value = Object.fromEntries(Object.entries(draftPositions.value).filter(([id]) => !(id in pendingPositions)))
    if (!findNode(document.value, nodeId) || !resolveNodeActionPolicy(document.value, [nodeId], nodeId, false).canTransform) return false
    const next = cloneUiDocument(document.value)
    let changed = false
    for (const [id, pendingRotation] of Object.entries(pendingRotations)) {
      const node = findNode(next, id)
      if (!node) continue
      node.props.rotate = normalizeGeometryInteger(pendingRotation, node.props.rotate)
      changed = true
    }
    for (const [id, pendingPosition] of Object.entries(pendingPositions)) {
      const node = findNode(next, id)
      if (!node) continue
      node.props.x = normalizeGeometryInteger(pendingPosition.x, node.props.x)
      node.props.y = normalizeGeometryInteger(pendingPosition.y, node.props.y)
      changed = true
    }
    if (changed) replaceActiveDocument(next, 'Rotate node')
    return changed
  }

  const setZoom = (scale: number, anchor?: { x: number; y: number }) => { viewport.value = zoomViewport(viewport.value, scale, anchor) }
  const fitCanvas = () => { viewport.value = fitViewport(viewport.value, document.value.canvas.width, document.value.canvas.height) }
  const pan = (delta: { x: number; y: number }) => { viewport.value = panViewport(viewport.value, delta) }
  const align = (alignment: Parameters<typeof alignNodes>[2], reference: Parameters<typeof alignNodes>[3] = 'selection') => {
    const targetId = selectedIds.value[0]
    if (!targetId || !getNodeActionPolicy(targetId).canTransform) return false
    const rootIds = selectionRootNodeIds(document.value, selectedIds.value)
    if (!rootIds.length) return false
    // Figma semantics: a single selected layer aligns to its parent (the
    // canvas for top-level nodes); multi-selects align to the chosen reference.
    const effectiveReference = rootIds.length === 1 ? 'parent' : reference
    replaceActiveDocument(alignNodes(document.value, rootIds, alignment, effectiveReference), `Align ${alignment}`)
    return true
  }
  const distribute = (axis: Parameters<typeof distributeNodes>[2]) => {
    const targetId = selectedIds.value[0]
    if (!targetId || !getNodeActionPolicy(targetId).canTransform) return false
    const rootIds = selectionRootNodeIds(document.value, selectedIds.value)
    if (!rootIds.length) return false
    replaceActiveDocument(distributeNodes(document.value, rootIds, axis), `Distribute ${axis}`)
    return true
  }

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
    snapFeedback,
    draftCoordinator,
    projectPath,
    projectGeneration,
    editingMode,
    isPreviewing,
    isEditorPreviewing,
    previewExecutionMode,
    previewCleanupPending,
    previewDisposalInFlight,
    fileStatus,
    fileMessage,
    previewStatus,
    previewMessage,
    previewDiagnostics,
    runtimeDiagnostics,
    runtimeStatus,
    runtimeStaging,
    resourceCatalog,
    resourceStatus,
    resourceMessage,
    projectProfile,
    projectProfileStatus,
    projectProfileMessage,
    actionError,
    fileConflict,
    runtimeConflict,
    runtimeConflictPath,
    runtimeConflictOperation,
    runtimeConflictFiles,
    runtimeProofMissing,
    recentFiles,
    sceneFiles,
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
    canRenderCanvas,
    canStartPreview,
    canStartEditorPreview,
    canCreateScene,
    canEditCode,
    newSceneCanvasSize,
    newScene,
    closeScene,
    reorderScenes,
    selectNodes,
    setHoveredNode,
    getNodeActionPolicy,
    selectNodeActionTarget,
    executeNodeAction,
    addNode,
    removeSelected,
    updateNodeProperty,
    previewNodeProperty,
    commitNodePropertyPreview,
    cancelNodePropertyPreview,
    setSpriteResource,
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
    applyJsonDocument,
    setEditingMode,
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
    registerSceneThumbnailProvider,
    registerPreviewDisposer,
    registerResourceMutationHandler,
    notifyResourceMutation,
    disposePreview,
    loadProjectProfile,
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
    acknowledgePreviewExecutionMode,
    failPreview,
    updateNodePositionWithSnap,
    previewNodePositionWithSnap,
    commitDraftPosition,
    previewSelectedPositionsWithSnap,
    commitDraftPositions,
    previewNodeResizeWithSnap,
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
