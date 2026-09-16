import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle } from '@contract/ui-designer'
import { nodeRect } from '../models/geometry'

vi.mock('../adapters', () => ({ createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }) }))
import { useUiDesigner } from './useUiDesigner'

const free = { preserveAspect: false, fromCenter: false }

test('resize uses peer alignment feedback and clears it on moving away, disabling snap and commit', () => {
  const designer = useUiDesigner()
  const id = designer.addNode('sprite', 'node_root', { x: 100, y: 100 })!
  const peerId = designer.addNode('sprite', 'node_root', { x: 300, y: 300 })!
  const node = designer.document.value.nodes.find((entry) => entry.id === id)!
  const origin = nodeRect(node)
  designer.setGridEnabled(false)
  designer.setSnapEnabled(true)
  const resize = (right: number) => designer.previewNodeResizeWithSnap(id, origin, 'e', { x: right - origin.x - origin.width, y: 0 }, free)!
  assert.equal(resize(297).x + designer.draftRects.value[id]!.width, 300)
  assert.ok(designer.snapFeedback.value?.lines.some((line) => line.axis === 'x' && line.position === 300 && line.source === 'node'))
  assert.equal(designer.document.value.nodes.find((entry) => entry.id === peerId)!.props.x, 300)
  resize(283)
  assert.equal(designer.snapFeedback.value, null)
  designer.setSnapEnabled(false)
  assert.equal(resize(297).width, 197)
  assert.equal(designer.snapFeedback.value, null)
  designer.setSnapEnabled(true)
  resize(297)
  assert.equal(designer.commitDraftRect(id), true)
  assert.equal(designer.snapFeedback.value, null)
  assert.equal(designer.document.value.nodes.find((entry) => entry.id === id)!.props.width, 200)
  designer.undo()
  assert.equal(designer.document.value.nodes.find((entry) => entry.id === id)!.props.width, origin.width)
})

test('resize honors grid and guide switches without reporting a line rejected by parent clipping', () => {
  const designer = useUiDesigner()
  const parentId = designer.addNode('container', 'node_root', { x: 0, y: 0 })!
  const id = designer.addNode('sprite', parentId, { x: 0, y: 0 })!
  const parent = designer.document.value.nodes.find((entry) => entry.id === parentId)!
  const node = designer.document.value.nodes.find((entry) => entry.id === id)!
  const origin = nodeRect(node)
  designer.setSnapEnabled(true)
  designer.setGridEnabled(true)
  designer.document.value.canvas.grid.size = 32
  const grid = designer.previewNodeResizeWithSnap(id, origin, 'e', { x: 190 - origin.width, y: 0 }, free)!
  assert.equal(grid.width, 192)
  designer.setGridEnabled(false)
  designer.document.value.guides.push({ id: 'sample_guide', type: 'vertical', position: 244, locked: false })
  const guide = designer.previewNodeResizeWithSnap(id, origin, 'e', { x: 242 - origin.width, y: 0 }, free)!
  assert.equal(guide.width, 244)
  assert.deepEqual(designer.snapFeedback.value?.guideIds, ['sample_guide'])
  const currentParent = designer.document.value.nodes.find((entry) => entry.id === parentId)!
  if (currentParent.type !== 'container') throw new Error('Expected container')
  currentParent.props.clip = true
  const clipped = designer.previewNodeResizeWithSnap(id, origin, 'e', { x: 242 - origin.width, y: 0 }, free)!
  assert.equal(clipped.width, parent.props.width)
  assert.equal(designer.snapFeedback.value, null)
})
