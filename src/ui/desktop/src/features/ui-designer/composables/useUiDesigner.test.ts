import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import type { UiDesignerAdapterBundle, UiDesignerPersistenceAdapter } from '@contract/ui-designer'
import { createUiDocument } from '../models/document'
import { exportRuntimeDocument } from '../models/export'
import { nodeRect } from '../models/geometry'

vi.mock('../adapters', () => ({
  createUiDesignerAdapters: (overrides: UiDesignerAdapterBundle = {}) => ({ ...overrides }),
}))

import { useUiDesigner } from './useUiDesigner'

const success = <T>(value?: T) => ({ status: 'success' as const, message: 'ok', value })

test('applies a scene JSON edit as one undoable step and rejects invalid input', () => {
  const designer = useUiDesigner()
  const before = designer.activeScene.value.history.availableUndoSteps
  const document = designer.document.value
  const source = JSON.stringify({ ...document, meta: { ...document.meta, description: 'json edit' } }, null, 2)
  const applied = designer.applyJsonDocument(source)
  assert.equal(applied.ok, true)
  assert.equal(designer.document.value.meta.description, 'json edit')
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before + 1)
  designer.undo()
  assert.equal(designer.document.value.meta.description, document.meta.description)

  assert.equal(designer.applyJsonDocument('{ not json').ok, false)
  assert.equal(designer.applyJsonDocument('{}').ok, false)
  assert.equal(designer.document.value.meta.description, document.meta.description)
})

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

test('Inspector property preview stays live and one gesture creates one undo step', () => {
  const designer = useUiDesigner()
  designer.addNode('text', 'node_root')
  const nodeId = designer.selectedIds.value[0]
  const original = designer.document.value.nodes.find((node) => node.id === nodeId)?.props.opacity
  const before = designer.activeScene.value.history.availableUndoSteps

  assert.equal(designer.previewNodeProperty(nodeId, 'opacity', 220), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === nodeId)?.props.opacity, 220)
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before)
  assert.equal(designer.previewNodeProperty(nodeId, 'opacity', 160), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === nodeId)?.props.opacity, 160)
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before)

  assert.equal(designer.commitNodePropertyPreview(nodeId, 'opacity'), true)
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before + 1)
  designer.undo()
  assert.equal(designer.document.value.nodes.find((node) => node.id === nodeId)?.props.opacity, original)
})

test('selecting an image resource makes its authoring preview URL available immediately', async () => {
  const loadReferenced = vi.fn(async (request: { referencedPaths: string[] }) => success({
    projectPath: 'projects/sample',
    engine: 'MV' as const,
    resources: request.referencedPaths.map((path) => ({
      id: `image:${path}`,
      category: 'image' as const,
      path,
      relativePath: path,
      previewUrl: 'rmmv-asset://project/sample/img/pictures/Example.png',
      name: 'Example.png',
      exists: true,
      referenced: true,
    })),
  }))
  const designer = useUiDesigner({
    projectPath: 'projects/sample',
    adapters: {
      resource: {
        async loadProject() { return success({ projectPath: 'projects/sample', engine: 'MV' as const, resources: [] }) },
        loadReferenced,
        async readSceneData() { return { status: 'unavailable' as const, message: 'unused' } },
      },
    },
  })
  designer.addNode('sprite', 'node_root')
  const nodeId = designer.selectedIds.value[0]
  designer.updateNodeProperty(nodeId, 'path', 'img/pictures/Example.png')
  await vi.waitFor(() => assert.equal(designer.resourceCatalog.value?.resources[0]?.previewUrl, 'rmmv-asset://project/sample/img/pictures/Example.png'))
  assert.deepEqual(loadReferenced.mock.calls[0]?.[0].referencedPaths, ['img/pictures/Example.png'])
})

