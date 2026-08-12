import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle, UiDesignerPersistenceAdapter } from '@contract/ui-designer'
import { createUiDocument } from '../models/document'
import { exportRuntimeDocument } from '../models/export'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

const success = <T>(value?: T) => ({ status: 'success' as const, message: 'ok', value })

test('Inspector draft flush commits once and one undo restores the original property', () => {
  const designer = useUiDesigner()
  designer.addNode('text', 'node_root')
  const nodeId = designer.selectedIds.value[0]
  const original = designer.document.value.nodes.find((node) => node.id === nodeId)?.props.opacity
  const before = designer.activeScene.value.history.availableUndoSteps
  let pending = 180
  const unregister = designer.draftCoordinator.register(() => {
    if (pending === 0) return
    designer.updateNodeProperty(nodeId, 'opacity', pending)
  }, { sceneId: designer.activeSceneId.value, pending: () => pending !== 0 })

  pending = 220
  pending = 200
  designer.flushDrafts(designer.activeSceneId.value)
  pending = 0
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before + 1)
  assert.equal(designer.document.value.nodes.find((node) => node.id === nodeId)?.props.opacity, 200)
  designer.undo()
  assert.equal(designer.document.value.nodes.find((node) => node.id === nodeId)?.props.opacity, original)
  unregister()
})

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

test('embedded preview hides editor chrome only after the renderer acknowledges the requested mode', () => {
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async stop() { return success(null) },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { rendererHost } })
  designer.editingMode.value = 'code'
  assert.equal(designer.startPreview(), true)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(designer.previewStatus.value, 'preparing')
  assert.equal(designer.canStartPreview.value, false)
  assert.equal(designer.acknowledgePreviewExecutionMode('full-preview'), true)
  assert.equal(designer.isPreviewing.value, true)
  assert.equal(designer.editingMode.value, 'design')
  assert.equal(designer.previewStatus.value, 'running')
  assert.equal(designer.stopPreview(), true)
  assert.equal(designer.isPreviewing.value, true)
  assert.equal(designer.previewStatus.value, 'preparing')
  assert.equal(designer.acknowledgePreviewExecutionMode('authoring'), true)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(designer.previewStatus.value, 'stopped')
})

test('embedded preview failure leaves the controller in authoring mode without an external session', () => {
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async stop() { return success(null) },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { rendererHost } })
  designer.editingMode.value = 'code'
  assert.equal(designer.startPreview(), true)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(designer.acknowledgePreviewExecutionMode('full-preview'), true)
  designer.failPreview('The replacement renderer preparation was superseded.')
  assert.equal(designer.previewStatus.value, 'error')
  assert.equal(designer.previewMessage.value, 'The replacement renderer preparation was superseded.')
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
})

test('preview preparation keeps editor chrome visible and preserves the captured scene on failure', () => {
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async confirm() { return success() },
    async stop() { return success(null) },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { rendererHost } })
  const capturedSceneId = designer.activeSceneId.value
  assert.equal(designer.newScene('Scene_Preview_Target', { width: 816, height: 624 }), true)
  const otherSceneId = designer.activeSceneId.value
  assert.equal(designer.selectScene(capturedSceneId), true)
  designer.editingMode.value = 'code'

  assert.equal(designer.startPreview(), true)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(designer.selectScene(otherSceneId), false)
  assert.equal(designer.activeSceneId.value, capturedSceneId)

  designer.failPreview('The latest scene could not be mounted.')
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(designer.previewStatus.value, 'error')
})

test('error preview retains a cleanup barrier until the authoring retry acknowledges disposal', () => {
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { rendererHost: { async start() { return success() }, async confirm() { return success() }, async stop() { return success(null) } } } })
  designer.failPreview('The isolated renderer was kept for recovery.', true)
  assert.equal(designer.previewCleanupPending.value, true)
  assert.equal(designer.canStartPreview.value, false)
  assert.equal(designer.acknowledgePreviewExecutionMode('authoring'), true)
  assert.equal(designer.previewCleanupPending.value, false)
  assert.equal(designer.previewStatus.value, 'stopped')
  assert.equal(designer.previewMessage.value, '')
  assert.equal(designer.canStartPreview.value, true)
})

