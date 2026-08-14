import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canvasScrollForWorldPoint,
  createCanvasScrollLayout,
  fitCanvasZoom,
  panCanvasScroll,
} from './viewport-navigation'

test('keeps both canvas edges reachable at low and high zoom', () => {
  const low = createCanvasScrollLayout(1000, 700, 816, 624, 0.25, 46)
  assert.equal(low.contentWidth, 1000)
  assert.equal(low.stageOffsetX, 398)

  const high = createCanvasScrollLayout(1000, 700, 816, 624, 2, 46)
  assert.equal(high.contentWidth, 1724)
  assert.equal(high.stageOffsetX, 46)
  assert.deepEqual(canvasScrollForWorldPoint(high, { x: 0, y: 0 }, { x: 46, y: 46 }, 2), { x: 0, y: 0 })
  assert.equal(canvasScrollForWorldPoint(high, { x: 816, y: 0 }, { x: 954, y: 46 }, 2).x, 724)
})

test('pans native scroll from the gesture origin and clamps without unreachable negative space', () => {
  const layout = createCanvasScrollLayout(800, 600, 816, 624, 2, 46)
  assert.deepEqual(panCanvasScroll(layout, { x: 300, y: 200 }, { x: 120, y: -80 }), { x: 180, y: 280 })
  assert.deepEqual(panCanvasScroll(layout, { x: 0, y: 0 }, { x: 500, y: 500 }), { x: 0, y: 0 })
  assert.deepEqual(panCanvasScroll(layout, { x: 0, y: 0 }, { x: -5000, y: -5000 }), { x: 924, y: 740 })
})

test('keeps a drag pan gutter reachable when the canvas fits the viewport', () => {
  const layout = createCanvasScrollLayout(1200, 800, 816, 624, 1, 46, 240, 240)
  assert.equal(layout.contentWidth, 1680)
  assert.equal(layout.stageOffsetX, 432)
  assert.deepEqual([layout.centerScrollX, layout.centerScrollY], [240, 240])
  assert.deepEqual(panCanvasScroll(layout, { x: 240, y: 240 }, { x: -100, y: 0 }), { x: 340, y: 240 })
  assert.deepEqual(panCanvasScroll(layout, { x: 240, y: 240 }, { x: 300, y: -600 }), { x: 0, y: 480 })
  assert.equal(panCanvasScroll(layout, { x: 240, y: 240 }, { x: -5000, y: -5000 }).x, 480)
})

test('extends the gutter beyond the stage at high zoom without losing either canvas edge', () => {
  const layout = createCanvasScrollLayout(1000, 700, 816, 624, 2, 46, 240, 240)
  assert.deepEqual([layout.contentWidth, layout.stageOffsetX], [2204, 286])
  assert.equal(canvasScrollForWorldPoint(layout, { x: 0, y: 0 }, { x: 286, y: 286 }, 2).x, 0)
  assert.equal(canvasScrollForWorldPoint(layout, { x: 816, y: 0 }, { x: 954, y: 286 }, 2).x, 964)
})

test('keeps the no-gutter layout centered and unscrollable for backward compatibility', () => {
  const layout = createCanvasScrollLayout(1200, 800, 816, 624, 1, 46)
  assert.deepEqual([layout.contentWidth, layout.stageOffsetX], [1200, 192])
  assert.deepEqual([layout.centerScrollX, layout.centerScrollY], [0, 0])
})

test('fits the full scene with deterministic margins', () => {
  assert.equal(fitCanvasZoom(1000, 700, 816, 624, 46), 608 / 624)
  assert.equal(fitCanvasZoom(20, 20, 816, 624, 46), 0.1)
})
