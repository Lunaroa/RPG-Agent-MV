import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isProductPluginEnabled,
  normalizeProductPluginSettings,
} from './product-plugin.ts'

test('normalizes product plugin state without dropping future ids', () => {
  assert.deepEqual(
    normalizeProductPluginSettings({
      ' ui-designer ': true,
      future: false,
      empty: 'yes',
      '': true,
    }),
    { 'ui-designer': true, future: false },
  )
  assert.deepEqual(normalizeProductPluginSettings({}, true), {})
  assert.equal(normalizeProductPluginSettings(null), undefined)
})

test('missing product plugin state is disabled by default', () => {
  assert.equal(isProductPluginEnabled(undefined, 'ui-designer'), false)
  assert.equal(isProductPluginEnabled(undefined, 'unlimited-map-layers'), false)
  assert.equal(isProductPluginEnabled({ 'ui-designer': false }, 'ui-designer'), false)
  assert.equal(isProductPluginEnabled({ 'ui-designer': true }, 'ui-designer'), true)
  assert.equal(isProductPluginEnabled({ 'unlimited-map-layers': true }, 'unlimited-map-layers'), true)
})
