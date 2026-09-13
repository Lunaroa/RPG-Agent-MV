import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle } from '@contract/ui-designer'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

test('locking removes editable selection while transient unlock and visibility actions remain available', () => {
  const designer = useUiDesigner()
  const firstId = designer.addNode('text', 'node_root')!
  const secondId = designer.addNode('text', 'node_root')!

  designer.selectNodes([firstId])
  assert.equal(designer.setNodeLocked(firstId, true), true)
  assert.deepEqual(designer.selectedIds.value, [])

  designer.selectNodes([firstId, secondId])
  assert.deepEqual(designer.selectedIds.value, [secondId])

  const locked = designer.document.value.nodes.find((node) => node.id === firstId)!
  const originalContent = locked.type === 'text' ? locked.props.content : ''
  designer.updateNodeProperty(firstId, 'content', 'Blocked edit')
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.props.content, originalContent)

  designer.updateNodeProperty(firstId, 'visible', false)
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.props.visible, false)
  assert.deepEqual(designer.selectedIds.value, [secondId])

  assert.equal(designer.executeNodeAction('toggleLock', firstId), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.locked, false)
  assert.deepEqual(designer.selectedIds.value, [firstId])
})

test('locking a parent removes its selected child but a container with only a locked descendant remains selectable', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root')!
  const childId = designer.addNode('text', containerId)!

  assert.equal(designer.setNodeLocked(containerId, true), true)
  assert.deepEqual(designer.selectedIds.value, [])
  designer.selectNodes([childId])
  assert.deepEqual(designer.selectedIds.value, [])

  assert.equal(designer.setNodeLocked(childId, true), true)
  assert.equal(designer.setNodeLocked(containerId, false), true)
  designer.selectNodes([containerId])
  assert.deepEqual(designer.selectedIds.value, [containerId])
  assert.equal(designer.getNodeActionPolicy(containerId).canTransform, false)
})
