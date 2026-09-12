import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { test, vi } from 'vitest'

import type { UiDesignerAdapterBundle, UiDesignerPersistenceAdapter, UiDesignerSceneDeleteInspection } from '@contract/ui-designer'
import { createUiDocument } from '../models/document'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

test('confirmed scene deletion closes every matching tab and discards its unsaved editor state', async () => {
  const sourcePath = path.join(os.tmpdir(), 'sample-project', 'data', 'ui-scenes', 'Scene_Target.mzui')
  const metadata = { path: sourcePath, digest: 'confirmed-digest', mtimeMs: 10, size: 100 }
  const inspection: UiDesignerSceneDeleteInspection = {
    sourcePath,
    sceneName: 'Scene_Target',
    metadata,
    references: [],
  }
  let deletedRequest: Parameters<UiDesignerPersistenceAdapter['deleteScene']>[0] | undefined
  const file: UiDesignerPersistenceAdapter = {
    async open() {
      return { status: 'ready', message: 'ready', value: createUiDocument('Scene_Target'), sourcePath, metadata }
    },
    async importScene() { return { status: 'unavailable', message: 'unused' } },
    async save() { return { status: 'unavailable', message: 'unused' } },
    async saveAs() { return { status: 'unavailable', message: 'unused' } },
    async listRecentFiles() { return { status: 'success', message: 'ready', value: [] } },
    async removeRecentFile() { return { status: 'success', message: 'ready', value: null } },
    async inspectSceneDeletion(requestedPath) {
      assert.equal(requestedPath, sourcePath)
      return { status: 'success', message: 'ready', value: inspection }
    },
    async deleteScene(request) {
      deletedRequest = request
      return { status: 'success', message: 'deleted', value: { sourcePath, sceneName: 'Scene_Target', cleanupWarnings: [] } }
    },
    async writeRecovery() { return { status: 'unavailable', message: 'unused' } },
    async listRecovery() { return { status: 'success', message: 'ready', value: [] } },
    async readRecovery() { return { status: 'unavailable', message: 'unused' } },
    async clearRecovery() { return { status: 'success', message: 'ready', value: null } },
    async revealSource() { return { status: 'unavailable', message: 'unused' } },
    async readPreferences() { return { status: 'success', message: 'ready', value: {} } },
    async writePreferences(value) { return { status: 'success', message: 'ready', value } },
    async readGlobalData() { return { status: 'unavailable', message: 'unused' } },
    async saveGlobalData() { return { status: 'unavailable', message: 'unused' } },
  }
  const designer = useUiDesigner({ projectPath: path.join(os.tmpdir(), 'sample-project'), adapters: { file } })
  assert.equal(await designer.open({ path: sourcePath }), true)
  const openedScene = designer.activeScene.value
  designer.updateNodeProperty('node_root', 'x', 24)
  assert.equal(designer.isSceneDirty(openedScene.id), true)

  const confirmed = await designer.inspectSceneDeletion(sourcePath)
  assert.deepEqual(confirmed, inspection)
  const deleted = await designer.deleteScene(confirmed!)

  assert.equal(deleted?.sceneName, 'Scene_Target')
  assert.deepEqual(deletedRequest, { path: sourcePath, expected: { digest: metadata.digest, mtimeMs: metadata.mtimeMs } })
  assert.equal(designer.scenes.value.some((scene) => scene.sourcePath === sourcePath), false)
  assert.equal(designer.scenes.value.some((scene) => scene.id === openedScene.id), false)
  assert.notEqual(designer.activeScene.value?.id, openedScene.id)
  assert.equal(designer.fileStatus.value, 'success')
})
