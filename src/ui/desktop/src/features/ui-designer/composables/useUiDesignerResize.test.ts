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

test('resizing a container changes only the container dimensions', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root', { x: 240, y: 180 })!
  const childId = designer.addNode('sprite', containerId, { x: 264, y: 212 })!
  const container = designer.document.value.nodes.find((candidate) => candidate.id === containerId)!
  const child = designer.document.value.nodes.find((candidate) => candidate.id === childId)!
  const childBefore = { ...child.props }
  const origin = nodeRect(container)

  const preview = designer.previewNodeResizeWithSnap(
    containerId,
    origin,
    'se',
    { x: 72, y: 36 },
    { preserveAspect: false, fromCenter: false },
  )!
  assert.equal(designer.draftRects.value[childId], undefined)
  assert.equal(designer.commitDraftRect(containerId), true)

  const containerAfter = designer.document.value.nodes.find((candidate) => candidate.id === containerId)!
  const childAfter = designer.document.value.nodes.find((candidate) => candidate.id === childId)!
  assert.deepEqual(nodeRect(containerAfter), preview)
  assert.deepEqual(childAfter.props, childBefore)
  assert.equal(designer.draftRects.value[childId], undefined)
})

test('resizing a list changes its complete grid extent and keeps the configured gaps', () => {
  const designer = useUiDesigner()
  const nodeId = designer.addNode('list', 'node_root', { x: 120, y: 100 })!
  const node = designer.document.value.nodes.find((candidate) => candidate.id === nodeId)!
  if (node.type !== 'list') throw new Error('expected list node')
  node.props.columns = 3
  node.props.rows = 2
  node.props.columnGap = 8
  node.props.rowGap = 6
  const origin = nodeRect(node)
  const preview = designer.previewNodeResizeWithSnap(nodeId, origin, 'se', { x: 75, y: 34 }, { preserveAspect: false, fromCenter: false })!
  assert.equal(designer.commitDraftRect(nodeId), true)

  const resized = designer.document.value.nodes.find((candidate) => candidate.id === nodeId)!
  if (resized.type !== 'list') throw new Error('expected list node')
  assert.deepEqual(nodeRect(resized), preview)
  assert.equal(resized.props.columnGap, 8)
  assert.equal(resized.props.rowGap, 6)
  assert.equal(resized.props.columnWidths.length, 3)
  assert.equal(resized.props.rowHeights.length, 2)
})

test('resizing text preserves font size and explicit scale', () => {
  const designer = useUiDesigner()
  const nodeId = designer.addNode('text', 'node_root', { x: 80, y: 60 })!
  const node = designer.document.value.nodes.find((candidate) => candidate.id === nodeId)!
  if (node.type !== 'text') throw new Error('expected text node')
  node.props.fontSize = 31
  node.props.scaleX = 1.5
  node.props.scaleY = 0.75
  const origin = nodeRect(node)

  designer.previewNodeResizeWithSnap(nodeId, origin, 'se', { x: 60, y: 30 }, { preserveAspect: false, fromCenter: false })
  assert.equal(designer.commitDraftRect(nodeId), true)

  const resized = designer.document.value.nodes.find((candidate) => candidate.id === nodeId)!
  assert.equal(resized.type, 'text')
  if (resized.type !== 'text') return
  assert.equal(resized.props.fontSize, 31)
  assert.equal(resized.props.scaleX, 1.5)
  assert.equal(resized.props.scaleY, 0.75)
})
