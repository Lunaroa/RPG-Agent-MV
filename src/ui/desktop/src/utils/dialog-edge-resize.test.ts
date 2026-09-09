import assert from 'node:assert/strict'
import { test } from 'vitest'
import { centeredDialogTranslation, DIALOG_RESIZE_EDGES, resizeDialogFromEdge } from './dialog-edge-resize'

const constraints = { viewportWidth: 1600, viewportHeight: 1000, minWidth: 720, minHeight: 560, margin: 8 }
const origin = { left: 200, top: 100, width: 1000, height: 760 }

test('dialog edges resize like a desktop window while the opposite edge stays fixed', () => {
  assert.deepEqual(DIALOG_RESIZE_EDGES, ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])
  assert.deepEqual(resizeDialogFromEdge(origin, 'e', 100, 0, constraints), { left: 200, top: 100, width: 1100, height: 760 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'se', 120, 80, constraints), { left: 200, top: 100, width: 1120, height: 840 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'ne', 120, 60, constraints), { left: 200, top: 160, width: 1120, height: 700 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'sw', -120, 80, constraints), { left: 80, top: 100, width: 1120, height: 840 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'nw', 100, 60, constraints), { left: 300, top: 160, width: 900, height: 700 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'w', -500, 0, constraints), { left: 8, top: 100, width: 1192, height: 760 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'n', 0, -500, constraints), { left: 200, top: 8, width: 1000, height: 852 })
})

test('dialog resizing respects viewport and minimum dimensions from every side', () => {
  assert.deepEqual(resizeDialogFromEdge(origin, 'e', 1000, 0, constraints), { left: 200, top: 100, width: 1392, height: 760 })
  assert.deepEqual(resizeDialogFromEdge(origin, 's', 0, 1000, constraints), { left: 200, top: 100, width: 1000, height: 892 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'w', 900, 0, constraints), { left: 480, top: 100, width: 720, height: 760 })
  assert.deepEqual(resizeDialogFromEdge(origin, 'n', 0, 900, constraints), { left: 200, top: 300, width: 1000, height: 560 })
})

test('centered dialog translation places the resized rect at its requested viewport position', () => {
  assert.deepEqual(centeredDialogTranslation({ left: 220, top: 130, width: 1000, height: 700 }, 1600, 1000), { x: -80, y: -20 })
  assert.deepEqual(centeredDialogTranslation({ left: 8, top: 8, width: 720, height: 560 }, 1600, 1000), { x: -432, y: -212 })
})
