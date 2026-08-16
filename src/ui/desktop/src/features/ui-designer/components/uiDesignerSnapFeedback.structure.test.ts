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
  const geometry = read('../models/geometry.ts')

  assert.match(canvas, /class="canvas-snap-line"/)
  assert.match(canvas, /snapFeedback\?\.lines \?\? \[\]/)
  assert.match(canvas, /snapFeedback\?\.guideIds\.includes\(guide\.id\)/)
  assert.match(canvas, /canvas-snap-line\.vertical[^}]*dashed/)
  assert.match(canvas, /canvas-snap-line\.horizontal[^}]*dashed/)
  assert.match(canvas, /canvas-guide\.snapped \{ opacity: 1/)

  assert.match(geometry, /export interface UiSnapHit/)
  assert.match(geometry, /export function snapFeedbackFor/)
  assert.match(geometry, /pushFinite\(x, rect\.x, undefined, 'node', target\.id\)/)

  assert.match(controller, /const snapFeedback = ref<UiSnapFeedback \| null>\(null\)/)
  assert.match(controller, /snapFeedbackFor\(/)
  assert.doesNotMatch(controller, /\bsnapRect\b/)
})
