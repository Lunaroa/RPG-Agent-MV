import assert from 'node:assert/strict'
import { Point, Rect, controlsUtils } from 'fabric'
import { test } from 'vitest'
import { configureFabricScaleControls, createFabricNodeObject } from './fabricNodeFactory'
import { createDefaultNode, createUiDocument } from '../models/document'

const handleKeys = ['tl', 'mt', 'tr', 'mr', 'br', 'mb', 'bl', 'ml'] as const
const expectedByAngle = {
  0: ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'],
  45: ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'],
  90: ['nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize'],
  135: ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'],
} as const

test('all eight resize controls feed the dimension-resize gesture and rotate their cursor directions with the object', () => {
  for (const angle of [0, 45, 90, 135] as const) {
    const object = new Rect({ width: 160, height: 80, left: 0, top: 0, originX: 'center', originY: 'center', angle })
    Object.defineProperty(object, 'canvas', {
      configurable: true,
      value: { viewportTransform: [1, 0, 0, 1, 0, 0], uniformScaling: false, uniScaleKey: 'shiftKey' },
    })
    configureFabricScaleControls(object)
    const radians = angle * Math.PI / 180
    const cursors = handleKeys.map((key) => {
      const control = object.controls[key]
      const coordinate = new Point(control.x * object.width, control.y * object.height).rotate(radians)
      assert.equal(control.getActionName({} as MouseEvent, control, object), 'scale')
      return control.cursorStyleHandler({ shiftKey: false } as MouseEvent, control, object, coordinate)
    })
    assert.deepEqual(cursors, expectedByAngle[angle])
    assert.equal(object.controls.tl.actionHandler, controlsUtils.scalingEqually)
    assert.equal(object.controls.mr.actionHandler, controlsUtils.scalingX)
    assert.equal(object.controls.mt.actionHandler, controlsUtils.scalingY)
    if (angle === 0) assert.equal(cursors[2], 'nesw-resize')
  }
})

test('a locked node is not selectable and lets pointer events pass through', async () => {
  const document = createUiDocument('Scene_LockedPointer')
  const container = createDefaultNode('container', { id: 'node_box', name: 'Box', parentId: 'node_root' })
  const child = createDefaultNode('container', { id: 'node_box_inner', name: 'BoxInner', parentId: 'node_box' })
  document.nodes.push(container, child)
  document.nodes[0].children.push(container.id)
  container.children.push(child.id)
  document.zOrder.push(container.id)

  const unlocked = await createFabricNodeObject(container, null, document)
  assert.equal(unlocked.selectable, true)
  assert.equal(unlocked.evented, true)
  assert.equal(unlocked.hoverCursor, 'move')

  container.locked = true
  const locked = await createFabricNodeObject(container, null, document)
  assert.equal(locked.selectable, false)
  assert.equal(locked.evented, false)
  assert.equal(locked.hoverCursor, 'default')

  // Ancestor locking is inherited: the child is not directly locked but still
  // becomes unselectable while its parent is locked.
  const inherited = await createFabricNodeObject(child, null, document)
  assert.equal(inherited.selectable, false)
  assert.equal(inherited.evented, false)
})

test('a container with a locked descendant blocks canvas transforms so a refused commit cannot desync the view', async () => {
  const document = createUiDocument('Scene_Lock')
  const container = createDefaultNode('container', { id: 'node_box', name: 'Box', parentId: 'node_root' })
  const child = createDefaultNode('text', { id: 'node_box_label', name: 'BoxLabel', parentId: 'node_box' })
  child.locked = true
  document.nodes.push(container, child)
  document.nodes[0].children.push(container.id)
  container.children.push(child.id)
  document.zOrder.push(container.id)

  const object = await createFabricNodeObject(container, null, document)
  assert.equal(object.lockScalingX, true)
  assert.equal(object.lockScalingY, true)
  assert.equal(object.lockMovementX, true)
  assert.equal(object.lockMovementY, true)
  assert.equal(object.lockRotation, true)
  assert.equal(object.hasControls, false)
  assert.equal(object.selectable, true)

  child.locked = false
  const unlocked = await createFabricNodeObject(container, null, document)
  assert.equal(unlocked.lockScalingX, false)
  assert.equal(unlocked.hasControls, true)
})
