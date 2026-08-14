import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWindowSkinFrameLayout } from './uiWindowSkinTextbox'

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
