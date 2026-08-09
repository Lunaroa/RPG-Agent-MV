import assert from 'node:assert/strict'
import { test } from 'node:test'

import { boundedAsyncMap } from './boundedAsyncMap.ts'

test('boundedAsyncMap preserves order and caps concurrent resource requests', async () => {
  let active = 0
  let peak = 0
  const results = await boundedAsyncMap([4, 3, 2, 1, 0], 2, async (value) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => setTimeout(resolve, value))
    active -= 1
    return value * 2
  })
  assert.deepEqual(results, [8, 6, 4, 2, 0])
  assert.equal(peak, 2)
})
