import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const read = (name: string) => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
const compile = (name: string) => {
  const source = read(name)
  const parsed = parse(source, { filename: name })
  assert.equal(parsed.errors.length, 0)
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `first-use-${name}`, inlineTemplate: true }))
  return source
}

test('first-use entry points and palette feedback stay unambiguous', () => {
  const toolbar = compile('./UiDesignerToolbar.vue')
  const shell = compile('./UiDesignerShell.vue')
  const nodePanel = compile('./UiDesignerNodePanel.vue')
  const messages = read('../i18n.ts')
  assert.doesNotMatch(toolbar, /ui-designer-new|emit\('newScene'\)/)
  assert.match(shell, /UiDesignerSceneTabs[\s\S]*@new-scene="openNewScene"/)
  assert.match(shell, /UiDesignerWelcome[\s\S]*@new-scene="openNewScene"/)
  assert.match(shell, /const showWelcome = ref\(true\)/)
  assert.doesNotMatch(shell, /const showWelcome = ref\(false\)/)
  assert.match(shell, /<aside v-if="!showWelcome" class="left-pane">/)
  assert.match(shell, /<UiDesignerInspector v-if="!showWelcome"/)
  assert.match(shell, /\.designer-workspace\.welcome-active \{ grid-template-columns: minmax\(0, 1fr\); \}/)
  assert.match(nodePanel, /palette-feedback/)
  assert.match(nodePanel, /designer\.addNode\(type, parentId\)/)
  assert.doesNotMatch(messages, /start from the welcome screen|从欢迎屏开始/)
})

test('button inspector prioritizes content, state resources, actions and sound', () => {
  const inspector = compile('./UiDesignerInspector.vue')
  assert.match(inspector, /button-content-primary/)
  assert.match(inspector, /button-states-priority/)
  assert.match(inspector, /button-events-priority/)
  assert.match(inspector, /button-se-priority/)
})
