import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'vitest'
import { compileScript, parse } from '@vue/compiler-sfc'

const eventEditorSource = readFileSync(new URL('./EventEditorDialog.vue', import.meta.url), 'utf8')
const eventCommandSource = readFileSync(new URL('./EventCommandDialog.vue', import.meta.url), 'utf8')
const sharedDialogCss = readFileSync(new URL('../../styles/editor-dialog.css', import.meta.url), 'utf8')
const uiDesignerInspectorSource = readFileSync(new URL('../../features/ui-designer/components/UiDesignerInspector.vue', import.meta.url), 'utf8')

describe('editor dialog edge resizing', () => {
  test('uses all shared frame edges in both resizable event dialogs', () => {
    assert.match(eventEditorSource, /v-for="edge in editorResizeEdges"/)
    assert.match(eventEditorSource, /@pointerdown="onEditorResizeStart\(\$event, edge\)"/)
    assert.match(eventEditorSource, /centeredDialogTranslation\(next, window\.innerWidth, window\.innerHeight\)/)
    assert.match(eventCommandSource, /v-for="edge in dialogResizeEdges"/)
    assert.match(eventCommandSource, /@pointerdown="onDialogResizeStart\(\$event, edge\)"/)
    assert.match(eventCommandSource, /centeredDialogTranslation\(next,window\.innerWidth,window\.innerHeight\)/)
    assert.doesNotMatch(eventEditorSource, /dialog-resize-handle/)
    assert.doesNotMatch(eventCommandSource, /dialog-resize-handle/)
  })

  test('maps straight edges and corners to their desktop resize cursors', () => {
    assert.match(sharedDialogCss, /\.editor-dialog-resize-edge\.n \{[^}]*cursor: ns-resize;/s)
    assert.match(sharedDialogCss, /\.editor-dialog-resize-edge\.e \{[^}]*cursor: ew-resize;/s)
    assert.match(sharedDialogCss, /\.editor-dialog-resize-edge\.ne,[\s\S]*?\.editor-dialog-resize-edge\.sw \{[^}]*cursor: nesw-resize;/)
    assert.match(sharedDialogCss, /\.editor-dialog-resize-edge\.nw,[\s\S]*?\.editor-dialog-resize-edge\.se \{[^}]*cursor: nwse-resize;/)
  })

  test('keeps the UI designer resource dialog on the same shared geometry', () => {
    assert.match(uiDesignerInspectorSource, /from '\.\.\/\.\.\/\.\.\/utils\/dialog-edge-resize'/)
    assert.match(uiDesignerInspectorSource, /const resourceWorkspaceResizeEdges = DIALOG_RESIZE_EDGES/)
  })

  test('compiles both event dialog templates with the shared edge bindings', () => {
    for (const [name, source] of [
      ['EventEditorDialog.vue', eventEditorSource],
      ['EventCommandDialog.vue', eventCommandSource],
    ] as const) {
      const parsed = parse(source, { filename: name })
      assert.deepEqual(parsed.errors, [])
      assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `dialog-resize-${name}`, inlineTemplate: true }))
    }
  })
})
