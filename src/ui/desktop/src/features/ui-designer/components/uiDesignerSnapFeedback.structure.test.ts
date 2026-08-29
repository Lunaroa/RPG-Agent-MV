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

test('drag snapping draws transient alignment lines while resize stays continuous', () => {
  const canvas = compile('UiDesignerCanvas.vue')
  const controller = read('../composables/useUiDesigner.ts')
  const factory = read('../fabric/fabricNodeFactory.ts')
  const geometry = read('../models/geometry.ts')

  assert.match(canvas, /class="canvas-snap-line"/)
  assert.match(canvas, /snapFeedback\?\.lines \?\? \[\]/)
  assert.match(canvas, /snapFeedback\?\.guideIds\.includes\(guide\.id\)/)
  assert.match(canvas, /canvas-snap-line[^}]*border-color: #ff0000;/)
  assert.doesNotMatch(canvas, /canvas-snap-line \{[^}]*drop-shadow/)
  assert.match(canvas, /canvas-snap-line\.vertical[^}]*margin-left: -0\.5px;[^}]*border-left: 1px dashed/)
  assert.match(canvas, /canvas-snap-line\.horizontal[^}]*margin-top: -0\.5px;[^}]*border-top: 1px dashed/)
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
})
