import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTreeDragAutoScrollDelta } from './tree-drag-autoscroll'

test('tree drag auto-scroll is symmetric and accelerates toward each edge', () => {
  assert.equal(resolveTreeDragAutoScrollDelta(150, 100, 300), 0)
  assert.equal(resolveTreeDragAutoScrollDelta(250, 100, 300), 0)

  const upperInner = resolveTreeDragAutoScrollDelta(140, 100, 300)
  const upperEdge = resolveTreeDragAutoScrollDelta(100, 100, 300)
  const lowerInner = resolveTreeDragAutoScrollDelta(260, 100, 300)
  const lowerEdge = resolveTreeDragAutoScrollDelta(300, 100, 300)
  assert.ok(upperInner < 0)
  assert.ok(upperEdge < upperInner)
  assert.ok(lowerInner > 0)
  assert.ok(lowerEdge > lowerInner)
  assert.equal(Math.abs(upperEdge), lowerEdge)
})

test('tree drag auto-scroll stays idle outside the viewport and rejects invalid geometry', () => {
  assert.equal(resolveTreeDragAutoScrollDelta(99, 100, 300), 0)
  assert.equal(resolveTreeDragAutoScrollDelta(301, 100, 300), 0)
  assert.equal(resolveTreeDragAutoScrollDelta(Number.NaN, 100, 300), 0)
  assert.equal(resolveTreeDragAutoScrollDelta(100, 300, 100), 0)
  assert.equal(resolveTreeDragAutoScrollDelta(100, 100, 300, 0), 0)
})
