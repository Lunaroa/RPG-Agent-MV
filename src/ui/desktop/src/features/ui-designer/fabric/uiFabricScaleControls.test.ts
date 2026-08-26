import assert from 'node:assert/strict'
import { Point, Rect, controlsUtils } from 'fabric'
import { test } from 'vitest'
import { configureFabricScaleControls } from './fabricNodeFactory'

const handleKeys = ['tl', 'mt', 'tr', 'mr', 'br', 'mb', 'bl', 'ml'] as const
const expectedByAngle = {
  0: ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'],
  45: ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'],
  90: ['nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize'],
  135: ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'],
} as const

test('all eight resize controls feed the dimension-resize gesture and rotate their cursor directions with the object', () => {
  for (const angle of [0, 45, 90, 135] as const) {
    const object = new Rect({ width: 160, height: 80, left: 0, top: 0, originX: 'center', originY: 'center', angle })
    Object.defineProperty(object, 'canvas', {
      configurable: true,
      value: { viewportTransform: [1, 0, 0, 1, 0, 0], uniformScaling: false, uniScaleKey: 'shiftKey' },
    })
    configureFabricScaleControls(object)
    const radians = angle * Math.PI / 180
    const cursors = handleKeys.map((key) => {
      const control = object.controls[key]
      const coordinate = new Point(control.x * object.width, control.y * object.height).rotate(radians)
      assert.equal(control.getActionName({} as MouseEvent, control, object), 'scale')
      return control.cursorStyleHandler({ shiftKey: false } as MouseEvent, control, object, coordinate)
    })
    assert.deepEqual(cursors, expectedByAngle[angle])
    assert.equal(object.controls.tl.actionHandler, controlsUtils.scalingEqually)
    assert.equal(object.controls.mr.actionHandler, controlsUtils.scalingX)
    assert.equal(object.controls.mt.actionHandler, controlsUtils.scalingY)
    if (angle === 0) assert.equal(cursors[2], 'nesw-resize')
  }
})
