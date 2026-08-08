import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUiDesignerDraftCoordinator } from './draftCoordinator'

test('draft coordinator flushes and cancels pending edits without resurrecting discarded values', () => {
  const coordinator = createUiDesignerDraftCoordinator()
  let pending = true
  let flushed = 0
  let cancelled = 0
  coordinator.register(() => { if (pending) flushed += 1; pending = false }, {
    sceneId: 'scene-a',
    pending: () => pending,
    cancel: () => { cancelled += 1; pending = false },
  })
  assert.equal(coordinator.hasPending('scene-a'), true)
  assert.equal(coordinator.hasPending('scene-b'), false)
  coordinator.cancel('scene-a')
  assert.equal(cancelled, 1)
  assert.equal(coordinator.hasPending('scene-a'), false)
  coordinator.flush('scene-a')
  assert.equal(flushed, 0)
})

test('scene-scoped flush does not invoke an unbound editor registration', () => {
  const coordinator = createUiDesignerDraftCoordinator()
  let flushed = 0
  coordinator.register(() => { flushed += 1 }, { pending: () => true })
  coordinator.flush('scene-a')
  assert.equal(flushed, 0)
  coordinator.flush()
  assert.equal(flushed, 1)
})
