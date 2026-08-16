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

test('multi-select drag keeps member container labels tracking while their geometry is skipped', () => {
  // ActiveSelection members must not receive absolute draft geometry (they are
  // group-relative), yet their name labels must still be re-synced mid-drag —
  // getBoundingRect() applies the group transform, so labels follow the group.
  assert.match(canvas, /if \(selectionMembers\?\.has\(object\)\) \{\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*syncContainerLabel\(id\)\n\s*continue\n\s*\}/)
})
