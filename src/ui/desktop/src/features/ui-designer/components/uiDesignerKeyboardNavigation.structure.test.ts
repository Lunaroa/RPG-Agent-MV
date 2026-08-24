import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const canvasSource = fs.readFileSync(new URL('./UiDesignerCanvas.vue', import.meta.url), 'utf8')
const fabricSource = fs.readFileSync(new URL('./UiDesignerFabricCanvas.vue', import.meta.url), 'utf8')

test('authoring canvas reserves arrows for editing and does not navigate node focus', () => {
  const parsed = parse(canvasSource, { filename: 'UiDesignerCanvas.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'ui-designer-keyboard-navigation', inlineTemplate: true }))
  assert.doesNotMatch(canvasSource, /navigationDirectionFromKey/)
  assert.doesNotMatch(canvasSource, /navigateSelection/)
})

test('fabric selection keeps model stacking and exposes only activation and thumbnail capture to the authoring shell', () => {
  assert.match(fabricSource, /preserveObjectStacking: true/)
  assert.doesNotMatch(fabricSource, /bringObjectToFront/)
  assert.match(fabricSource, /defineExpose\(\{ activateNode, captureThumbnail \}\)/)
})
