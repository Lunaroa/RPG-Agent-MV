import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const canvas = fs.readFileSync(new URL('./UiDesignerCanvas.vue', import.meta.url), 'utf8')
const node = fs.readFileSync(new URL('./UiCanvasNode.vue', import.meta.url), 'utf8')
const hostLifecycle = fs.readFileSync(new URL('../composables/useUiDesignerRendererHost.ts', import.meta.url), 'utf8')

test('UI designer canvas consumes the isolated runtime host and keeps stable overlay targets', () => {
  assert.match(canvas, /useUiDesignerRendererHost/)
  assert.match(canvas, /data-ui-id="ui-designer-runtime-canvas-frame"/)
  assert.match(canvas, /:renderer-bounds="rendererBounds"/)
  assert.match(canvas, /rendererHost\.sendInput/)
  assert.match(node, /data-ui-id="`ui-designer-canvas-node-\$\{node\.id\}`"/)
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) assert.match(node, new RegExp(`'${handle}'`))
})

test('UI canvas node contains hit overlays only and no DOM content renderer', () => {
  assert.doesNotMatch(node, /<img|<video|node-content|particle-preview|progress-track|asset-image|resourceUrl|setTimeout/)
  assert.doesNotMatch(canvas, /resourceCatalog|resourceUrl|resourceByPath/)
  assert.doesNotMatch(canvas, /konva|fabric|pixi\.js/i)
})

test('rapid project generations serialize disposal before the newest host start', () => {
  assert.match(hostLifecycle, /if \(disposePromise\) return disposePromise/)
  const disposeIndex = hostLifecycle.indexOf("await dispose('project-change')")
  const startIndex = hostLifecycle.indexOf('adapters.rendererHost.start(generation)')
  assert.ok(disposeIndex >= 0 && startIndex > disposeIndex)
  assert.match(hostLifecycle, /epoch !== startEpoch/)
})
