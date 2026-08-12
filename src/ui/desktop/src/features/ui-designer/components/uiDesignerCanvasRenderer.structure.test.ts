import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const canvas = fs.readFileSync(new URL('./UiDesignerCanvas.vue', import.meta.url), 'utf8')
const node = fs.readFileSync(new URL('./UiCanvasNode.vue', import.meta.url), 'utf8')
const staticPreview = fs.readFileSync(new URL('./UiDesignerStaticNodePreview.vue', import.meta.url), 'utf8')
const propertyField = fs.readFileSync(new URL('./UiPropertyField.vue', import.meta.url), 'utf8')
const nodePanel = fs.readFileSync(new URL('./UiDesignerNodePanel.vue', import.meta.url), 'utf8')
const shell = fs.readFileSync(new URL('./UiDesignerShell.vue', import.meta.url), 'utf8')
const toolbar = fs.readFileSync(new URL('./UiDesignerToolbar.vue', import.meta.url), 'utf8')
const sceneTabs = fs.readFileSync(new URL('./UiDesignerSceneTabs.vue', import.meta.url), 'utf8')
const hostLifecycle = fs.readFileSync(new URL('../composables/useUiDesignerRendererHost.ts', import.meta.url), 'utf8')
const designerController = fs.readFileSync(new URL('../composables/useUiDesigner.ts', import.meta.url), 'utf8')
const routedView = fs.readFileSync(new URL('../../../views/UiDesignerView.vue', import.meta.url), 'utf8')

const compileComponent = (name: string) => {
  const source = fs.readFileSync(new URL(name, import.meta.url), 'utf8')
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `canvas-authoring-${name}`, inlineTemplate: true }))
}

test('authoring canvas static preview components compile', () => {
  for (const name of ['./UiDesignerCanvas.vue', './UiCanvasNode.vue', './UiDesignerStaticNodePreview.vue', './UiPropertyField.vue']) compileComponent(name)
})

test('UI designer canvas consumes the isolated runtime host and keeps stable overlay targets', () => {
  assert.match(canvas, /useUiDesignerRendererHost/)
  assert.match(canvas, /data-ui-id="ui-designer-runtime-canvas-frame"/)
  assert.doesNotMatch(canvas, /:renderer-bounds="rendererBounds"/)
  assert.match(canvas, /preview-interactive/)
  assert.match(canvas, /@error="rendererHost\.onIframeError"/)
  assert.match(canvas, /rendererFailureCode/)
  assert.match(canvas, /rendererHost\.retry\(\)/)
  assert.match(canvas, /rendererDisconnected/)
  assert.match(canvas, /data-ui-id="ui-designer-runtime-canvas-restart"/)
  assert.doesNotMatch(canvas, /rendererHost\.sendInput/)
  assert.match(node, /data-ui-id="`ui-designer-canvas-node-\$\{node\.id\}`"/)
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) assert.match(node, new RegExp(`'${handle}'`))
})

test('editor preview leaves only the canonical iframe and a minimal exit control', () => {
  assert.match(toolbar, /v-if="designer\.isPreviewing"/)
  assert.match(toolbar, /data-ui-id="ui-designer-preview-exit"/)
  assert.match(toolbar, /:disabled="!designer\.canStartPreview"/)
  assert.doesNotMatch(toolbar, /canStartGamePreview|gamePreview/)
  assert.match(shell, /UiDesignerInspector v-show="!designer\.isPreviewing"/)
  assert.match(shell, /UiDesignerSceneTabs v-show="!designer\.isPreviewing"/)
  assert.match(canvas, /v-if="!previewing" class="canvas-toolbar"/)
  assert.match(canvas, /v-if="!previewing && document\.canvas\.rulers"/)
  assert.match(canvas, /pointer-events: none/)
  assert.match(canvas, /touch-action: none/)
})