test('adding a button requests the window skin resource for the authoring canvas', async () => {
  const loadReferenced = vi.fn(async (request: { referencedPaths: string[] }) => success({
    projectPath: 'projects/sample',
    engine: 'MV' as const,
    resources: request.referencedPaths.map((path) => ({
      id: `image:${path}`,
      category: 'image' as const,
      path,
      relativePath: path,
      previewUrl: `rmmv-asset://project/sample/${path}`,
      name: path.split('/').pop() ?? path,
      exists: true,
      referenced: true,
    })),
  }))
  const designer = useUiDesigner({
    projectPath: 'projects/sample',
    adapters: {
      resource: {
        async loadProject() { return success({ projectPath: 'projects/sample', engine: 'MV' as const, resources: [] }) },
        loadReferenced,
        async readSceneData() { return { status: 'unavailable' as const, message: 'unused' } },
      },
    },
  })
  designer.addNode('button', 'node_root')
  await vi.waitFor(() => assert.ok(loadReferenced.mock.calls.some(([request]) => request.referencedPaths.includes('img/system/Window.png'))))
  await vi.waitFor(() => assert.equal(
    designer.resourceCatalog.value?.resources.find((resource) => resource.relativePath === 'img/system/Window.png')?.previewUrl,
    'rmmv-asset://project/sample/img/system/Window.png',
  ))
})

test('selecting a sprite image adopts its intrinsic dimensions in one undoable edit', () => {
  const designer = useUiDesigner()
  designer.addNode('sprite', 'node_root')
  const nodeId = designer.selectedIds.value[0]
  const before = designer.activeScene.value.history.availableUndoSteps

  assert.equal(designer.setSpriteResource(nodeId, 'img/pictures/Example.png', { width: 648, height: 324 }), true)
  const selected = designer.document.value.nodes.find((node) => node.id === nodeId)
  assert.equal(selected?.type, 'sprite')
  if (selected?.type !== 'sprite') return
  assert.equal(selected.props.path, 'img/pictures/Example.png')
  assert.equal(selected.props.width, 648)
  assert.equal(selected.props.height, 324)
  assert.equal(selected.props.fillMode, 'stretch')
  assert.equal(selected.props.scaleX, 1)
  assert.equal(selected.props.scaleY, 1)
  assert.equal(selected.props.anchorX, 0.5)
  assert.equal(selected.props.anchorY, 0.5)
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before + 1)

  designer.undo()
  const restored = designer.document.value.nodes.find((node) => node.id === nodeId)
  assert.equal(restored?.type === 'sprite' ? restored.props.path : undefined, '')
  assert.equal(restored?.type === 'sprite' ? restored.props.width : undefined, 160)
  assert.equal(restored?.type === 'sprite' ? restored.props.height : undefined, 80)
})

test('selecting an oversized sprite keeps source pixels but fits the visible node inside its parent', () => {
  const designer = useUiDesigner()
  designer.addNode('sprite', 'node_root')
  const nodeId = designer.selectedIds.value[0]

  assert.equal(designer.setSpriteResource(nodeId, 'img/pictures/LargeExample.png', { width: 1600, height: 900 }), true)
  const selected = designer.document.value.nodes.find((node) => node.id === nodeId)
  assert.equal(selected?.type, 'sprite')
  if (selected?.type !== 'sprite') return
  assert.deepEqual([selected.props.width, selected.props.height], [1600, 900])
  assert.equal(selected.props.scaleX, selected.props.scaleY)
  assert.ok(selected.props.scaleX < 1)
  assert.ok(selected.props.width * selected.props.scaleX <= designer.document.value.canvas.width)
  assert.ok(selected.props.height * selected.props.scaleY <= designer.document.value.canvas.height)
})

