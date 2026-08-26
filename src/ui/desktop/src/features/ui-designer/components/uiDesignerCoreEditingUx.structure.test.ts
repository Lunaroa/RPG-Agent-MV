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
  assert.match(source, /node-row-actions \{[^}]*display: inline-flex;[^}]*flex: 0 1 72px;[^}]*max-width: 80px;[^}]*visibility: hidden;/)
  assert.doesNotMatch(source, /node-row-actions \{ display: none/)
  assert.match(source, /node-tree-entry\.selected \.node-row-actions/)
  assert.match(source, /v-if="selectedIds\.length < 2" class="node-row-actions"/)
  assert.match(source, /:expand-on-click-node="false"/)
  assert.match(source, /UI_DESIGNER_NODE_TYPE_ICONS\[data\.type\]/)
  assert.match(source, /UI_DESIGNER_NODE_ACTION_GROUPS/)
  assert.match(source, /class="panel-heading-actions"[\s\S]*duplicateNode[\s\S]*deleteNode/)
})

test('left node panel contains selected-row actions and palette feedback without widening the workspace', () => {
  const panel = compile('./UiDesignerNodePanel.vue')
  const shell = compile('./UiDesignerShell.vue')
  assert.match(shell, /\.left-pane \{[^}]*min-width: 0;[^}]*overflow: hidden;/)
  assert.match(panel, /\.node-panel \{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow: hidden;/)
  assert.match(panel, /\.node-tree \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/)
  assert.match(panel, /el-tree-node__content\) \{ box-sizing: border-box; overflow: hidden;/)
  assert.match(panel, /\.palette-feedback \{[^}]*max-width: 50%;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
})

test('canvas routes node context menus before the guide menu and dismisses menus outside', () => {
  const source = compile('./UiDesignerCanvas.vue')
  const fabricCanvas = compile('./UiDesignerFabricCanvas.vue')
  assert.match(source, /const openFabricContextMenu = \(payload: \{ event: MouseEvent; node\?: UiNode \}\)/)
  assert.match(source, /if \(payload\.node\) openNodeMenu\(payload\.event, payload\.node\)[\s\S]*else openGuideMenu\(payload\.event\)/)
  assert.match(source, /window\.addEventListener\('pointerdown', dismissContextMenus, true\)/)
  assert.match(source, /@contextmenu="openFabricContextMenu"/)
  assert.match(fabricCanvas, /const contextNode = \(target\?: FabricObject\)[\s\S]*target instanceof ActiveSelection[\s\S]*selectedObjectIds\(target\)\[0\]/)
  assert.match(fabricCanvas, /const contextTargetAt = \(event: MouseEvent, target\?: FabricObject\)[\s\S]*active instanceof ActiveSelection[\s\S]*active\.containsPoint\(canvas\.getScenePoint\(event\)\)/)
  assert.match(fabricCanvas, /emit\('contextmenu', \{ event: pointerEvent, node: contextNode\(contextTargetAt\(pointerEvent, event\.target\)\) \}\)/)
})

test('Inspector padding directions are visible and property expressions can be resized vertically', () => {
  const padding = compile('./UiPaddingEditor.vue')
  const property = compile('./UiPropertyField.vue')
  const editor = compile('./UiCodeMirrorEditor.vue')
  assert.match(padding, /class="padding-side-label">\{\{ t\(sideLabels/)
  assert.match(padding, /top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft'/)
  assert.match(property, /:rows="3" resizable/)
  assert.match(editor, /class="editor-host" :class="\{ resizable: props\.resizable \}"/)
  assert.match(editor, /\.editor-host\.resizable \{[^}]*resize: vertical;/)
  assert.match(editor, /new ResizeObserver\(\(\) => editor\?\.refreshLayout\?\.\(\)\)/)
})

test('narrow layouts preserve the inspector without duplicating resources and events below the main tabs', () => {
  const shell = compile('./UiDesignerShell.vue')
  const inspector = compile('./UiDesignerInspector.vue')
  assert.match(shell, /grid-template-columns: 180px 0 minmax\(0, 1fr\) 0 240px/)
  assert.doesNotMatch(shell, /@media \(max-width: 900px\)[^{]*\{[\s\S]*\.inspector-panel \{ display: none;/)
  assert.doesNotMatch(inspector, /ui-designer-inspector-resources/)
  assert.doesNotMatch(inspector, /ui-designer-inspector-events-shortcut/)
  assert.match(inspector, /\['advanced', 'identity', 'contentResources', 'geometry', 'appearance', 'behavior'\]/)
  assert.doesNotMatch(inspector, /inspector-primary-actions/)
  assert.match(inspector, /v-if="!selectedNode"[\s\S]*v-else-if="activeSection === 'properties'"[\s\S]*<UiDesignerEvents\s+v-else-if="activeSection === 'events'"/)
})

test('reconcile dissolves multi-select ActiveSelection before writing absolute geometry', () => {
  const fabricCanvas = compile('./UiDesignerFabricCanvas.vue')
  assert.match(fabricCanvas, /const reconcile = async \(\) => \{[\s\S]{0,400}?canvas\.getActiveObject\(\) instanceof ActiveSelection[\s\S]{0,200}?canvas\.discardActiveObject\(\)[\s\S]*?applyFabricNodeGeometry\(object, current, props\.document\)[\s\S]*?syncFabricSelection\(\)/)
})

test('canvas double click edits text and buttons in place and routes other node types to their primary editor', () => {
  const canvas = compile('./UiDesignerCanvas.vue')
  const fabricCanvas = compile('./UiDesignerFabricCanvas.vue')
  const inspector = compile('./UiDesignerInspector.vue')
  const panel = compile('./UiDesignerNodePanel.vue')
  const shell = compile('./UiDesignerShell.vue')
  assert.equal(fs.existsSync(new URL('./UiCanvasNode.vue', import.meta.url)), false)
  assert.match(fabricCanvas, /canvas\.on\('mouse:dblclick', \(event\) => activateObject\(event\.target\)\)/)
  assert.match(fabricCanvas, /object instanceof Textbox/)
  assert.match(fabricCanvas, /object\.enterEditing\(\)[\s\S]*object\.selectAll\(\)[\s\S]*object\.hiddenTextarea\?\.focus\(\)/)
  assert.match(fabricCanvas, /const content = normalizeUiSingleLineText\(object\.text\)[\s\S]*props\.designer\.previewNodeProperty\(node\.id, 'content', content\)/)
  assert.match(fabricCanvas, /props\.designer\.commitNodePropertyPreview\(nodeId, 'content'\)/)
  assert.match(canvas, /if \(node\.type === 'container' \|\| node\.type === 'list'\) enterContainer\(node\)[\s\S]*else emit\('editNode', node\.id\)/)
  assert.match(shell, /@edit-node="editPrimaryNode"/)
  assert.match(panel, /@dblclick\.stop="emit\('activateNode', data\.id\)"/)
  assert.match(shell, /@activate-node="activateNode"/)
  assert.match(inspector, /node\.type === 'text' \|\| node\.type === 'button'/)
  assert.match(inspector, /ui-designer-property-content-input/)
  assert.match(inspector, /ui-designer-frames-select-many/)
  assert.match(inspector, /ui-designer-resource-\$\{resourceField\}-select/)
})
