import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { cleanupUiDesignerIpcHandlers, registerUiDesignerIpcHandlers } from './ui-designer-ipc-bindings.ts'

const metadata = (filePath: string) => {
  const content = fs.readFileSync(filePath)
  const stat = fs.statSync(filePath)
  return { path: path.resolve(filePath), digest: crypto.createHash('sha256').update(content).digest('hex'), mtimeMs: stat.mtimeMs, size: stat.size }
}

test('scene IPC saves directly in the current project and keeps overwrite semantics explicit', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-designer-ipc-'))
  const sceneDirectory = path.join(project, 'data', 'ui-scenes')
  fs.mkdirSync(sceneDirectory, { recursive: true })
  const scenePath = (sceneName: string) => path.join(sceneDirectory, `${sceneName}.mzui`)
  const writeScene = (sceneName: string, marker = '') => {
    const document = { editorVersion: '1.1.0', version: '1.1.0', meta: { sceneName, sceneBase: 'Scene_Base', author: '', description: '', canvasWidth: 816, canvasHeight: 624 }, marker }
    fs.writeFileSync(scenePath(sceneName), JSON.stringify(document), 'utf8')
    return document
  }

  const handlers = new Map<string, (...args: any[]) => any>()
  const ipcMain = { handle(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler) } }
  const recent: string[] = []
  const removedRecent: string[] = []
  let runtimeInstalls = 0
  let selectedImportPath: string | null = null
  const store = {
    isWorkingDocumentPath: () => false,
    saveWorkingDocument: () => { throw new Error('Working-document storage is not part of project scene saves.') },
    listRecentFiles: () => recent.map((sourcePath) => ({ sourcePath, projectPath: project, lastOpenedAt: 'now', exists: fs.existsSync(sourcePath) })),
    recordRecentFile: (sourcePath: string) => { recent.push(path.resolve(sourcePath)); return { sourcePath, lastOpenedAt: 'now', exists: true } },
    removeRecentFile: (sourcePath: string) => { removedRecent.push(path.resolve(sourcePath)) },
    writeRecovery: () => ({ id: 'recovery', sourcePath: '', snapshotPath: 'snapshot', savedAt: 'now', digest: 'digest', mtimeMs: 1 }),
    listRecovery: () => [],
    readRecovery: () => ({ record: { id: 'recovery', sourcePath: '', snapshotPath: 'snapshot', savedAt: 'now', digest: 'digest', mtimeMs: 1 }, document: {} }),
    clearRecovery: () => undefined,
    readPreferences: () => ({}),
    writePreferences: () => undefined,
  }

  registerUiDesignerIpcHandlers(ipcMain, {
    showOpenDialog: async () => selectedImportPath
      ? ({ canceled: false, filePaths: [selectedImportPath] })
      : ({ canceled: true, filePaths: [] }),
  }, {
    workflowRoot: path.join(project, 'install'),
    resolveProject: (requested) => requested ? path.resolve(requested) : project,
    file: {
      readUiDesignerFile: (filePath) => ({ document: JSON.parse(fs.readFileSync(filePath, 'utf8')), metadata: metadata(filePath) }),
      saveUiDesignerFile: (filePath, document) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, JSON.stringify(document), 'utf8')
        return metadata(filePath)
      },
      projectUiDesignerScenePath: (_project, sceneName) => scenePath(sceneName),
      migrateLegacyProjectUiDesignerScenes: () => ({ copied: [] }),
      readProjectUiDesignerGlobalData: () => ({ data: {}, metadata: null }),
      saveProjectUiDesignerGlobalData: (_project, data) => {
        const target = path.join(project, 'data', 'GlobalUI.json')
        fs.writeFileSync(target, JSON.stringify(data), 'utf8')
        return metadata(target)
      },
      writeProjectUiDesignerThumbnail: (_project, sceneName) => path.join(project, '.luna_rpg', 'ui-designer', 'thumbnails', `${sceneName}.png`),
      revealSource: () => undefined,
      UiDesignerUserDataStore: class { constructor() { return store as any } } as any,
    },
    project: {
      inspectUiDesignerProjectProfile: () => ({ engine: 'MV', engineVersion: null, screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 }),
      listUiDesignerSceneFiles: () => recent.filter((sourcePath) => fs.existsSync(sourcePath)).map((sourcePath) => ({ path: path.relative(project, sourcePath).replaceAll('\\', '/'), sourcePath, sceneName: path.basename(sourcePath, '.mzui'), modifiedAt: new Date().toISOString() })),
    },
    resources: {
      inspectUiDesignerResourcesAsync: async () => ({ resources: [] }),
      inspectUiDesignerResourceReferences: () => ({ resources: [] }),
      readUiDesignerSceneData: () => { throw new Error('unused') },
    },
    runtime: {
      inspectUiDesignerRuntime: () => ({ state: 'enabled-compatible', message: 'Ready.' }),
      installUiDesignerRuntime: () => { runtimeInstalls += 1; return { status: 'installed' } },
    },
    userDataStore: () => store as any,
  })

  const missingSelection = await handlers.get('ui-designer:file:open')!(null, { project })
  assert.equal(missingSelection.code, 'UI_DESIGNER_PROJECT_SCENE_REQUIRED')

  const outside = path.join(project, 'Scene_Outside.mzui')
  fs.writeFileSync(outside, JSON.stringify({ meta: { sceneName: 'Scene_Outside' } }), 'utf8')
  const outsideResult = await handlers.get('ui-designer:file:open')!(null, { project, path: outside })
  assert.equal(outsideResult.code, 'UI_DESIGNER_PROJECT_SCENE_REQUIRED')

  selectedImportPath = outside
  const imported = await handlers.get('ui-designer:file:import')!({ sender: null }, { project })
  assert.equal(imported.status, 'success')
  assert.equal(imported.value.meta.sceneName, 'Scene_Outside')
  assert.equal(imported.sourcePath, undefined)
  selectedImportPath = null

  writeScene('Scene_Sample', 'original')
  const opened = await handlers.get('ui-designer:file:open')!(null, { project, path: scenePath('Scene_Sample') })
  assert.equal(opened.status, 'ready')
  assert.equal(opened.sourcePath, path.resolve(scenePath('Scene_Sample')))

  const firstUpdate = { ...opened.value, marker: 'first update' }
  const firstSave = await handlers.get('ui-designer:file:save')!(null, { project, path: opened.sourcePath, expected: opened.metadata }, firstUpdate)
  assert.equal(firstSave.status, 'success')
  const secondUpdate = { ...firstUpdate, marker: 'second update' }
  const secondSave = await handlers.get('ui-designer:file:save')!(null, { project, path: opened.sourcePath, expected: firstSave.metadata }, secondUpdate)
  assert.equal(secondSave.status, 'success')
  assert.equal(JSON.parse(fs.readFileSync(scenePath('Scene_Sample'), 'utf8')).marker, 'second update')

  writeScene('Scene_FirstSave', 'old')
  const directOverwrite = await handlers.get('ui-designer:file:save')!(null, { project }, { ...opened.value, meta: { ...opened.value.meta, sceneName: 'Scene_FirstSave' }, marker: 'new' })
  assert.equal(directOverwrite.status, 'success')
  assert.equal(JSON.parse(fs.readFileSync(scenePath('Scene_FirstSave'), 'utf8')).marker, 'new')

  writeScene('Scene_Copy', 'existing')
  const saveAsDocument = { ...opened.value, meta: { ...opened.value.meta, sceneName: 'Scene_Copy' }, marker: 'copy' }
  const saveAsConflict = await handlers.get('ui-designer:file:save-as')!(null, { project }, saveAsDocument)
  assert.equal(saveAsConflict.code, 'UI_DESIGNER_OVERWRITE_REQUIRED')
  const saveAsForced = await handlers.get('ui-designer:file:save-as')!(null, { project, force: true }, saveAsDocument)
  assert.equal(saveAsForced.status, 'success')
  assert.equal(JSON.parse(fs.readFileSync(scenePath('Scene_Copy'), 'utf8')).marker, 'copy')

  const renameDocument = { ...secondUpdate, meta: { ...secondUpdate.meta, sceneName: 'Scene_Renamed' } }
  const renamed = await handlers.get('ui-designer:file:save')!(null, { project, path: scenePath('Scene_Sample'), expected: secondSave.metadata }, renameDocument)
  assert.equal(renamed.status, 'success')
  assert.equal(fs.existsSync(scenePath('Scene_Sample')), false)
  assert.equal(fs.existsSync(scenePath('Scene_Renamed')), true)
  assert.deepEqual(removedRecent, [path.resolve(scenePath('Scene_Sample'))])

  const globalSaved = await handlers.get('ui-designer:global-data:save')!(null, { project }, { menuList: [] })
  assert.equal(globalSaved.status, 'success')
  assert.equal(fs.existsSync(path.join(project, 'data', 'GlobalUI.json')), true)
  assert.equal(runtimeInstalls, 6)
  assert.equal(handlers.has('ui-designer:scene:stage'), false)
  assert.equal(handlers.has('ui-designer:global-data:stage'), false)
  assert.equal(handlers.has('ui-designer:runtime:export'), false)
  assert.equal(handlers.has('ui-designer:runtime:install'), false)

  const removed: string[] = []
  cleanupUiDesignerIpcHandlers({ removeHandler: (name: string) => { removed.push(name) } })
  assert.equal(removed.includes('ui-designer:file:save-as'), true)
  assert.equal(removed.includes('ui-designer:file:import'), true)
  assert.equal(removed.includes('ui-designer:global-data:save'), true)
  assert.equal(removed.includes('ui-designer:scene:stage'), false)
  fs.rmSync(project, { recursive: true, force: true })
})
