import { expect, test } from 'vitest'
import { resolveUiFabricTextPresentationSync } from './uiFabricTextPresentation'

test('Inspector content replaces stale Fabric text even while inline editing remains active', () => {
  expect(resolveUiFabricTextPresentationSync(true, 'Text', 'Live Inspector Text')).toEqual({
    shouldSync: true,
    syncEditingTextarea: true,
  })
})

test('inline typing keeps the active Fabric caret untouched when the document already agrees', () => {
  expect(resolveUiFabricTextPresentationSync(true, 'Inline Draft', 'Inline Draft')).toEqual({
    shouldSync: false,
    syncEditingTextarea: false,
  })
})

test('inactive Fabric text always accepts current document presentation', () => {
  expect(resolveUiFabricTextPresentationSync(false, 'Same', 'Same')).toEqual({
    shouldSync: true,
    syncEditingTextarea: false,
  })
})
