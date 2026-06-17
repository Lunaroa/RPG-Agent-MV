/**
 * Run: node --experimental-strip-types --test src/utils/chatHistoryWidth.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  CHAT_HISTORY_DEFAULT_WIDTH,
  CHAT_HISTORY_MAX_WIDTH,
  CHAT_HISTORY_MIN_WIDTH,
  clampChatHistoryWidth,
  parseChatHistoryWidth,
} from './chatHistoryWidth.ts'

describe('chat history width', () => {
  test('uses the compact default when no valid width was saved', () => {
    assert.equal(parseChatHistoryWidth(null), CHAT_HISTORY_DEFAULT_WIDTH)
    assert.equal(parseChatHistoryWidth('not-a-number'), CHAT_HISTORY_DEFAULT_WIDTH)
    assert.equal(parseChatHistoryWidth('0'), CHAT_HISTORY_DEFAULT_WIDTH)
  })

  test('clamps persisted and dragged widths to the supported range', () => {
    assert.equal(parseChatHistoryWidth('120'), CHAT_HISTORY_MIN_WIDTH)
    assert.equal(parseChatHistoryWidth('520'), CHAT_HISTORY_MAX_WIDTH)
    assert.equal(clampChatHistoryWidth(319.6), 320)
  })
})
