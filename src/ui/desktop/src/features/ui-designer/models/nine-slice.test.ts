import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeNineSliceBorderValue, resolveNineSliceLayout } from './nine-slice'

test('keeps nine-slice edits finite and lays all nine regions inside the source and target', () => {
  assert.equal(normalizeNineSliceBorderValue(-4), 0)
  assert.equal(normalizeNineSliceBorderValue(Number.NaN, 7.6), 8)
  assert.equal(normalizeNineSliceBorderValue(5.4), 5)

  const layout = resolveNineSliceLayout(30, 20, 12, 8, {
    left: 20,
    right: 20,
    top: 15,
    bottom: 15,
  })
  assert.equal(layout.horizontal.length, 3)
  assert.equal(layout.vertical.length, 3)
  assert.equal(layout.horizontal.reduce((total, segment) => total + segment.sourceSize, 0), 30)
  assert.equal(layout.horizontal.reduce((total, segment) => total + segment.targetSize, 0), 12)
  assert.equal(layout.vertical.reduce((total, segment) => total + segment.sourceSize, 0), 20)
  assert.equal(layout.vertical.reduce((total, segment) => total + segment.targetSize, 0), 8)
  assert.ok(layout.horizontal.every((segment) => segment.sourceSize >= 0 && segment.targetSize >= 0))
  assert.ok(layout.vertical.every((segment) => segment.sourceSize >= 0 && segment.targetSize >= 0))
})
