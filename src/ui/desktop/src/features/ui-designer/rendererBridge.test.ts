import assert from 'node:assert/strict'
import test from 'node:test'

import type { UiDesignerDocument, UiNode, UiRuntimeDiagnostic, UiRuntimeSceneExport } from '@contract/ui-designer'
import { UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES, UI_DESIGNER_RENDERER_BRIDGE_VERSION, validateUiDesignerRendererBridgeMessage } from '@contract/ui-designer-renderer-bridge'
import { buildUiDesignerRendererDraftPatches, createUiDesignerRendererDisposeAck, planUiDesignerRendererUpdate, scheduleUiDesignerRendererHandshakeTimeout, UI_DESIGNER_RENDERER_HANDSHAKE_TIMEOUT_MS } from './rendererBridge'
import { createUiDocument } from './models/document'
import {
  UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES,
  createUiDesignerRendererFailureLatch,
  createUiDesignerRendererTerminalGate,
  reduceUiDesignerRendererHostRuntimeMessage,
  resolveUiDesignerRendererFailure,
  type UiDesignerRendererHostRuntimeState,
} from './composables/useUiDesignerRendererHost'

const node = (index: number, x = index): UiNode => ({
  id: `node_${index}`,
  name: `Node ${index}`,
  type: 'container',
  parentId: null,
  children: [],
  locked: false,
  condition: { type: 'none' },
  enterAnim: { type: 'none', duration: 0, easing: 'linear' },
  exitAnim: { type: 'none', duration: 0, easing: 'linear' },
  events: {},
  propModes: {},
  propCodes: {},
  props: {
    x, y: index, width: 100, height: 40, anchorX: 0, anchorY: 0,
    scaleX: 1, scaleY: 1, rotate: 0, opacity: 255, visible: true, zIndex: index,
    clip: false, layoutMode: 'free', padding: 0, gap: 0,
  },
} as UiNode)

