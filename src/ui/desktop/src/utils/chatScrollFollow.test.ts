/**
 * Run: node --experimental-strip-types --test src/utils/chatScrollFollow.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { CHAT_SCROLL_FOLLOW_THRESHOLD, isNearScrollBottom } from './chatScrollFollow.ts'

describe('chat scroll follow', () => {
  test('treats viewport within threshold of bottom as following', () => {
    const el = { scrollTop: 900, scrollHeight: 1000, clientHeight: 80 }
    assert.equal(isNearScrollBottom(el), true)
    assert.equal(isNearScrollBottom(el, 10), false)
  })

  test('treats scrolled-up viewport as not following', () => {
    const el = { scrollTop: 100, scrollHeight: 1000, clientHeight: 80 }
    assert.equal(isNearScrollBottom(el), false)
  })

  test('exports a sensible default threshold', () => {
    assert.ok(CHAT_SCROLL_FOLLOW_THRESHOLD >= 40)
  })
})
