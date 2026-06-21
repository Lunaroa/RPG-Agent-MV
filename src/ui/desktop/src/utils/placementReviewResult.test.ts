/**
 * Run: node --experimental-strip-types --test src/utils/placementReviewResult.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  buildPlacementReviewAnswers,
  formatPlacementReviewContinuationIntent,
  formatPlacementReviewAnswer,
  placementReviewDecision,
  summarizePlacementReviewActions,
  type PlacementReviewAction,
} from './placementReviewResult.ts'

const actions: PlacementReviewAction[] = [
  {
    askId: 'ask-1',
    contractId: 'event.ok',
    eventName: 'EV_OK',
    decision: 'approve',
    targetMapId: 1,
    decidedAt: '2026-06-18T00:00:00.000Z',
  },
  {
    askId: 'ask-1',
    contractId: 'event.fix',
    eventName: 'EV_FIX',
    decision: 'revise',
    feedback: '台词太现代',
    targetMapId: 2,
    decidedAt: '2026-06-18T00:01:00.000Z',
  },
]

describe('placementReviewResult', () => {
  test('summarizes mixed per-event review decisions', () => {
    assert.equal(placementReviewDecision(actions), 'revise')
    const answer = formatPlacementReviewAnswer(actions, '整体语气再朴素一点', 'zh-CN')
    assert.match(answer, /确认 1/)
    assert.match(answer, /调整 1/)
    assert.match(answer, /EV_FIX/)
    assert.match(answer, /台词太现代/)
  })

  test('writes answers under id, question, and header keys', () => {
    const answers = buildPlacementReviewAnswers({
      questions: [{
        id: 'q-placement',
        header: '事件预览',
        question: '应用到待放置队列？',
        options: [],
      }],
    }, actions)
    assert.equal(answers['q-placement']?.selected[0], '__other__')
    assert.equal(answers['应用到待放置队列？']?.selected[0], '__other__')
    assert.equal(answers['事件预览']?.selected[0], '__other__')
    assert.match(answers['应用到待放置队列？']?.other || '', /event.ok/)
  })

  test('formats English review answers and continuation intent', () => {
    const summary = summarizePlacementReviewActions(actions, 'en-US')
    const answer = formatPlacementReviewAnswer(actions, 'Overall tone should be simpler', 'en-US')
    const intent = formatPlacementReviewContinuationIntent({ askId: 'ask-1' }, actions, '', 'en-US')

    assert.equal(summary, 'approved 1, requested changes 1')
    assert.match(answer, /Pending placement events were reviewed one by one/)
    assert.match(answer, /feedback=台词太现代/)
    assert.match(intent, /manual review result for pending placement events/)
    assert.doesNotMatch(intent, /这是/)
  })
})
