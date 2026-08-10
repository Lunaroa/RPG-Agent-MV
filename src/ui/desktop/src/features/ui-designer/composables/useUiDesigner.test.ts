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
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0' }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0' }) },
    async stop() { return success(null) },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { preview, rendererHost } })
  assert.equal(await designer.startPreview(), true)
  assert.equal(designer.canStartEditorPreview.value, false)
  assert.equal(await designer.stopPreview(), false)
  assert.equal(designer.previewSessionId.value, 'preview-1')
  assert.equal(designer.isPreviewing.value, true)
  assert.equal(await designer.stopPreview(), true)
  assert.equal(designer.previewSessionId.value, undefined)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.canStartEditorPreview.value, true)
})

test('game preview start is single-flight and project switch cancels pending scene readiness once', async () => {
  let resolveStart!: (result: UiPreviewResult) => void
  const pendingStart = new Promise<UiPreviewResult>((resolve) => { resolveStart = resolve })
  let starts = 0
  let stops = 0
  const preview: UiDesignerPreviewAdapter = {
    async start() { starts += 1; return await pendingStart },
    async current() { return { state: 'preparing', message: 'preparing' } },
    async stop() {
      stops += 1
      const stopped = { state: 'stopped' as const, message: 'stopped', sessionId: 'preview-pending' }
      resolveStart(stopped)
      return stopped
    },
  }
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0' }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0' }) },
    async stop() { return success(null) },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { preview, rendererHost } })
  const firstStart = designer.startPreview()
  assert.equal(designer.previewStatus.value, 'preparing')
  assert.equal(designer.canStartEditorPreview.value, false)
  assert.equal(designer.startEditorPreview(), false)
  assert.equal(await designer.startPreview(), false)
  assert.equal(starts, 1)
  assert.equal(await designer.setProjectContext('projects/next', { preview, rendererHost }), true)
  assert.equal(await firstStart, false)
  assert.equal(stops, 1)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.canStartEditorPreview.value, true)
})

test('editor preview waits for mount acknowledgements and excludes game preview until cleanup', async () => {
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0' }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0' }) },
    async stop() { return success(null) },
  }
  let gameStarts = 0
  const preview: UiDesignerPreviewAdapter = {
    async start() { gameStarts += 1; return { state: 'running', message: 'running', sessionId: 'game-preview' } },
    async current() { return { state: 'running', message: 'running', sessionId: 'game-preview' } },
    async stop() { return { state: 'stopped', message: 'stopped', sessionId: 'game-preview' } },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { rendererHost, preview } })
  designer.editingMode.value = 'code'
  assert.equal(designer.startEditorPreview(), true)
  assert.equal(designer.isEditorPreviewing.value, true)
  assert.equal(designer.editingMode.value, 'design')
  assert.equal(designer.editorPreviewStatus.value, 'preparing')
  assert.equal(designer.canStartGamePreview.value, false)
  assert.equal(await designer.startPreview(), false)
  assert.equal(gameStarts, 0)
  assert.equal(designer.acknowledgeEditorPreviewExecutionMode('full-preview'), true)
  assert.equal(designer.editorPreviewStatus.value, 'running')
  assert.equal(designer.stopEditorPreview(), true)
  assert.equal(designer.isEditorPreviewing.value, true)
  assert.equal(designer.editingMode.value, 'design')
  assert.equal(designer.editorPreviewStatus.value, 'preparing')
  assert.equal(designer.canStartGamePreview.value, false)
  assert.equal(designer.acknowledgeEditorPreviewExecutionMode('authoring'), true)
  assert.equal(designer.isEditorPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(designer.canStartGamePreview.value, true)

  assert.equal(designer.startEditorPreview(), true)
  assert.equal(designer.acknowledgeEditorPreviewExecutionMode('full-preview'), true)
  designer.failEditorPreview('The replacement renderer preparation was superseded.')
  assert.equal(designer.editorPreviewStatus.value, 'error')
  assert.equal(designer.editorPreviewMessage.value, 'The replacement renderer preparation was superseded.')
  assert.equal(designer.isEditorPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
})