test('closing the only opened tab leaves no scene behind', async () => {
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
  assert.equal(designer.scenes.value.length, 0)
  assert.equal(designer.activeScene.value, undefined)
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

test('editor preview and in-game preview keep distinct embedded execution modes', () => {
  const rendererHost = {
    async start() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async confirm() { return success({ sessionId: 'renderer-session', generation: 1, iframeUrl: 'rpg-agent-preview://sample/index.html', engine: 'MV' as const, engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }) },
    async stop() { return success(null) },
  }
  const designer = useUiDesigner({ projectPath: 'projects/sample', adapters: { rendererHost } })
  designer.editingMode.value = 'code'

  assert.equal(designer.startEditorPreview(), true)
  assert.equal(designer.isEditorPreviewing.value, false)
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.previewExecutionMode.value, 'editor-preview')
  assert.equal(designer.previewStatus.value, 'preparing')
  assert.equal(designer.editingMode.value, 'code')
  assert.equal(designer.acknowledgePreviewExecutionMode('editor-preview'), true)
  assert.equal(designer.isEditorPreviewing.value, true)
  assert.equal(designer.editingMode.value, 'design')
  assert.equal(designer.stopEditorPreview(), true)
  assert.equal(designer.isEditorPreviewing.value, true)
  assert.equal(designer.previewExecutionMode.value, 'authoring')
  assert.equal(designer.previewStatus.value, 'preparing')
  assert.equal(designer.acknowledgePreviewExecutionMode('authoring'), true)
  assert.equal(designer.isEditorPreviewing.value, false)
  assert.equal(designer.editingMode.value, 'code')

  assert.equal(designer.startPreview(), true)
  assert.equal(designer.previewExecutionMode.value, 'full-preview')
  assert.equal(designer.isPreviewing.value, false)
  assert.equal(designer.acknowledgePreviewExecutionMode('full-preview'), true)
  assert.equal(designer.isPreviewing.value, true)
  assert.equal(designer.isEditorPreviewing.value, false)
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
    async listSceneFiles() {
      return success([{ path: 'ui/title.mzui', sceneName: 'Scene_Profile_Title' }])
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
      async listSceneFiles() {
        return success([])
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

test('align and distribute move only selection roots so nested children keep parent-relative offsets', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root')!
  const childId = designer.addNode('button', containerId)!
  const otherId = designer.addNode('button', 'node_root')!
  const before = designer.document.value
  const childX = before.nodes.find((node) => node.id === childId)!.props.x
  const containerX = before.nodes.find((node) => node.id === containerId)!.props.x
  const otherX = before.nodes.find((node) => node.id === otherId)!.props.x

  designer.selectNodes([containerId, childId, otherId])
  assert.equal(designer.align('left'), true)
  const aligned = designer.document.value
  const alignedContainer = aligned.nodes.find((node) => node.id === containerId)!
  const alignedChild = aligned.nodes.find((node) => node.id === childId)!
  const alignedOther = aligned.nodes.find((node) => node.id === otherId)!
  assert.equal(alignedChild.props.x, childX)
  const referenceX = Math.min(containerX, otherX)
  assert.equal(alignedContainer.props.x, referenceX)
  assert.equal(alignedOther.props.x, referenceX)
})

test('new palette siblings cascade without turning a selected container into an implicit template', () => {
  const designer = useUiDesigner()
  const parentId = 'node_root'
  const containerId = designer.addNode('container', parentId)
  const titleId = designer.addNode('text', parentId)
  const firstButtonId = designer.addNode('button', parentId)
  const secondButtonId = designer.addNode('button', parentId)
  assert.ok(containerId && titleId && firstButtonId && secondButtonId)

  const added = [containerId, titleId, firstButtonId, secondButtonId].map((id) => designer.document.value.nodes.find((node) => node.id === id))
  assert.deepEqual(added.map((node) => node?.parentId), [parentId, parentId, parentId, parentId])
  assert.deepEqual(added.map((node) => [node?.props.x, node?.props.y]), [[24, 24], [48, 48], [72, 72], [96, 96]])
})

test('adds a new node as a child when the active tree target is a container', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root', { x: 120, y: 90 })!
  designer.selectNodes([containerId])
  const spriteId = designer.addNode('sprite')!
  const container = designer.document.value.nodes.find((node) => node.id === containerId)
  const sprite = designer.document.value.nodes.find((node) => node.id === spriteId)
  assert.equal(sprite?.parentId, containerId)
  assert.deepEqual(container?.children, [spriteId])
  assert.deepEqual([sprite?.props.x, sprite?.props.y], [144, 114])
  assert.equal(container?.type === 'container' ? container.props.clip : undefined, false)
})

test('selecting an image in an unclipped container keeps its intrinsic size and allows overflow', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root', { x: 120, y: 90 })!
  const spriteId = designer.addNode('sprite', containerId)!

  assert.equal(designer.setSpriteResource(spriteId, 'img/pictures/LargeExample.png', { width: 816, height: 624 }), true)
  const sprite = designer.document.value.nodes.find((node) => node.id === spriteId)
  assert.equal(sprite?.type, 'sprite')
  if (sprite?.type !== 'sprite') return
  assert.deepEqual([sprite.props.width, sprite.props.height, sprite.props.scaleX, sprite.props.scaleY], [816, 624, 1, 1])
  assert.ok(sprite.props.x + sprite.props.width / 2 > 120 + 240)
  assert.ok(sprite.props.y + sprite.props.height / 2 > 90 + 160)
})

test('rotation pivots on the visual center and commits angle plus repositioned anchor', () => {
  const designer = useUiDesigner()
  const nodeId = designer.addNode('sprite', 'node_root', { x: 100, y: 100 })!
  const original = designer.document.value.nodes.find((node) => node.id === nodeId)!
  const before = designer.activeScene.value.history.availableUndoSteps

  designer.previewNodeRotation(nodeId, 37)
  assert.equal(designer.draftRotations.value[nodeId], 37)
  assert.equal(designer.commitDraftRotation(nodeId), true)

  const rotated = designer.document.value.nodes.find((node) => node.id === nodeId)!
  assert.deepEqual([rotated.props.x, rotated.props.y, rotated.props.rotate], [140, 60, 37])
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before + 1)
  designer.undo()
  const restored = designer.document.value.nodes.find((node) => node.id === nodeId)!
  assert.deepEqual([restored.props.x, restored.props.y, restored.props.rotate], [original.props.x, original.props.y, original.props.rotate])
})

test('moving a container previews and commits its complete subtree as one transaction', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root')!
  const childId = designer.addNode('text', containerId)!
  const container = designer.document.value.nodes.find((node) => node.id === containerId)!
  const child = designer.document.value.nodes.find((node) => node.id === childId)!
  const origins = {
    [containerId]: { x: container.props.x, y: container.props.y },
    [childId]: { x: child.props.x, y: child.props.y },
  }
  const before = designer.activeScene.value.history.availableUndoSteps

  const drafts = designer.previewSelectedPositionsWithSnap([containerId], origins, { x: 48, y: 32 })
  assert.deepEqual(drafts[containerId], { x: origins[containerId].x + 48, y: origins[containerId].y + 32 })
  assert.deepEqual(drafts[childId], { x: origins[childId].x + 48, y: origins[childId].y + 32 })
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before)

  assert.equal(designer.commitDraftPositions([containerId]), true)
  assert.equal(designer.document.value.nodes.find((node) => node.id === containerId)?.props.x, origins[containerId].x + 48)
  assert.equal(designer.document.value.nodes.find((node) => node.id === childId)?.props.x, origins[childId].x + 48)
  assert.equal(designer.activeScene.value.history.availableUndoSteps, before + 1)
})

