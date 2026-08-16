import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const surfaceUrl = new URL('./UiDesignerNewSceneSurface.vue', import.meta.url)
const surface = fs.readFileSync(surfaceUrl, 'utf8')
const shell = fs.readFileSync(new URL('./UiDesignerShell.vue', import.meta.url), 'utf8')
const validation = fs.readFileSync(new URL('../models/validation.ts', import.meta.url), 'utf8')
const i18n = fs.readFileSync(new URL('../i18n.ts', import.meta.url), 'utf8')

test('new scene surface compiles and shares the runtime scene-name guard through confirmation', () => {
  const parsed = parse(surface, { filename: surfaceUrl.pathname })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'ui-designer-new-scene-surface', inlineTemplate: true }))
  assert.match(validation, /export const isValidUiDesignerSceneName = \(name: string\): boolean => \/\^Scene_\[A-Za-z0-9_\$\]\+\$\//)
  assert.match(surface, /isValidUiDesignerSceneName\(props\.draft\.name\)/)
  assert.match(surface, /:error="sceneNameError"/)
  assert.match(surface, /:disabled="!sceneNameValid"/)
  assert.match(i18n, /sceneNameInvalid: '请以 Scene_ 开头/)
  assert.match(i18n, /sceneNameInvalid: 'Start with Scene_/)
  assert.match(shell, /const created = rawDesigner\.newScene\([\s\S]*if \(created\) \{[\s\S]*surface\.value = null[\s\S]*showWelcome\.value = false/)
})
