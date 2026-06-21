/**
 * Run: node --experimental-strip-types --test src/utils/askHistory.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildAskHistoryPairs } from './askHistory.ts'
import type { Ask } from './askParser.ts'

function submittedAsk(patch: Partial<Ask>): Ask {
  return {
    askId: 'ask-1',
    type: 'clarify',
    title: '确认',
    prompt: '要继续吗？',
    ...patch,
    result: {
      submittedAt: '2026-06-13T00:00:00.000Z',
      ...(patch.result || {}),
    },
  }
}

describe('buildAskHistoryPairs', () => {
  test('keeps unanswered asks as cards', () => {
    assert.deepEqual(buildAskHistoryPairs({
      askId: 'ask-1',
      type: 'clarify',
      title: '确认',
      prompt: '要继续吗？',
    }, 'zh-CN'), [])
  })

  test('renders clarify as one question and answer', () => {
    assert.deepEqual(buildAskHistoryPairs(submittedAsk({
      result: { answer: '继续' },
    }), 'zh-CN'),[{ question: '要继续吗？', answer: '继续' }])
  })

  test('splits multi-choice answers in original order', () => {
    const pairs = buildAskHistoryPairs(submittedAsk({
      type: 'multi-choice-clarify',
      questions: [
        { id: 'drafts', question: '稿件怎么处理？', options: [{ id: 'discard', label: '全部废稿' }] },
        { id: 'report', question: '报告做到什么程度？', options: [{ id: 'count', label: '只报总行数' }] },
      ],
      result: {
        answers: {
          drafts: { selected: ['discard'], other: '' },
          report: { selected: ['count'], other: '' },
        },
      },
    }), 'zh-CN')
    assert.deepEqual(pairs, [
      { question: '稿件怎么处理？', answer: '全部废稿' },
      { question: '报告做到什么程度？', answer: '只报总行数' },
    ])
  })

  test('renders action asks as plain history', () => {
    assert.equal(buildAskHistoryPairs(submittedAsk({
      type: 'plan-approval',
      result: { decision: 'revise', feedback: '缩小范围' },
    }), 'zh-CN')[0].answer, '要求修改计划：缩小范围')

    assert.equal(buildAskHistoryPairs(submittedAsk({
      type: 'map-selection',
      result: { decision: 'use-existing', selectedMapId: 3 },
    }), 'zh-CN')[0].answer, '使用现有地图 #3')

    assert.match(buildAskHistoryPairs(submittedAsk({
      type: 'event-placement-list',
      events: [{ contractId: 'intro', eventName: '开场', targetMapId: 1, status: 'placed', placedEventId: 2, x: 4, y: 5 }],
      result: { placed: true },
    }), 'zh-CN')[0].answer, /开场：已放置到 Map1 \(4, 5\)/)

    assert.equal(buildAskHistoryPairs(submittedAsk({
      type: 'production-board',
      result: { decision: 'confirmed' },
    }), 'zh-CN')[0].answer, '确认制作清单')
  })

  test('renders action asks in English mode', () => {
    assert.equal(buildAskHistoryPairs(submittedAsk({
      type: 'plan-approval',
      result: { decision: 'revise', feedback: 'reduce scope' },
    }), 'en-US')[0].answer, 'Requested plan changes: reduce scope')

    assert.equal(buildAskHistoryPairs(submittedAsk({
      type: 'map-selection',
      result: { decision: 'use-existing', selectedMapId: 3 },
    }), 'en-US')[0].answer, 'Use existing map #3')

    assert.match(buildAskHistoryPairs(submittedAsk({
      type: 'event-placement-list',
      events: [{ contractId: 'intro', eventName: 'Intro', targetMapId: 1, status: 'placed', placedEventId: 2, x: 4, y: 5 }],
      result: { placed: true },
    }), 'en-US')[0].answer, /Intro: placed on Map1 \(4, 5\)/)

    assert.equal(buildAskHistoryPairs(submittedAsk({
      type: 'production-board',
      result: { decision: 'confirmed' },
    }), 'en-US')[0].answer, 'Confirmed production board')
  })
})
