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

type CompiledComponent = {
  setup: (props: Record<string, unknown>, context: Record<string, unknown>) => (context: Record<string, unknown>, cache: unknown[]) => TestVNode
}

type TestAction = { type: string; code?: string }
type TestEvents = Partial<Record<string, { actions: TestAction[] }>>

function compileComponent(name: string, imports: Record<string, unknown>): CompiledComponent {
  const filename = fileURLToPath(new URL(`./${name}.vue`, import.meta.url))
  const source = fs.readFileSync(filename, 'utf8')
  const parsed = parse(source, { filename })
  assert.deepEqual(parsed.errors, [])
  const compiled = compileScript(parsed.descriptor, { id: `batch3-${name}`, inlineTemplate: true })
  const code = transformSync(compiled.content, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const module = { exports: {} as Record<string, unknown> }
  const vueRuntime = { ...Vue, resolveComponent: (componentName: string) => componentName }
  const localRequire = (id: string): unknown => {
    if (id === 'vue') return vueRuntime
    if (id in imports) return imports[id]
    throw new Error(`Unexpected compiled import: ${id}`)
  }
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
  return module.exports.default as CompiledComponent
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

const commonImports = {
  '@contract/ui-designer-script': { UI_DESIGNER_NODE_SCRIPT_COMPLETIONS: ['runtime', 'scene'] },
  '../i18n': { useUiDesignerI18n: () => ({ t: (key: string) => key }) },
  './UiCodeMirrorEditor.vue': 'UiCodeMirrorEditor',
  './UiScriptContextHint.vue': 'UiScriptContextHint',
}

test('event context changes flush the old script before switching or reordering', () => {
  const component = compileComponent('UiDesignerEvents', {
    ...commonImports,
    '../models/actions': {
      reorderEventActions: (actions: unknown[], from: number, to: number) => {
        const next = [...actions]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      },
    },
  })
  const node = Vue.reactive<{ id: string; name: string; events: TestEvents }>({
    id: 'node_a',
    name: 'Node A',
    events: { onClick: { actions: [{ type: 'script', code: 'old code' }, { type: 'none' }] } },
  })
  let pending: (() => void) | undefined
  let flushCalls = 0
  const designer = Vue.reactive({
    document: { nodes: [node] },
    scenes: [],
    validation: { valid: true, issues: [], errors: [], warnings: [] },
    preferences: { autoFormat: false },
    activeSceneId: 'scene_a',
    adapters: { code: {} },
    draftCoordinator: {},
    flushDrafts: () => { flushCalls += 1; const flush = pending; pending = undefined; flush?.() },
    setNodeEvents: (nodeId: string, events: TestEvents) => {
      const target = designer.document.nodes.find((candidate) => candidate.id === nodeId)
      if (target) target.events = events
    },
  })
  const render = component.setup({ designer, node }, { expose: () => undefined })
  let tree = render({}, [])
  const editor = findByUiId(tree, 'ui-designer-event-onClick-0-script')
  assert.ok(editor)
  assert.deepEqual(editor.props?.['completion-items'], ['runtime', 'scene', 'node_a', 'Node A'])
  const emitDraft = editor.props?.['onUpdate:modelValue']
  assert.equal(typeof emitDraft, 'function')

  pending = () => (emitDraft as (value: string) => void)('draft before event switch')
  const eventSelect = findByUiId(tree, 'ui-designer-event-select')
  ;(eventSelect?.props?.['onUpdate:modelValue'] as (eventName: string) => void)('onUpdate')
  assert.equal(flushCalls, 1)
  assert.equal(node.events.onClick?.actions[0]?.code, 'draft before event switch')
  assert.equal(node.events.onUpdate, undefined)

  const secondNode = Vue.reactive<{ id: string; name: string; events: TestEvents }>({
    id: 'node_b',
    name: 'Node B',
    events: { onClick: { actions: [{ type: 'script', code: 'old code' }, { type: 'none' }] } },
  })
  pending = undefined
  flushCalls = 0
  designer.document.nodes = [secondNode]
  const secondRender = component.setup({ designer, node: secondNode }, { expose: () => undefined })
  tree = secondRender({}, [])
  const secondEditor = findByUiId(tree, 'ui-designer-event-onClick-0-script')
  const secondEmitDraft = secondEditor?.props?.['onUpdate:modelValue'] as (value: string) => void
  pending = () => secondEmitDraft('draft before reorder')
  const moveDown = findByUiId(tree, 'ui-designer-event-onClick-0-move-down')
  ;(moveDown?.props?.onClick as () => void)()
  assert.equal(flushCalls, 1)
  assert.equal(secondNode.events.onClick.actions[1]?.type, 'script')
  assert.equal(secondNode.events.onClick.actions[1]?.code, 'draft before reorder')
})

test('condition sibling drafts merge through the live document before a structure change', () => {
  const component = compileComponent('UiConditionEditor', commonImports)
  const staleCondition = { type: 'and' as const, children: [{ type: 'code' as const, code: 'old first' }, { type: 'code' as const, code: 'old second' }] }
  const node = Vue.reactive({ id: 'node_condition', condition: structuredClone(staleCondition) })
  const emitted: unknown[] = []
  let flushPending = () => undefined
  const designer = Vue.reactive({
    document: { nodes: [node] },
    selectedNode: node,
    validation: { valid: true, issues: [], errors: [], warnings: [] },
    preferences: { autoFormat: false },
    activeSceneId: 'scene_a',
    adapters: { code: {} },
    draftCoordinator: {},
    flushDrafts: () => flushPending(),
  })
  const render = component.setup({ condition: staleCondition, designer, path: 'condition' }, {
    expose: () => undefined,
    emit: (event: string, condition: typeof staleCondition) => {
      if (event !== 'update') return
      node.condition = JSON.parse(JSON.stringify(condition)) as typeof staleCondition
      emitted.push(condition)
    },
  })
  const tree = render({}, [])
  const firstChild = findByUiId(tree, 'ui-designer-condition-condition-child-0')
  const secondChild = findByUiId(tree, 'ui-designer-condition-condition-child-1')
  flushPending = () => {
    ;(firstChild?.props?.onUpdate as (condition: unknown) => void)({ type: 'code', code: 'draft first' })
    ;(secondChild?.props?.onUpdate as (condition: unknown) => void)({ type: 'code', code: 'draft second' })
  }
  const addChild = findByUiId(tree, 'ui-designer-condition-add-child')
  ;(addChild?.props?.onClick as () => void)()
  assert.deepEqual(emitted.at(-1), {
    type: 'and',
    children: [{ type: 'code', code: 'draft first' }, { type: 'code', code: 'draft second' }, { type: 'none' }],
  })
})

test('Inspector keys script editors by selected node identity', () => {
  const filename = fileURLToPath(new URL('./UiDesignerInspector.vue', import.meta.url))
  const source = fs.readFileSync(filename, 'utf8')
  assert.match(source, /UiDesignerEvents[^>]+:key="`events-\$\{selectedNode\.id\}`"/)
  assert.match(source, /UiDesignerConditions[^>]+:key="`condition-\$\{selectedNode\.id\}`"/)
})