const scene = (count: number): UiRuntimeSceneExport => ({
  version: '1.1.0',
  runtimeVersion: '>=1.1.0',
  meta: { sceneName: 'Scene_RendererBridge', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
  transitions: { enter: { type: 'none', duration: 0, easing: 'linear' }, exit: { type: 'none', duration: 0, easing: 'linear' } },
  globalFilter: { type: 'none', intensity: 0 },
  nodes: Array.from({ length: count }, (_, index) => node(index)),
  zOrder: Array.from({ length: count }, (_, index) => `node_${index}`),
  sceneScript: { version: '1.0.0', source: '' },
})

test('renderer planner patches bounded in-place geometry and remounts resource changes', () => {
  const previous = scene(2)
  const geometry = structuredClone(previous)
  geometry.nodes[1].props.x += 4
  assert.equal(planUiDesignerRendererUpdate(previous, geometry, 2)?.kind, 'patch')

  const resource = structuredClone(previous)
  ;(resource.nodes[1] as UiNode & { props: Record<string, unknown> }).props.path = 'img/pictures/sample.png'
  assert.equal(planUiDesignerRendererUpdate(previous, resource, 3)?.kind, 'mount')
})

test('draft geometry helper emits only local transform props and converts resize rects', () => {
  const document = { ...createUiDocument('Scene_RendererBridge'), nodes: [node(1)], zOrder: ['node_1'] } as UiDesignerDocument
  document.nodes[0].props.anchorX = 0.5
  document.nodes[0].props.anchorY = 0.25
  document.nodes[0].props.scaleX = 2
  document.nodes[0].props.scaleY = 0.5
  assert.deepEqual(
    buildUiDesignerRendererDraftPatches(document, { positions: { node_1: { x: 12, y: 20 } } }),
    [{ nodeId: 'node_1', props: { x: 12, y: 20 } }],
  )
  assert.deepEqual(
    buildUiDesignerRendererDraftPatches(document, { rects: { node_1: { x: 10, y: 20, width: 100, height: 40 } }, rotations: { node_1: 15 } }),
    [{ nodeId: 'node_1', props: { x: 60, y: 30, width: 50, height: 80, rotate: 15 } }],
  )
})

test('renderer planner remounts when 513 nodes would exceed the patch contract', () => {
  const count = UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES + 1
  const previous = scene(count)
  const next = structuredClone(previous)
  next.nodes.forEach((entry) => { entry.props.x += 1 })
  const update = planUiDesignerRendererUpdate(previous, next, 4)
  assert.equal(update?.kind, 'mount')
})

test('renderer handshake timeout is bounded and cancellable with a fake timer', () => {
  let callback: (() => void) | undefined
  let timeoutMs = 0
  let cleared = false
  let failed = false
  const cancel = scheduleUiDesignerRendererHandshakeTimeout(
    () => { failed = true },
    (next, delay) => { callback = next; timeoutMs = delay; return 17 as unknown as ReturnType<typeof setTimeout> },
    () => { cleared = true },
  )
  assert.equal(timeoutMs, UI_DESIGNER_RENDERER_HANDSHAKE_TIMEOUT_MS)
  callback?.()
  assert.equal(failed, true)
  cancel()
  assert.equal(cleared, true)
})

test('local renderer terminal entries map every fixed code to controlled recovery copy', () => {
  const expected = new Map<string, string>([
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.sceneExport, 'The editor could not prepare the current UI scene for the isolated canvas. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.updatePlan, 'The editor could not prepare the current UI scene update. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountPost, 'The editor could not send the current UI scene to the isolated canvas. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.patchPost, 'The editor could not send the latest UI scene changes to the isolated canvas. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.sceneSnapshot, 'The editor could not retain the current UI scene snapshot. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.selectionPost, 'The editor could not synchronize the current UI selection. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.handshakeTimeout, 'The isolated game frame did not finish connecting in time. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.handshakeWatchdog, 'The editor could not monitor the isolated game frame connection. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountedTimeout, 'The isolated game frame did not finish mounting the current scene in time. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountedWatchdog, 'The editor could not monitor the isolated scene mount. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.startAdapter, 'The editor could not start the isolated UI canvas. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.startResult, 'The isolated UI canvas returned an invalid start result. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIpc, 'The editor could not confirm the isolated UI canvas process. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIdentity, 'The isolated UI canvas identity did not match the active preview. Retry the preview.'],
    [UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.iframeLoad, 'The isolated game frame could not be loaded. Retry the preview.'],
  ])
  assert.equal(expected.size, Object.keys(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES).length)
  for (const [code, recoveryReason] of expected) {
    assert.deepEqual(resolveUiDesignerRendererFailure(code, 'scene-state'), { code, stage: 'scene-state', recoveryReason })
  }
})

test('handshake and mounted watchdog failures keep ten seconds and distinct code-stage pairs', () => {
  assert.equal(UI_DESIGNER_RENDERER_HANDSHAKE_TIMEOUT_MS, 10_000)
  assert.deepEqual(
    resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.handshakeTimeout, 'hello'),
    {
      code: 'UI_RENDERER_HANDSHAKE_TIMEOUT',
      stage: 'hello',
      recoveryReason: 'The isolated game frame did not finish connecting in time. Retry the preview.',
    },
  )
  assert.deepEqual(
    resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.mountedTimeout, 'mounted'),
    {
      code: 'UI_RENDERER_MOUNTED_TIMEOUT',
      stage: 'mounted',
      recoveryReason: 'The isolated game frame did not finish mounting the current scene in time. Retry the preview.',
    },
  )
})

test('renderer dispose acknowledgement settles immediately without waiting for timeout', async () => {
  let cleared = false
  let timeout: (() => void) | undefined
  const ack = createUiDesignerRendererDisposeAck(
    (callback) => { timeout = callback; return 19 as unknown as ReturnType<typeof setTimeout> },
    () => { cleared = true },
  )
  let settled = false
  void ack.promise.then(() => { settled = true })
  ack.acknowledge()
  assert.equal(await ack.promise, true)
  assert.equal(settled, true)
  assert.equal(cleared, true)
  timeout?.()
  assert.equal(settled, true)
})

test('renderer dispose acknowledgement timeout is not terminal proof', async () => {
  let timeout: (() => void) | undefined
  const ack = createUiDesignerRendererDisposeAck(
    (callback) => { timeout = callback; return 23 as unknown as ReturnType<typeof setTimeout> },
    () => undefined,
  )
  timeout?.()
  assert.equal(await ack.promise, false)
})

