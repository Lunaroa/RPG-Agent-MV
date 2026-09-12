import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('saved project scenes expose deletion from the welcome context menu and scene settings', () => {
  const welcome = source('./UiDesignerWelcome.vue')
  const settings = source('./UiDesignerSceneSettingsSurface.vue')
  const shell = source('./UiDesignerShell.vue')

  assert.match(welcome, /trigger="contextmenu"/)
  assert.match(welcome, /emit\('deleteScene', item\)/)
  assert.match(welcome, /<el-dropdown-item command="delete">\{\{ t\('deleteScene'\) \}\}/)
  assert.match(settings, /data-testid="ui-designer-scene-settings-delete"/)
  assert.match(settings, /v-if="designer\.activeScene\?\.sourcePath"/)
  assert.match(shell, /rawDesigner\.inspectSceneDeletion\(scene\.sourcePath\)/)
  assert.match(shell, /rawDesigner\.deleteScene\(inspection\)/)
  assert.match(shell, /deleteSceneReferences/)
  assert.match(shell, /deleteSceneConfirm/)
})

test('desktop bridge keeps inspection and confirmed deletion as separate operations', () => {
  const preload = source('../../../../electron/preload.ts')
  const bindings = source('../../../../electron/ui-designer-ipc-bindings.ts')

  assert.match(preload, /ui-designer:scene-delete:inspect/)
  assert.match(preload, /ui-designer:scene-delete:execute/)
  assert.match(bindings, /trashProjectUiDesignerScene/)
  assert.match(bindings, /removeRecoveryForSource/)
  assert.match(bindings, /cleanupWarnings/)
})
