import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultNode, createUiDocument } from '../models/document'
import { reparentNode } from '../models/tree'
import { scopeNodes } from './fabricNodeFactory'

test('canvas stacking paints the last tree sibling on top', () => {
  const document = createUiDocument('Scene_Order')
  const sprite = createDefaultNode('sprite', { id: 'node_sprite_001', name: 'Sprite_1', parentId: 'node_root' })
  const container = createDefaultNode('container', { id: 'node_container_001', name: 'Container_1', parentId: 'node_root' })
  const button = createDefaultNode('button', { id: 'node_button_001', name: 'Button_1', parentId: 'node_root' })
  document.nodes.push(sprite, container, button)
  document.nodes[0].children.push(sprite.id, container.id, button.id)

  assert.deepEqual(scopeNodes(document, 'node_root').map((node) => node.id), [sprite.id, container.id, button.id])

  const moved = reparentNode(document, button.id, sprite.id, 'before')
  assert.deepEqual(scopeNodes(moved, 'node_root').map((node) => node.id), [button.id, sprite.id, container.id])
})

test('an explicit z-index still overrides the tree stacking order', () => {
  const document = createUiDocument('Scene_ZIndex')
  const back = createDefaultNode('container', { id: 'node_container_001', name: 'Container_1', parentId: 'node_root' })
  const front = createDefaultNode('button', { id: 'node_button_001', name: 'Button_1', parentId: 'node_root' })
  back.props.zIndex = 5
  document.nodes.push(back, front)
  document.nodes[0].children.push(back.id, front.id)

  assert.deepEqual(scopeNodes(document, 'node_root').map((node) => node.id), [front.id, back.id])
})
