import { isRef, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type {
  UiDesignerRendererHostAdapter,
  UiDesignerRendererHostSession,
  UiDesignerRendererHostStopReason,
  UiRuntimeDiagnostic,
  UiRuntimeSceneExport,
} from '@contract/ui-designer'
import type { ProjectAssetChangeManifest } from '@contract/types'
import { mergeProjectAssetChangeManifests } from '@contract/ui-designer-resources'
import {
  UI_DESIGNER_RENDERER_BRIDGE_VERSION,
  UI_DESIGNER_RENDERER_HOST_SCENE_CLASS,
  validateUiDesignerRendererBridgeMessage,
  type UiDesignerRendererBridgeReceipt,
  type UiDesignerRendererBridgeMessage,
  type UiDesignerRendererExecutionMode,
  type UiDesignerRendererNodeBounds,
} from '@contract/ui-designer-renderer-bridge'
import type { UiDesignerController, UiDesignerPreviewDisposeReason } from './useUiDesigner'
import { buildUiDesignerRendererDraftPatches, createUiDesignerRendererDisposeAck, planUiDesignerRendererUpdate, scheduleUiDesignerRendererHandshakeTimeout, type UiDesignerRendererDisposeAck } from '../rendererBridge'

type RendererHostStatus = 'idle' | 'preparing' | 'loading' | 'running' | 'error'

interface RetainedRendererOwner {
  session: UiDesignerRendererHostSession
  adapter: UiDesignerRendererHostAdapter
}

export type UiDesignerRendererHostStage =
  | 'idle'
  | 'start'
  | 'iframe-load'
  | 'entry-invoked'
  | 'hello'
  | 'confirm'
  | 'ready'
  | 'mount'
  | 'mounted'
  | 'scene-state'
  | 'dispose'

export type UiDesignerRendererHostStageStatus = 'idle' | 'begin' | 'success' | 'error'

type UiDesignerRendererReceiptPayload = UiDesignerRendererBridgeReceipt

export interface UiDesignerRendererFailure {
  code: string
  stage: UiDesignerRendererHostStage
  recoveryReason: string
}

export interface UiDesignerRendererTerminalFailure extends UiDesignerRendererFailure {
  revision: number
  sequence: number
}

export interface UiDesignerRendererFailureDetails {
  code: string
  stage: UiDesignerRendererHostStage
  stageStatus: UiDesignerRendererHostStageStatus
  recoveryReason: string
  technicalMessage: string | null
  iframeLoaded: boolean
  engineReady: boolean
  processConfirmed: boolean
  pendingMountRevision: number | null
  requestedExecutionMode: UiDesignerRendererExecutionMode
  executionMode: UiDesignerRendererExecutionMode
  executionModeReady: boolean
  revision: number
  hostSequence: number
  lastHostMessageKind: string | null
  scenePhase: 'transitioning' | 'active'
  requestedScene: string | null
  actualScene: string | null
  engineSceneClass: string | null
  mountedDocumentSceneId: string | null
  documentSceneName: string | null
  mountedRevision: number | null
  mountedExecutionMode: UiDesignerRendererExecutionMode | null
  cleanupConfirmed: boolean | null
  lastDiagnostic: Pick<UiRuntimeDiagnostic, 'code' | 'severity' | 'phase' | 'event' | 'label' | 'message' | 'count'> | null
}

export const UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES = Object.freeze({
  sceneExport: 'UI_RENDERER_SCENE_EXPORT_FAILED',
  updatePlan: 'UI_RENDERER_UPDATE_PLAN_FAILED',
  mountPost: 'UI_RENDERER_MOUNT_POST_FAILED',
  patchPost: 'UI_RENDERER_PATCH_POST_FAILED',
  sceneSnapshot: 'UI_RENDERER_SCENE_SNAPSHOT_FAILED',
  selectionPost: 'UI_RENDERER_SELECTION_POST_FAILED',
  handshakeTimeout: 'UI_RENDERER_HANDSHAKE_TIMEOUT',
  handshakeWatchdog: 'UI_RENDERER_HANDSHAKE_WATCHDOG_FAILED',
  mountedTimeout: 'UI_RENDERER_MOUNTED_TIMEOUT',
  mountedWatchdog: 'UI_RENDERER_MOUNTED_WATCHDOG_FAILED',
  startAdapter: 'UI_RENDERER_START_ADAPTER_FAILED',
  startResult: 'UI_RENDERER_START_RESULT_INVALID',
  confirmIpc: 'UI_RENDERER_CONFIRM_IPC_FAILED',
  confirmIdentity: 'UI_RENDERER_CONFIRM_IDENTITY_INVALID',
  iframeLoad: 'UI_RENDERER_IFRAME_LOAD_FAILED',
} as const)

const rendererRecoveryByCode: Readonly<Record<string, string>> = Object.freeze({
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.sceneExport]: 'The editor could not prepare the current UI scene for the isolated canvas. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.updatePlan]: 'The editor could not prepare the current UI scene update. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountPost]: 'The editor could not send the current UI scene to the isolated canvas. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.patchPost]: 'The editor could not send the latest UI scene changes to the isolated canvas. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.sceneSnapshot]: 'The editor could not retain the current UI scene snapshot. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.selectionPost]: 'The editor could not synchronize the current UI selection. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.handshakeTimeout]: 'The isolated game frame did not finish connecting in time. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.handshakeWatchdog]: 'The editor could not monitor the isolated game frame connection. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountedTimeout]: 'The isolated game frame did not finish mounting the current scene in time. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountedWatchdog]: 'The editor could not monitor the isolated scene mount. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.startAdapter]: 'The editor could not start the isolated UI canvas. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.startResult]: 'The isolated UI canvas returned an invalid start result. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIpc]: 'The editor could not confirm the isolated UI canvas process. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIdentity]: 'The isolated UI canvas identity did not match the active preview. Retry the preview.',
  [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.iframeLoad]: 'The isolated game frame could not be loaded. Retry the preview.',
  UI_RENDERER_READY_SCENE_CREATE: 'The game runtime could not create the isolated preview scene. Retry the preview.',
  UI_RENDERER_READY_CANVAS_HOST: 'The game runtime could not create the embedded canvas. Retry the preview.',
  UI_RENDERER_READY_SIGNAL: 'The embedded canvas could not finish its ready handshake. Retry the preview.',
  UI_RENDERER_BOOT_FAILED: 'The isolated game frame could not start. Retry the preview.',
  UI_RENDERER_BRIDGE_PROTOCOL: 'The isolated game frame stopped because its connection became invalid. Retry the preview.',
  UI_RENDERER_WINDOW_ERROR: 'The isolated game runtime stopped unexpectedly. Retry the preview.',
  UI_RENDERER_PROMISE_ERROR: 'The isolated game runtime stopped unexpectedly. Retry the preview.',
})

const unknownRendererRecoveryReason = 'The isolated UI canvas stopped unexpectedly. Retry the preview.'

