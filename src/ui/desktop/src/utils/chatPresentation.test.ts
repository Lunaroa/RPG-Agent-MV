/**
 * Run: node --experimental-strip-types --test src/utils/chatPresentation.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { ChatSegment } from '../composables/useSessionStream.ts'
import {
  adaptiveRevealCount,
  advanceChatPresentation,
  isChatPresentationDrained,
  pendingChatPresentationSegmentId,
  syncChatPresentation,
} from './chatPresentation.ts'

function segment(type: ChatSegment['type'], id: string, content = ''): ChatSegment {
  return { type, id, content, timestamp: 1 }
}

describe('chat presentation pipeline', () => {
  test('restored history is displayed immediately', () => {
    const source = [
      segment('user', 'u1', '继续'),
      segment('reasoning', 'r1', '检查工程'),
      segment('text', 'a1', '完成'),
    ]
    const displayed = syncChatPresentation([], source, false)
    assert.deepEqual(displayed, source)
    assert.equal(isChatPresentationDrained(displayed, source), true)
  })

  test('holds later steps until the current typed segment catches up', () => {
    const source = [
      segment('user', 'u1', '继续'),
      segment('reasoning', 'r1', '检查工程状态'),
      segment('tool', 't1'),
      segment('text', 'a1', '最终回复'),
    ]
    let displayed = syncChatPresentation([source[0]], source, true)
    assert.deepEqual(displayed.map((item) => item.id), ['u1', 'r1'])
    assert.equal(displayed[1]?.content, '')

    while (displayed.length < source.length) {
      displayed = advanceChatPresentation(displayed, source)
      if (displayed.at(-1)?.id === 'a1') break
    }

    assert.deepEqual(displayed.map((item) => item.id), ['u1', 'r1', 't1', 'a1'])
    assert.equal(displayed[1]?.content, source[1]?.content)
    assert.equal(displayed[3]?.content, '')
  })

  test('queues terminal steps until pending text is fully revealed', () => {
    const source = [
      segment('text', 'a1', '这是一段需要逐步显示的最终回复'),
      segment('status', 'st1'),
      segment('meta', 's1'),
    ]
    let displayed = syncChatPresentation([], source, true)
    assert.deepEqual(displayed.map((item) => item.id), ['a1'])

    while (!isChatPresentationDrained(displayed, source)) {
      displayed = advanceChatPresentation(displayed, source)
    }

    assert.deepEqual(displayed.map((item) => item.id), ['a1', 'st1', 's1'])
  })

  test('reconciles replaced snapshots without duplicating content', () => {
    const displayed = [segment('text', 'a1', 'hello old')]
    const source = [segment('text', 'a1', 'hello new result')]
    const synced = syncChatPresentation(displayed, source, true)
    assert.equal(synced[0]?.content, 'hello ')
    assert.equal(pendingChatPresentationSegmentId(synced, source), 'a1')
  })

  test('accelerates when another pipeline step is waiting', () => {
    assert.ok(adaptiveRevealCount(100, true) > adaptiveRevealCount(100, false))
  })
})
