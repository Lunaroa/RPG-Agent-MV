import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'

const componentDir = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(componentDir, name), 'utf8')
const compile = (name: string, source = read(name)) => {
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `resource-reference-${name}`, inlineTemplate: true }))
  return source
}

test('resource fields clear only their local reference from a compact right-side action', () => {
  const control = compile('UiResourceReferenceControl.vue')
  const property = compile('UiPropertyField.vue')
  const buttonStates = compile('UiButtonStatesEditor.vue')
  const events = compile('UiDesignerEvents.vue')
  const frames = compile('UiFrameListEditor.vue')
  const workspace = compile('../../../components/ProjectAssetsWorkspace.vue', read('../../../components/ProjectAssetsWorkspace.vue'))
  const inspector = compile('UiDesignerInspector.vue')

  assert.match(control, /<template #append>/)
  assert.match(control, /class="resource-clear"/)
  assert.match(control, /<Close/)
  assert.match(control, /emit\('clear'\)/)
  for (const source of [property, buttonStates, events, frames]) assert.match(source, /UiResourceReferenceControl/)
  assert.doesNotMatch(workspace, /project-assets-selection-clear/)
  assert.doesNotMatch(workspace, /clear: \[\]/)
  assert.doesNotMatch(inspector, /@clear="settleResourceWorkspace/)
})
