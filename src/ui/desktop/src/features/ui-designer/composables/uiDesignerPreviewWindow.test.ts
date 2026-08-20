import assert from 'node:assert/strict'
import test from 'node:test'

import { uiDesignerPreviewWindowSize } from './uiDesignerPreviewWindow'

test('preview window keeps small scenes at one-to-one size', () => {
  assert.deepEqual(uiDesignerPreviewWindowSize(816, 624, 1920, 1080), { width: 816, height: 624 })
})

test('preview window constrains only the viewport for oversized scenes', () => {
  assert.deepEqual(uiDesignerPreviewWindowSize(2560, 1440, 1920, 1080), { width: 1872, height: 1008 })
})
