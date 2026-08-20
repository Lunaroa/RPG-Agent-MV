import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWindowSkinBackgroundRect, resolveWindowSkinFrameLayout } from './uiWindowSkinTextbox'

test('window skin frame keeps RPG Maker source cells while fitting small and large buttons', () => {
  const large = resolveWindowSkinFrameLayout(240, 72)
  assert.deepEqual(large.horizontal.map((segment) => segment.sourceSize), [24, 48, 24])
  assert.deepEqual(large.vertical.map((segment) => segment.sourceSize), [24, 48, 24])
  assert.equal(large.horizontal.reduce((sum, segment) => sum + segment.targetSize, 0), 240)
  assert.equal(large.vertical.reduce((sum, segment) => sum + segment.targetSize, 0), 72)

  const small = resolveWindowSkinFrameLayout(30, 18)
  assert.equal(small.horizontal.reduce((sum, segment) => sum + segment.targetSize, 0), 30)
  assert.equal(small.vertical.reduce((sum, segment) => sum + segment.targetSize, 0), 18)
  assert.ok(small.horizontal.every((segment) => segment.targetSize >= 0))
  assert.ok(small.vertical.every((segment) => segment.targetSize >= 0))
})

test('window skin background stays inside the native four-pixel frame margin', () => {
  assert.deepEqual(resolveWindowSkinBackgroundRect(240, 72), { left: -116, top: -32, width: 232, height: 64 })
  assert.deepEqual(resolveWindowSkinBackgroundRect(6, 6), { left: 1, top: 1, width: 1, height: 1 })
})
