import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

test('save conflicts expose the recovery actions required by their source state', () => {
  const source = fs.readFileSync(new URL('./UiDesignerShell.vue', import.meta.url), 'utf8')
  const parsed = parse(source, { filename: 'UiDesignerShell.vue' })

  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'ui-designer-save-conflict', inlineTemplate: true }))
  assert.match(source, /firstSaveConflict/)
  assert.match(source, /ui-designer-conflict-save-as/)
  assert.match(source, /!designer\.runtimeConflict && !firstSaveConflict/)
  assert.match(source, /resolveFileConflict\('force'\)/)
})
