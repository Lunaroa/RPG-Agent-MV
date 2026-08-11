import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  UI_DESIGNER_RENDERER_BRIDGE_VERSION,
  UiDesignerRendererBridgeProtocolError,
  validateUiDesignerRendererBridgeMessage,
} from '../../../../contract/ui-designer-renderer-bridge.ts'

const baseMessage = () => ({
  version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
  sessionId: 'session_01',
  generation: 3,
  sequence: 8,
  sceneId: 'Scene_Sample',
})

test('accepts bounded renderer bridge messages for the active session', () => {
  assert.equal(UI_DESIGNER_RENDERER_BRIDGE_VERSION, '2.0.0')
  const message = {
    ...baseMessage(),
    kind: 'bounds',
    payload: {
      revision: 2,
      bounds: [{ nodeId: 'node_1', x: 10, y: 20, width: 100, height: 40, rotation: 0, visible: true, interactive: true }],
    },
  }
  const validated = validateUiDesignerRendererBridgeMessage(message, {
    sessionId: 'session_01', generation: 3, minimumSequence: 8, minimumRevision: 2, sceneId: 'Scene_Sample',
  })
  assert.equal(validated.kind, 'bounds')
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...message, payload: { ...message.payload, revision: 1 } }, {
      sessionId: 'session_01', generation: 3, minimumSequence: 8, minimumRevision: 2,
    }),
    /revision is stale/,
  )
  const exitRequest = validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'exit-request', payload: { key: 'F6' } }, {
    sessionId: 'session_01', generation: 3, minimumSequence: 8, sceneId: 'Scene_Sample',
  })
  assert.equal(exitRequest.kind, 'exit-request')
  const receipt = validateUiDesignerRendererBridgeMessage({
    ...baseMessage(), kind: 'receipt', payload: { stage: 'iframe-load', status: 'success', message: null },
  }, { sessionId: 'session_01', generation: 3, minimumSequence: 8 })
  assert.equal(receipt.kind, 'receipt')
  const fatal = validateUiDesignerRendererBridgeMessage({
    ...baseMessage(), kind: 'fatal', payload: { stage: 'mount', code: 'UI_RENDERER_MOUNT_FAILED', message: 'The isolated renderer could not mount the scene.', revision: 2 },
  }, { sessionId: 'session_01', generation: 3, minimumSequence: 8, minimumRevision: 2 })
  assert.equal(fatal.kind, 'fatal')
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'fatal', payload: { stage: 'pre-hello', code: 'BAD', message: 'invalid stage', revision: 0 } }),
    /receipt stage is unsupported/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'fatal', payload: { stage: 'ready', code: 'UI_RENDERER_READY_SIGNAL', message: 'stale', revision: 1 } }, {
      sessionId: 'session_01', generation: 3, minimumSequence: 8, minimumRevision: 2,
    }),
    /revision is stale/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'fatal', payload: { stage: 'ready', code: 'project/path', message: 'invalid code', revision: 0 } }),
    /fatal code is invalid/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'exit-request', payload: { key: 'F5' } }),
    /exit request key is unsupported/,
  )
})

test('rejects stale, oversized, unknown-field, and malformed mount messages', () => {
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), generation: 2, kind: 'disposed', payload: {} }, {
      sessionId: 'session_01', generation: 3, minimumSequence: 8,
    }),
    UiDesignerRendererBridgeProtocolError,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), extra: 'smuggled', kind: 'disposed', payload: {} }),
    /Unexpected bridge message field/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'patch', payload: { revision: 1, nodes: [{ nodeId: 'node_1', props: { value: 'x'.repeat(4_300_000) } }] } }),
    /exceeds/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'patch', payload: { revision: 1, nodes: [{ nodeId: 'node_1', props: { imagePath: path.join(os.tmpdir(), 'outside.png') } }] } }),
    /project-relative/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'patch', payload: { revision: 1, nodes: [{ nodeId: 'node_1', props: { imagePath: 'https://example.invalid/outside.png' } }] } }),
    /project-relative/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'patch', payload: { revision: 1, nodes: [{ nodeId: 'node_1', props: { imageStates: { normal: 'img/pictures/normal.png', hover: 'img/../outside.png', pressed: '', disabled: '' } } }] } }),
    /escape the project/,
  )
  assert.throws(
    () => validateUiDesignerRendererBridgeMessage({ ...baseMessage(), kind: 'mount', payload: {
      revision: 1,
      executionMode: 'authoring',
      scene: { version: '1.1.0', runtimeVersion: '>=1.1.0', meta: { sceneName: 'Scene_Sample' }, nodes: [], zOrder: [], sceneScript: { version: '2.0.0', source: '' } },
    } }),
    /sceneScript/,
  )
})
