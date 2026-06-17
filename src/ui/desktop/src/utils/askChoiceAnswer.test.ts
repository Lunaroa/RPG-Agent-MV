/**
 * Run: node --experimental-strip-types --test src/utils/askChoiceAnswer.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  buildClarifySingleSelectPayload,
  buildMultiSelectMccAnswer,
  buildSingleSelectMccAnswer,
} from './askChoiceAnswer.ts'

describe('buildSingleSelectMccAnswer', () => {
  test('radio option only', () => {
    assert.deepEqual(buildSingleSelectMccAnswer('full', ''), {
      selected: ['full'],
      other: '',
    })
  })

  test('adjustment text wins without clearing the visible positive selection', () => {
    assert.deepEqual(buildSingleSelectMccAnswer('full', '自定义路径'), {
      selected: ['__other__'],
      other: '自定义路径',
    })
  })

  test('empty selection', () => {
    assert.deepEqual(buildSingleSelectMccAnswer('', ''), { selected: [], other: '' })
    assert.deepEqual(buildSingleSelectMccAnswer('__other__', ''), { selected: [], other: '' })
  })
})

describe('buildMultiSelectMccAnswer', () => {
  test('adjustment text wins and clearing it restores positive selections', () => {
    assert.deepEqual(buildMultiSelectMccAnswer(['a'], '说明'), {
      selected: ['__other__'],
      other: '说明',
    })
    assert.deepEqual(buildMultiSelectMccAnswer(['a'], ''), {
      selected: ['a'],
      other: '',
    })
  })
})

describe('buildClarifySingleSelectPayload', () => {
  test('rejects empty selection', () => {
    assert.equal(buildClarifySingleSelectPayload('', ''), null)
  })

  test('adjustment text can be submitted without a positive selection', () => {
    assert.deepEqual(buildClarifySingleSelectPayload('', '换一种做法'), {
      selected: ['__other__'],
      other: '换一种做法',
    })
  })
})
