import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultNode, createUiDocument } from './document'
import { isNodeSelectable, resolveNodeActionPolicy } from './actions'

test('selection locking follows locked ancestry without hiding an unlocked protected container', () => {
  const document = createUiDocument('Scene_SelectionLock')
  const container = createDefaultNode('container', { id: 'node_container', name: 'Container', parentId: 'node_root' })
  const child = createDefaultNode('text', { id: 'node_child', name: 'Child', parentId: container.id })
  document.nodes.push(container, child)
  document.nodes[0].children.push(container.id)
  container.children.push(child.id)

  child.locked = true
  assert.equal(isNodeSelectable(document, child.id), false)
  assert.equal(resolveNodeActionPolicy(document, [child.id], child.id, false).canSelect, false)
  assert.equal(resolveNodeActionPolicy(document, [child.id], child.id, false).allowed.toggleLock, true)

  const containerPolicy = resolveNodeActionPolicy(document, [container.id], container.id, false)
  assert.equal(containerPolicy.canSelect, true)
  assert.equal(containerPolicy.canTransform, false)

  container.locked = true
  assert.equal(isNodeSelectable(document, container.id), false)
  assert.equal(isNodeSelectable(document, child.id), false)
})

test('a node with a missing ancestor is not exposed as selectable', () => {
  const document = createUiDocument('Scene_BrokenAncestry')
  const orphan = createDefaultNode('text', { id: 'node_orphan', name: 'Orphan', parentId: 'node_missing' })
  document.nodes.push(orphan)
  assert.equal(isNodeSelectable(document, orphan.id), false)
})
