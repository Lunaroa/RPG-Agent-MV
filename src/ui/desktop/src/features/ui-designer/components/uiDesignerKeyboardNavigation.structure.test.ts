import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const canvasSource = fs.readFileSync(new URL('./UiDesignerCanvas.vue', import.meta.url), 'utf8')
const fabricSource = fs.readFileSync(new URL('./UiDesignerFabricCanvas.vue', import.meta.url), 'utf8')

test('arrow keys move the designer selection without hijacking consumed keys', () => {
  const parsed = parse(canvasSource, { filename: 'UiDesignerCanvas.vue' })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: 'ui-designer-keyboard-navigation', inlineTemplate: true }))
  assert.match(canvasSource, /if \(previewing\.value \|\| isEditableTarget\(event\.target\)\) return/)
  assert.match(canvasSource, /const direction = navigationDirectionFromKey\(event\.key\)/)
  assert.match(canvasSource, /if \(!direction \|\| event\.defaultPrevented\) return/)
  assert.match(canvasSource, /fabricCanvas\.value\?\.navigateSelection\(direction\)/)
})

test('fabric canvas navigates visible scope objects by scene bounds and commits a single selection', () => {
  assert.match(fabricSource, /if \(!object\.visible\) continue/)
  assert.match(fabricSource, /const bounds = object\.getBoundingRect\(\)/)
  assert.match(fabricSource, /entries\.push\(\{ id, rect: \{ x: bounds\.left, y: bounds\.top, width: bounds\.width, height: bounds\.height \} \}\)/)
  assert.match(fabricSource, /selectionRootNodeIds\(props\.document, selected\)\.find\(\(id\) => objects\.get\(id\)\?\.visible\)/)
  assert.match(fabricSource, /const next = nextNodeIdInDirection\(entries, anchor, direction\)/)
  assert.match(fabricSource, /if \(next\) props\.designer\.selectNodes\(\[next\]\)/)
  assert.match(fabricSource, /defineExpose\(\{ activateNode, navigateSelection \}\)/)
})