const sanitizeRendererTechnicalMessage = (cause: unknown): string | null => {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  if (!raw.trim()) return null
  return raw
    .replace(/(?:file|rpg-agent-preview):\/\/[^\s"'<>]+/gi, '<preview>')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>]*/g, '<path>')
    .replace(/\b[a-f0-9]{32,}\b/gi, '<token>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1024)
}

export function resolveUiDesignerRendererFailure(
  code: string,
  stage: UiDesignerRendererHostStage,
): UiDesignerRendererFailure {
  return { code, stage, recoveryReason: rendererRecoveryByCode[code] ?? unknownRendererRecoveryReason }
}

export function createUiDesignerRendererTerminalGate(): {
  accept: (message: UiDesignerRendererBridgeMessage) => UiDesignerRendererTerminalFailure | null
  reset: () => void
} {
  let accepted = false
  return {
    accept(message) {
      if (message.kind !== 'fatal' || accepted) return null
      accepted = true
      return {
        ...resolveUiDesignerRendererFailure(message.payload.code, message.payload.stage),
        revision: message.payload.revision,
        sequence: message.sequence,
      }
    },
    reset() { accepted = false },
  }
}

export function createUiDesignerRendererFailureLatch(): {
  accept: (candidate: UiDesignerRendererFailure) => { failure: UiDesignerRendererFailure; accepted: boolean }
  reset: () => void
} {
  let failure: UiDesignerRendererFailure | null = null
  return {
    accept(candidate) {
      if (failure) return { failure, accepted: false }
      failure = candidate
      return { failure, accepted: true }
    },
    reset() { failure = null },
  }
}

const rendererStageDescription: Record<UiDesignerRendererHostStage, string> = {
  idle: 'idle',
  start: 'starting the isolated renderer',
  'iframe-load': 'loading the isolated game frame',
  'entry-invoked': 'starting the isolated game entry',
  hello: 'connecting to the isolated game frame',
  confirm: 'confirming the isolated renderer',
  ready: 'starting the game runtime',
  mount: 'mounting the current scene',
  mounted: 'finishing the current scene mount',
  'scene-state': 'waiting for the current scene',
  dispose: 'closing the isolated renderer',
}

const rendererFailureMessage = (stage: UiDesignerRendererHostStage) =>
  `The isolated UI canvas failed while ${rendererStageDescription[stage]}. Close the preview and try again.`

const retainedStopFailureMessage = 'The previous isolated UI canvas session was kept because it could not be stopped. Close the preview and try again.'

const rendererStageOrder: Record<UiDesignerRendererHostStage, number> = {
  idle: -1,
  start: -1,
  'iframe-load': 0,
  'entry-invoked': 1,
  hello: 2,
  confirm: 3,
  ready: 4,
  mount: 5,
  mounted: 6,
  'scene-state': 7,
  dispose: -1,
}

export interface UiDesignerRendererHostOptions {
  designer: UiDesignerController
  iframe: Ref<HTMLIFrameElement | undefined>
  runtimeScene: () => UiRuntimeSceneExport
  executionMode: () => UiDesignerRendererExecutionMode
  active?: () => boolean
  postMessage?: (message: UiDesignerRendererBridgeMessage) => boolean
  onExecutionModeReady?: (mode: UiDesignerRendererExecutionMode) => void
  onExecutionModeError?: (message: string, cleanupPending?: boolean) => void
  onPreviewExitRequest?: (key: 'Escape' | 'F6' | 'action-exit') => void
}

export interface UiDesignerRendererHostRuntimeState {
  bounds: Record<string, UiDesignerRendererNodeBounds>
  diagnostics: UiRuntimeDiagnostic[]
  executionMode: UiDesignerRendererExecutionMode
  executionModeReady: boolean
  scenePhase: 'transitioning' | 'active'
  requestedScene: string | null
  actualScene: string | null
  engineSceneClass: string | null
  mountedDocumentSceneId: string | null
  documentSceneName: string | null
  mountedRevision: number | null
  mountedExecutionMode: UiDesignerRendererExecutionMode | null
}

export function reduceUiDesignerRendererHostRuntimeMessage(
  state: UiDesignerRendererHostRuntimeState,
  message: UiDesignerRendererBridgeMessage,
  expectedRevision: number,
  requestedExecutionMode: UiDesignerRendererExecutionMode,
  expectedDocumentSceneId: string | null = null,
  expectedDocumentSceneName: string | null = null,
): UiDesignerRendererHostRuntimeState {
  if (message.kind === 'mounted' || message.kind === 'bounds') {
    if (message.payload.revision < expectedRevision) return state
    if (message.kind === 'mounted') {
      if (message.payload.executionMode !== requestedExecutionMode) return state
      return {
        ...state,
        bounds: Object.fromEntries(message.payload.bounds.map((entry) => [entry.nodeId, entry])),
        executionMode: message.payload.executionMode,
        executionModeReady: false,
        engineSceneClass: message.payload.engineSceneClass,
        mountedDocumentSceneId: message.payload.mountedDocumentSceneId,
        documentSceneName: message.payload.documentSceneName,
        mountedRevision: message.payload.revision,
        mountedExecutionMode: message.payload.executionMode,
      }
    }
    const bounds = { ...state.bounds }
    for (const entry of message.payload.bounds) bounds[entry.nodeId] = entry
    return { ...state, bounds }
  }
  if (message.kind === 'diagnostic') {
    return { ...state, diagnostics: [...state.diagnostics, ...message.payload.entries].slice(-64) }
  }
  if (message.kind === 'scene-state') {
    const documentMatches = (expectedDocumentSceneId === null || message.payload.mountedDocumentSceneId === expectedDocumentSceneId)
      && (expectedDocumentSceneName === null || message.payload.documentSceneName === expectedDocumentSceneName)
    const ready = message.payload.phase === 'active'
      && message.payload.engineSceneClass === UI_DESIGNER_RENDERER_HOST_SCENE_CLASS
      && message.payload.mountedDocumentSceneId !== null
      && message.payload.documentSceneName !== null
      && message.payload.revision === expectedRevision
      && message.payload.executionMode === requestedExecutionMode
      && documentMatches
      && state.mountedRevision === message.payload.revision
      && state.mountedExecutionMode === message.payload.executionMode
      && state.mountedDocumentSceneId === message.payload.mountedDocumentSceneId
      && state.documentSceneName === message.payload.documentSceneName
    return {
      ...state,
      scenePhase: message.payload.phase,
      requestedScene: message.payload.requestedScene,
      actualScene: message.payload.actualScene,
      engineSceneClass: documentMatches ? message.payload.engineSceneClass : state.engineSceneClass,
      mountedDocumentSceneId: documentMatches ? message.payload.mountedDocumentSceneId : state.mountedDocumentSceneId,
      documentSceneName: documentMatches ? message.payload.documentSceneName : state.documentSceneName,
      executionMode: message.payload.executionMode,
      executionModeReady: ready,
    }
  }
  return state
}

export function useUiDesignerRendererHost(options: UiDesignerRendererHostOptions) {
  const rendererRequested = () => options.active?.() ?? true
  const status = ref<RendererHostStatus>('idle')
  const error = ref('')
  const failureCode = ref<string | null>(null)
  const failureRecoveryReason = ref('')
  const failureDetails = ref<UiDesignerRendererFailureDetails | null>(null)
  const iframeUrl = ref('')
  const bounds = ref<Record<string, UiDesignerRendererNodeBounds>>({})
  const diagnostics = ref<UiRuntimeDiagnostic[]>([])
  const executionMode = ref<UiDesignerRendererExecutionMode>('authoring')
  const executionModeReady = ref(false)
  const stage = ref<UiDesignerRendererHostStage>('idle')
  const stageStatus = ref<UiDesignerRendererHostStageStatus>('idle')
  const scenePhase = ref<'transitioning' | 'active'>('active')
  const requestedScene = ref<string | null>(null)
  const actualScene = ref<string | null>(null)
  const engineSceneClass = ref<string | null>(null)
  const mountedDocumentSceneId = ref<string | null>(null)
  const documentSceneName = ref<string | null>(null)
  const mountedRevision = ref<number | null>(null)
  const mountedExecutionMode = ref<UiDesignerRendererExecutionMode | null>(null)
  let session: UiDesignerRendererHostSession | null = null
  let sessionAdapter: UiDesignerRendererHostAdapter | null = null
  let hostSequence = -1
  let clientSequence = 0
  let revision = 0
  let pendingMountRevision: number | null = null
  let previousScene: UiRuntimeSceneExport | null = null
  let previousExecutionMode: UiDesignerRendererExecutionMode | null = null
  let disposingSession: UiDesignerRendererHostSession | null = null
  const retainedStaleSessions = new Map<string, RetainedRendererOwner>()
  const pendingStarts = new Set<Promise<unknown>>()
  let actorDisposed = false
  let engineReady = false
  let processConfirmed = false
  let lastHostMessageKind: string | null = null
  let lastTechnicalMessage: string | null = null
  let startEpoch = 0
  let disposed = false
  let messageListenerInstalled = false
  let cancelHandshake: () => void = () => undefined
  let cancelMountedWatchdog: () => void = () => undefined
  let pendingDispose: UiDesignerRendererDisposeAck | null = null
  let disposePromise: Promise<boolean> | null = null
  let queuedDisposePromise: Promise<boolean> | null = null
  let disposeCoordinatesPendingStarts = false
  let retainedStopPromise: Promise<boolean> | null = null
  let pendingStartCleanup = false
  let iframeLoaded = false
  let failurePromise: Promise<void> | null = null
  let draftFrame: { cancel: () => void } | null = null
  let draftEpoch = 0
  let previousDesignerSceneId: string | null = null
  let sceneSyncQueued = false
  let forceMountQueued = false
  let pendingResourceRefresh: { resourceRevision: number; manifest: ProjectAssetChangeManifest } | null = null
  let pendingUnboundResource: { generation: number; manifest: ProjectAssetChangeManifest } | null = null
  let resourceSyncChain = Promise.resolve()
  const terminalGate = createUiDesignerRendererTerminalGate()
  const failureLatch = createUiDesignerRendererFailureLatch()

  const latchFailure = (candidate: UiDesignerRendererFailure): UiDesignerRendererFailure => {
    const outcome = failureLatch.accept(candidate)
    if (outcome.accepted) {
      failureCode.value = outcome.failure.code
      failureRecoveryReason.value = outcome.failure.recoveryReason
    }
    return outcome.failure
  }

  const setStage = (next: UiDesignerRendererHostStage, nextStatus: UiDesignerRendererHostStageStatus) => {
    stage.value = next
    stageStatus.value = nextStatus
  }

  const rememberTechnicalFailure = (cause: unknown) => {
    lastTechnicalMessage = sanitizeRendererTechnicalMessage(cause)
  }

  const readDesignerValue = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value

  const applyReceiptStage = (next: UiDesignerRendererBridgeReceipt) => {
    if (next.status === 'error' || rendererStageOrder[next.stage] >= rendererStageOrder[stage.value]) setStage(next.stage, next.status)
  }

  const activeSceneId = () => {
    try {
      const document = readDesignerValue(options.designer.document)
      return document.meta.sceneName || 'Scene_CanvasHost'
    } catch { return 'Scene_CanvasHost' }
  }

  const designerSceneId = () => {
    try { return String(readDesignerValue(options.designer.activeSceneId)) }
    catch { return '' }
  }

  const postToFrame = (message: UiDesignerRendererBridgeMessage) => {
    if (!options.iframe.value?.contentWindow) throw new Error('The isolated UI canvas frame is unavailable for an active renderer session.')
    if (options.postMessage) {
      if (!options.postMessage(message)) throw new Error('The isolated UI canvas preview window rejected a renderer message.')
      return
    }
    options.iframe.value.contentWindow.postMessage(message, '*')
  }

  const post = (kind: UiDesignerRendererBridgeMessage['kind'], payload: Record<string, unknown>, sceneId = activeSceneId()) => {
    if (!session) return false
    const message = validateUiDesignerRendererBridgeMessage({
      version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
      sessionId: session.sessionId,
      generation: session.generation,
      sequence: clientSequence++,
      sceneId,
      kind,
      payload,
    })
    postToFrame(message)
    return true
  }

  const queueSceneSync = (forceMount = false) => {
    sceneSyncQueued = true
    forceMountQueued ||= forceMount
  }

  const postPendingResourceRefresh = () => {
    if (!session || !pendingResourceRefresh || pendingMountRevision !== null || !executionModeReady.value) return false
    const pending = pendingResourceRefresh
    pendingResourceRefresh = null
    revision += 1
    pendingMountRevision = revision
    executionModeReady.value = false
    status.value = 'loading'
    setStage('mount', 'begin')
    try {
      const relativePaths = [...new Set(
        [...pending.manifest.deleteRelativePaths, ...pending.manifest.upsertRelativePaths]
          .map((relativePath) => relativePath.replace(/^www\//, '')),
      )]
      if (!post('resource-refresh', {
        revision,
        resourceRevision: pending.resourceRevision,
        relativePaths,
      })) throw new Error('resource refresh post rejected')
      return true
    } catch {
      pendingMountRevision = null
      void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountPost, 'mount'))
      return false
    }
  }

  const syncResourceManifest = (manifest: ProjectAssetChangeManifest) => {
    const capturedSession = session
    const capturedAdapter = sessionAdapter
    const capturedGeneration = options.designer.projectGeneration
    if (!capturedSession || !capturedAdapter?.syncResources || capturedSession.generation !== capturedGeneration) {
      if (options.designer.canRenderCanvas && options.designer.projectPath) {
        pendingUnboundResource = {
          generation: capturedGeneration,
          manifest: mergeProjectAssetChangeManifests([
            pendingUnboundResource?.generation === capturedGeneration ? pendingUnboundResource.manifest : null,
            manifest,
          ]),
        }
      }
      return Promise.resolve()
    }
    const operation = resourceSyncChain.then(async () => {
      if (session !== capturedSession || sessionAdapter !== capturedAdapter || options.designer.projectGeneration !== capturedGeneration) return
      const sceneRevisionAtStart = revision
      const result = await capturedAdapter.syncResources!({
        sessionId: capturedSession.sessionId,
        generation: capturedSession.generation,
        manifest,
      })
      if (session !== capturedSession || options.designer.projectGeneration !== capturedGeneration) return
      if (result.status !== 'success' || !result.value || result.value.sessionId !== capturedSession.sessionId || result.value.generation !== capturedSession.generation || result.value.resourceRevision <= capturedSession.resourceRevision) {
        throw new Error(result.message || 'Renderer resource synchronization returned an invalid receipt.')
      }
      capturedSession.resourceRevision = result.value.resourceRevision
      const appliedManifest: ProjectAssetChangeManifest = {
        schemaVersion: '1.0.0',
        upsertRelativePaths: result.value.upsertedRelativePaths,
        deleteRelativePaths: result.value.deletedRelativePaths,
      }
      pendingResourceRefresh = {
        resourceRevision: result.value.resourceRevision,
        manifest: mergeProjectAssetChangeManifests([pendingResourceRefresh?.manifest, appliedManifest]),
      }
      // The isolated host remounts its last acknowledged scene after evicting
      // caches. If editing advanced while the filesystem copy was in flight,
      // immediately follow that refresh with the latest complete scene so an
      // older mount snapshot can never replace newer document or draft data.
      if (revision !== sceneRevisionAtStart) queueSceneSync(true)
      postPendingResourceRefresh()
    }).catch((cause) => {
      if (session === capturedSession) error.value = cause instanceof Error ? cause.message : String(cause)
    })
    resourceSyncChain = operation.then(() => undefined)
    return operation
  }

  const syncScene = (forceMount = false) => {
    if (!session || (status.value !== 'running' && status.value !== 'loading') || !engineReady || !processConfirmed || !iframeLoaded) return
    if (pendingMountRevision !== null) {
      queueSceneSync(forceMount)
      return
    }
    const mountRequested = forceMount || forceMountQueued
    sceneSyncQueued = false
    forceMountQueued = false
    let next: UiRuntimeSceneExport
    try {
      next = options.runtimeScene()
    } catch {
      void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.sceneExport, stage.value))
      return
    }
    let requestedExecutionMode: UiDesignerRendererExecutionMode
    let executionModeChanged = false
    let update: ReturnType<typeof planUiDesignerRendererUpdate>
    try {
      requestedExecutionMode = options.executionMode()
      executionModeChanged = previousExecutionMode !== requestedExecutionMode
      update = mountRequested || executionModeChanged
        ? { kind: 'mount', revision: revision + 1, scene: next }
        : planUiDesignerRendererUpdate(previousScene, next, revision + 1)
    } catch {
      void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.updatePlan, stage.value))
      return
    }
    if (!update) return
    // A mount owns the renderer revision until the runtime acknowledges it.
    // Keep later document changes in the local snapshot and reconcile them
    // after `mounted`; sending a patch while the host scene is still pending
    // is rejected by the isolated runtime as a protocol fatal.
    if (update.kind === 'patch' && !executionModeReady.value) {
      queueSceneSync(mountRequested)
      return
    }
    revision = update.revision
    if (update.kind === 'mount') {
      if (executionModeChanged) status.value = 'loading'
      executionModeReady.value = false
      scenePhase.value = 'transitioning'
      setStage('mount', 'begin')
      try {
        if (!post('mount', { revision, executionMode: requestedExecutionMode, documentSceneId: designerSceneId(), scene: update.scene }, update.scene.meta.sceneName)) throw new Error('mount post rejected')
        pendingMountRevision = revision
      } catch {
        void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountPost, 'mount'))
        return
      }
      cancelHandshake()
      cancelHandshake = () => undefined
      cancelMountedWatchdog()
      cancelMountedWatchdog = () => undefined
      const watchdogSessionId = session.sessionId
      const watchdogRevision = revision
      try {
        cancelMountedWatchdog = scheduleUiDesignerRendererHandshakeTimeout(() => {
          if (session?.sessionId === watchdogSessionId && revision === watchdogRevision && !executionModeReady.value) {
            void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountedTimeout, 'mounted'))
          }
        })
      } catch {
        void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountedWatchdog, 'mounted'))
        return
      }
    } else {
      try {
        if (!post('patch', { revision, nodes: update.nodes }, next.meta.sceneName)) throw new Error('patch post rejected')
      } catch {
        void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.patchPost, stage.value))
        return
      }
    }
    try {
      previousScene = JSON.parse(JSON.stringify(next)) as UiRuntimeSceneExport
      previousExecutionMode = requestedExecutionMode
    } catch {
      void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.sceneSnapshot, stage.value))
    }
  }

  const refreshCanvas = () => {
    if (options.executionMode() !== 'authoring') return false
    if (pendingMountRevision !== null) {
      queueSceneSync(true)
      return true
    }
    const beforeRevision = revision
    syncScene(true)
    return revision > beforeRevision || pendingMountRevision !== null
  }

  const cancelDraftSync = () => {
    draftEpoch += 1
    draftFrame?.cancel()
    draftFrame = null
  }

  const syncDraftGeometry = () => {
    if (!session || (status.value !== 'running' && status.value !== 'loading') || !engineReady || !processConfirmed || !iframeLoaded || !executionModeReady.value || pendingMountRevision !== null) return
    const nodes = buildUiDesignerRendererDraftPatches(readDesignerValue(options.designer.document), {
      positions: readDesignerValue(options.designer.draftPositions),
      rects: readDesignerValue(options.designer.draftRects),
      rotations: readDesignerValue(options.designer.draftRotations),
    })
    if (!nodes.length) return
    revision += 1
    try {
      if (!post('patch', { revision, nodes }, activeSceneId())) throw new Error('draft patch post rejected')
    } catch {
      void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.patchPost, stage.value))
    }
  }

  const queueDraftSync = () => {
    if (draftFrame) return
    const epoch = draftEpoch
    const run = () => {
      draftFrame = null
      if (epoch !== draftEpoch) return
      syncDraftGeometry()
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      const id = globalThis.requestAnimationFrame(() => run())
      draftFrame = { cancel: () => globalThis.cancelAnimationFrame(id) }
      return
    }
    const id = setTimeout(run, 16)
    draftFrame = { cancel: () => clearTimeout(id) }
  }

  const syncSelection = () => {
    if (options.executionMode() !== 'full-preview') return
    if (!session || (status.value !== 'running' && status.value !== 'loading') || !engineReady || !processConfirmed || !iframeLoaded || !executionModeReady.value) return
    try {
      if (!post('select', { nodeIds: [...options.designer.selectedIds] })) throw new Error('selection post rejected')
    } catch {
      void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.selectionPost, stage.value))
    }
  }

  const stopBackend = async (
    active: UiDesignerRendererHostSession | null,
    reason: UiDesignerRendererHostStopReason,
    adapter: UiDesignerRendererHostAdapter,
  ) => {
    const result = await adapter.stop(active?.sessionId, reason)
    if (result.status !== 'success' && result.status !== 'idle') throw new Error(result.message)
  }

  const stopRetainedStaleSessions = (): Promise<boolean> => {
    if (retainedStopPromise) return retainedStopPromise
    const operation = (async () => {
      while (retainedStaleSessions.size) {
        const entries = [...retainedStaleSessions.entries()]
        for (const [sessionId, owner] of entries) {
          try {
            await stopBackend(owner.session, 'project-change', owner.adapter)
            if (retainedStaleSessions.get(sessionId) === owner) retainedStaleSessions.delete(sessionId)
          } catch {
            return false
          }
        }
      }
      return true
    })()
    const tracked = operation.finally(() => { if (retainedStopPromise === tracked) retainedStopPromise = null })
    retainedStopPromise = tracked
    return tracked
  }

  const stopStaleSession = async (stale: UiDesignerRendererHostSession, adapter: UiDesignerRendererHostAdapter) => {
    retainedStaleSessions.set(stale.sessionId, { session: stale, adapter })
    // A route/project/unmount barrier that is already awaiting this start owns
    // the stop.  Let that single barrier stop the retained owner once, after
    // every pending start has settled.
    if (pendingStartCleanup) return true
    return stopRetainedStaleSessions()
  }

  const waitForPendingStarts = async () => {
    while (pendingStarts.size) await Promise.allSettled([...pendingStarts])
  }

  const clearStoppedSessionState = () => {
    cancelDraftSync()
    sessionAdapter = null
    disposingSession = null
    iframeUrl.value = ''
    bounds.value = {}
    diagnostics.value = []
    options.designer.runtimeDiagnostics = []
    previousScene = null
    previousExecutionMode = null
    previousDesignerSceneId = null
    pendingMountRevision = null
    sceneSyncQueued = false
    forceMountQueued = false
    pendingResourceRefresh = null
    iframeLoaded = false
    executionMode.value = 'authoring'
    executionModeReady.value = false
    scenePhase.value = 'active'
    requestedScene.value = null
    actualScene.value = null
    engineSceneClass.value = null
    mountedDocumentSceneId.value = null
    documentSceneName.value = null
    mountedRevision.value = null
    mountedExecutionMode.value = null
    engineReady = false
    processConfirmed = false
    actorDisposed = false
  }

  const dispose = (
    bridgeReason: 'project-change' | 'unload' | 'shutdown',
    backendReason: UiDesignerRendererHostStopReason = bridgeReason,
    coordinatePendingStarts = true,
  ): Promise<boolean> => {
    cancelDraftSync()
    if (coordinatePendingStarts) {
      startEpoch += 1
      pendingStartCleanup = true
      if (queuedDisposePromise) return queuedDisposePromise
    }
    if (disposePromise) {
      if (!coordinatePendingStarts || disposeCoordinatesPendingStarts) return disposePromise
      const currentDispose = disposePromise
      const queued = (async () => {
        const currentOk = await currentDispose
        await waitForPendingStarts()
        if (!currentOk) return false
        return dispose(bridgeReason, backendReason, false)
      })().finally(() => {
        if (queuedDisposePromise === queued) queuedDisposePromise = null
        pendingStartCleanup = false
      })
      queuedDisposePromise = queued
      return queued
    }
    disposeCoordinatesPendingStarts = coordinatePendingStarts
    const operation = (async () => {
      if (coordinatePendingStarts) {
        pendingStartCleanup = true
        await waitForPendingStarts()
      }
      const active = session
      const activeAdapter = sessionAdapter ?? options.designer.adapters.rendererHost
      if (!active) {
        const ok = await stopRetainedStaleSessions()
        if (ok) {
          status.value = 'idle'
          error.value = ''
          setStage('idle', 'idle')
          if (options.executionMode() === 'authoring') options.onExecutionModeReady?.('authoring')
        } else {
          status.value = 'error'
          setStage('dispose', 'error')
          error.value = retainedStopFailureMessage
          options.onExecutionModeError?.(error.value, true)
        }
        if (ok && disposed && coordinatePendingStarts) {
          unregisterPreviewDisposer()
          removeMessageListener()
        }
        return ok
      }
      cancelHandshake()
      cancelHandshake = () => undefined
      cancelMountedWatchdog()
      cancelMountedWatchdog = () => undefined
      session = null
      sessionAdapter = null
      disposingSession = active
      const canAskHost = Boolean(options.iframe.value?.contentWindow)
      let actorTerminal = actorDisposed || !canAskHost
      setStage('dispose', 'begin')
      status.value = 'preparing'
      if (canAskHost && !actorDisposed) {
        pendingDispose = createUiDesignerRendererDisposeAck()
        try { postWithSession(active, 'dispose', { reason: bridgeReason }, activeSceneId()) }
        catch { actorTerminal = false }
        if (pendingDispose) actorTerminal = await pendingDispose.promise
        pendingDispose = null
      }
      // A fatal/iframe failure may arrive while a normal route disposal is
      // already waiting for the actor acknowledgement.  `fail()` marks the
      // actor terminal; re-check that flag after the await so the owner still
      // reaches backend cleanup instead of returning early with a live temp
      // project.
      if (!actorTerminal && actorDisposed) actorTerminal = true
      if (!actorTerminal) {
        session = active
        sessionAdapter = activeAdapter
        disposingSession = null
        status.value = 'error'
        setStage('dispose', 'error')
        error.value = 'The isolated UI canvas did not confirm disposal; its temporary project was kept for recovery.'
        options.onExecutionModeError?.(error.value, true)
        return false
      }
      actorDisposed = true
      try {
        await stopBackend(active, backendReason, activeAdapter)
        clearStoppedSessionState()
        if (!await stopRetainedStaleSessions()) {
          status.value = 'error'
          setStage('dispose', 'error')
          error.value = retainedStopFailureMessage
          options.onExecutionModeError?.(error.value, true)
          return false
        }
        setStage('idle', 'idle')
        error.value = ''
        status.value = 'idle'
        if (options.executionMode() === 'authoring') options.onExecutionModeReady?.('authoring')
        if (disposed && coordinatePendingStarts) {
          unregisterPreviewDisposer()
          removeMessageListener()
        }
        return true
      } catch {
        session = active
        sessionAdapter = activeAdapter
        disposingSession = null
        status.value = 'error'
        setStage('dispose', 'error')
        error.value = `${rendererFailureMessage('dispose')} The isolated renderer was kept because disposal failed.`
        options.onExecutionModeError?.(error.value, true)
        return false
      }
    })()
    const tracked = operation.finally(() => {
      if (coordinatePendingStarts) pendingStartCleanup = false
      if (disposePromise === tracked) {
        disposePromise = null
        disposeCoordinatesPendingStarts = false
      }
    })
    disposePromise = tracked
    return tracked
  }

  const unregisterPreviewDisposer = options.designer.registerPreviewDisposer((reason: UiDesignerPreviewDisposeReason) =>
    dispose(reason, reason))

  const postWithSession = (
    active: UiDesignerRendererHostSession,
    kind: UiDesignerRendererBridgeMessage['kind'],
    payload: Record<string, unknown>,
    sceneId: string,
  ) => {
    const message = validateUiDesignerRendererBridgeMessage({
      version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
      sessionId: active.sessionId,
      generation: active.generation,
      sequence: clientSequence++,
      sceneId,
      kind,
      payload,
    })
    postToFrame(message)
    return true
  }

  const fail = (acceptedFailure: UiDesignerRendererFailure): Promise<void> => {
    if (failurePromise) return failurePromise
    cancelDraftSync()
    const authoritativeFailure = latchFailure(acceptedFailure)
    const failedStage = authoritativeFailure.stage
    const latestDiagnostic = diagnostics.value.at(-1)
    failureDetails.value = {
      code: authoritativeFailure.code,
      stage: failedStage,
      stageStatus: stageStatus.value,
      recoveryReason: authoritativeFailure.recoveryReason,
      technicalMessage: lastTechnicalMessage,
      iframeLoaded,
      engineReady,
      processConfirmed,
      pendingMountRevision,
      requestedExecutionMode: options.executionMode(),
      executionMode: executionMode.value,
      executionModeReady: executionModeReady.value,
      revision,
      hostSequence,
      lastHostMessageKind,
      scenePhase: scenePhase.value,
      requestedScene: requestedScene.value,
      actualScene: actualScene.value,
      engineSceneClass: engineSceneClass.value,
      mountedDocumentSceneId: mountedDocumentSceneId.value,
      documentSceneName: documentSceneName.value,
      mountedRevision: mountedRevision.value,
      mountedExecutionMode: mountedExecutionMode.value,
      cleanupConfirmed: null,
      lastDiagnostic: latestDiagnostic ? {
        code: latestDiagnostic.code,
        severity: latestDiagnostic.severity,
        phase: latestDiagnostic.phase,
        event: latestDiagnostic.event,
        label: latestDiagnostic.label,
        message: latestDiagnostic.message,
        count: latestDiagnostic.count,
      } : null,
    }
    const operation = (async () => {
      startEpoch += 1
      cancelHandshake()
      cancelHandshake = () => undefined
      cancelMountedWatchdog()
      cancelMountedWatchdog = () => undefined
      setStage(failedStage, 'error')
      // A protocol/iframe failure means the embedded actor can no longer be
      // relied on to acknowledge `dispose`.  Mark the actor terminal before
      // entering the shared disposal barrier so backend stop still runs and can
      // release the owned temporary project.  If backend stop itself fails,
      // this flag stays set and a later route/project retry skips the dead actor
      // handshake and retries the backend cleanup instead of leaking the owner.
      if (session || disposingSession) actorDisposed = true
      const terminal = await dispose('shutdown', 'protocol-error', false)
      removeMessageListener()
      status.value = 'error'
      setStage(failedStage, 'error')
      const recoveryReason = terminal
        ? authoritativeFailure.recoveryReason
        : `${authoritativeFailure.recoveryReason} The previous preview was kept because cleanup was not confirmed.`
      failureRecoveryReason.value = recoveryReason
      error.value = recoveryReason
      if (failureDetails.value) failureDetails.value = { ...failureDetails.value, recoveryReason, cleanupConfirmed: terminal }
      console.error('[ui-designer renderer bridge failure]', {
        code: authoritativeFailure.code,
        stage: failedStage,
        cleanupConfirmed: terminal,
      })
      // Every failure mode must return the designer to a recoverable state;
      // skipping the notification for terminal editor-preview failures left
      // previewStatus stuck on 'preparing' with no exit path.
      options.onExecutionModeError?.(recoveryReason, !terminal)
      if (terminal) {
        iframeUrl.value = ''
        bounds.value = {}
        diagnostics.value = []
        options.designer.runtimeDiagnostics = []
        previousScene = null
        previousExecutionMode = null
        previousDesignerSceneId = null
        pendingMountRevision = null
        sceneSyncQueued = false
        forceMountQueued = false
        iframeLoaded = false
        executionMode.value = 'authoring'
        executionModeReady.value = false
        scenePhase.value = 'active'
        requestedScene.value = null
        actualScene.value = null
        engineSceneClass.value = null
        mountedDocumentSceneId.value = null
        documentSceneName.value = null
        mountedRevision.value = null
        mountedExecutionMode.value = null
        engineReady = false
        processConfirmed = false
      }
    })()
    const tracked = operation.finally(() => {
      if (failurePromise === tracked) failurePromise = null
    })
    failurePromise = tracked
    return tracked
  }

  const armHandshakeWatchdog = (activeSessionId: string): boolean => {
    cancelHandshake()
    cancelHandshake = () => undefined
    try {
      cancelHandshake = scheduleUiDesignerRendererHandshakeTimeout(() => {
        if (session?.sessionId === activeSessionId && pendingMountRevision === null && !executionModeReady.value) {
          void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.handshakeTimeout, stage.value))
        }
      })
      return true
    } catch {
      void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.handshakeWatchdog, 'iframe-load'))
      return false
    }
  }

  const start = async () => {
    const epoch = ++startEpoch
    if (pendingStartCleanup || queuedDisposePromise || disposeCoordinatesPendingStarts) return
    if (!await dispose('project-change', 'project-change', false)) return
    if (!await stopRetainedStaleSessions()) {
      status.value = 'error'
      setStage('dispose', 'error')
      error.value = retainedStopFailureMessage
      options.onExecutionModeError?.(error.value, true)
      return
    }
    await nextTick()
    if (disposed || epoch !== startEpoch || !options.designer.canRenderCanvas || !options.designer.projectPath) return
    terminalGate.reset()
    failureLatch.reset()
    failureCode.value = null
    failureRecoveryReason.value = ''
    failureDetails.value = null
    lastHostMessageKind = null
    lastTechnicalMessage = null
    installMessageListener()
    status.value = 'preparing'
    setStage('start', 'begin')
    error.value = ''
    diagnostics.value = []
    options.designer.runtimeDiagnostics = []
    const generation = options.designer.projectGeneration
    const rendererAdapter = options.designer.adapters.rendererHost
    const pendingStart = (async () => {
      let result: Awaited<ReturnType<UiDesignerRendererHostAdapter['start']>>
      try {
        result = await rendererAdapter.start(generation)
      } catch (cause) {
        if (disposed || epoch !== startEpoch || generation !== options.designer.projectGeneration) return
        rememberTechnicalFailure(cause)
        await fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.startAdapter, 'start'))
        return
      }
      if (disposed || epoch !== startEpoch || generation !== options.designer.projectGeneration) {
        if (result.value) {
          // A stale start still owns a real backend session.  Keep it in a
          // separate owner slot so it cannot overwrite the current session;
          // a later start retries the stop before creating another session.
          const stopped = await stopStaleSession(result.value, rendererAdapter)
          // A newer start may already own the active renderer.  A stale stop
          // failure must not overwrite that owner's running/loading state;
          // the retained owner remains queued for the next barrier retry.
          if (!stopped && (!session || session.sessionId === result.value.sessionId)) {
            status.value = 'error'
            setStage('dispose', 'error')
            error.value = retainedStopFailureMessage
            options.onExecutionModeError?.(error.value, true)
          }
        }
        return
      }
      if (result.status !== 'success' || !result.value) {
        await fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.startResult, 'start'))
        return
      }
      const started = result.value
      session = started
      sessionAdapter = rendererAdapter
      actorDisposed = false
      setStage('start', 'success')
      setStage('iframe-load', 'begin')
      hostSequence = -1
      clientSequence = 0
      revision = 0
      pendingMountRevision = null
      pendingResourceRefresh = null
      previousScene = null
      previousExecutionMode = null
      sceneSyncQueued = false
      forceMountQueued = false
      previousDesignerSceneId = designerSceneId()
      iframeLoaded = false
      executionMode.value = 'authoring'
      executionModeReady.value = false
      scenePhase.value = 'active'
      requestedScene.value = null
      actualScene.value = null
      engineSceneClass.value = null
      mountedDocumentSceneId.value = null
      documentSceneName.value = null
      mountedRevision.value = null
      mountedExecutionMode.value = null
      engineReady = false
      processConfirmed = false
      iframeUrl.value = started.iframeUrl
      status.value = 'loading'
      if (pendingUnboundResource?.generation === started.generation) {
        const queued = pendingUnboundResource.manifest
        pendingUnboundResource = null
        void syncResourceManifest(queued)
      } else if (pendingUnboundResource) pendingUnboundResource = null
      armHandshakeWatchdog(started.sessionId)
    })()
    pendingStarts.add(pendingStart)
    try { await pendingStart }
    finally { pendingStarts.delete(pendingStart) }
  }

  const maybeRun = () => {
    if (!session || !engineReady || !processConfirmed) return
    setStage('ready', 'success')
    status.value = 'loading'
    syncScene()
    syncSelection()
  }

  const acknowledgeIframeLoad = () => {
    if (!session) return
    const firstAcknowledgement = !iframeLoaded
    iframeLoaded = true
    if (status.value !== 'running') status.value = 'loading'
    if (rendererStageOrder[stage.value] <= rendererStageOrder['iframe-load']) setStage('iframe-load', 'success')
    if (!engineReady && rendererStageOrder[stage.value] <= rendererStageOrder.hello) setStage('hello', 'begin')
    if (firstAcknowledgement) maybeRun()
  }

  const acknowledgeEngineReady = (reportedEngineSceneClass: string) => {
    if (reportedEngineSceneClass !== UI_DESIGNER_RENDERER_HOST_SCENE_CLASS) {
      throw new Error('The isolated UI canvas ready scene class does not match the fixed host scene.')
    }
    if (engineReady) return
    engineReady = true
    setStage('ready', 'success')
    maybeRun()
  }

  const confirmProcess = async (active: UiDesignerRendererHostSession, adapter: UiDesignerRendererHostAdapter) => {
    let result: Awaited<ReturnType<UiDesignerRendererHostAdapter['confirm']>>
    try {
      result = await adapter.confirm(active.sessionId)
    } catch (cause) {
      if (!session || session.sessionId !== active.sessionId) return
      rememberTechnicalFailure(cause)
      await fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIpc, 'confirm'))
      return
    }
    if (!session || session.sessionId !== active.sessionId) return
    if (result.status !== 'success' || !result.value) {
      await fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIpc, 'confirm'))
      return
    }
    const confirmed = result.value
    if (
      confirmed.sessionId !== active.sessionId
      || confirmed.generation !== active.generation
      || confirmed.iframeUrl !== active.iframeUrl
      || confirmed.engine !== active.engine
      || confirmed.engineVersion !== active.engineVersion
      || confirmed.runtimeVersion !== active.runtimeVersion
    ) {
      await fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIdentity, 'confirm'))
      return
    }
    processConfirmed = true
    setStage('confirm', 'success')
    setStage('ready', 'begin')
    maybeRun()
  }

  const messageOriginMatches = (origin: string) => {
    if (origin === 'null') return true
    try { return origin === new URL(iframeUrl.value).origin } catch { return false }
  }

  const onMessage = (event: MessageEvent) => {
    const active = session ?? disposingSession
    if (!active || !options.iframe.value?.contentWindow || event.source !== options.iframe.value.contentWindow || !messageOriginMatches(event.origin)) return
    const candidate = event.data
    const candidateEnvelope = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : null
    if (
      candidateEnvelope
      && typeof candidateEnvelope.sessionId === 'string' && typeof candidateEnvelope.generation === 'number'
      && (candidateEnvelope.sessionId !== active.sessionId || candidateEnvelope.generation !== active.generation)
    ) return
    try {
      // The host publishes one initial scene-state for its own fixed canvas
      // scene immediately after ready.  A mount posted from the ready handler
      // can therefore be queued before that pre-mount state is delivered.  It
      // carries no document identity and must stay a harmless transition
      // status; enforcing the current document/revision on it turns a legal
      // lifecycle message into a protocol fatal.
      const sceneStatePayload = candidateEnvelope?.kind === 'scene-state'
        && candidateEnvelope.payload && typeof candidateEnvelope.payload === 'object' && !Array.isArray(candidateEnvelope.payload)
        ? candidateEnvelope.payload as Record<string, unknown>
        : null
      const sceneStateHasDocumentIdentity = sceneStatePayload?.mountedDocumentSceneId !== null
      const expectsDocumentIdentity = session
        && (
          (candidateEnvelope?.kind === 'mounted' && (pendingMountRevision !== null || mountedDocumentSceneId.value !== null))
          || (candidateEnvelope?.kind === 'scene-state' && sceneStateHasDocumentIdentity)
        )
      const message = validateUiDesignerRendererBridgeMessage(candidate, {
        sessionId: active.sessionId,
        generation: active.generation,
        minimumSequence: hostSequence + 1,
        ...(expectsDocumentIdentity
          ? { sceneId: activeSceneId() }
          : {}),
        ...((candidateEnvelope?.kind === 'fatal' || (session && (candidateEnvelope?.kind === 'mounted' || candidateEnvelope?.kind === 'bounds' || (candidateEnvelope?.kind === 'scene-state' && sceneStateHasDocumentIdentity))))
          ? { minimumRevision: revision }
          : {}),
      })
      hostSequence = message.sequence
      const messageKind = (message as unknown as { kind: string }).kind
      lastHostMessageKind = messageKind
      if (!session) {
        if (messageKind === 'fatal') {
          const terminalFailure = terminalGate.accept(message)
          if (terminalFailure) latchFailure(terminalFailure)
          actorDisposed = true
          pendingDispose?.acknowledge()
        }
        if (message.kind === 'disposed' && pendingDispose) pendingDispose.acknowledge()
        return
      }
      const advancesHandshake = messageKind === 'receipt'
        || messageKind === 'hello'
        || messageKind === 'ready'
        || (messageKind === 'scene-state' && !sceneStateHasDocumentIdentity)
      if (advancesHandshake) acknowledgeIframeLoad()
      if (advancesHandshake && pendingMountRevision === null && !executionModeReady.value && !armHandshakeWatchdog(active.sessionId)) return
      if (messageKind === 'receipt') {
        const payload = (message as unknown as { payload: UiDesignerRendererReceiptPayload }).payload
        applyReceiptStage(payload)
        if (payload.stage === 'iframe-load' && payload.status === 'success') {
          acknowledgeIframeLoad()
        }
      } else if (messageKind === 'fatal') {
        rememberTechnicalFailure((message as Extract<UiDesignerRendererBridgeMessage, { kind: 'fatal' }>).payload.message)
        const terminalFailure = terminalGate.accept(message)
        if (terminalFailure) void fail(terminalFailure)
      } else if (message.kind === 'hello') {
        setStage('hello', 'success')
        if (message.payload.engine !== active.engine) throw new Error('The isolated UI canvas engine does not match the selected project.')
        if (!active.engineVersion || message.payload.engineVersion !== active.engineVersion) throw new Error('The isolated UI canvas engine version does not match the selected project.')
        if (!message.payload.pixiVersion) throw new Error('The isolated UI canvas did not expose the project PIXI version.')
        if (message.payload.runtimeVersion !== active.runtimeVersion) throw new Error('The isolated UI canvas loaded an incompatible MZUIRuntime version.')
        if (!sessionAdapter) throw new Error('The isolated UI canvas renderer owner is unavailable.')
        setStage('confirm', 'begin')
        void confirmProcess(active, sessionAdapter)
      } else if (message.kind === 'ready') {
        acknowledgeEngineReady(message.payload.engineSceneClass)
      } else if (message.kind === 'mounted' || message.kind === 'bounds' || message.kind === 'diagnostic' || message.kind === 'scene-state') {
        const next = reduceUiDesignerRendererHostRuntimeMessage({
          bounds: bounds.value,
          diagnostics: diagnostics.value,
          executionMode: executionMode.value,
          executionModeReady: executionModeReady.value,
          scenePhase: scenePhase.value,
          requestedScene: requestedScene.value,
          actualScene: actualScene.value,
          engineSceneClass: engineSceneClass.value,
          mountedDocumentSceneId: mountedDocumentSceneId.value,
          documentSceneName: documentSceneName.value,
          mountedRevision: mountedRevision.value,
          mountedExecutionMode: mountedExecutionMode.value,
        }, message, revision, options.executionMode(), designerSceneId(), activeSceneId())
        bounds.value = next.bounds
        diagnostics.value = next.diagnostics
        executionMode.value = next.executionMode
        executionModeReady.value = next.executionModeReady
        scenePhase.value = next.scenePhase
        requestedScene.value = next.requestedScene
        actualScene.value = next.actualScene
        engineSceneClass.value = next.engineSceneClass
        mountedDocumentSceneId.value = next.mountedDocumentSceneId
        documentSceneName.value = next.documentSceneName
        mountedRevision.value = next.mountedRevision
        mountedExecutionMode.value = next.mountedExecutionMode
        if (message.kind === 'diagnostic') options.designer.runtimeDiagnostics = [...diagnostics.value]
        if (
          message.kind === 'scene-state'
          && !engineReady
          && message.payload.phase === 'active'
          && message.payload.actualScene === UI_DESIGNER_RENDERER_HOST_SCENE_CLASS
          && message.payload.engineSceneClass === UI_DESIGNER_RENDERER_HOST_SCENE_CLASS
          && message.payload.mountedDocumentSceneId === null
          && message.payload.documentSceneName === null
          && message.payload.revision === 0
          && message.payload.executionMode === 'authoring'
        ) {
          // The generated host publishes this exact authenticated pre-mount
          // state only after its one-shot ready signal. It therefore closes
          // the iframe-ref race without accepting a different engine scene or
          // treating a mounted document state as renderer readiness.
          acknowledgeEngineReady(message.payload.engineSceneClass)
        }
        if (message.kind === 'mounted' && message.payload.revision >= revision) {
          const mountedIdentityMatches = message.payload.engineSceneClass === UI_DESIGNER_RENDERER_HOST_SCENE_CLASS
            && message.payload.mountedDocumentSceneId === designerSceneId()
            && message.payload.documentSceneName === activeSceneId()
          const mountedModeMatches = message.payload.executionMode === options.executionMode()
          if (!mountedIdentityMatches) throw new Error('The isolated UI canvas mounted document identity does not match the active request.')
          if (!mountedModeMatches) {
            // A same-revision receipt from the previous mode must not settle the
            // current transition. Drop the stale pending revision and issue a
            // fresh mount for the mode the editor is currently requesting.
            cancelMountedWatchdog()
            cancelMountedWatchdog = () => undefined
            pendingMountRevision = null
            status.value = 'loading'
            executionModeReady.value = false
            sceneSyncQueued = false
            forceMountQueued = false
            syncScene(true)
          } else {
            setStage('mounted', 'success')
            // Mounted is only the renderer acknowledgment.  The official
            // engine scene can still be transitioning, so running/ready is
            // settled by the matching active scene-state below.
            status.value = 'loading'
          }
        }
        if (message.kind === 'scene-state') {
          setStage('scene-state', message.payload.phase === 'active' && executionModeReady.value ? 'success' : 'begin')
          if (executionModeReady.value) {
            const mountedRevisionMatches = pendingMountRevision === null || pendingMountRevision === message.payload.revision
            if (mountedRevisionMatches) {
              cancelMountedWatchdog()
              cancelMountedWatchdog = () => undefined
              pendingMountRevision = null
              status.value = 'running'
              cancelDraftSync()
              if (postPendingResourceRefresh()) return
              const previewNeedsLatestMount = sceneSyncQueued && options.executionMode() !== 'authoring'
              if (sceneSyncQueued || previousScene?.meta.sceneName !== activeSceneId()) syncScene(previewNeedsLatestMount)
              if (!previewNeedsLatestMount) options.onExecutionModeReady?.(message.payload.executionMode)
              syncSelection()
            }
          } else if (message.payload.phase === 'transitioning') {
            executionModeReady.value = false
            status.value = 'loading'
          }
        }
      } else if (message.kind === 'exit-request') {
        if (executionModeReady.value && executionMode.value !== 'authoring') options.onPreviewExitRequest?.(message.payload.key)
      } else if (message.kind === 'disposed') {
        if (pendingDispose) pendingDispose.acknowledge()
      }
    } catch (cause) {
      rememberTechnicalFailure(cause)
      void fail(resolveUiDesignerRendererFailure('UI_RENDERER_BRIDGE_PROTOCOL', stage.value))
    }
  }

  const onIframeLoad = () => {
    acknowledgeIframeLoad()
  }

  const onIframeError = () => {
    iframeLoaded = false
    if (session) void fail(resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.iframeLoad, 'iframe-load'))
  }
  const retry = () => {
    if (disposed) return false
    const restart = async () => {
      if (session || disposingSession || retainedStaleSessions.size) {
        const stopped = await dispose('shutdown', 'shutdown', true)
        if (!stopped) return
      }
      await start()
    }
    void restart()
    return true
  }

  function installMessageListener() {
    if (messageListenerInstalled) return
    window.addEventListener('message', onMessage)
    messageListenerInstalled = true
  }

  function removeMessageListener() {
    if (!messageListenerInstalled) return
    window.removeEventListener('message', onMessage)
    messageListenerInstalled = false
  }

  const projectStop = watch(
    () => [options.designer.projectPath, options.designer.projectGeneration, options.designer.canRenderCanvas] as const,
    () => {
      cancelDraftSync()
      if (rendererRequested()) void start()
      else if (session || disposingSession || retainedStaleSessions.size) void dispose('project-change')
    },
    { flush: 'post' },
  )
  const sceneStop = watch(
    () => [designerSceneId(), readDesignerValue(options.designer.document)] as const,
    ([nextSceneId]) => {
      cancelDraftSync()
      const sceneChanged = previousDesignerSceneId !== null && nextSceneId !== previousDesignerSceneId
      previousDesignerSceneId = nextSceneId
      if (rendererRequested()) syncScene(sceneChanged)
    },
    { flush: 'post' },
  )
  const draftStop = watch(
    () => [readDesignerValue(options.designer.draftPositions), readDesignerValue(options.designer.draftRects), readDesignerValue(options.designer.draftRotations)],
    () => { if (rendererRequested()) queueDraftSync() },
    { deep: true, flush: 'post' },
  )
  const selectionStop = watch(() => [...options.designer.selectedIds], () => { if (rendererRequested()) syncSelection() }, { flush: 'post' })
  const executionModeStop = watch(options.executionMode, () => {
    cancelDraftSync()
    if (!rendererRequested()) return
    executionModeReady.value = false
    // A renderer fatal clears the isolated iframe and leaves the editor in
    // authoring mode.  Entering editor preview again must reuse the same
    // owner lifecycle by starting a fresh session instead of leaving the
    // controller in `preparing` with no session to acknowledge it.
    if (options.executionMode() !== 'authoring' && status.value === 'error' && !session && !disposingSession) {
      void retry()
      return
    }
    syncScene(true)
  }, { flush: 'post' })
  const activeStop = watch(rendererRequested, (active) => {
    cancelDraftSync()
    if (active) {
      installMessageListener()
      void start()
    } else if (session || disposingSession || retainedStaleSessions.size) {
      void dispose('shutdown')
    }
  }, { flush: 'post' })
  const unregisterResourceMutationHandler = options.designer.registerResourceMutationHandler(syncResourceManifest)

  onMounted(() => {
    installMessageListener()
    if (rendererRequested()) void start()
  })
  onBeforeUnmount(() => {
    disposed = true
    startEpoch += 1
    cancelDraftSync()
    projectStop()
    sceneStop()
    draftStop()
    selectionStop()
    executionModeStop()
    activeStop()
    unregisterResourceMutationHandler()
    void dispose('unload')
      .then((barrierOk) => {
        if (barrierOk) {
          unregisterPreviewDisposer()
          removeMessageListener()
        }
        return barrierOk
      })
  })

  return { status, error, failureCode, failureRecoveryReason, failureDetails, iframeUrl, bounds, diagnostics, executionMode, executionModeReady, stage, stageStatus, scenePhase, requestedScene, actualScene, engineSceneClass, mountedDocumentSceneId, documentSceneName, mountedRevision, mountedExecutionMode, onWindowMessage: onMessage, onIframeLoad, onIframeError, retry, refreshCanvas, dispose }
}