test('project profile dimensions seed only newly created scenes across project switches', async () => {
  const project = {
    async getProfile(request?: { project?: string }) {
      assert.equal(request?.project, 'projects/sample')
      return success({ engine: 'MV' as const, engineVersion: '1.6.2', screenWidth: 960, screenHeight: 540, uiAreaWidth: 960, uiAreaHeight: 540 })
    },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { project } })
  assert.equal(designer.canCreateScene.value, false)
  assert.equal(await designer.loadProjectProfile(), true)
  assert.deepEqual(designer.newSceneCanvasSize.value, { width: 960, height: 540 })
  assert.equal(designer.newScene('Scene_Profile_A'), true)
  const firstScene = designer.document.value
  assert.deepEqual([firstScene.canvas.width, firstScene.canvas.height], [960, 540])

  assert.equal(await designer.setProjectContext('projects/next', {
    project: {
      async getProfile(request?: { project?: string }) {
        assert.equal(request?.project, 'projects/next')
        return success({ engine: 'MZ' as const, engineVersion: '1.10.0', screenWidth: 1280, screenHeight: 720, uiAreaWidth: 1280, uiAreaHeight: 720 })
      },
    },
  }), true)
  assert.deepEqual([firstScene.canvas.width, firstScene.canvas.height], [960, 540])
  assert.equal(designer.newScene('Scene_Profile_B'), true)
  assert.deepEqual([designer.document.value.canvas.width, designer.document.value.canvas.height], [1280, 720])
})

test('no project profile disables default scene creation but explicit low-level dimensions remain valid', () => {
  const designer = useUiDesigner()
  const initialSceneCount = designer.scenes.value.length
  assert.equal(designer.newSceneCanvasSize.value, null)
  assert.equal(designer.canCreateScene.value, false)
  assert.equal(designer.newScene('Scene_Requires_Project'), false)
  assert.equal(designer.scenes.value.length, initialSceneCount)
  assert.equal(designer.newScene('Scene_Explicit_Size', { width: 640, height: 360 }), true)
  assert.deepEqual([designer.document.value.canvas.width, designer.document.value.canvas.height], [640, 360])
})

test('integer geometry and shared node actions guard locked selections and ancestry at execution', () => {
  const designer = useUiDesigner()
  designer.addNode('text', 'node_root', { x: 10.6, y: 20.4 })
  const firstId = designer.selectedIds.value[0]
  assert.deepEqual([designer.document.value.nodes.find((node) => node.id === firstId)?.props.x, designer.document.value.nodes.find((node) => node.id === firstId)?.props.y], [11, 20])
  designer.updateNodeProperty(firstId, 'width', 100.6)
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.props.width, 101)
  designer.setNodeLocked(firstId, true)
  assert.equal(designer.executeNodeAction('delete', firstId), false)
  assert.ok(designer.document.value.nodes.some((node) => node.id === firstId))
  assert.equal(designer.executeNodeAction('toggleLock', firstId), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === firstId)?.locked, false)

  designer.addNode('container', 'node_root')
  const containerId = designer.selectedIds.value[0]
  designer.addNode('text', containerId)
  const nestedId = designer.selectedIds.value[0]
  designer.setNodeLocked(containerId, true)
  assert.equal(designer.executeNodeAction('delete', nestedId), false)
  assert.equal(designer.nudgeSelected({ x: 1, y: 1 }), false)
  assert.equal(designer.duplicateSelected(), false)
  assert.equal(designer.reparent(nestedId, 'node_root', 'inner'), false)
  assert.equal(designer.align('left'), false)
  assert.equal(designer.previewNodeResizeWithSnap(nestedId, { x: 0, y: 0, width: 160, height: 80 }, 'e', { x: 10, y: 0 }, { preserveAspect: true, fromCenter: false }), undefined)
  assert.equal(designer.renameNode(nestedId, 'RenamedNested'), false)
  assert.ok(designer.document.value.nodes.some((node) => node.id === nestedId))

  designer.setNodeLocked(nestedId, true)
  designer.setNodeLocked(containerId, false)
  designer.selectNodes([containerId])
  assert.equal(designer.getNodeActionPolicy(containerId).canUngroup, false)
  assert.equal(designer.removeSelected(), false)
  assert.equal(designer.duplicateSelected(), false)
  assert.equal(designer.reparent(containerId, 'node_root', 'inner'), false)
  assert.equal(designer.renameNode('node_root', 'RenamedRoot'), false)
  assert.equal(designer.executeNodeAction('toggleLock', nestedId), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === nestedId)?.locked, false)

  designer.addNode('text', null)
  const topFirstId = designer.selectedIds.value[0]
  designer.addNode('text', null)
  const topSecondId = designer.selectedIds.value[0]
  assert.equal(designer.moveStep(topSecondId, 'up'), true)
  assert.deepEqual(designer.document.value.zOrder, ['node_root', topSecondId, topFirstId])
  assert.equal(designer.moveStep(topSecondId, 'up'), false)
  assert.equal(designer.reparent(topFirstId, 'node_root', 'before'), false)
})

