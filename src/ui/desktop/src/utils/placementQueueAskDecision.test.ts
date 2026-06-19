import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  isPlacementQueueReviewAsk,
  resolvePlacementQueueDecision,
} from './placementQueueAskDecision.ts'

describe('placementQueueAskDecision', () => {
  const ask = {
    questions: [{
      id: '应用到待放置队列？',
      header: '事件预览',
      question: '应用到待放置队列？',
      options: [
        { id: '应用', label: '应用' },
        { id: '调整', label: '调整' },
        { id: '取消', label: '取消' },
      ],
    }],
  }

  test('detects placement queue review ask', () => {
    assert.equal(isPlacementQueueReviewAsk(ask), true)
    assert.equal(isPlacementQueueReviewAsk({ questions: [{ id: 'q1', question: '选哪个地图？', options: [] }] }), false)
  })

  test('classifies apply / revise / cancel answers', () => {
    assert.equal(
      resolvePlacementQueueDecision(ask, { '应用到待放置队列？': { selected: ['应用'], other: '' } }),
      'apply',
    )
    assert.equal(
      resolvePlacementQueueDecision(ask, { '应用到待放置队列？': { selected: ['调整'], other: '' } }),
      'revise',
    )
    assert.equal(
      resolvePlacementQueueDecision(ask, { '应用到待放置队列？': { selected: ['取消'], other: '' } }),
      'cancel',
    )
  })

  test('classifies freeform placement feedback as revise', () => {
    assert.equal(
      resolvePlacementQueueDecision(ask, { '应用到待放置队列？': { selected: ['__other__'], other: '第二个事件台词太现代' } }),
      'revise',
    )
  })
})
