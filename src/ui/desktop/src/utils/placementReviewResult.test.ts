/**
 * Run: node --experimental-strip-types --test src/utils/placementReviewResult.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  buildPlacementReviewAnswers,
  formatPlacementReviewAnswer,
  placementReviewDecision,
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
    const answer = formatPlacementReviewAnswer(actions, '整体语气再朴素一点')
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
})
