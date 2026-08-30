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
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `named-entry-${name}`, inlineTemplate: true }))
  return source
}

test('switch and variable references show names through the system entry selector', () => {
  const field = compile('UiNamedEntryField.vue')
  const conditions = compile('UiConditionEditor.vue')
  const events = compile('UiDesignerEvents.vue')
  const settings = compile('UiDesignerSceneSettingsSurface.vue')
  const composable = read('../composables/useSystemNamedEntries.ts')

  assert.match(field, /SystemNamedEntrySelectorDialog/)
  assert.match(field, /readonly/)
  assert.match(field, /<template #append>/)
  assert.match(field, /open\(\{ kind: props\.kind, selectedId/)
  assert.match(field, /@commit="commitNamedSelection"/)
  assert.match(field, /@catalog-changed="reload"/)
  assert.match(field, /v-else/)
  assert.match(field, /Math\.max\(fallback, parsed\)/)

  assert.match(composable, /projectAssets\.editorCatalog/)
  assert.match(composable, /loadedProject/)

  for (const source of [conditions, events, settings]) {
    assert.match(source, /UiNamedEntryField/)
    assert.doesNotMatch(source, /el-input-number[^>\n]*(switchId|variableId)/)
  }
  assert.match(conditions, /kind="switch"/)
  assert.match(conditions, /kind="variable"/)
  assert.match(events, /class="set-switch-params"[\s\S]*kind="switch"[\s\S]*<el-switch/)
  assert.match(events, /actionField\(action, 'switchVal'\) !== 'toggle'/)
  assert.doesNotMatch(events, /action\.type === 'setSwitch'[\s\S]{0,500}<el-select/)
  assert.match(events, /ui-designer-event-\$\{activeEvent\}-\$\{index\}-variable/)
  assert.match(events, /ui-designer-event-\$\{activeEvent\}-\$\{index\}-switch/)
  assert.match(settings, /allow-none/)
})
