import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultNode } from './document'
import { localResizeNodeRect, nodeRect, resizeHandlePoint, snapRect, type SnapOptions, type UiResizeHandle } from './geometry'

const options: SnapOptions = { enabled: true, gridEnabled: false, gridSize: 16, smartEnabled: true, sensitivity: 6, guides: [] }
const free = { preserveAspect: false, fromCenter: false }
const nodeFor = () => createDefaultNode('sprite', { id: 'node_sample', name: 'Sample', parentId: 'node_root', x: 200, y: 160, width: 100, height: 60 })

test('resize snapping aligns all eight handles and leaves the opposite handle fixed', () => {
  const handles: UiResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const opposite: Record<UiResizeHandle, UiResizeHandle> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' }
  for (const handle of handles) {
    const node = nodeFor()
    const origin = nodeRect(node)
    const hasX = /[ew]/.test(handle)
    const hasY = /[ns]/.test(handle)
    const wanted = localResizeNodeRect(node, origin, handle, hasX ? 140 : 100, hasY ? 90 : 60, false)
    const target = resizeHandlePoint(wanted, handle, node)
    const requested = localResizeNodeRect(node, origin, handle, hasX ? 138 : 100, hasY ? 88 : 60, false)
    const result = snapRect(requested, origin, handle, free, {
      ...options,
      guides: [
        { id: 'vertical', type: 'vertical', position: target.x, locked: false },
        { id: 'horizontal', type: 'horizontal', position: target.y, locked: false },
      ],
    }, node)
    assert.deepEqual({ x: result.x, y: result.y, width: result.width, height: result.height }, wanted, handle)
    assert.deepEqual(resizeHandlePoint(result, opposite[handle], node), resizeHandlePoint(origin, opposite[handle], node), handle)
    assert.equal(result.hits.length, Number(hasX) + Number(hasY), handle)
  }
})

test('center resizing does not double the drag delta with or without a snap', () => {
  const node = nodeFor()
  const origin = nodeRect(node)
  const requested = localResizeNodeRect(node, origin, 'e', 138, 60, true)
  const modifiers = { ...free, fromCenter: true }
  const continuous = snapRect(requested, origin, 'e', modifiers, options, node)
  assert.equal(continuous.width, 138)
  const result = snapRect(requested, origin, 'e', modifiers, { ...options, guides: [{ id: 'v', type: 'vertical', position: 320, locked: false }] }, node)
  assert.equal(result.x + result.width, 320)
  assert.equal(result.x + result.width / 2, origin.x + origin.width / 2)
})

test('aspect-preserving corner resize reaches the line without breaking the ratio', () => {
  const node = nodeFor()
  const origin = nodeRect(node)
  const requested = localResizeNodeRect(node, origin, 'se', 138, 82.8, false)
  const result = snapRect(requested, origin, 'se', { ...free, preserveAspect: true }, { ...options, guides: [{ id: 'v', type: 'vertical', position: 340, locked: false }] }, node)
  assert.equal(result.width, 140)
  assert.equal(result.height, 84)
  assert.equal(result.x, origin.x)
  assert.equal(result.y, origin.y)
  assert.equal(result.hits[0]?.value, 340)
})

test('rotated and anchored resize snaps the world handle while retaining local-axis geometry', () => {
  for (const rotation of [30, 90, 135, 270]) {
    const node = nodeFor()
    node.props.rotate = rotation
    node.props.anchorX = 0.5
    node.props.anchorY = 0.5
    const origin = nodeRect(node)
    const requested = localResizeNodeRect(node, origin, 'se', 139, 89, false)
    const point = resizeHandlePoint(requested, 'se', node)
    const target = { x: Math.round(point.x) + 1, y: Math.round(point.y) + 1 }
    const result = snapRect(requested, origin, 'se', free, { ...options, guides: [
      { id: 'v', type: 'vertical', position: target.x, locked: false },
      { id: 'h', type: 'horizontal', position: target.y, locked: false },
    ] }, node)
    const next = resizeHandlePoint(result, 'se', node)
    assert.ok(Math.abs(next.x - target.x) <= 1, String(rotation))
    assert.ok(Math.abs(next.y - target.y) <= 1, String(rotation))
    const fixed = resizeHandlePoint(result, 'nw', node)
    const originalFixed = resizeHandlePoint(origin, 'nw', node)
    assert.ok(Math.hypot(fixed.x - originalFixed.x, fixed.y - originalFixed.y) <= 1, String(rotation))
    for (const hit of result.hits) assert.equal(Math.round(next[hit.axis]), hit.value)
  }
})

test('disabled snapping and near-parallel sides do not jump, and canvas hits carry feedback', () => {
  const node = nodeFor()
  const origin = nodeRect(node)
  const requested = localResizeNodeRect(node, origin, 'e', 138, 60, false)
  const result = snapRect(requested, origin, 'e', free, { ...options, canvasWidth: 340 }, node)
  assert.equal(result.x + result.width, 340)
  assert.deepEqual(result.hits, [{ axis: 'x', value: 340, source: 'canvas' }])
  assert.equal(snapRect(requested, origin, 'e', free, { ...options, enabled: false, canvasWidth: 340 }, node).width, 138)
  node.props.rotate = 89
  const rotated = localResizeNodeRect(node, origin, 'e', 138, 60, false)
  const point = resizeHandlePoint(rotated, 'e', node)
  const nearParallel = snapRect(rotated, origin, 'e', free, { ...options, guides: [{ id: 'v', type: 'vertical', position: Math.round(point.x) + 2, locked: false }] }, node)
  assert.equal(nearParallel.width, 138)
  assert.equal(nearParallel.snapped, false)
})
