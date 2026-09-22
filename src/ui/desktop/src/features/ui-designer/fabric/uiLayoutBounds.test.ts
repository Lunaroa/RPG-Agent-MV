import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ActiveSelection, Point } from 'fabric'
import { createFabricNodeObject, positionFabricNodeFromRect } from './fabricNodeFactory'
import { UiLayoutTextbox } from './uiLayoutTextbox'
import { createDefaultNode, createUiDocument } from '../models/document'
import { nodeRect, nodeVisualRect } from '../models/geometry'

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

test('layout bounds ignore decorative stroke across scale anchor rotation and resize', async () => {
  for (const type of ['container', 'overlay', 'progressBar', 'particle', 'list'] as const) {
    for (const scale of [1, 1.5, 3]) {
      for (const anchor of [0, 0.5, 1]) {
        for (const rotation of [0, 30, 90, 180, 270]) {
          const document = createUiDocument()
          const node = createDefaultNode(type, { id: 'box', name: 'Box', parentId: 'node_root', x: 160, y: 120, width: 100, height: 60 })
          Object.assign(node.props, { scaleX: scale, scaleY: scale, anchorX: anchor, anchorY: anchor, rotate: rotation })
          document.nodes.push(node)
          document.nodes[0].children.push(node.id)
          const object = await createFabricNodeObject(node, null, document)
          const expected = nodeVisualRect(node)
          const actual = object.getBoundingRect()
          near(actual.left, expected.x)
          near(actual.top, expected.y)
          near(actual.width, expected.width)
          near(actual.height, expected.height)
          positionFabricNodeFromRect(object, node, document, nodeRect(node))
          near(object.getBoundingRect().width, expected.width)
          object.dispose()
        }
      }
    }
  }
})

test('layout bounds stay exact when bordered containers enter and leave a multi selection', async () => {
  const document = createUiDocument()
  const a = createDefaultNode('container', { id: 'a', name: 'A', parentId: 'node_root', x: 40, y: 40, width: 100, height: 60 })
  const b = createDefaultNode('container', { id: 'b', name: 'B', parentId: 'node_root', x: 200, y: 40, width: 100, height: 60 })
  document.nodes.push(a, b)
  document.nodes[0].children.push(a.id, b.id)
  const objects = await Promise.all([a, b].map((node) => createFabricNodeObject(node, null, document)))
  const selection = new ActiveSelection(objects)
  assert.deepEqual(selection.getBoundingRect(), { left: 40, top: 40, width: 260, height: 60 })
  selection.removeAll()
  assert.deepEqual(objects[0].getBoundingRect(), { left: 40, top: 40, width: 100, height: 60 })
  for (const object of objects) object.dispose()
  selection.dispose()
})

test('layout bounds use the text box dimensions rather than glyph outline width', () => {
  // No font rasterizer is needed to exercise Fabric's real geometry methods.
  const object = Object.create(UiLayoutTextbox.prototype) as UiLayoutTextbox
  Object.assign(object, { width: 100, height: 60, scaleX: 2, scaleY: 3, skewX: 0, skewY: 0, strokeWidth: 4, strokeUniform: false })
  assert.deepEqual(object._getTransformedDimensions(), new Point(200, 180))
  assert.deepEqual(object._getNonTransformedDimensions(), new Point(100, 60))
  assert.equal(object.strokeWidth, 4)
})
