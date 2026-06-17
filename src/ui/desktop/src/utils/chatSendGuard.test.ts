/**
 * Run: node --experimental-strip-types --test src/utils/chatSendGuard.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { canSubmitChatMessage, isSendDebounced } from './chatSendGuard.ts'

describe('chatSendGuard', () => {
  test('canSubmitChatMessage rejects empty or busy', () => {
    assert.equal(canSubmitChatMessage('', false), false)
    assert.equal(canSubmitChatMessage('  ', false), false)
    assert.equal(canSubmitChatMessage('hi', true), false)
    assert.equal(canSubmitChatMessage('hi', false), true)
  })

  test('isSendDebounced blocks rapid repeat within window', () => {
    assert.equal(isSendDebounced(0, 1000), false)
    assert.equal(isSendDebounced(1000, 1200), true)
    assert.equal(isSendDebounced(1000, 1301), false)
  })
})
