import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const compile = (name: string) => {
  const source = fs.readFileSync(new URL(name, import.meta.url), 'utf8')
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `node-lock-scroll-${name}`, inlineTemplate: true }))
  return source
}

test('node tree blocks locked selection and owns a bounded drag auto-scroll lifecycle', () => {
  const panel = compile('./UiDesignerNodePanel.vue')
  assert.match(panel, /getNodeActionPolicy\(entry\.id\)[\s\S]{0,100}\.canSelect\) \{/)
  assert.match(panel, /:allow-drag="allowDrag"/)
  assert.match(panel, /@node-drag-start="startTreeDragAutoScroll"/)
  assert.match(panel, /@node-drag-end="stopTreeDragAutoScroll"/)
  assert.match(panel, /resolveTreeDragAutoScrollDelta/)
  assert.match(panel, /window\.removeEventListener\('drop', stopTreeDragAutoScroll, true\)/)
  assert.match(panel, /setCurrentKey\?\.\(selectedIds\.value\[0\] \?\? null\)/)
  assert.match(panel, /@dblclick\.stop="activateNode\(data\)"/)
})

test('canvas and shell activation refuse nodes rejected by the shared selection policy', () => {
  const canvas = compile('./UiDesignerCanvas.vue')
  const fabric = compile('./UiDesignerFabricCanvas.vue')
  const shell = compile('./UiDesignerShell.vue')
  assert.match(canvas, /getNodeActionPolicy\(node\.id\)[\s\S]{0,80}\.canSelect/)
  assert.match(fabric, /isNodeSelectable\(props\.document, node\.id\)/)
  assert.match(shell, /getNodeActionPolicy\(nodeId\)\.canSelect/)
})
