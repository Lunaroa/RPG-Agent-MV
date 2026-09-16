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
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `snap-feedback-${name}`, inlineTemplate: true }))
  return source
}

test('moving and resizing both use transient alignment feedback', () => {
  const canvas = compile('UiDesignerCanvas.vue')
  const controller = read('../composables/useUiDesigner.ts')
  const factory = read('../fabric/fabricNodeFactory.ts')
  const geometry = read('../models/geometry.ts')

  assert.match(canvas, /class="canvas-snap-line"/)
  assert.match(canvas, /snapFeedback\?\.lines \?\? \[\]/)
  assert.match(canvas, /snapFeedback\?\.guideIds\.includes\(guide\.id\)/)
  assert.match(canvas, /canvas-snap-line \{[^}]*box-shadow: 0 0 0 1px #fff;/)
  assert.doesNotMatch(canvas, /canvas-snap-line \{[^}]*drop-shadow/)
  assert.match(canvas, /canvas-snap-line\.vertical[^}]*width: 1px;[^}]*margin-left: -1px;[^}]*repeating-linear-gradient\(to bottom, #ff2d2d/)
  assert.match(canvas, /canvas-snap-line\.horizontal[^}]*height: 1px;[^}]*margin-top: -1px;[^}]*repeating-linear-gradient\(to right, #ff2d2d/)
  assert.match(canvas, /canvas-guide\.snapped \{ opacity: 1/)

  assert.match(factory, /borderColor: '#d06b42'/)
  assert.match(factory, /cornerColor: '#d06b42'/)
  assert.match(factory, /cornerStrokeColor: '#171a24'/)
  assert.match(factory, /cornerSize: 9/)
  assert.doesNotMatch(factory, /borderScaleFactor:/)

  assert.match(geometry, /export interface UiSnapHit/)
  assert.match(geometry, /export function snapFeedbackFor/)
  assert.match(geometry, /export function snapMoveRect/)
  assert.match(geometry, /pushFinite\(x, rect\.x, undefined, 'node', target\.id\)/)

  assert.match(controller, /const snapFeedback = ref<UiSnapFeedback \| null>\(null\)/)
  assert.match(controller, /snapFeedbackFor\(/)
  assert.match(controller, /snapMoveRect\(requestedBounds/)
  assert.match(controller, /snapRect\(requested, originRect, handle, modifiers, snapOptionsFor\(nodeId\), node\)/)
  assert.match(controller, /const commitDraftRect = [\s\S]{0,100}clearSnapFeedback\(\)/)
})

test('node tree paints every selected row through the native tree class contract', () => {
  const panel = compile('UiDesignerNodePanel.vue')
  assert.match(panel, /:props="\{ class:.*selectedIds\.includes\(data\.id\).*'is-selected'/)
  assert.match(panel, /\.el-tree-node\.is-selected > \.el-tree-node__content\)\s*\{[^}]*background-color:/)
  assert.match(panel, /:current-node-key="selectedIds\[0\]"/)
})

test('text wrapping is an explicit text field while button and document defaults remain unchanged', () => {
  const inspector = compile('UiDesignerInspector.vue')
  assert.match(inspector, /text: \[\.\.\.commonText, \{ key: 'wrapWidth', kind: 'number', min: 0 \}\]/)
  const factory = read('../fabric/fabricNodeFactory.ts')
  assert.match(factory, /wrapWidth: node\.type === 'text' \? node\.props\.wrapWidth : 0/)
  assert.match(read('../models/document.ts'), /wrapWidth: 0/)
})
