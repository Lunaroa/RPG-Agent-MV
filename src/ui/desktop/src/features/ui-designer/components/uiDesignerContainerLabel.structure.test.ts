import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'vitest'

const canvas = fs.readFileSync(new URL('./UiDesignerFabricCanvas.vue', import.meta.url), 'utf8')
const factory = fs.readFileSync(new URL('../fabric/fabricNodeFactory.ts', import.meta.url), 'utf8')

test('container names are separate editor labels with stable screen size above transformed bounds', () => {
  assert.doesNotMatch(factory, /node\.children\.length \? `\$\{node\.name\}/)
  assert.match(canvas, /const containerLabels = new Map<string, Textbox>\(\)/)
  assert.match(canvas, /const bounds = object\.getBoundingRect\(\)/)
  assert.match(canvas, /top: bounds\.top - 4 \/ zoom/)
  assert.match(canvas, /fontSize: 12 \/ zoom/)
  assert.match(canvas, /angle: 0/)
  assert.match(canvas, /selectable: false/)
  assert.match(canvas, /evented: false/)
  assert.match(canvas, /excludeFromExport: true/)
  assert.match(canvas, /watch\(\(\) => props\.zoom, syncContainerLabels\)/)
})
