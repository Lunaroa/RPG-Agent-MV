import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { profileIdFromBinding } from './profile-id.ts'

describe('profileIdFromBinding', () => {
  it('matches backend rules for deepseek flash', () => {
    assert.equal(
      profileIdFromBinding('deepseek-claude', 'deepseek-v4-flash'),
      'deepseek-claude--deepseek-v4-flash',
    )
  })

  it('keeps provider id direct and sanitizes model id', () => {
    assert.equal(
      profileIdFromBinding('deepseek-claude', 'deepseek/v4-pro'),
      'deepseek-claude--deepseek-v4-pro',
    )
  })
})
