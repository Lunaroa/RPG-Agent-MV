import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCompleteSlashCommand,
  isSlashInput,
  parseSlashSubmit,
  shouldOpenSlashPopover,
} from './chatSlashInput.ts'

const commands = [
  { name: 'tokens' },
  { name: 'help' },
  { name: 'compact' },
]

test('parseSlashSubmit detects slash commands', () => {
  assert.deepEqual(parseSlashSubmit('/tokens'), { kind: 'slash', command: 'tokens', args: '' })
  assert.deepEqual(parseSlashSubmit('/compact now'), { kind: 'slash', command: 'compact', args: 'now' })
})

test('parseSlashSubmit keeps normal messages', () => {
  assert.deepEqual(parseSlashSubmit('hello'), { kind: 'message', text: 'hello' })
  assert.deepEqual(parseSlashSubmit('see /tokens later'), { kind: 'message', text: 'see /tokens later' })
})

test('shouldOpenSlashPopover only for slash-only input', () => {
  assert.equal(shouldOpenSlashPopover('/'), true)
  assert.equal(shouldOpenSlashPopover('/tok'), true)
  assert.equal(shouldOpenSlashPopover('/tokens please'), false)
})

test('isCompleteSlashCommand matches registered commands without args', () => {
  assert.equal(isCompleteSlashCommand('/tokens', commands), true)
  assert.equal(isCompleteSlashCommand('/tokens ', commands), true)
  assert.equal(isCompleteSlashCommand('/tok', commands), false)
  assert.equal(isCompleteSlashCommand('/tokens extra', commands), false)
})

test('isSlashInput detects slash-prefixed input', () => {
  assert.equal(isSlashInput('/tokens'), true)
  assert.equal(isSlashInput('  /help'), true)
  assert.equal(isSlashInput('hello'), false)
})
