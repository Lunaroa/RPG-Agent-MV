import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle, UiDesignerPersistenceAdapter, UiDesignerPreviewAdapter, UiPreviewResult } from '@contract/ui-designer'
import { createUiDocument } from '../models/document'
import { exportRuntimeDocument } from '../models/export'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

const success = <T>(value?: T) => ({ status: 'success' as const, message: 'ok', value })

test('closing the only opened tab creates a fresh untitled clean scene', async () => {
  let clearedRecovery: string | undefined
  const file: UiDesignerPersistenceAdapter = {
    async open() {
      return { ...success(createUiDocument('Scene_Opened')), sourcePath: 'ui/opened.mzui', recoveryId: 'recovery-opened', metadata: { path: 'ui/opened.mzui', digest: 'digest', mtimeMs: 10, size: 1 } }
    },
    async clearRecovery(id) { clearedRecovery = id; return success() },
    async save() { return { status: 'unavailable', message: 'unused' } },
    async saveAs() { return { status: 'unavailable', message: 'unused' } },
    async revealSource() { return { status: 'unavailable', message: 'unused' } },
    async listRecentFiles() { return success([]) },
    async removeRecentFile() { return success() },
    async listRecovery() { return success([]) },
    async readRecovery() { return { status: 'unavailable', message: 'unused' } },
    async readPreferences() { return success({}) },
    async writePreferences() { return success() },
    async writeRecovery() { return success({ id: 'recovery' }) },
    async exportRuntime() { return success('runtime.json') },
    async listNodeTemplates() { return success([]) },
    async readNodeTemplate() { return { status: 'unavailable', message: 'unused' } },
    async writeNodeTemplate() { return success('template.mztemplate') },
    async removeNodeTemplate() { return success() },
    async importNodeTemplate() { return { status: 'unavailable', message: 'unused' } },
    async exportNodeTemplate() { return success('template.mztemplate') },
  }
  const designer = useUiDesigner({ adapters: { file } })
  assert.equal(await designer.open(), true)
  const openedId = designer.activeScene.value.id
  assert.equal(await designer.closeScene(designer.scenes.value[0].id), true)
  assert.equal(await designer.closeScene(openedId), true)
  const replacement = designer.scenes.value[0]
  assert.equal(replacement.sourcePath, undefined)
  assert.equal(replacement.openedMetadata, undefined)
  assert.equal(replacement.recoveryId, undefined)
  assert.equal(replacement.history.isDirty, false)
  assert.equal(clearedRecovery, 'recovery-opened')
})

test('preview stop failure retains the session and polling can be retried', async () => {
  let stopCalls = 0
  const preview: UiDesignerPreviewAdapter = {
    async start(): Promise<UiPreviewResult> { return { state: 'running', message: 'running', sessionId: 'preview-1' } },
    async current(): Promise<UiPreviewResult> { return { state: 'running', message: 'running', sessionId: 'preview-1' } },
    async stop(): Promise<UiPreviewResult> {
      stopCalls += 1
      return stopCalls === 1 ? { state: 'error', message: 'stop failed', sessionId: 'preview-1' } : { state: 'stopped', message: 'stopped', sessionId: 'preview-1' }
    },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { preview } })
  assert.equal(await designer.startPreview(), true)
  assert.equal(await designer.stopPreview(), false)
  assert.equal(designer.previewSessionId.value, 'preview-1')
  assert.equal(designer.isPreviewing.value, true)
  assert.equal(await designer.stopPreview(), true)
  assert.equal(designer.previewSessionId.value, undefined)
  assert.equal(designer.isPreviewing.value, false)
})

test('preview diagnostics follow the active session and retain final cleanup diagnostics', async () => {
  const startDiagnostics = [{ schemaVersion: '1.0.0' as const, sessionId: 'preview-diagnostics', scene: 'Scene_Main', file: 'code.ready', node: 'node_root', type: 'code', phase: 'ready', event: null, code: 'UI_CODE_ERROR', severity: 'error' as const, label: 'Code error', message: 'syntax error', count: 1 }]
  const stopDiagnostics = [{ ...startDiagnostics[0], message: 'cleanup complete', count: 2 }]
  const preview: UiDesignerPreviewAdapter = {
    async start(): Promise<UiPreviewResult> { return { state: 'running', message: 'running', sessionId: 'preview-diagnostics', diagnostics: startDiagnostics } },
    async current(): Promise<UiPreviewResult> { return { state: 'running', message: 'running', sessionId: 'preview-diagnostics', diagnostics: startDiagnostics } },
    async stop(): Promise<UiPreviewResult> { return { state: 'stopped', message: 'stopped', sessionId: 'preview-diagnostics', diagnostics: stopDiagnostics } },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { preview } })
  assert.equal(await designer.startPreview(), true)
  assert.equal(designer.previewDiagnostics.value[0]?.code, 'UI_CODE_ERROR')
  assert.equal(await designer.stopPreview(), true)
  assert.equal(designer.previewDiagnostics.value[0]?.message, 'cleanup complete')
  assert.equal(designer.previewDiagnostics.value[0]?.count, 2)
})

