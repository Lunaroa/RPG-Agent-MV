import assert from 'node:assert/strict'
import test from 'node:test'

import type { UiNode, UiRuntimeSceneExport } from '@contract/ui-designer'
import { UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES } from '@contract/ui-designer-renderer-bridge'
import { createUiDesignerRendererDisposeAck, planUiDesignerRendererUpdate, scheduleUiDesignerRendererHandshakeTimeout, UI_DESIGNER_RENDERER_HANDSHAKE_TIMEOUT_MS } from './rendererBridge'

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
  await ack.promise
  assert.equal(settled, true)
  assert.equal(cleared, true)
  timeout?.()
  assert.equal(settled, true)
})
