import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultNode, createUiDocument } from './document'
import { resolveCanvasWorkspace } from './canvas-workspace'

test('editing workspace grows without imposing a coordinate limit', () => {
  const document = createUiDocument('Workspace')
  const node = createDefaultNode('text', { parentId: 'node_root' })
  node.props.x = -1_000_000
  node.props.y = 2_000_000
  document.nodes.push(node)
  document.nodes[0].children.push(node.id)

  const workspace = resolveCanvasWorkspace(document, 240)
  assert.equal(workspace.left >= 1_000_240, true)
  assert.equal(workspace.bottom >= 1_999_000, true)
  assert.equal(workspace.width, workspace.left + document.canvas.width + workspace.right)
})

test('editing workspace expands from committed geometry after a transform finishes', () => {
  const document = createUiDocument('Committed workspace')
  const node = createDefaultNode('button', { parentId: 'node_root' })
  node.props.x = 100
  node.props.y = 100
  node.props.width = 200
  node.props.height = 40
  document.nodes.push(node)
  document.nodes[0].children.push(node.id)

  const before = resolveCanvasWorkspace(document)
  node.props.x = -800
  node.props.y = -600
  node.props.rotate = 45
  const workspace = resolveCanvasWorkspace(document)
  assert.equal(before.left, 240)
  assert.equal(before.top, 240)
  assert.equal(workspace.left > 900, true)
  assert.equal(workspace.top > 700, true)
})

test('editing workspace includes in-flight positions without dropping the committed bounds', () => {
  const document = createUiDocument('In-flight workspace')
  const node = createDefaultNode('sprite', { parentId: 'node_root' })
  node.props.x = 100
  node.props.y = 100
  node.props.width = 200
  node.props.height = 100
  document.nodes.push(node)
  document.nodes[0].children.push(node.id)

  const committed = resolveCanvasWorkspace(document, 240)
  const rightAndBottom = resolveCanvasWorkspace(document, 240, { [node.id]: { x: 2_000, y: 3_000 } })
  const leftAndTop = resolveCanvasWorkspace(document, 240, { [node.id]: { x: -2_000, y: -3_000 } })

  assert.equal(rightAndBottom.left, committed.left)
  assert.equal(rightAndBottom.top, committed.top)
  assert.equal(rightAndBottom.right > committed.right, true)
  assert.equal(rightAndBottom.bottom > committed.bottom, true)
  assert.equal(leftAndTop.left > committed.left, true)
  assert.equal(leftAndTop.top > committed.top, true)
  assert.equal(leftAndTop.right, committed.right)
  assert.equal(leftAndTop.bottom, committed.bottom)
  assert.equal(node.props.x, 100)
  assert.equal(node.props.y, 100)
})
