import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'

type TestVNode = {
  children?: TestVNode[] | Record<string, unknown> | string
  props?: Record<string, unknown>
}

type CompiledFrameList = {
  setup: (props: Record<string, unknown>, context: Record<string, unknown>) => (context: Record<string, unknown>, cache: unknown[]) => TestVNode
}

function compiledFrameListComponent(): CompiledFrameList {
  const filename = fileURLToPath(new URL('./UiFrameListEditor.vue', import.meta.url))
  const source = fs.readFileSync(filename, 'utf8')
  const parsed = parse(source, { filename })
  assert.deepEqual(parsed.errors, [])
  const compiled = compileScript(parsed.descriptor, { id: 'ui-frame-list-behavior', inlineTemplate: true })
  const code = transformSync(compiled.content, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const module = { exports: {} as Record<string, unknown> }
  const vueRuntime = { ...Vue, resolveComponent: (name: string) => name }
  const localRequire = (id: string): unknown => {
    if (id === 'vue') return vueRuntime
    if (id === '../i18n') return { useUiDesignerI18n: () => ({ t: (key: string) => key }) }
    if (id === './UiResourceReferenceControl.vue') return 'UiResourceReferenceControl'
    throw new Error(`Unexpected compiled import: ${id}`)
  }
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
  return module.exports.default as CompiledFrameList
}

function findByUiId(value: unknown, uiId: string): TestVNode | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findByUiId(child, uiId)
      if (match) return match
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const vnode = value as TestVNode
  if (vnode.props?.['data-ui-id'] === uiId) return vnode
  return Array.isArray(vnode.children) ? findByUiId(vnode.children, uiId) : undefined
}

test('frame batch resource button invokes the shared workspace picker and appends selected paths', async () => {
  const component = compiledFrameListComponent()
  let pickerCalls = 0
  const updates: unknown[] = []
  const render = component.setup({
    value: [{ id: 'frame_001', path: '', duration: 100 }],
    resources: [],
    pickResources: async () => {
      pickerCalls += 1
      return ['img/pictures/frame_b.png', 'img/pictures/frame_a.png']
    },
    resourcePickerDisabled: false,
  }, {
    emit: (event: string, value: unknown) => {
      if (event === 'update') updates.push(value)
    },
  })

  const button = findByUiId(render({}, []), 'ui-designer-frames-select-many')
  assert.ok(button)
  assert.equal(button.props?.disabled, false)
  const click = button.props?.onClick
  assert.equal(typeof click, 'function')
  ;(click as () => void)()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(pickerCalls, 1)
  assert.deepEqual(updates, [[
    { id: 'frame_001', path: '', duration: 100 },
    { id: 'frame_002', path: 'img/pictures/frame_a.png', duration: 100 },
    { id: 'frame_003', path: 'img/pictures/frame_b.png', duration: 100 },
  ]])
})