test('renderer host keeps full-preview ready across later bounds and diagnostic messages', () => {
  const sessionId = 'renderer-session'
  const generation = 4
  const bounds = [
    { nodeId: 'node_1', x: 10, y: 20, width: 100, height: 40, rotation: 0, visible: true, interactive: true },
    { nodeId: 'node_2', x: 30, y: 40, width: 80, height: 20, rotation: 0, visible: true, interactive: false },
  ]
  const diagnostic: UiRuntimeDiagnostic = {
    schemaVersion: '1.0.0', sessionId, scene: 'Scene_RendererBridge', file: null, node: 'node_1', type: 'button', phase: 'update', event: null,
    code: 'UI_RUNTIME_HANDLER_ERROR', severity: 'warning', label: 'runtime', message: 'A recoverable runtime diagnostic.', count: 1,
  }
  let state: UiDesignerRendererHostRuntimeState = {
    bounds: {}, diagnostics: [], executionMode: 'authoring', executionModeReady: false,
    scenePhase: 'active', requestedScene: null, actualScene: null,
  }
  let minimumSequence = 0
  const accept = (kind: 'mounted' | 'bounds' | 'diagnostic' | 'scene-state', payload: Record<string, unknown>) => {
    const message = validateUiDesignerRendererBridgeMessage({
      version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
      sessionId,
      generation,
      sequence: minimumSequence,
      sceneId: 'Scene_RendererBridge',
      kind,
      payload,
    }, { sessionId, generation, minimumSequence })
    minimumSequence += 1
    state = reduceUiDesignerRendererHostRuntimeMessage(state, message, 7, 'full-preview')
  }

  assert.doesNotThrow(() => {
    accept('mounted', { revision: 7, executionMode: 'full-preview', bounds })
    accept('bounds', { revision: 7, bounds: [{ ...bounds[0], x: 12 }] })
    accept('diagnostic', { entries: [diagnostic] })
    accept('scene-state', { phase: 'transitioning', requestedScene: 'Scene_Options', actualScene: 'Scene_RendererBridge' })
    accept('scene-state', { phase: 'active', requestedScene: null, actualScene: 'Scene_Options' })
  })
  assert.equal(state.executionMode, 'full-preview')
  assert.equal(state.executionModeReady, true)
  assert.equal(state.bounds.node_1?.x, 12)
  assert.equal(state.bounds.node_2?.x, 30)
  assert.equal(state.diagnostics[0]?.message, diagnostic.message)
  assert.equal(state.scenePhase, 'active')
  assert.equal(state.requestedScene, null)
  assert.equal(state.actualScene, 'Scene_Options')
})

test('renderer lifecycle receipts expose bounded stage failures without carrying session details', () => {
  assert.equal(UI_DESIGNER_RENDERER_BRIDGE_VERSION, '2.0.0')
  const common = { version: UI_DESIGNER_RENDERER_BRIDGE_VERSION, sessionId: 'renderer-session', generation: 4, sceneId: 'Scene_RendererBridge' }
  assert.doesNotThrow(() => validateUiDesignerRendererBridgeMessage({
    ...common, sequence: 0, kind: 'receipt', payload: { stage: 'mount', status: 'begin', message: null },
  }))
  assert.doesNotThrow(() => validateUiDesignerRendererBridgeMessage({
    ...common, sequence: 1, kind: 'fatal', payload: { stage: 'mounted', code: 'UI_RENDERER_BOOT_FAILED', message: 'The isolated renderer stopped before mounting.', revision: 7 },
  }))
})

test('receipt progress cannot terminate before the same-tick fatal atomically latches its safe code', () => {
  const common = { version: UI_DESIGNER_RENDERER_BRIDGE_VERSION, sessionId: 'renderer-session', generation: 4, sceneId: 'Scene_RendererBridge' }
  const receipt = validateUiDesignerRendererBridgeMessage({
    ...common,
    sequence: 0,
    kind: 'receipt',
    payload: { stage: 'ready', status: 'error', message: null },
  }, { sessionId: common.sessionId, generation: common.generation, minimumSequence: 0 })
  const fatal = validateUiDesignerRendererBridgeMessage({
    ...common,
    sequence: 1,
    kind: 'fatal',
    payload: {
      stage: 'ready',
      code: 'UI_RENDERER_READY_CANVAS_HOST',
      message: 'sanitized renderer detail that must not become user copy',
      revision: 0,
    },
  }, { sessionId: common.sessionId, generation: common.generation, minimumSequence: 1, minimumRevision: 0 })
  const duplicate = validateUiDesignerRendererBridgeMessage({
    ...common,
    sequence: 2,
    kind: 'fatal',
    payload: { stage: 'ready', code: 'UI_RENDERER_READY_SIGNAL', message: 'later detail', revision: 0 },
  }, { sessionId: common.sessionId, generation: common.generation, minimumSequence: 2, minimumRevision: 0 })
  const gate = createUiDesignerRendererTerminalGate()

  assert.equal(gate.accept(receipt), null)
  assert.deepEqual(gate.accept(fatal), {
    code: 'UI_RENDERER_READY_CANVAS_HOST',
    stage: 'ready',
    recoveryReason: 'The game runtime could not create the embedded canvas. Retry the preview.',
    revision: 0,
    sequence: 1,
  })
  assert.equal(gate.accept(duplicate), null)
})

