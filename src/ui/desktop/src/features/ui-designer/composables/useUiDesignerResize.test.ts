import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle } from '@contract/ui-designer'
import { nodeRect } from '../models/geometry'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

test('resize stays continuous regardless of grid and snap settings while modifiers keep their own meaning', () => {
  const designer = useUiDesigner()
  const nodeId = designer.addNode('sprite', 'node_root', { x: 96, y: 80 })!
  const node = designer.document.value.nodes.find((candidate) => candidate.id === nodeId)!
  const origin = nodeRect(node)
  const delta = { x: 13, y: 7 }

  designer.setGridEnabled(true)
  designer.setSnapEnabled(true)
  const withSnapSettings = designer.previewNodeResizeWithSnap(
    nodeId,
    origin,
    'se',
    delta,
    { preserveAspect: false, fromCenter: false },
  )!

  designer.setGridEnabled(false)
  designer.setSnapEnabled(false)
  const withoutSnapSettings = designer.previewNodeResizeWithSnap(
    nodeId,
    origin,
    'se',
    delta,
    { preserveAspect: false, fromCenter: false },
  )!

  assert.deepEqual(withSnapSettings, withoutSnapSettings)
  assert.equal(withSnapSettings.width, origin.width + delta.x)
  assert.equal(withSnapSettings.height, origin.height + delta.y)

  const shifted = designer.previewNodeResizeWithSnap(
    nodeId,
    origin,
    'e',
    { x: 13, y: 0 },
    { preserveAspect: true, fromCenter: false },
  )!
  assert.ok(Math.abs(shifted.width / shifted.height - origin.width / origin.height) < 0.02)

  const centered = designer.previewNodeResizeWithSnap(
    nodeId,
    origin,
    'se',
    { x: 10, y: 5 },
    { preserveAspect: false, fromCenter: true },
  )!
  assert.equal(centered.x, origin.x - 10)
  assert.equal(centered.y, origin.y - 5)
  assert.equal(centered.width, origin.width + 20)
  assert.equal(centered.height, origin.height + 10)
})

test('resizing a container scales its whole subtree in the same transaction', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root', { x: 240, y: 180 })!
  const childId = designer.addNode('sprite', containerId, { x: 264, y: 212 })!
  const container = designer.document.value.nodes.find((candidate) => candidate.id === containerId)!
  const child = designer.document.value.nodes.find((candidate) => candidate.id === childId)!
  const childBefore = { rotate: child.props.rotate, scaleX: child.props.scaleX, scaleY: child.props.scaleY }
  const origin = nodeRect(container)

  const preview = designer.previewNodeResizeWithSnap(
    containerId,
    origin,
    'se',
    { x: 72, y: 36 },
    { preserveAspect: false, fromCenter: false },
  )!
  assert.deepEqual(designer.draftRects.value[childId], { x: 271, y: 219, width: 208, height: 98 })
  assert.equal(designer.commitDraftRect(containerId), true)

  const containerAfter = designer.document.value.nodes.find((candidate) => candidate.id === containerId)!
  const childAfter = designer.document.value.nodes.find((candidate) => candidate.id === childId)!
  assert.deepEqual(nodeRect(containerAfter), preview)
  assert.deepEqual([childAfter.props.x, childAfter.props.y, childAfter.props.width, childAfter.props.height], [271, 219, 208, 98])
  assert.deepEqual([childAfter.props.rotate, childAfter.props.scaleX, childAfter.props.scaleY], [childBefore.rotate, childBefore.scaleX, childBefore.scaleY])
  assert.equal(designer.draftRects.value[childId], undefined)
})
