import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { normalizeUiDesignerProjectRelativeResourcePath } from '@contract/ui-designer-resources'
import { createUiDesignerDraftCoordinator } from '../composables/draftCoordinator'

function mountReference(editable = true) {
  const source = fs.readFileSync(new URL('./UiResourceReferenceControl.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'resource-reference' })
  const code = transformSync(compiled.content, { loader: 'ts', format: 'cjs' }).code
  const cleanups: Array<() => void> = []
  const localRequire = (id: string): unknown => {
    if (id === 'vue') return { ...Vue, onBeforeUnmount: (callback: () => void) => cleanups.push(callback) }
    if (id === '@element-plus/icons-vue') return { Close: {} }
    if (id === '@contract/ui-designer-resources') return { normalizeUiDesignerProjectRelativeResourcePath }
    if (id === '../i18n') return { useUiDesignerI18n: () => ({ t: (key: string) => key }) }
    throw new Error(`Unexpected import: ${id}`)
  }
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
  const draftCoordinator = createUiDesignerDraftCoordinator()
  const props = Vue.reactive({ modelValue: 'img/ui/normal.png', sceneId: 'scene_a', nodeId: 'button_a', editable, draftCoordinator })
  const updates: Array<[string, string?]> = []
  const scope = Vue.effectScope()
  const state = scope.run(() => module.exports.default.setup(props, {
    expose: () => undefined,
    emit: (event: string, value?: string) => updates.push([event, value]),
  }))
  return { props, state, updates, draftCoordinator, dispose: () => { cleanups.forEach((fn) => fn()); scope.stop() } }
}

test('resource path editing commits once, normalizes paths, cancels and flushes before save', () => {
  const editor = mountReference()
  try {
    editor.state.input('img\\ui\\hover.png')
    assert.deepEqual(editor.updates, [])
    assert.equal(editor.draftCoordinator.hasPending(), true)
    editor.draftCoordinator.flush()
    editor.state.commit()
    assert.deepEqual(editor.updates, [['change', 'img/ui/hover.png']])
    editor.state.input('img/ui/cancelled.png')
    editor.state.cancel()
    editor.state.commit()
    assert.equal(editor.updates.length, 1)
    editor.state.input('')
    editor.state.commit()
    assert.deepEqual(editor.updates[1], ['change', ''])
  } finally { editor.dispose() }
})

test('resource path editing rejects outside-project references without silently saving the old value', async () => {
  const editor = mountReference()
  try {
    editor.state.input('../outside.png')
    editor.state.commit()
    assert.deepEqual(editor.updates, [])
    assert.equal(editor.state.error.value, 'resourceDropInvalid')
    assert.throws(() => editor.draftCoordinator.flush(), /resourceDropInvalid/)
    editor.props.nodeId = 'button_b'
    await Vue.nextTick()
    assert.equal(editor.draftCoordinator.hasPending(), false)
    editor.draftCoordinator.flush()
    assert.deepEqual(editor.updates, [])
  } finally { editor.dispose() }
  assert.equal(editor.draftCoordinator.hasPending(), false)
})

test('resource path editing is opt-in and keeps other resource controls read-only', () => {
  const editor = mountReference(false)
  try {
    editor.state.input('img/ui/changed.png')
    editor.draftCoordinator.flush()
    assert.deepEqual(editor.updates, [])
    assert.equal(editor.state.draft.value, 'img/ui/normal.png')
  } finally { editor.dispose() }
})