test('resource property execution rejects unsafe nested paths before document mutation', () => {
  const designer = useUiDesigner()
  designer.addNode('button', 'node_root')
  const buttonId = designer.selectedIds.value[0]
  const button = designer.document.value.nodes.find((node) => node.id === buttonId)
  assert.equal(button?.type, 'button')
  const originalStates = button?.type === 'button' ? { ...button.props.imageStates } : undefined
  designer.updateNodeProperty(buttonId, 'imageStates', {
    normal: 'img/pictures/normal.png',
    hover: '../outside.png',
    pressed: '',
    disabled: '',
  })
  const unchangedButton = designer.document.value.nodes.find((node) => node.id === buttonId)
  assert.deepEqual(unchangedButton?.type === 'button' ? unchangedButton.props.imageStates : undefined, originalStates)
  assert.match(designer.actionError.value, /project/i)

  designer.addNode('frameAnimation', 'node_root')
  const frameId = designer.selectedIds.value[0]
  designer.updateNodeProperty(frameId, 'frames', [{ id: 'frame_001', path: 'asset://preview/frame.png', duration: 100 }])
  const unchangedFrame = designer.document.value.nodes.find((node) => node.id === frameId)
  assert.deepEqual(unchangedFrame?.type === 'frameAnimation' ? unchangedFrame.props.frames : undefined, [])
})

test('preview diagnostics follow the active session and retain final cleanup diagnostics', async () => {
  const startDiagnostics = [{ schemaVersion: '1.0.0' as const, sessionId: 'preview-diagnostics', scene: 'Scene_Main', file: 'sceneScript.source', node: 'node_root', type: 'code', phase: 'ready', event: null, code: 'UI_CODE_ERROR', severity: 'error' as const, label: 'Code error', message: 'syntax error', count: 1 }]
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

test('switching scenes flushes the single-file source draft to its captured scene', () => {
  const designer = useUiDesigner()
  const sceneA = designer.activeScene.value
  designer.newScene('Scene_B', { width: 816, height: 624 })
  const sceneB = designer.activeScene.value
  const sceneBSource = sceneB.document.sceneScript.source
  designer.selectScene(sceneA.id)
  designer.previewSourceCode('onReady(function () { this.__sceneA = true; });', sceneA.id)
  assert.equal(designer.selectScene(sceneB.id), true)
  assert.match(sceneA.document.sceneScript.source, /__sceneA/)
  assert.equal(sceneB.document.sceneScript.source, sceneBSource)

  designer.setPropertyCode('node_root', 'x', 'return 12', sceneA.id)
  assert.equal(sceneA.document.nodes.find((node) => node.id === 'node_root')?.propCodes.x, 'return 12')
  assert.equal(designer.activeScene.value.id, sceneB.id)
})

test('undo redo and leaving code mode synchronously resolve the pending scene script draft', () => {
  const designer = useUiDesigner()
  const sceneId = designer.activeSceneId.value
  const originalSource = designer.document.value.sceneScript.source
  let pendingSource: string | undefined = 'onReady(function () { this.__pendingDraft = 1; });'
  const unregister = designer.draftCoordinator.register(() => {
    if (pendingSource === undefined) return
    designer.previewSourceCode(pendingSource, sceneId)
    pendingSource = undefined
    designer.commitSourceCode(sceneId)
  }, {
    sceneId,
    pending: () => pendingSource !== undefined,
  })

  designer.setEditingMode('code')
  designer.undo()
  assert.equal(designer.document.value.sceneScript.source, originalSource)
  designer.redo()
  assert.match(designer.document.value.sceneScript.source, /__pendingDraft = 1/)

  pendingSource = 'onReady(function () { this.__pendingDraft = 2; });'
  designer.setEditingMode('design')
  assert.match(designer.document.value.sceneScript.source, /__pendingDraft = 2/)
  assert.equal(designer.draftCoordinator.hasPending(sceneId), false)
  unregister()
})
