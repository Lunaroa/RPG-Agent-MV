import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const source = fs.readFileSync(new URL('./UiDesignerCanvas.vue', import.meta.url), 'utf8')

test('canvas viewport compiles with one native-scroll navigation model', () => {
  const parsed = parse(source, { filename: 'UiDesignerCanvas.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'ui-designer-viewport', inlineTemplate: true }))
  assert.match(source, /class="canvas-scroll-content" :style="scrollContentStyle"/)
  assert.match(source, /const scroll = panCanvasScroll\(/)
  assert.match(source, /element\.scrollLeft = scroll\.x[\s\S]*element\.scrollTop = scroll\.y/)
  assert.doesNotMatch(source, /translate\(\$\{viewport\.value\.panX/)
  assert.doesNotMatch(source, /designer\.pan\(\{ x: event\.clientX/)
})

test('Space release ends only the Space gesture and preview never inherits authoring scroll', () => {
  assert.match(source, /mode: spaceDrag \? 'space' : 'middle'/)
  assert.match(source, /if \(panning\.value\?\.mode === 'space'\) endPan\(\)/)
  assert.match(source, /if \(isPreviewing\) authoringScroll = \{ x: element\.scrollLeft, y: element\.scrollTop \}/)
  assert.match(source, /element\.scrollLeft = isPreviewing \? 0 : authoringScroll\.x/)
  assert.match(source, /element\.scrollTop = isPreviewing \? 0 : authoringScroll\.y/)
})

test('keeps drag pan available when the canvas fits the viewport', () => {
  assert.match(source, /previewing\.value \? 0 : canvasPanRoom\(viewportSize\.value\.width\)/)
  assert.match(source, /previewing\.value \? 0 : canvasPanRoom\(viewportSize\.value\.height\)/)
  assert.match(source, /element\.scrollLeft = scrollLayout\.value\.centerScrollX/)
  assert.match(source, /\.canvas-viewport::-webkit-scrollbar \{ display: none; \}/)
  assert.doesNotMatch(source, /scrollLeft = 0; element\.scrollTop = 0/)
})
