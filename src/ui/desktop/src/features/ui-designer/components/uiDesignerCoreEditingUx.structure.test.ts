import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const read = (name: string) => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
const compile = (name: string) => {
  const source = read(name)
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `core-editing-${name}`, inlineTemplate: true }))
  return source
}

test('node tree hover actions reserve space instead of shifting node names', () => {
  const source = compile('./UiDesignerNodePanel.vue')
  assert.match(source, /node-row-actions \{[^}]*display: inline-flex;[^}]*flex: 0 0 72px;[^}]*visibility: hidden;/)
  assert.doesNotMatch(source, /node-row-actions \{ display: none/)
  assert.match(source, /node-tree-entry\.selected \.node-row-actions/)
})

test('canvas routes node context menus before the guide menu and dismisses menus outside', () => {
  const source = compile('./UiDesignerCanvas.vue')
  assert.match(source, /const openCanvasMenu = \(event: MouseEvent\)/)
  assert.match(source, /contextNodeFromEvent\(event\)[\s\S]*openNodeMenu\(\{ event, node \}\)[\s\S]*openGuideMenu\(event\)/)
  assert.match(source, /window\.addEventListener\('pointerdown', dismissContextMenus, true\)/)
  assert.match(source, /@contextmenu\.prevent\.stop="openCanvasMenu\(\$event\)"/)
})

test('narrow layouts preserve the inspector and expose resources and events above scrolling fields', () => {
  const shell = compile('./UiDesignerShell.vue')
  const inspector = compile('./UiDesignerInspector.vue')
  assert.match(shell, /grid-template-columns: 180px 0 minmax\(0, 1fr\) 0 240px/)
  assert.doesNotMatch(shell, /@media \(max-width: 900px\)[^{]*\{[\s\S]*\.inspector-panel \{ display: none;/)
  assert.match(inspector, /ui-designer-inspector-resources/)
  assert.match(inspector, /ui-designer-inspector-events-shortcut/)
  assert.match(inspector, /\['identity', 'contentResources', 'geometry', 'appearance', 'behavior', 'advanced'\]/)
  assert.match(inspector, /class="inspector-primary-actions"[\s\S]*v-if="!selectedNode"[\s\S]*v-else-if="activeSection === 'properties'"[\s\S]*<UiDesignerEvents\s+v-else-if="activeSection === 'events'"/)
})