test('drag previews publish snap feedback lines and clear them on commit', () => {
  const designer = useUiDesigner()
  const targetId = designer.addNode('text', 'node_root', { x: 210, y: 40 })!
  const draggedId = designer.addNode('text', 'node_root', { x: 132, y: 40 })!
  const target = designer.document.value.nodes.find((node) => node.id === targetId)!
  const dragged = designer.document.value.nodes.find((node) => node.id === draggedId)!
  const origins = { [draggedId]: { x: dragged.props.x, y: dragged.props.y } }

  const drafts = designer.previewSelectedPositionsWithSnap([draggedId], origins, { x: 81, y: 0 })
  assert.equal(drafts[draggedId].x, 210)
  const feedback = designer.snapFeedback.value
  assert.ok(feedback)
  assert.deepEqual(feedback!.guideIds, [])
  const xLine = feedback!.lines.find((line) => line.axis === 'x' && line.source === 'node')
  assert.equal(xLine?.position, 210)
  const targetRect = nodeRect(target)
  const draggedRect = nodeRect(dragged)
  assert.equal(xLine?.start, Math.min(draggedRect.y, targetRect.y))
  assert.equal(xLine?.end, Math.max(draggedRect.y + draggedRect.height, targetRect.y + targetRect.height))

  assert.equal(designer.commitDraftPositions([draggedId]), true)
  assert.equal(designer.snapFeedback.value, null)
})