test('design and code keep one mounted canvas host while committed edits synchronize automatically', () => {
  assert.match(shell, /<template v-else>[\s\S]*UiDesignerCanvas v-show="designer\.editingMode === 'design' \|\| designer\.isPreviewing"[\s\S]*UiDesignerCodePanel v-show="designer\.editingMode === 'code' && !designer\.isPreviewing"/)
  assert.doesNotMatch(shell, /UiDesignerCanvas v-else-if/)
  assert.match(canvas, /data-ui-id="ui-designer-canvas-refresh"/)
  assert.match(canvas, /rendererHost\.refreshCanvas\(\)/)
  assert.match(hostLifecycle, /const refreshCanvas = \(\) => \{[\s\S]*syncScene\(true\)/)
  const refresh = hostLifecycle.slice(hostLifecycle.indexOf('const refreshCanvas ='), hostLifecycle.indexOf('const cancelDraftSync ='))
  assert.doesNotMatch(refresh, /start\(/)
  assert.doesNotMatch(refresh, /status\.value = 'preparing'/)
  const sceneWatcher = hostLifecycle.slice(hostLifecycle.indexOf('const sceneStop = watch('), hostLifecycle.indexOf('const draftStop = watch('))
  assert.match(sceneWatcher, /syncScene\(sceneChanged\)/)
  const draftSync = hostLifecycle.slice(hostLifecycle.indexOf('const syncDraftGeometry ='), hostLifecycle.indexOf('const syncSelection ='))
  assert.doesNotMatch(draftSync, /options\.executionMode\(\) !== 'full-preview'/)
  assert.match(hostLifecycle, /if \(pendingMountRevision !== null\) \{\s*queueSceneSync\(forceMount\)/)
  assert.match(hostLifecycle, /const previewNeedsLatestMount = sceneSyncQueued && options\.executionMode\(\) === 'full-preview'/)
  assert.match(hostLifecycle, /syncScene\(previewNeedsLatestMount\)/)
  assert.match(hostLifecycle, /if \(!previewNeedsLatestMount\) options\.onExecutionModeReady/)
  const selectionSync = hostLifecycle.slice(hostLifecycle.indexOf('const syncSelection ='), hostLifecycle.indexOf('const stopBackend ='))
  assert.match(selectionSync, /options\.executionMode\(\) !== 'full-preview'/)
  const modeWatcher = hostLifecycle.slice(hostLifecycle.indexOf('const executionModeStop = watch('), hostLifecycle.indexOf('onMounted(() =>'))
  assert.match(modeWatcher, /syncScene\(true\)/)
  assert.match(modeWatcher, /status\.value === 'error' && !session && !disposingSession[\s\S]*void retry\(\)/)
  const previewStart = designerController.slice(designerController.indexOf('const startPreview ='), designerController.indexOf('const stopPreview ='))
  assert.ok(previewStart.indexOf('flushDrafts') < previewStart.indexOf("previewExecutionMode.value = 'full-preview'"))
  assert.doesNotMatch(previewStart, /isPreviewing\.value = true/)
  const previewReady = designerController.slice(designerController.indexOf('const acknowledgePreviewExecutionMode ='), designerController.indexOf('const failPreview ='))
  assert.ok(previewReady.indexOf("setEditingMode('design')") < previewReady.indexOf('isPreviewing.value = true'))
})

test('resource refresh follows an in-flight edit with the latest complete scene', () => {
  assert.match(hostLifecycle, /const sceneRevisionAtStart = revision[\s\S]*if \(revision !== sceneRevisionAtStart\) queueSceneSync\(true\)[\s\S]*postPendingResourceRefresh\(\)/)
})

test('authoring renderer status remains a non-blocking hint over editable DOM overlays', () => {
  assert.doesNotMatch(canvas, /runtime-disabled/)
  assert.match(canvas, /designer\.previewStatus === 'preparing' \? 'previewPreparing' : 'canvasSyncing'/)
  assert.match(canvas, /\.canvas-runtime-state \{[^}]*top: 8px;[^}]*right: 8px;[^}]*pointer-events: none;/)
  assert.match(canvas, /\.canvas-runtime-state \.el-button \{ pointer-events: auto; \}/)
})

test('renderer host does not settle a mounted receipt from the wrong execution mode', () => {
  const messageHandlerStart = hostLifecycle.indexOf('const onMessage =')
  const mountedHandler = hostLifecycle.slice(hostLifecycle.indexOf("if (message.kind === 'mounted'", messageHandlerStart), hostLifecycle.indexOf("if (message.kind === 'scene-state'", messageHandlerStart))
  assert.match(mountedHandler, /message\.payload\.executionMode === options\.executionMode\(\)/)
  assert.match(mountedHandler, /if \(!mountedModeMatches\)/)
  assert.match(mountedHandler, /pendingMountRevision = null/)
  assert.match(mountedHandler, /status\.value = 'loading'/)
  assert.match(mountedHandler, /syncScene\(true\)/)
})

test('pre-mount host scene-state does not become a protocol fatal after mount is queued', () => {
  const messageHandler = hostLifecycle.slice(hostLifecycle.indexOf('const onMessage ='), hostLifecycle.indexOf('const onIframeLoad ='))
  assert.match(messageHandler, /const sceneStateHasDocumentIdentity = sceneStatePayload\?\.mountedDocumentSceneId !== null/)
  assert.match(messageHandler, /candidateEnvelope\?\.kind === 'scene-state' && sceneStateHasDocumentIdentity/)
  assert.match(messageHandler, /candidateEnvelope\?\.kind === 'mounted' && \(pendingMountRevision !== null \|\| mountedDocumentSceneId\.value !== null\)/)
  assert.match(messageHandler, /sceneStateHasDocumentIdentity[\s\S]*minimumRevision: revision/)
})

test('renderer restart stops any retained owner before starting a replacement session', () => {
  const retryBlock = hostLifecycle.slice(hostLifecycle.indexOf('const retry ='), hostLifecycle.indexOf('function installMessageListener'))
  assert.match(retryBlock, /session \|\| disposingSession \|\| retainedStaleSessions\.size/)
  assert.match(retryBlock, /await dispose\('scene-change', 'scene-change', true\)/)
  assert.ok(retryBlock.indexOf("await dispose('scene-change'") < retryBlock.indexOf('await start()'))
})

test('authoring canvas renders static image and text content without depending on the runtime iframe', () => {
  assert.match(node, /canvas-inline-editor/)
  assert.match(node, /UiDesignerStaticNodePreview/)
  assert.match(canvas, /resourcePreviewUrls/)
  assert.match(canvas, /authoring-frame/)
  assert.match(staticPreview, /resourcePreviewUrls/)
  assert.match(staticPreview, /backgroundImage/)
  assert.match(staticPreview, /node\.type === 'text' \|\| node\.type === 'button'/)
  assert.match(staticPreview, /node\.props\.content/)
  assert.match(staticPreview, /node\.type === 'video'/)
  assert.match(staticPreview, /node\.type === 'particle'/)
  assert.match(staticPreview, /particleDots/)
  assert.doesNotMatch(canvas, /konva|fabric|pixi\.js/i)
})

test('sprite resource selection carries intrinsic dimensions into one controller transaction', () => {
  assert.match(designerController, /const setSpriteResource =/)
  assert.match(designerController, /node\.props\.width = normalizeGeometryInteger\(dimensions\.width/)
  assert.match(designerController, /node\.props\.height = normalizeGeometryInteger\(dimensions\.height/)
  assert.match(designerController, /replaceActiveDocument\(next, 'Select sprite image'/)
})

test('nested nodes do not light every ancestor and parent bounds constrain transforms', () => {
  assert.doesNotMatch(node, /\.canvas-node:hover/)
  assert.match(designerController, /clampNodePositionToParent/)
  assert.match(designerController, /clampNodeRectToParent/)
})

test('bounded number sliders keep both end thumbs inside the inspector column', () => {
  assert.match(propertyField, /\.number-control :deep\(\.el-slider\)[^{]*\{[^}]*box-sizing: border-box;[^}]*padding-inline: 10px;/)
})

test('rapid project generations serialize disposal before the newest host start', () => {
  assert.match(hostLifecycle, /if \(disposePromise\) \{\s*if \(!coordinatePendingStarts \|\| disposeCoordinatesPendingStarts\) return disposePromise/)
  const disposeIndex = hostLifecycle.indexOf("await dispose('project-change', 'project-change', false)")
  const startIndex = hostLifecycle.indexOf('rendererAdapter.start(generation)')
  assert.ok(disposeIndex >= 0 && startIndex > disposeIndex)
  assert.match(hostLifecycle, /epoch !== startEpoch/)
  assert.match(hostLifecycle, /cancelMountedWatchdog = scheduleUiDesignerRendererHandshakeTimeout/)
  assert.match(hostLifecycle, /messageKind === 'receipt'/)
  assert.match(hostLifecycle, /messageKind === 'fatal'/)
  assert.doesNotMatch(hostLifecycle, /UI_RENDERER_CLIENT_FAILURE/)
  assert.match(hostLifecycle, /const fail = \(acceptedFailure: UiDesignerRendererFailure\)/)
  assert.match(hostLifecycle, /if \(failurePromise\) return failurePromise/)
  assert.match(hostLifecycle, /terminalGate\.accept\(message\)/)
  assert.doesNotMatch(hostLifecycle, /payload\.status === 'error'\) void fail/)
  assert.doesNotMatch(hostLifecycle, /error\.value = reason instanceof Error \? reason\.message/)
  assert.match(canvas, /rendererDisconnected/)
  assert.doesNotMatch(canvas, /rendererStage} \(\$\{rendererStageStatus/)
})

test('scene synchronization assigns fixed codes to export plan post snapshot and selection failures', () => {
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.sceneExport, stage\.value/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.updatePlan, stage\.value/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.mountPost, 'mount'/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.patchPost, stage\.value/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.sceneSnapshot, stage\.value/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.selectionPost, stage\.value/)
  assert.doesNotMatch(hostLifecycle, /void fail\(reason\)|await fail\(reason\)/)
})

test('both ten second renderer watchdogs report distinct fixed codes and stages', () => {
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.handshakeTimeout, stage\.value/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.mountedTimeout, 'mounted'/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.handshakeWatchdog, 'iframe-load'/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.mountedWatchdog, 'mounted'/)
})

test('start confirm and iframe terminals enter the shared latch with fixed safe codes', () => {
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.startAdapter, 'start'/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.startResult, 'start'/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.confirmIpc, 'confirm'/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.confirmIdentity, 'confirm'/)
  assert.match(hostLifecycle, /UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES\.iframeLoad, 'iframe-load'/)
  assert.match(hostLifecycle, /if \(terminalFailure\) void fail\(terminalFailure\)/)
  assert.match(hostLifecycle, /void fail\(resolveUiDesignerRendererFailure\('UI_RENDERER_BRIDGE_PROTOCOL', stage\.value\)\)/)
  const startAndConfirm = hostLifecycle.slice(hostLifecycle.indexOf('const start = async'), hostLifecycle.indexOf('const messageOriginMatches'))
  assert.doesNotMatch(startAndConfirm, /result\.message/)
  assert.match(canvas, /:data-failure-code="rendererFailureCode \|\| undefined"/)
  assert.match(canvas, /:data-failure-stage="rendererStage"/)
  assert.match(canvas, /t\('rendererDisconnected'\)/)
})

test('stale renderer starts keep an opaque owner for a retryable stop', () => {
  assert.match(hostLifecycle, /retainedStaleSessions/)
  assert.match(hostLifecycle, /const stopStaleSession = async/)
  assert.match(hostLifecycle, /await stopStaleSession\(result\.value, rendererAdapter\)/)
  assert.match(hostLifecycle, /retainedStopPromise/)
  assert.match(hostLifecycle, /if \(!stopped && \(!session \|\| session\.sessionId === result\.value\.sessionId\)\)/)
  assert.match(hostLifecycle, /onExecutionModeError\?\.\(error\.value, true\)/)
  assert.doesNotMatch(hostLifecycle, /if \(.*stale.*\)\s*session = result\.value/)
  assert.match(hostLifecycle, /previous isolated UI canvas session was kept/)
})

test('renderer scene sync waits for the iframe handshake and mounted revision', () => {
  assert.match(hostLifecycle, /!engineReady \|\| !processConfirmed \|\| !iframeLoaded/)
  const pendingMountGate = hostLifecycle.indexOf('if (pendingMountRevision !== null) {')
  const nextRevision = hostLifecycle.indexOf('revision = update.revision', pendingMountGate)
  assert.ok(pendingMountGate >= 0 && nextRevision > pendingMountGate)
  assert.match(hostLifecycle, /post\('mount',[\s\S]*pendingMountRevision = revision/)
  assert.match(hostLifecycle, /message\.kind === 'mounted'[\s\S]*pendingMountRevision = null[\s\S]*syncScene\(previewNeedsLatestMount\)/)
  assert.match(hostLifecycle, /!executionModeReady\.value/)
  assert.match(hostLifecycle, /update\.kind === 'patch' && !executionModeReady\.value/)
  assert.match(hostLifecycle, /iframeLoaded = true[\s\S]*maybeRun\(\)/)
  assert.match(hostLifecycle, /options\.designer\.runtimeDiagnostics = \[\]/)
})

test('preview keeps scene tabs and controller activation locked to the captured scene', () => {
  assert.match(sceneTabs, /if \(designer\.isPreviewing\) return/)
  assert.match(designerController, /const activateScene = \(sceneId: string\) => \{\s*if \(previewOccupied\.value\) return false/)
  const contextBarrier = designerController.indexOf('const previewWasOccupied = previewOccupied.value')
  const contextDiscardPrompt = designerController.indexOf('options.confirmDiscard()', contextBarrier)
  assert.ok(contextBarrier >= 0 && contextDiscardPrompt > contextBarrier)
})

test('route teardown waits for the renderer owner before leaving the designer', () => {
  assert.match(routedView, /disposePreview\('unload'\)/)
  assert.match(routedView, /if \(shellRef\.value && !\(await shellRef\.value\.disposePreview\('unload'\)\)\) return false/)
  assert.match(shell, /if \(rawDesigner\.isPreviewing\.value\) rawDesigner\.stopPreview\(\)/)
  assert.match(shell, /disposePreview\('unload'\)\.then\(\(\) => restorePreviewState\(\)\)/)
})

test('scene-state fatal keeps the route barrier on one active owner and retries backend cleanup', () => {
  assert.match(hostLifecycle, /if \(session \|\| disposingSession\) actorDisposed = true/)
  assert.match(hostLifecycle, /if \(!actorTerminal && actorDisposed\) actorTerminal = true/)
  assert.match(hostLifecycle, /if \(messageKind === 'fatal'\) \{[\s\S]*terminalGate\.accept\(message\)[\s\S]*actorDisposed = true\s*pendingDispose\?\.acknowledge\(\)/)
  assert.match(hostLifecycle, /onExecutionModeError\?\.\(recoveryReason, !terminal\)/)
  assert.match(designerController, /const previewCleanupPending = ref\(false\)/)
  assert.match(designerController, /previewCleanupPending\.value \|\| previewDisposalInFlight\.value \|\| previewStatus\.value === 'preparing'/)
  assert.match(designerController, /failPreview = \(message = '', cleanupPending = false\)/)
})

test('terminal retry preserves the fixed cause through cleanup and resets only before a new owner starts', () => {
  assert.match(hostLifecycle, /const outcome = failureLatch\.accept\(candidate\)[\s\S]*if \(outcome\.accepted\) \{\s*failureCode\.value = outcome\.failure\.code\s*failureRecoveryReason\.value = outcome\.failure\.recoveryReason/)
  assert.match(hostLifecycle, /const authoritativeFailure = latchFailure\(acceptedFailure\)/)
  assert.match(hostLifecycle, /if \(terminalFailure\) latchFailure\(terminalFailure\)/)
  assert.match(hostLifecycle, /const terminal = await dispose\('shutdown', 'protocol-error', false\)/)
  const cleanupBarrier = hostLifecycle.indexOf("if (!await stopRetainedStaleSessions())")
  const gateReset = hostLifecycle.indexOf('terminalGate.reset()', cleanupBarrier)
  const rendererStart = hostLifecycle.indexOf('rendererAdapter.start(generation)', gateReset)
  assert.ok(cleanupBarrier >= 0 && gateReset > cleanupBarrier && rendererStart > gateReset)
  assert.match(hostLifecycle, /failureCode\.value = null\s*failureRecoveryReason\.value = ''/)
})

test('stop failures preserve a retryable disposer through unmount', () => {
  assert.match(hostLifecycle, /void dispose\('unload'\)\s*\.then\(\(barrierOk\) =>/)
  assert.match(hostLifecycle, /pendingStarts\.add\(pendingStart\)/)
  assert.match(hostLifecycle, /pendingStarts\.delete\(pendingStart\)/)
  assert.match(hostLifecycle, /pendingStartCleanup = true\s*await waitForPendingStarts\(\)/)
  assert.match(hostLifecycle, /if \(pendingStartCleanup\) return true/)
  assert.match(hostLifecycle, /const currentOk = await currentDispose\s*await waitForPendingStarts\(\)/)
  assert.match(hostLifecycle, /if \(disposed && coordinatePendingStarts\)/)
  assert.match(hostLifecycle, /if \(pendingStartCleanup \|\| queuedDisposePromise \|\| disposeCoordinatesPendingStarts\) return/)
  assert.match(hostLifecycle, /if \(barrierOk\) \{[\s\S]*unregisterPreviewDisposer\(\)[\s\S]*removeMessageListener\(\)/)
  assert.doesNotMatch(hostLifecycle, /\.finally\(unregisterPreviewDisposer\)/)
})

test('project and route cleanup await active and retained owners before terminal success', () => {
  const activeStop = hostLifecycle.indexOf('await stopBackend(active, backendReason, activeAdapter)')
  const retainedStop = hostLifecycle.indexOf('if (!await stopRetainedStaleSessions())', activeStop)
  const authoringReady = hostLifecycle.indexOf("options.onExecutionModeReady?.('authoring')", retainedStop)
  const terminalSuccess = hostLifecycle.indexOf('return true', authoringReady)
  assert.ok(activeStop >= 0 && retainedStop > activeStop)
  assert.ok(authoringReady > retainedStop && terminalSuccess > authoringReady)
  assert.match(hostLifecycle, /if \(!await stopRetainedStaleSessions\(\)\) \{\s*status\.value = 'error'[\s\S]*return false/)
  assert.match(hostLifecycle, /if \(!active\) \{\s*const ok = await stopRetainedStaleSessions\(\)/)
  assert.match(hostLifecycle, /stopBackend\(owner\.session, 'project-change', owner\.adapter\)/)
  assert.match(designerController, /const previewDisposalInFlight = ref\(false\)/)
  assert.match(designerController, /if \(previewDisposePromise\) return previewDisposePromise/)
  assert.match(designerController, /previewCleanupPending\.value \|\| previewDisposalInFlight\.value/)
  assert.match(shell, /previewDisposalInFlight\.value/)
  assert.match(routedView, /previewDisposalInFlight/)
})

test('preview restores the existing tree expansion state through the Element Plus tree owner', () => {
  assert.match(nodePanel, /defineExpose\(\{ getExpandedKeys, setExpandedKeys \}\)/)
  assert.match(nodePanel, /@node-expand="rememberExpanded"/)
  assert.match(nodePanel, /@node-collapse="rememberCollapsed"/)
  assert.match(nodePanel, /type === 'before' \|\| type === 'prev'/)
  assert.match(nodePanel, /type === 'after' \|\| type === 'next'/)
  assert.match(shell, /expandedNodeIds: nodePanelRef\.value\?\.getExpandedKeys\(\)/)
  assert.match(shell, /setExpandedKeys\(snapshot\.expandedNodeIds\)/)
})
