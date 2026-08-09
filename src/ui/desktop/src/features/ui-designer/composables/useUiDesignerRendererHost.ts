import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type {
  UiDesignerRendererHostSession,
  UiDesignerRendererHostStopReason,
  UiRuntimeDiagnostic,
  UiRuntimeSceneExport,
} from '@contract/ui-designer'
import {
  UI_DESIGNER_RENDERER_BRIDGE_VERSION,
  validateUiDesignerRendererBridgeMessage,
  type UiDesignerRendererBridgeMessage,
  type UiDesignerRendererNodeBounds,
} from '@contract/ui-designer-renderer-bridge'
import type { UiDesignerController } from './useUiDesigner'
import { createUiDesignerRendererDisposeAck, planUiDesignerRendererUpdate, scheduleUiDesignerRendererHandshakeTimeout, type UiDesignerRendererDisposeAck } from '../rendererBridge'

type RendererHostStatus = 'idle' | 'preparing' | 'loading' | 'running' | 'error'

export interface UiDesignerRendererHostOptions {
  designer: UiDesignerController
  iframe: Ref<HTMLIFrameElement | undefined>
  runtimeScene: () => UiRuntimeSceneExport
}

export function useUiDesignerRendererHost(options: UiDesignerRendererHostOptions) {
  const status = ref<RendererHostStatus>('idle')
  const error = ref('')
  const iframeUrl = ref('')
  const bounds = ref<Record<string, UiDesignerRendererNodeBounds>>({})
  const diagnostics = ref<UiRuntimeDiagnostic[]>([])
  let session: UiDesignerRendererHostSession | null = null
  let hostSequence = -1
  let clientSequence = 0
  let revision = 0
  let previousScene: UiRuntimeSceneExport | null = null
  let disposingSession: UiDesignerRendererHostSession | null = null
  let engineReady = false
  let processConfirmed = false
  let startEpoch = 0
  let disposed = false
  let messageListenerInstalled = false
  let cancelHandshake: () => void = () => undefined
  let pendingDispose: UiDesignerRendererDisposeAck | null = null
  let disposePromise: Promise<void> | null = null

  const activeSceneId = () => {
    try { return options.runtimeScene().meta.sceneName } catch { return 'Scene_CanvasHost' }
  }

  const post = (kind: UiDesignerRendererBridgeMessage['kind'], payload: Record<string, unknown>, sceneId = activeSceneId()) => {
    if (!session) return false
    if (!options.iframe.value?.contentWindow) throw new Error('The isolated UI canvas frame is unavailable for an active renderer session.')
    const message = validateUiDesignerRendererBridgeMessage({
      version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
      sessionId: session.sessionId,
      generation: session.generation,
      sequence: clientSequence++,
      sceneId,
      kind,
      payload,
    })
    options.iframe.value.contentWindow.postMessage(message, '*')
    return true
  }

  const syncScene = () => {
    if (!session || status.value !== 'running') return
    try {
      const next = options.runtimeScene()
      const update = planUiDesignerRendererUpdate(previousScene, next, revision + 1)
      if (!update) return
      revision = update.revision
      if (update.kind === 'mount') post('mount', { revision, scene: update.scene }, update.scene.meta.sceneName)
      else post('patch', { revision, nodes: update.nodes }, next.meta.sceneName)
      previousScene = JSON.parse(JSON.stringify(next)) as UiRuntimeSceneExport
    } catch (reason) {
      void fail(reason)
    }
  }

  const syncSelection = () => {
    if (status.value !== 'running') return
    try { post('select', { nodeIds: [...options.designer.selectedIds] }) }
    catch (reason) { void fail(reason) }
  }

  const stopBackend = async (active: UiDesignerRendererHostSession | null, reason: UiDesignerRendererHostStopReason) => {
    const result = await options.designer.adapters.rendererHost.stop(active?.sessionId, reason)
    if (result.status !== 'success' && result.status !== 'idle') throw new Error(result.message)
  }

  const dispose = (
    bridgeReason: 'project-change' | 'unload' | 'shutdown',
    backendReason: UiDesignerRendererHostStopReason = bridgeReason,
  ): Promise<void> => {
    if (disposePromise) return disposePromise
    const active = session
    if (!active) return Promise.resolve()
    const operation = (async () => {
      cancelHandshake()
      cancelHandshake = () => undefined
      session = null
      disposingSession = active
      const canAskHost = Boolean(options.iframe.value?.contentWindow && (engineReady || status.value === 'running'))
      status.value = 'preparing'
      if (canAskHost) {
        pendingDispose = createUiDesignerRendererDisposeAck()
        try { postWithSession(active, 'dispose', { reason: bridgeReason }, activeSceneId()) } catch { pendingDispose.acknowledge() }
        await pendingDispose.promise
        pendingDispose = null
      }
      disposingSession = null
      iframeUrl.value = ''
      bounds.value = {}
      previousScene = null
      engineReady = false
      processConfirmed = false
      status.value = 'idle'
      try { await stopBackend(active, backendReason) }
      catch (reason) { status.value = 'error'; error.value = reason instanceof Error ? reason.message : String(reason) }
    })()
    const tracked = operation.finally(() => { if (disposePromise === tracked) disposePromise = null })
    disposePromise = tracked
    return tracked
  }

  const postWithSession = (
    active: UiDesignerRendererHostSession,
    kind: UiDesignerRendererBridgeMessage['kind'],
    payload: Record<string, unknown>,
    sceneId: string,
  ) => {
    if (!options.iframe.value?.contentWindow) throw new Error('The isolated UI canvas frame is unavailable for an active renderer session.')
    const message = validateUiDesignerRendererBridgeMessage({
      version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
      sessionId: active.sessionId,
      generation: active.generation,
      sequence: clientSequence++,
      sceneId,
      kind,
      payload,
    })
    options.iframe.value.contentWindow.postMessage(message, '*')
    return true
  }

  const fail = async (reason: unknown) => {
    startEpoch += 1
    const active = session
    session = null
    disposingSession = null
    removeMessageListener()
    cancelHandshake()
    cancelHandshake = () => undefined
    if (pendingDispose) {
      pendingDispose.acknowledge()
      pendingDispose = null
    }
    status.value = 'error'
    error.value = reason instanceof Error ? reason.message : String(reason)
    iframeUrl.value = ''
    bounds.value = {}
    previousScene = null
    engineReady = false
    processConfirmed = false
    if (active) {
      try { await stopBackend(active, 'protocol-error') }
      catch (cleanupError) { error.value = `${error.value} ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}` }
    }
  }

  const start = async () => {
    const epoch = ++startEpoch
    await dispose('project-change')
    await nextTick()
    if (disposed || epoch !== startEpoch || !options.designer.canRenderCanvas || !options.designer.projectPath) return
    installMessageListener()
    status.value = 'preparing'
    error.value = ''
    diagnostics.value = []
    const generation = options.designer.projectGeneration
    try {
      const result = await options.designer.adapters.rendererHost.start(generation)
      if (disposed || epoch !== startEpoch || generation !== options.designer.projectGeneration) {
        if (result.value) await options.designer.adapters.rendererHost.stop(result.value.sessionId, 'project-change')
        return
      }
      if (result.status !== 'success' || !result.value) throw new Error(result.message)
      const started = result.value
      session = started
      hostSequence = -1
      clientSequence = 0
      revision = 0
      previousScene = null
      engineReady = false
      processConfirmed = false
      iframeUrl.value = started.iframeUrl
      status.value = 'loading'
      cancelHandshake = scheduleUiDesignerRendererHandshakeTimeout(() => {
        if (session?.sessionId === started.sessionId) void fail(new Error('The isolated UI canvas did not complete its bridge handshake in time.'))
      })
    } catch (reason) { await fail(reason) }
  }

  const maybeRun = () => {
    if (!session || !engineReady || !processConfirmed) return
    cancelHandshake()
    cancelHandshake = () => undefined
    status.value = 'running'
    syncScene()
    syncSelection()
  }

  const confirmProcess = async (active: UiDesignerRendererHostSession) => {
    try {
      const result = await options.designer.adapters.rendererHost.confirm(active.sessionId)
      if (!session || session.sessionId !== active.sessionId) return
      if (result.status !== 'success' || !result.value) throw new Error(result.message)
      processConfirmed = true
      maybeRun()
    } catch (reason) { await fail(reason) }
  }

  const messageOriginMatches = (origin: string) => {
    if (origin === 'null') return true
    try { return origin === new URL(iframeUrl.value).origin } catch { return false }
  }

  const onMessage = (event: MessageEvent) => {
    const active = session ?? disposingSession
    if (!active || !options.iframe.value?.contentWindow || event.source !== options.iframe.value.contentWindow || !messageOriginMatches(event.origin)) return
    try {
      const message = validateUiDesignerRendererBridgeMessage(event.data, {
        sessionId: active.sessionId,
        generation: active.generation,
        minimumSequence: hostSequence + 1,
      })
      hostSequence = message.sequence
      if (!session) {
        if (message.kind === 'disposed' && pendingDispose) pendingDispose.acknowledge()
        return
      }
      if (message.kind === 'hello') {
        if (message.payload.engine !== active.engine) throw new Error('The isolated UI canvas engine does not match the selected project.')
        if (!active.engineVersion || message.payload.engineVersion !== active.engineVersion) throw new Error('The isolated UI canvas engine version does not match the selected project.')
        if (!message.payload.pixiVersion) throw new Error('The isolated UI canvas did not expose the project PIXI version.')
        if (message.payload.runtimeVersion !== active.runtimeVersion) throw new Error('The isolated UI canvas loaded an incompatible MZUIRuntime version.')
        void confirmProcess(active)
      } else if (message.kind === 'ready') {
        engineReady = true
        maybeRun()
      } else if (message.kind === 'mounted' || message.kind === 'bounds') {
        if (message.payload.revision < revision) return
        bounds.value = Object.fromEntries(message.payload.bounds.map((entry) => [entry.nodeId, entry]))
      } else if (message.kind === 'diagnostic') {
        diagnostics.value = [...diagnostics.value, ...message.payload.entries].slice(-64)
        options.designer.previewDiagnostics = [...diagnostics.value]
      } else if (message.kind === 'disposed') {
        if (pendingDispose) pendingDispose.acknowledge()
      }
    } catch (reason) { void fail(reason) }
  }

  const onIframeLoad = () => {
    if (session && status.value !== 'running') status.value = 'loading'
  }

  const sendInput = (payload: Extract<UiDesignerRendererBridgeMessage, { kind: 'input' }>['payload']) => {
    if (status.value !== 'running') return
    try { post('input', payload) }
    catch (reason) { void fail(reason) }
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
    () => { void start() },
    { flush: 'post' },
  )
  const sceneStop = watch(
    () => [options.designer.document, options.designer.draftPositions, options.designer.draftRects, options.designer.draftRotations],
    syncScene,
    { deep: true, flush: 'post' },
  )
  const selectionStop = watch(() => [...options.designer.selectedIds], syncSelection, { flush: 'post' })

  onMounted(() => {
    installMessageListener()
    void start()
  })
  onBeforeUnmount(() => {
    disposed = true
    startEpoch += 1
    projectStop()
    sceneStop()
    selectionStop()
    void dispose('unload').finally(removeMessageListener)
  })

  return { status, error, iframeUrl, bounds, diagnostics, onIframeLoad, sendInput, dispose }
}