test('terminal retry reset accepts a new owner and maps unknown safe codes to fixed recovery copy', () => {
  const common = { version: UI_DESIGNER_RENDERER_BRIDGE_VERSION, sessionId: 'renderer-session', generation: 4, sceneId: 'Scene_RendererBridge' }
  const fatal = validateUiDesignerRendererBridgeMessage({
    ...common,
    sequence: 0,
    kind: 'fatal',
    payload: { stage: 'ready', code: 'UI_RENDERER_UNRECOGNIZED', message: 'arbitrary project exception text', revision: 0 },
  })
  const gate = createUiDesignerRendererTerminalGate()
  const first = gate.accept(fatal)
  assert.equal(first?.recoveryReason, 'The isolated UI canvas stopped unexpectedly. Retry the preview.')
  assert.equal(first?.recoveryReason.includes('arbitrary project exception text'), false)
  gate.reset()
  assert.equal(gate.accept({ ...fatal, sequence: 1 })?.code, 'UI_RENDERER_UNRECOGNIZED')
})

test('scene-state synchronization keeps the first local cause over later iframe confirm and fatal failures', () => {
  const latch = createUiDesignerRendererFailureLatch()
  const local = resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.sceneExport, 'scene-state')
  const iframe = resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.iframeLoad, 'iframe-load')
  const confirm = resolveUiDesignerRendererFailure(UI_DESIGNER_RENDERER_LOCAL_FAILURE_CODES.confirmIpc, 'confirm')
  const renderer = resolveUiDesignerRendererFailure('UI_RENDERER_READY_CANVAS_HOST', 'ready')
  assert.deepEqual(latch.accept(local), { failure: local, accepted: true })
  assert.deepEqual(latch.accept(iframe), { failure: local, accepted: false })
  assert.deepEqual(latch.accept(confirm), { failure: local, accepted: false })
  assert.deepEqual(latch.accept(renderer), { failure: local, accepted: false })
  latch.reset()
  assert.deepEqual(latch.accept(renderer), { failure: renderer, accepted: true })
})

test('unknown renderer reasons never replace fixed user recovery copy', () => {
  const unsafeReason = 'untrusted adapter detail must stay hidden'
  const failure = resolveUiDesignerRendererFailure('UI_RENDERER_UNKNOWN_LOCAL_REASON', 'scene-state')
  assert.equal(failure.code, 'UI_RENDERER_UNKNOWN_LOCAL_REASON')
  assert.equal(failure.stage, 'scene-state')
  assert.equal(failure.recoveryReason, 'The isolated UI canvas stopped unexpectedly. Retry the preview.')
  assert.equal(failure.recoveryReason.includes(unsafeReason), false)
})

test('stale terminal session generation sequence and revision are rejected before failure mapping', () => {
  const base = {
    version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
    sessionId: 'renderer-session',
    generation: 4,
    sequence: 8,
    sceneId: 'Scene_RendererBridge',
    kind: 'fatal',
    payload: { stage: 'mount', code: 'UI_RENDERER_BRIDGE_PROTOCOL', message: 'safe', revision: 6 },
  }
  const expected = { sessionId: 'renderer-session', generation: 4, minimumSequence: 8, minimumRevision: 6 }
  assert.throws(() => validateUiDesignerRendererBridgeMessage({ ...base, sessionId: 'stale-session' }, expected), /session is stale/)
  assert.throws(() => validateUiDesignerRendererBridgeMessage({ ...base, generation: 3 }, expected), /generation is stale/)
  assert.throws(() => validateUiDesignerRendererBridgeMessage({ ...base, sequence: 7 }, expected), /sequence is stale/)
  assert.throws(() => validateUiDesignerRendererBridgeMessage({ ...base, payload: { ...base.payload, revision: 5 } }, expected), /revision is stale/)
})
