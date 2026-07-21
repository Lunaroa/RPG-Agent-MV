import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const listSource = readFileSync(new URL('./ConversationList.vue', import.meta.url), 'utf8')
const chatSource = readFileSync(new URL('../views/ChatView.vue', import.meta.url), 'utf8')
const zhSource = readFileSync(new URL('../i18n/locales/zh-CN.ts', import.meta.url), 'utf8')
const enSource = readFileSync(new URL('../i18n/locales/en-US.ts', import.meta.url), 'utf8')

describe('conversation history management', () => {
  test('keeps normal list behavior separate from management selection', () => {
    assert.match(listSource, /data-ui-id="conversation-manage"/)
    assert.match(listSource, /data-ui-id="conversation-select-all"/)
    assert.match(listSource, /data-ui-id="conversation-delete-selected"/)
    assert.match(listSource, /data-ui-id="conversation-manage-done"/)
    assert.match(listSource, /if \(managing\.value\) toggleConversation\(conversation\)/)
    assert.match(listSource, /if \(!managing\.value\) emit\('delete', conversation\)/)
    assert.match(listSource, /if \(!conversation\.batchDeletable \|\| props\.batchDeleting\) return/)
    assert.match(listSource, /selectedRootIds\.value = new Set\(\)/)
  })

  test('sends one deduplicated batch request and refreshes actual history', () => {
    assert.match(chatSource, /sessionIdsForConversations\(selectedConversations\)/)
    assert.match(chatSource, /sessionsApi\.deleteMany\(requestedSessionIds\)/)
    assert.match(chatSource, /await loadHistory\(\)/)
    assert.match(chatSource, /nearestConversationAfterDeletion/)
    assert.doesNotMatch(chatSource, /async function deleteConversations[\s\S]*for \(const sessionId of requestedSessionIds\)/)
  })

  test('ships bilingual labels and protection guidance', () => {
    for (const source of [zhSource, enSource]) {
      assert.match(source, /'conversation\.manage'/)
      assert.match(source, /'conversation\.selectAll'/)
      assert.match(source, /'conversation\.batchProtected'/)
      assert.match(source, /'chat\.delete\.batchConfirmBody'/)
      assert.match(source, /'chat\.delete\.batchPartial'/)
    }
  })
})
