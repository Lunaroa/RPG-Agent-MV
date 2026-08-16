import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'

const compile = (name: string) => {
  const source = fs.readFileSync(new URL(name, import.meta.url), 'utf8')
  const parsed = parse(source, { filename: name })
  assert.deepEqual(parsed.errors, [])
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: `workspace-continuity-${name}`, inlineTemplate: true }))
  return source
}

test('scene labels stay inside scrollable tabs and expose their full name', () => {
  const tabs = compile('./UiDesignerSceneTabs.vue')
  assert.match(tabs, /:title="tabLabel\(scene\)"/)
  assert.match(tabs, /class="scene-tab-label"/)
  assert.match(tabs, /\.scene-tab \{[\s\S]*flex: 0 0 auto;[\s\S]*overflow: hidden;/)
  assert.match(tabs, /\.scene-tab-label \{[\s\S]*text-overflow: ellipsis;/)
})

test('designer restores the last working document or stays on the welcome page', () => {
  const shell = compile('./UiDesignerShell.vue')
  assert.match(shell, /const showWelcome = ref\(true\)/)
  assert.match(shell, /const restoreLastActiveDocument = async \(\) =>/)
  assert.match(shell, /showWelcome\.value = !\(await restoreLastActiveDocument\(\)\)/)
  assert.match(shell, /rawDesigner\.recentFiles\.value\.find\(\(record\) => record\.exists\)/)
  assert.match(shell, /remembered \? remembered\.sourcePath\.trim\(\) : legacyRecent\?\.sourcePath/)
  assert.match(shell, /sourcePath: sourcePath\?\.trim\(\) \?\? ''/)
  assert.match(shell, /await rawDesigner\.closeScene\(initialSceneId\)/)
})

test('Ctrl or Cmd plus S saves the active canvas even from an editable field', () => {
  const shell = compile('./UiDesignerShell.vue')
  assert.match(shell, /key: 's',[\s\S]*ctrlOrMeta: true,[\s\S]*allowInEditable: true,[\s\S]*description: 'shortcutSave'/)
  assert.match(shell, /rawDesigner\.saveScene\(rawDesigner\.activeSceneId\.value\)/)
  assert.match(shell, /window\.addEventListener\('keydown', captureSaveShortcut, true\)/)
  assert.match(shell, /event\.stopPropagation\(\)/)
  assert.match(shell, /window\.removeEventListener\('keydown', captureSaveShortcut, true\)/)
})