test('natural preview exit reconciles the session so a later guard does not restart it', async () => {
  let stopCalls = 0
  const finalDiagnostic = { schemaVersion: '1.0.0' as const, sessionId: 'preview-natural', scene: 'Scene_Main', file: null, node: null, type: 'runtime', phase: 'stop', event: null, code: 'UI_RUNTIME_EXIT', severity: 'warning' as const, label: 'Runner exited', message: 'runner exited', count: 1 }
  const preview: UiDesignerPreviewAdapter = {
    async start(): Promise<UiPreviewResult> { return { state: 'running', message: 'running', sessionId: 'preview-natural' } },
    async current(): Promise<UiPreviewResult> { return { state: 'stopped', message: 'runner exited', sessionId: 'preview-natural', diagnostics: [finalDiagnostic] } },
    async stop(): Promise<UiPreviewResult> { stopCalls += 1; return { state: 'stopped', message: 'already stopped', sessionId: 'preview-natural' } },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { preview } })
  assert.equal(await designer.startPreview(), true)
  await new Promise((resolve) => setTimeout(resolve, 1050))
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.previewSessionId.value, undefined)
  assert.equal(designer.previewDiagnostics.value[0]?.code, 'UI_RUNTIME_EXIT')
  assert.equal(await designer.stopPreview(), true)
  assert.equal(stopCalls, 0)
})

test('recovery cleanup failure keeps the recovery id and reports discard failure', async () => {
  const file: UiDesignerPersistenceAdapter = {
    async open() { return { status: 'unavailable', message: 'unused' } },
    async save() { return { status: 'unavailable', message: 'unused' } },
    async saveAs() { return { status: 'unavailable', message: 'unused' } },
    async revealSource() { return { status: 'unavailable', message: 'unused' } },
    async listRecentFiles() { return success([]) },
    async removeRecentFile() { return success() },
    async listRecovery() { return success([]) },
    async readRecovery() { return { status: 'unavailable', message: 'unused' } },
    async clearRecovery() { return { status: 'error', message: 'cleanup failed', code: 'RECOVERY_BUSY' } },
    async readPreferences() { return success({}) },
    async writePreferences() { return success() },
    async writeRecovery() { return success({ id: 'recovery' }) },
    async exportRuntime() { return success('runtime.json') },
    async listNodeTemplates() { return success([]) },
    async readNodeTemplate() { return { status: 'unavailable', message: 'unused' } },
    async writeNodeTemplate() { return success('template.mztemplate') },
    async removeNodeTemplate() { return success() },
    async importNodeTemplate() { return { status: 'unavailable', message: 'unused' } },
    async exportNodeTemplate() { return success('template.mztemplate') },
  }
  const designer = useUiDesigner({ adapters: { file } })
  const scene = designer.scenes.value[0]
  scene.recoveryId = 'recovery-kept'
  designer.updateNodeProperty('node_root', 'x', 20)
  assert.equal(await designer.discardAllDirtyScenes(), false)
  assert.equal(scene.recoveryId, 'recovery-kept')
  assert.match(designer.fileMessage.value, /cleanup failed/)
})

test('scene data import creates a dirty editor copy that can be saved as a new source', async () => {
  const imported = exportRuntimeDocument(createUiDocument('Scene_Imported_Runtime'))
  let savedPath: string | undefined
  const file = {
    async saveAs() {
      savedPath = 'ui/imported-copy.mzui'
      return {
        status: 'success' as const,
        message: 'saved',
        value: createUiDocument('Scene_Imported_Runtime'),
        sourcePath: savedPath,
        metadata: { path: savedPath, digest: 'new-digest', mtimeMs: 2, size: 1 },
      }
    },
  } as unknown as UiDesignerPersistenceAdapter
  const resource = {
    async loadProject() { return success() },
    async readSceneData() {
      return success({
        scene: imported,
        metadata: {
          id: 'scene-data-1',
          relativePath: 'js/plugins/mzui-data/imported.json',
        sceneName: 'Scene_Imported_Runtime',
          version: '1.0.0',
          runtimeVersion: '1.0.0',
          compatibility: 'compatible' as const,
          digest: 'runtime-digest',
          mtimeMs: 1,
          size: 1,
        },
        projectCompatibility: { engine: 'MZ', version: '1.0.0', engineVersionSupported: true, warnings: [] },
      })
    },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { file, resource } })
  assert.equal(await designer.importSceneData('js/plugins/mzui-data/imported.json', true), true)
  const scene = designer.activeScene.value
  assert.equal(scene.document.meta.sceneName, 'Scene_Imported_Runtime')
  assert.equal(scene.sourcePath, undefined)
  assert.equal(scene.history.isDirty, true)
  assert.equal(await designer.save('saveAs'), true)
  assert.equal(savedPath, 'ui/imported-copy.mzui')
  assert.equal(scene.history.isDirty, false)
})

test('switching scenes flushes source drafts to their captured tab', () => {
  const designer = useUiDesigner()
  const sceneA = designer.activeScene.value
  designer.newScene('Scene_B')
  const sceneB = designer.activeScene.value
  designer.selectScene(sceneA.id)
  designer.previewSourceCode('ready', 'A draft', sceneA.id)
  assert.equal(designer.selectScene(sceneB.id), true)
  assert.equal(sceneA.document.code.ready, 'A draft')
  assert.equal(sceneB.document.code.ready, '')

  designer.setPropertyCode('node_root', 'x', 'return 12', sceneA.id)
  assert.equal(sceneA.document.nodes.find((node) => node.id === 'node_root')?.propCodes.x, 'return 12')
  assert.equal(designer.activeScene.value.id, sceneB.id)
})
