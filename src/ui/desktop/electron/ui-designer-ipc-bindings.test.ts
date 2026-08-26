import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { cleanupUiDesignerIpcHandlers, registerUiDesignerIpcHandlers } from './ui-designer-ipc-bindings.ts'

test('ui-designer IPC exposes structured file/resource/runtime boundaries', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipcMain = { handle(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler) } }
  let selectedFrameFolder: string | undefined
  let saveDialogs = 0
  const dialog = {
    async showOpenDialog(_parent: unknown, options?: { properties?: string[] }) {
      if (options?.properties?.includes('openDirectory')) return selectedFrameFolder ? { canceled: false, filePaths: [selectedFrameFolder] } : { canceled: true, filePaths: [] }
      return { canceled: true, filePaths: [] }
    },
    async showSaveDialog() { saveDialogs += 1; return { canceled: true, filePath: undefined } },
  }
  let saved = 0
  const revealRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-ipc-'))
  const revealPath = path.join(revealRoot, 'scene.mzui')
  fs.writeFileSync(revealPath, '{}', 'utf8')
  const revealed: string[] = []
  const recent: Array<{ path: string; options?: { opened?: boolean; saved?: boolean; sceneName?: string; projectPath?: string; thumbnailDataUrl?: string } }> = []
  const recentProjects: Array<string | undefined> = []
  const thumbnails: Array<{ project: string; sceneName: string; dataUrl: string }> = []
  let rendererStarts = 0
  const userDataStore = {
    isWorkingDocumentPath: (filePath: string) => filePath.startsWith('runtime/documents/'),
    saveWorkingDocument: (_document: unknown, options: { path?: string; duplicate?: boolean } = {}) => {
      saved += 1
      const filePath = !options.duplicate && options.path?.startsWith('runtime/documents/') ? options.path : `runtime/documents/${saved}.mzui`
      return { path: filePath, digest: `digest-${saved}`, mtimeMs: saved, size: 2 }
    },
    recordRecentFile(path: string, options?: { opened?: boolean; saved?: boolean; sceneName?: string; projectPath?: string; thumbnailDataUrl?: string }) { recent.push({ path, options }); return { sourcePath: path, lastOpenedAt: 'now', exists: true } },
    listRecentFiles: (project?: string) => { recentProjects.push(project); return [] },
    removeRecentFile: () => {},
    writeRecovery: () => ({ id: 'recovery', sourcePath: '', snapshotPath: 'snapshot', savedAt: 'now', digest: 'digest', mtimeMs: 1 }),
    listRecovery: () => [],
    readRecovery: () => ({ record: { id: 'recovery', sourcePath: '', snapshotPath: 'snapshot', savedAt: 'now', digest: 'digest', mtimeMs: 1 }, document: {} }),
    clearRecovery: () => {},
    readPreferences: () => ({}),
    writePreferences: () => {},
  }
  registerUiDesignerIpcHandlers(ipcMain, dialog, {
    workflowRoot: 'workflow',
    resolveProject: (project) => project || 'project',
    file: {
      readUiDesignerFile: (filePath) => ({ document: { meta: { sceneName: 'Scene_Sample' } }, metadata: { path: path.resolve(filePath), digest: 'digest', mtimeMs: 1, size: 2 } }),
      saveUiDesignerFile: (filePath) => { saved += 1; return { path: path.resolve(filePath), digest: `digest-${saved}`, mtimeMs: saved, size: 2 } },
      projectUiDesignerScenePath: (project, sceneName) => path.join(project, '.luna_rpg', 'ui-designer', 'scenes', `${sceneName}.mzui`),
      writeProjectUiDesignerThumbnail: (project, sceneName, dataUrl) => { thumbnails.push({ project, sceneName, dataUrl }); return path.join(project, '.luna_rpg', 'ui-designer', 'thumbnails', `${sceneName}.png`) },
      revealSource: (filePath: string) => { revealed.push(filePath) },
      UiDesignerUserDataStore: class { constructor() { return userDataStore as any } } as any,
    },
    project: {
      inspectUiDesignerProjectProfile: () => ({
        engine: 'MV', engineVersion: null, screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624,
      }),
      listUiDesignerSceneFiles: () => [],
    },
    resources: {
      inspectUiDesignerResourcesAsync: async () => ({ resources: [] }),
      inspectUiDesignerResourceReferences: () => ({ resources: [] }),
      selectUiDesignerFrameFolder: (project: string, selected: string) => [{
        id: 'image:img/frames/001.png', category: 'image', path: 'img/frames/001.png', relativePath: 'img/frames/001.png',
        previewUrl: `rmmv-asset://${project}/img/frames/001.png`, name: '001.png', exists: true, referenced: false, size: 1,
      }],
      readUiDesignerSceneData: (_project: string, requestedPath: string) => ({
        scene: { version: '1.1.0', runtimeVersion: '>=1.1.0', meta: { sceneName: 'Scene_Sample', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624 }, transitions: { enter: { type: 'none', duration: 0 }, exit: { type: 'none', duration: 0 } }, globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.1.0', source: '' } },
        metadata: { id: `sceneData:${requestedPath}`, relativePath: requestedPath, sceneName: 'Scene_Sample', version: '1.1.0', runtimeVersion: '>=1.1.0', compatibility: 'compatible', digest: 'digest', mtimeMs: 1, size: 2 },
        projectCompatibility: { engine: 'MV', engineVersion: null, engineVersionSupported: true, warnings: [] },
      }),
    },
    runtime: {
      inspectUiDesignerRuntime: () => ({ state: 'missing' }),
      stageUiDesignerRuntimeInstall: () => ({ status: 'staged' }),
      stageUiDesignerSceneExport: () => ({ status: 'staged' }),
      writeUiDesignerRuntimeExport: () => ({ path: 'Scene_Sample.json', digest: 'digest', mtimeMs: 2, size: 2 }),
    },
    rendererHost: {
      start: async (_project: string, generation: number) => { rendererStarts += 1; return { sessionId: 'renderer-session', generation, iframeUrl: 'rpg-agent-preview://renderer/index.html', engine: 'MV', engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 } },
      confirm: (sessionId: string) => ({ sessionId, generation: 2, iframeUrl: 'rpg-agent-preview://renderer/index.html', engine: 'MV', engineVersion: '1.6.2', runtimeVersion: '1.1.0', resourceRevision: 0 }),
      stop: () => undefined,
      syncResources: (request) => ({ sessionId: request.sessionId, generation: request.generation, resourceRevision: 1, upsertedRelativePaths: request.manifest.upsertRelativePaths, deletedRelativePaths: request.manifest.deleteRelativePaths }),
    },
    userDataStore: () => userDataStore as any,
  })

  const opened = await handlers.get('ui-designer:file:open')!({ sender: {} }, { path: 'scene.mzui' })
  assert.equal(opened.status, 'ready')
  assert.equal(opened.sourcePath, path.resolve('scene.mzui'))
  assert.deepEqual(recent[0], { path: path.resolve('scene.mzui'), options: { opened: true, sceneName: 'Scene_Sample' } })
  const savedResult = await handlers.get('ui-designer:file:save')!({ sender: {} }, { path: opened.sourcePath, project: revealRoot }, { meta: { sceneName: 'Scene_Sample' } })
  assert.equal(savedResult.status, 'success')
  assert.equal(savedResult.sourcePath, opened.sourcePath)
  const thumbnailDataUrl = 'data:image/png;base64,iVBORw0KGgo='
  const firstSavePath = path.join(revealRoot, '.luna_rpg', 'ui-designer', 'scenes', 'Scene_New.mzui')
  fs.mkdirSync(path.dirname(firstSavePath), { recursive: true })
  fs.writeFileSync(firstSavePath, '{}', 'utf8')
  const firstSaveConflict = await handlers.get('ui-designer:file:save')!({ sender: {} }, { project: revealRoot, thumbnailDataUrl }, { meta: { sceneName: 'Scene_New' } })
  assert.equal(firstSaveConflict.status, 'error')
  assert.equal(firstSaveConflict.code, 'UI_DESIGNER_OVERWRITE_REQUIRED')
  assert.deepEqual(firstSaveConflict.conflict, {
    code: 'UI_DESIGNER_CONFLICT',
    expected: undefined,
    actual: { path: firstSavePath, digest: 'digest', mtimeMs: 1, size: 2 },
    recoverable: true,
  })
  fs.rmSync(firstSavePath)
  const firstSave = await handlers.get('ui-designer:file:save')!({ sender: {} }, { project: revealRoot, thumbnailDataUrl }, { meta: { sceneName: 'Scene_New' } })
  assert.equal(firstSave.status, 'success')
  assert.equal(firstSave.sourcePath, firstSavePath)
  assert.deepEqual(thumbnails, [{ project: revealRoot, sceneName: 'Scene_New', dataUrl: thumbnailDataUrl }])
  assert.equal(saved, 2)
  assert.equal(saveDialogs, 0)
  assert.equal(recent[1].options?.saved, true)
  assert.equal(recent[1].options?.opened, false)
  assert.equal(recent[1].options?.projectPath, revealRoot)
  const projectRecent = await handlers.get('ui-designer:recent:list')!(null, { project: revealRoot })
  assert.equal(projectRecent.status, 'success')
  assert.deepEqual(recentProjects, [revealRoot])
  const revealResult = await handlers.get('ui-designer:file:reveal-source')!(null, revealPath)
  assert.equal(revealResult.status, 'success')
  assert.deepEqual(revealed, [path.resolve(revealPath)])
  const revealDenied = await handlers.get('ui-designer:file:reveal-source')!(null, path.join(revealRoot, 'missing.mzui'))
  assert.equal(revealDenied.status, 'error')
  const profile = await handlers.get('ui-designer:project:profile')!(null, { project: 'project' })
  assert.equal(profile.status, 'success')
  assert.deepEqual(profile.value, { engine: 'MV', engineVersion: null, screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 })
  assert.equal('projectPath' in profile.value, false)
  const missingProfile = await handlers.get('ui-designer:project:profile')!(null, {})
  assert.equal(missingProfile.status, 'error')
  assert.equal(missingProfile.code, 'UI_DESIGNER_PROJECT_REQUIRED')
  const projectScenes = await handlers.get('ui-designer:scenes:list')!(null, { project: revealRoot })
  assert.equal(projectScenes.status, 'success')
  assert.deepEqual(projectScenes.value, [])
  const resources = await handlers.get('ui-designer:resources:list')!(null, { project: 'project' })
  assert.equal(resources.status, 'success')
  const sceneData = await handlers.get('ui-designer:resources:read-scene-data')!(null, { project: 'project', path: 'js/plugins/mzui-data/Scene_Sample.json' })
  assert.equal(sceneData.status, 'success')
  assert.equal(sceneData.value.metadata.compatibility, 'compatible')
  assert.equal(sceneData.value.projectCompatibility.engine, 'MV')
  selectedFrameFolder = 'project/img/frames'
  const selected = await handlers.get('ui-designer:file:select-frame-folder')!({ sender: {} }, { project: 'project' })
  assert.equal(selected.status, 'success')
  assert.equal(selected.value[0].relativePath, 'img/frames/001.png')
  const missingEnable = await handlers.get('ui-designer:runtime:install')!(null, { project: 'project' })
  assert.equal(missingEnable.status, 'error')
  assert.equal(missingEnable.code, 'UI_DESIGNER_RUNTIME_ENABLE_REQUIRED')
  const runtimeExport = await handlers.get('ui-designer:runtime:export')!({ sender: {} }, {
    path: 'Scene_Sample.json',
    scene: { meta: { sceneName: 'Scene_Sample' } },
  })
  assert.equal(runtimeExport.status, 'success')
  assert.equal(runtimeExport.value, 'Scene_Sample.json')
  const missingRendererProject = await handlers.get('ui-designer:renderer:start')!(null, { project: '', generation: 2 })
  assert.equal(missingRendererProject.status, 'error')
  assert.equal(missingRendererProject.code, 'UI_DESIGNER_PROJECT_REQUIRED')
  assert.equal(rendererStarts, 0)
  const renderer = await handlers.get('ui-designer:renderer:start')!(null, { project: 'project', generation: 2 })
  assert.equal(renderer.status, 'success')
  assert.equal(renderer.value.runtimeVersion, '1.1.0')
  assert.equal(rendererStarts, 1)
  const resourceSync = await handlers.get('ui-designer:renderer:sync-resources')!(null, {
    project: 'project', sessionId: renderer.value.sessionId, generation: 2,
    manifest: { schemaVersion: '1.0.0', upsertRelativePaths: ['img/pictures/new.png'], deleteRelativePaths: ['img/pictures/old.png'] },
  })
  assert.equal(resourceSync.status, 'success')
  assert.equal(resourceSync.value.resourceRevision, 1)
  assert.deepEqual(resourceSync.value.deletedRelativePaths, ['img/pictures/old.png'])
  assert.equal(handlers.has('ui-designer:preview:start'), false)
  assert.equal(handlers.has('ui-designer:preview:current'), false)
  assert.equal(handlers.has('ui-designer:preview:stop'), false)
  const canceled = await handlers.get('ui-designer:file:open')!({ sender: {} })
  assert.equal(canceled.status, 'idle')
  const removed: string[] = []
  cleanupUiDesignerIpcHandlers({ removeHandler: (name: string) => { removed.push(name) } })
  assert.equal(removed.includes('ui-designer:project:profile'), true)
  assert.equal(removed.includes('ui-designer:renderer:sync-resources'), true)
  fs.rmSync(revealRoot, { recursive: true, force: true })
})
