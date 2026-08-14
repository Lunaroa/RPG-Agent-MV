import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle } from '@contract/ui-designer'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

test('rotation preview and committed document use stable integer degrees', () => {
  const designer = useUiDesigner()
  const nodeId = designer.addNode('sprite', 'node_root', { x: 96, y: 80 })!

  const preview = designer.previewNodeRotation(nodeId, -2.6026906982904165)
  assert.equal(preview, -3)
  assert.equal(designer.draftRotations.value[nodeId], -3)

  assert.equal(designer.commitDraftRotation(nodeId), true)
  const node = designer.document.value.nodes.find((candidate) => candidate.id === nodeId)!
  assert.equal(node.props.rotate, -3)
  assert.equal(designer.draftRotations.value[nodeId], undefined)
})

test('rotating a container rotates every descendant around the container center in one transaction', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root', { x: 240, y: 180 })!
  const childId = designer.addNode('sprite', containerId, { x: 264, y: 212 })!

  designer.previewNodeRotation(containerId, 90)
  assert.equal(designer.draftRotations.value[containerId], 90)
  assert.equal(designer.draftRotations.value[childId], 90)
  assert.deepEqual(designer.draftPositions.value[containerId], { x: 440, y: 140 })
  assert.deepEqual(designer.draftPositions.value[childId], { x: 408, y: 164 })

  assert.equal(designer.commitDraftRotation(containerId), true)
  const container = designer.document.value.nodes.find((candidate) => candidate.id === containerId)!
  const child = designer.document.value.nodes.find((candidate) => candidate.id === childId)!
  assert.deepEqual([container.props.x, container.props.y, container.props.rotate], [440, 140, 90])
  assert.deepEqual([child.props.x, child.props.y, child.props.rotate], [408, 164, 90])
  assert.equal(designer.draftRotations.value[childId], undefined)
  assert.equal(designer.draftPositions.value[childId], undefined)
})
