import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle } from '@contract/ui-designer'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

test('multi-selection context actions copy, delete, show, hide, lock and unlock the full selection', () => {
  const designer = useUiDesigner()
  const firstId = designer.addNode('text', 'node_root')!
  const secondId = designer.addNode('button', 'node_root')!
  designer.selectNodes([firstId, secondId])

  assert.equal(designer.executeNodeAction('toggleVisibility', firstId), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.props.visible, false)
  assert.equal(designer.document.value.nodes.find((node) => node.id === secondId)?.props.visible, false)
  designer.undo()
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.props.visible, true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === secondId)?.props.visible, true)

  designer.selectNodes([firstId, secondId])
  assert.equal(designer.executeNodeAction('toggleLock', firstId), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.locked, true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === secondId)?.locked, true)
  assert.equal(designer.executeNodeAction('toggleLock', firstId), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.locked, false)
  assert.equal(designer.document.value.nodes.find((node) => node.id === secondId)?.locked, false)

  assert.equal(designer.executeNodeAction('duplicate', firstId), true)
  assert.equal(designer.selectedIds.value.length, 2)
  assert.equal(designer.document.value.nodes.filter((node) => node.id !== 'node_root').length, 4)

  designer.selectNodes([firstId, secondId])
  assert.equal(designer.executeNodeAction('delete', firstId), true)
  assert.equal(designer.document.value.nodes.some((node) => node.id === firstId || node.id === secondId), false)
})