test('reparenting a node into a container immediately clamps it inside the destination', () => {
  const designer = useUiDesigner()
  const containerId = designer.addNode('container', 'node_root', { x: 120, y: 90 })!
  designer.updateNodeProperty(containerId, 'clip', true)
  const childId = designer.addNode('sprite', 'node_root', { x: 760, y: 560 })!

  assert.equal(designer.reparent(childId, containerId, 'inner'), true)
  const container = designer.document.value.nodes.find((node) => node.id === containerId)!
  const child = designer.document.value.nodes.find((node) => node.id === childId)!
  assert.equal(child.parentId, containerId)
  assert.ok(child.props.x >= container.props.x)
  assert.ok(child.props.y >= container.props.y)
  assert.ok(child.props.x + child.props.width <= container.props.x + container.props.width)
  assert.ok(child.props.y + child.props.height <= container.props.y + container.props.height)
})

test('reparenting without a clipping destination preserves the node geometry exactly', () => {
  const designer = useUiDesigner()
  const spriteId = designer.addNode('sprite', 'node_root', { x: 100, y: 80 })!
  designer.updateNodeProperty(spriteId, 'width', 101)
  designer.updateNodeProperty(spriteId, 'height', 63)
  const containerId = designer.addNode('container', 'node_root', { x: 300, y: 200 })!

  const assertGeometry = () => {
    const sprite = designer.document.value.nodes.find((node) => node.id === spriteId)!
    assert.deepEqual([sprite.props.x, sprite.props.y, sprite.props.width, sprite.props.height], [100, 80, 101, 63])
  }

  assert.equal(designer.reparent(spriteId, containerId, 'inner'), true)
  assertGeometry()
  assert.equal(designer.reparent(spriteId, 'node_root', 'inner'), true)
  assertGeometry()
  assert.equal(designer.reparent(spriteId, containerId, 'inner'), true)
  assertGeometry()
})

test('resizing a text node changes its box without changing font size or scale', () => {
  const designer = useUiDesigner()
  const textId = designer.addNode('text', 'node_root', { x: 100, y: 100 })!
  const node = () => designer.document.value.nodes.find((item) => item.id === textId)!
  const origin = nodeRect(node())
  const baseFontSize = node().type === 'text' ? node().props.fontSize : 0
  assert.ok(baseFontSize > 0)
  designer.previewNodeResizeWithSnap(textId, origin, 'se', { x: origin.width, y: origin.height }, { preserveAspect: false, fromCenter: false })
  assert.equal(designer.commitDraftRect(textId), true)
  const resized = node()
  assert.equal(resized.type === 'text' ? resized.props.fontSize : 0, baseFontSize)
  assert.equal(resized.props.width, origin.width * 2)
  assert.equal(resized.props.height, origin.height * 2)
  assert.equal(resized.props.scaleX, 1)
  assert.equal(resized.props.scaleY, 1)
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
