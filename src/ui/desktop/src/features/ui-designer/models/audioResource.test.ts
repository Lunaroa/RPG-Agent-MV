import assert from 'node:assert/strict'
import test from 'node:test'

import { uiDesignerSeNameFromResourcePath } from './audioResource.ts'

test('converts managed MV and MZ SE paths to AudioManager names', () => {
  assert.equal(uiDesignerSeNameFromResourcePath('audio/se/Confirm.ogg'), 'Confirm')
  assert.equal(uiDesignerSeNameFromResourcePath('www/audio/se/ui/Confirm.m4a'), 'ui/Confirm')
})

test('rejects non-SE categories, unsupported extensions, and unsafe paths', () => {
  assert.throws(() => uiDesignerSeNameFromResourcePath('audio/bgm/Theme.ogg'), /audio\/se/)
  assert.throws(() => uiDesignerSeNameFromResourcePath('audio/se/Confirm.wav'), /\.ogg or \.m4a/)
  assert.throws(() => uiDesignerSeNameFromResourcePath('../audio/se/Confirm.ogg'), /must not escape/)
})
