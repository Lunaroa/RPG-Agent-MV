import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

test('save conflicts expose the recovery actions required by their source state', () => {
  const source = fs.readFileSync(new URL('./UiDesignerShell.vue', import.meta.url), 'utf8')
  const parsed = parse(source, { filename: 'UiDesignerShell.vue' })

  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'ui-designer-save-conflict', inlineTemplate: true }))
  assert.match(source, /designer\.saveAsConflict/)
  assert.match(source, /ui-designer-conflict-save-as/)
  assert.match(source, /v-if="!designer\.saveAsConflict"/)
  assert.match(source, /resolveFileConflict\('force'\)/)
  assert.doesNotMatch(source, /runtimeConflict|publishConflict/)
})

test('modified runtime recovery is shared by scene and global data saves', () => {
  const sources = new Map([
    ['UiDesignerShell.vue', fs.readFileSync(new URL('./UiDesignerShell.vue', import.meta.url), 'utf8')],
    ['UiDesignerGlobalDataSurface.vue', fs.readFileSync(new URL('./UiDesignerGlobalDataSurface.vue', import.meta.url), 'utf8')],
    ['UiDesignerRuntimeReplacementDialog.vue', fs.readFileSync(new URL('./UiDesignerRuntimeReplacementDialog.vue', import.meta.url), 'utf8')],
  ])
  for (const [filename, source] of sources) {
    const parsed = parse(source, { filename })
    assert.deepEqual(parsed.errors, [])
    assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `ui-designer-runtime-replacement-${filename}`, inlineTemplate: true }))
  }

  assert.match(sources.get('UiDesignerShell.vue')!, /runtimeReplacementPending/)
  assert.match(sources.get('UiDesignerGlobalDataSurface.vue')!, /replaceModifiedRuntime/)
  assert.match(sources.get('UiDesignerRuntimeReplacementDialog.vue')!, /ui-designer-runtime-replacement-confirm/)
  assert.match(sources.get('UiDesignerRuntimeReplacementDialog.vue')!, /ui-designer-runtime-replacement-cancel/)
})
