import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const read = (name: string) => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
const compile = (name: string) => {
  const source = read(name)
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `acceptance-${name}`, inlineTemplate: true }))
  return source
}

test('hostile main-menu acceptance controls expose stable semantic selectors', () => {
  const help = compile('./UiDesignerHelpSurface.vue')
  const welcome = compile('./UiDesignerWelcome.vue')
  const sceneTabs = compile('./UiDesignerSceneTabs.vue')
  const newScene = compile('./UiDesignerNewSceneSurface.vue')
  const nodePanel = compile('./UiDesignerNodePanel.vue')
  const toolbar = compile('./UiDesignerToolbar.vue')
  const canvas = compile('./UiDesignerCanvas.vue')
  const inspector = compile('./UiDesignerInspector.vue')
  const buttonStates = compile('./UiButtonStatesEditor.vue')
  const events = compile('./UiDesignerEvents.vue')
  const property = compile('./UiPropertyField.vue')

  assert.match(help, /ui-designer-onboarding-dialog/)
  assert.match(help, /ui-designer-onboarding-skip/)
  assert.match(help, /ui-designer-onboarding-finish/)
  assert.match(welcome, /ui-designer-welcome-new-scene/)
  assert.match(sceneTabs, /ui-designer-scene-tab-new/)
  assert.match(sceneTabs, /ui-designer-scene-tab-\$\{scene\.id\}/)
  assert.match(newScene, /ui-designer-new-scene-dialog/)
  assert.match(newScene, /ui-designer-new-scene-name/)
  assert.match(newScene, /ui-designer-new-scene-validation/)
  assert.match(newScene, /ui-designer-new-scene-confirm/)
  assert.match(newScene, /ui-designer-new-scene-cancel/)
  assert.match(nodePanel, /ui-designer-palette-\$\{type\}/)
  assert.match(toolbar, /ui-designer-preview-enter/)
  assert.match(toolbar, /ui-designer-preview-exit/)
  assert.match(canvas, /ui-designer-runtime-canvas-restart/)
  assert.match(inspector, /ui-designer-inspector-button-content/)
  assert.match(inspector, /ui-designer-inspector-button-\$\{field\.key\}/)
  assert.match(inspector, /ui-designer-inspector-button-events/)
  assert.match(buttonStates, /\['normal', 'hover', 'pressed', 'disabled'\]/)
  for (const suffix of ['preview', 'select', 'clear']) assert.match(buttonStates, new RegExp(`ui-designer-button-state-\\$\\{state\\}-${suffix}`))
  assert.match(events, /ui-designer-event-select/)
  assert.match(events, /ui-designer-event-action-add/)
  assert.match(property, /ui-designer-resource-\$\{props\.fieldKey\}-select/)
  assert.match(property, /ui-designer-resource-\$\{props\.fieldKey\}-clear/)
})