test('multiple renderer owners remain in the cleanup barrier until each owner stops once', async () => {
  const designer = useUiDesigner({ projectPath: 'projects/sample' })
  designer.failPreview('The isolated renderer was kept for recovery.', true)
  let firstStops = 0
  let secondStops = 0
  let lateStops = 0
  let secondAttempt = 0
  let releaseSecond!: (result: boolean) => void
  let markSecondStarted!: () => void
  const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve })
  let unregisterFirst = () => undefined
  let unregisterSecond = () => undefined
  let unregisterLate = () => undefined
  unregisterFirst = designer.registerPreviewDisposer(async () => {
    firstStops += 1
    unregisterFirst()
    designer.acknowledgePreviewExecutionMode('authoring')
    unregisterLate = designer.registerPreviewDisposer(async () => {
      lateStops += 1
      unregisterLate()
      return true
    })
    return true
  })
  unregisterSecond = designer.registerPreviewDisposer(async () => {
    secondStops += 1
    secondAttempt += 1
    if (secondAttempt === 1) {
      markSecondStarted()
      return new Promise<boolean>((resolve) => { releaseSecond = resolve })
    }
    unregisterSecond()
    return true
  })

  const firstCleanup = designer.disposePreview('unload')
  await secondStarted
  assert.equal(designer.previewDisposalInFlight.value, true)
  assert.equal(designer.previewCleanupPending.value, false)
  assert.equal(designer.canStartPreview.value, false)
  releaseSecond(false)
  assert.equal(await firstCleanup, false)
  assert.equal(designer.previewDisposalInFlight.value, false)
  assert.equal(designer.previewCleanupPending.value, true)
  assert.deepEqual({ firstStops, secondStops, lateStops }, { firstStops: 1, secondStops: 1, lateStops: 1 })
  assert.equal(await designer.disposePreview('unload'), true)
  assert.equal(designer.previewCleanupPending.value, false)
  assert.equal(designer.previewStatus.value, 'stopped')
  assert.deepEqual({ firstStops, secondStops, lateStops }, { firstStops: 1, secondStops: 2, lateStops: 1 })
})

test('project switching cancels the embedded preview without polling an external session', async () => {
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async stop() { return success(null) },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { rendererHost } })
  designer.editingMode.value = 'code'
  assert.equal(designer.startPreview(), true)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(await designer.setProjectContext('projects/next', { rendererHost }), true)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')
})

test('project switching stops preview ownership before asking about dirty source', async () => {
  const observations: Array<{ mode: string; previewing: boolean }> = []
  let designer!: ReturnType<typeof useUiDesigner>
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async stop() { return success(null) },
  }
  designer = useUiDesigner({
    projectPath: 'projects/sample',
    adapters: { rendererHost },
    confirmDiscard: async () => {
      observations.push({ mode: designer.previewExecutionMode.value, previewing: designer.isPreviewing.value })
      return false
    },
  })
  designer.addNode('text')
  assert.equal(designer.startPreview(), true)
  assert.equal(await designer.setProjectContext('projects/next', { rendererHost }), false)
  assert.deepEqual(observations, [{ mode: 'authoring', previewing: false }])
  assert.equal(designer.isPreviewing.value, false)
})

test('project context changes wait for renderer disposal and retain the old project on stop failure', async () => {
  const designer = useUiDesigner({ projectPath: 'projects/sample' })
  let releaseDispose!: (result: boolean) => void
  let disposalStarted!: () => void
  const started = new Promise<void>((resolve) => { disposalStarted = resolve })
  const disposal = new Promise<boolean>((resolve) => { releaseDispose = resolve })
  const unregister = designer.registerPreviewDisposer(async () => {
    disposalStarted()
    return disposal
  })

  const pending = designer.setProjectContext('projects/next')
  await started
  assert.equal(designer.projectPath.value, 'projects/sample')
  releaseDispose(false)
  assert.equal(await pending, false)
  assert.equal(designer.projectPath.value, 'projects/sample')
  assert.match(designer.previewMessage.value, /could not finish closing/)

  unregister()
  const switched = await designer.setProjectContext('projects/next')
  assert.equal(switched, true)
  assert.equal(designer.projectPath.value, 'projects/next')
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

test('new scene rejects names outside the runtime contract without adding or activating a scene', () => {
  const designer = useUiDesigner()
  const initialSceneIds = designer.scenes.value.map((scene) => scene.id)
  const initialActiveSceneId = designer.activeSceneId.value
  for (const invalidName of ['', 'Fast Final Scene', 'Scene_', 'Scene_Bad-Name', ' Scene_Trimmed']) {
    assert.equal(designer.newScene(invalidName, { width: 640, height: 360 }), false)
    assert.deepEqual(designer.scenes.value.map((scene) => scene.id), initialSceneIds)
    assert.equal(designer.activeSceneId.value, initialActiveSceneId)
  }
  assert.equal(designer.newScene('Scene_Fast_Final_$1', { width: 640, height: 360 }), true)
  assert.equal(designer.document.value.meta.sceneName, 'Scene_Fast_Final_$1')
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
