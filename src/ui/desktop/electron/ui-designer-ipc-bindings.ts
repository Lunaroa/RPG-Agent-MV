import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, Dialog, IpcMain } from 'electron'
import type {
  UiDesignerDocument,
  UiDesignerFileMetadata,
  UiDesignerFileRequest,
  UiDesignerFrameFolderRequest,
  UiDesignerGlobalDataReadResult,
  UiDesignerGlobalDataRequest,
  UiDesignerGlobalDataStageRequest,
  UiDesignerGlobalDataValue,
  UiDesignerProjectProfileRequest,
  UiDesignerProjectProfileResult,
  UiDesignerProjectRequest,
  UiDesignerRecoveryWriteRequest,
  UiDesignerRecoveryRecord,
  UiDesignerRecentFileRecord,
  UiDesignerResourceRequest,
  UiDesignerSceneDataReadRequest,
  UiDesignerSceneDataReadResult,
  UiDesignerRuntimeInstallRequest,
  UiDesignerRuntimeExportRequest,
  UiDesignerRuntimeStageResult,
  UiDesignerRendererHostSession,
  UiDesignerRendererResourceSyncRequest,
  UiDesignerRendererResourceSyncResult,
  UiDesignerRendererHostStopReason,
  UiDesignerSceneFileRecord,
  UiDesignerSceneStageRequest,
  UiRuntimeSceneExport,
  UiRuntimeStatus,
  UiProjectResourceCatalog,
  UiResourceEntry,
} from '../../../contract/ui-designer.ts'

export interface UiDesignerIpcDependencies {
  workflowRoot: string
  dialogParent?(sender: unknown): BrowserWindow | undefined
  resolveProject(project?: string): string
  file: {
    readUiDesignerFile(filePath: string): { document: UiDesignerDocument; metadata: UiDesignerFileMetadata }
    saveUiDesignerFile(filePath: string, document: UiDesignerDocument, options?: UiDesignerFileRequest): UiDesignerFileMetadata
    projectUiDesignerScenePath(project: string, sceneName: string): string
    readProjectUiDesignerGlobalData(project: string): UiDesignerGlobalDataReadResult
    saveProjectUiDesignerGlobalData(project: string, data: UiDesignerGlobalDataValue, options?: UiDesignerGlobalDataRequest): UiDesignerFileMetadata
    writeProjectUiDesignerThumbnail(project: string, sceneName: string, dataUrl: string): string
    revealSource(filePath: string): void
    UiDesignerUserDataStore: new (root: string) => UiDesignerUserDataStoreLike
  }
  project: {
    inspectUiDesignerProjectProfile(project: string): UiDesignerProjectProfileResult
    listUiDesignerSceneFiles(project: string): UiDesignerSceneFileRecord[]
  }
  resources: {
    inspectUiDesignerResourcesAsync(project: string, options?: UiDesignerResourceRequest): Promise<UiProjectResourceCatalog>
    inspectUiDesignerResourceReferences(project: string, referencedPaths: string[]): UiProjectResourceCatalog | Promise<UiProjectResourceCatalog>
    selectUiDesignerFrameFolder?(project: string, selectedDirectory: string): UiResourceEntry[]
    readUiDesignerSceneData(project: string, requestedPath: string): UiDesignerSceneDataReadResult
  }
  runtime: {
    inspectUiDesignerRuntime(workflowRoot: string, project: string): UiRuntimeStatus
    stageUiDesignerRuntimeInstall(workflowRoot: string, project: string, options?: UiDesignerRuntimeInstallRequest): UiDesignerRuntimeStageResult
    stageUiDesignerSceneExport(workflowRoot: string, project: string, scene: UiRuntimeSceneExport, options?: Pick<UiDesignerSceneStageRequest, 'targetPath' | 'overwrite'>): UiDesignerRuntimeStageResult
    stageUiDesignerGlobalDataExport(workflowRoot: string, project: string, data: UiDesignerGlobalDataValue): UiDesignerRuntimeStageResult
    writeUiDesignerRuntimeExport(filePath: string, scene: UiRuntimeSceneExport, options?: { overwrite?: boolean }): { path: string; digest: string; mtimeMs: number; size: number }
  }
  rendererHost?: {
    start(project: string, generation: number): Promise<UiDesignerRendererHostSession>
    confirm(sessionId: string): UiDesignerRendererHostSession
    stop(sessionId?: string): void
    syncResources?(request: UiDesignerRendererResourceSyncRequest & { project: string }): UiDesignerRendererResourceSyncResult
  }
  userDataStore: () => UiDesignerUserDataStoreLike
}

interface UiDesignerUserDataStoreLike {
  isWorkingDocumentPath(path: string): boolean
  saveWorkingDocument(document: UiDesignerDocument, options?: { path?: string; duplicate?: boolean; expected?: Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>; force?: boolean }): UiDesignerFileMetadata
  listRecentFiles(projectPath?: string): UiDesignerRecentFileRecord[]
  recordRecentFile(path: string, options?: { opened?: boolean; saved?: boolean; sceneName?: string; projectPath?: string; thumbnailDataUrl?: string }): UiDesignerRecentFileRecord
  removeRecentFile(path: string): void
  writeRecovery(document: UiDesignerDocument, sourcePath?: string, sourceMetadata?: Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>, key?: string): UiDesignerRecoveryRecord
  listRecovery(): UiDesignerRecoveryRecord[]
  readRecovery(id: string): { record: UiDesignerRecoveryRecord; document: UiDesignerDocument }
  clearRecovery(id: string): void
  readPreferences(): Record<string, unknown>
  writePreferences(value: Record<string, unknown>): void
}

type DialogLike = Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>
type IpcLike = Pick<IpcMain, 'handle'>

export function uiDesignerOperationError(operation: string, error: unknown): Record<string, unknown> {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || 'UI_DESIGNER_ERROR') : 'UI_DESIGNER_ERROR'
  const recoverable = code === 'UI_DESIGNER_CONFLICT'
    || code === 'UI_DESIGNER_OVERWRITE_REQUIRED'
    || code === 'UI_DESIGNER_PERSISTENCE_ERROR'
    || code === 'UI_DESIGNER_FRAME_FOLDER_INVALID'
  return {
    status: 'error',
    operation,
    code,
    recoverable,
    choices: recoverable ? ['retry', 'reload', 'save-as'] : ['retry'],
    error: { code, operation, recoverable, choices: recoverable ? ['retry', 'reload', 'save-as'] : ['retry'] },
    message: 'UI designer operation failed. Review the details and choose a recovery action.',
    ...(typeof error === 'object' && error && ('actual' in error || 'expected' in error)
      ? { conflict: { code: 'UI_DESIGNER_CONFLICT', expected: (error as { expected?: unknown }).expected, actual: (error as { actual?: unknown }).actual, recoverable } }
      : {}),
    ...(typeof error === 'object' && error && 'affectedFiles' in error
      ? { affectedFiles: (error as { affectedFiles?: unknown }).affectedFiles, digest: (error as { digest?: unknown }).digest, mtimeMs: (error as { mtimeMs?: unknown }).mtimeMs }
      : {}),
  }
}

async function selectedPath(dialog: DialogLike, parent: Parameters<Dialog['showOpenDialog']>[0], mode: 'open' | 'save', extension = 'mzui', defaultName?: string): Promise<string | null> {
  const label = 'UI Designer'
  if (mode === 'open') {
    const result = await dialog.showOpenDialog(parent, { properties: ['openFile'], filters: [{ name: label, extensions: [extension] }] })
    return result.canceled ? null : result.filePaths[0] || null
  }
  const result = await dialog.showSaveDialog(parent, { filters: [{ name: label, extensions: [extension] }], ...(defaultName ? { defaultPath: defaultName } : {}) })
  return result.canceled ? null : result.filePath || null
}

async function selectedDirectory(dialog: DialogLike, parent: Parameters<Dialog['showOpenDialog']>[0]): Promise<string | null> {
  const result = await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0] || null
}

export function registerUiDesignerIpcHandlers(
  ipcMain: IpcLike,
  dialog: DialogLike,
  dependencies: UiDesignerIpcDependencies,
): void {
  ipcMain.handle('ui-designer:file:open', async (event, request?: Pick<UiDesignerFileRequest, 'path' | 'project'>) => {
    const parent = dependencies.dialogParent?.(event.sender)
    const filePath = request?.path || await selectedPath(dialog, parent, 'open')
    if (!filePath) return { status: 'idle', operation: 'open', message: 'Canceled.' }
    try {
      const result = dependencies.file.readUiDesignerFile(filePath)
      const store = dependencies.userDataStore()
      const project = typeof request?.project === 'string' && request.project.trim()
        ? dependencies.resolveProject(request.project)
        : undefined
      store.recordRecentFile(result.metadata.path, {
        opened: true,
        sceneName: result.document.meta.sceneName,
        ...(project ? { projectPath: project } : {}),
      })
      return { status: 'ready', operation: 'open', value: result.document, metadata: result.metadata, sourcePath: result.metadata.path, message: 'Ready.' }
    } catch (error) { return uiDesignerOperationError('open', error) }
  })

  const save = async (event: { sender: unknown }, request: UiDesignerFileRequest, document: UiDesignerDocument, mode: 'save' | 'saveAs') => {
    try {
      const project = typeof request?.project === 'string' && request.project.trim()
        ? dependencies.resolveProject(request.project)
        : ''
      const canonicalProjectPath = project
        ? dependencies.file.projectUiDesignerScenePath(project, document.meta.sceneName)
        : ''
      let targetPath = typeof request?.path === 'string' && request.path.trim() ? path.resolve(request.path) : ''
      if (mode === 'saveAs') {
        const parent = dependencies.dialogParent?.(event.sender)
        targetPath = await selectedPath(dialog, parent, 'save', 'mzui', canonicalProjectPath || `${document.meta.sceneName}.mzui`) || ''
        if (!targetPath) return { status: 'idle', operation: mode, message: 'Canceled.' }
      } else if (!targetPath) {
        if (!canonicalProjectPath) throw Object.assign(new Error('A selected RPG Maker project is required for the first save.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
        if (fs.existsSync(canonicalProjectPath) && request?.force !== true) {
          const existing = dependencies.file.readUiDesignerFile(canonicalProjectPath)
          throw Object.assign(new Error('A scene with this name already exists in the current project. Review it or choose Save As before replacing it.'), {
            code: 'UI_DESIGNER_OVERWRITE_REQUIRED',
            actual: existing.metadata,
          })
        }
        targetPath = canonicalProjectPath
      }
      const store = dependencies.userDataStore()
      const metadata = dependencies.file.saveUiDesignerFile(targetPath, document, {
        expected: request?.expected,
        force: request?.force,
      })
      const thumbnailDataUrl = typeof request?.thumbnailDataUrl === 'string' ? request.thumbnailDataUrl : undefined
      if (thumbnailDataUrl && project && isPathInside(project, metadata.path)) {
        dependencies.file.writeProjectUiDesignerThumbnail(project, document.meta.sceneName, thumbnailDataUrl)
      }
      store.recordRecentFile(metadata.path, {
        saved: true,
        opened: mode === 'saveAs',
        sceneName: document.meta.sceneName,
        ...(project ? { projectPath: project } : {}),
        thumbnailDataUrl,
      })
      return { status: 'success', operation: mode, metadata, sourcePath: metadata.path, message: 'Saved.' }
    } catch (error) { return uiDesignerOperationError(mode, error) }
  }
  ipcMain.handle('ui-designer:file:save', (event, request: UiDesignerFileRequest, document: UiDesignerDocument) => save(event, request || {}, document, 'save'))
  ipcMain.handle('ui-designer:file:save-as', (event, request: UiDesignerFileRequest, document: UiDesignerDocument) => save(event, request || {}, document, 'saveAs'))
  ipcMain.handle('ui-designer:file:reveal-source', (_event, requestedPath: string) => {
    try {
      if (!dependencies.file.revealSource) throw Object.assign(new Error('File manager reveal is unavailable.'), { code: 'UI_DESIGNER_REVEAL_UNAVAILABLE' })
      if (typeof requestedPath !== 'string' || !requestedPath.trim()) throw Object.assign(new Error('A source path is required.'), { code: 'UI_DESIGNER_SOURCE_NOT_FOUND' })
      const resolved = path.resolve(requestedPath)
      const extensionAllowed = path.extname(resolved).toLowerCase() === '.mzui'
      const exists = fs.existsSync(resolved) && fs.statSync(resolved).isFile()
      const recent = dependencies.userDataStore().listRecentFiles().some((record) => path.resolve(record.sourcePath) === resolved)
      if (!exists || (!extensionAllowed && !recent)) throw Object.assign(new Error('The UI designer source file is not an existing .mzui file or a known recent source.'), { code: 'UI_DESIGNER_SOURCE_NOT_FOUND' })
      dependencies.file.revealSource(resolved)
      return { status: 'success', operation: 'reveal-source', value: null, message: 'Source revealed.' }
    } catch (error) { return uiDesignerOperationError('reveal-source', error) }
  })

  ipcMain.handle('ui-designer:project:profile', (_event, request: UiDesignerProjectProfileRequest = {}) => {
    try {
      if (typeof request?.project !== 'string' || !request.project.trim()) {
        throw Object.assign(new Error('A selected RPG Maker project is required.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
      }
      return {
        status: 'success',
        operation: 'project:profile',
        value: dependencies.project.inspectUiDesignerProjectProfile(dependencies.resolveProject(request.project)),
        message: 'Ready.',
      }
    } catch (error) { return uiDesignerOperationError('project:profile', error) }
  })

  ipcMain.handle('ui-designer:scenes:list', (_event, request: UiDesignerProjectRequest = {}) => {
    try {
      return { status: 'success', operation: 'scenes:list', value: dependencies.project.listUiDesignerSceneFiles(dependencies.resolveProject(request.project)), message: 'Ready.' }
    } catch (error) { return uiDesignerOperationError('scenes:list', error) }
  })

  ipcMain.handle('ui-designer:resources:list', async (_event, request: UiDesignerResourceRequest = {}) => {
    try { return { status: 'success', value: await dependencies.resources.inspectUiDesignerResourcesAsync(dependencies.resolveProject(request.project), request), message: 'Ready.' } }
    catch (error) { return uiDesignerOperationError('resources:list', error) }
  })
  ipcMain.handle('ui-designer:resources:references', async (_event, request: UiDesignerResourceRequest = {}) => {
    try {
      const referencedPaths = Array.isArray(request.referencedPaths) ? request.referencedPaths : []
      return { status: 'success', value: await dependencies.resources.inspectUiDesignerResourceReferences(dependencies.resolveProject(request.project), referencedPaths), message: 'Ready.' }
    } catch (error) { return uiDesignerOperationError('resources:references', error) }
  })
  ipcMain.handle('ui-designer:resources:read-scene-data', (_event, request: UiDesignerSceneDataReadRequest) => {
    try {
      return { status: 'success', operation: 'resources:read-scene-data', value: dependencies.resources.readUiDesignerSceneData(dependencies.resolveProject(request?.project), request?.path), message: 'Ready.' }
    } catch (error) { return uiDesignerOperationError('resources:read-scene-data', error) }
  })
  ipcMain.handle('ui-designer:file:select-frame-folder', async (event, request: UiDesignerFrameFolderRequest = {}) => {
    const selected = await selectedDirectory(dialog, dependencies.dialogParent?.(event.sender))
    if (!selected) return { status: 'idle', operation: 'file:select-frame-folder', message: 'Canceled.' }
    try {
      if (!dependencies.resources.selectUiDesignerFrameFolder) throw Object.assign(new Error('Frame folder selection is unavailable.'), { code: 'UI_DESIGNER_FRAME_FOLDER_UNAVAILABLE' })
      const entries = dependencies.resources.selectUiDesignerFrameFolder(dependencies.resolveProject(request.project), selected)
      return { status: 'success', operation: 'file:select-frame-folder', value: entries, message: 'Ready.' }
    } catch (error) { return uiDesignerOperationError('file:select-frame-folder', error) }
  })
  ipcMain.handle('ui-designer:runtime:check', (_event, request: UiDesignerProjectRequest = {}) => {
    try { return { status: 'success', value: dependencies.runtime.inspectUiDesignerRuntime(dependencies.workflowRoot, dependencies.resolveProject(request.project)), message: 'Ready.' } }
    catch (error) { return uiDesignerOperationError('runtime:check', error) }
  })
  ipcMain.handle('ui-designer:runtime:install', (_event, request?: UiDesignerRuntimeInstallRequest) => {
    if (!request || request.enable !== true) {
      return uiDesignerOperationError('runtime:install', { code: 'UI_DESIGNER_RUNTIME_ENABLE_REQUIRED' })
    }
    try { return { status: 'success', value: dependencies.runtime.stageUiDesignerRuntimeInstall(dependencies.workflowRoot, dependencies.resolveProject(request.project), request), message: 'Runtime staged.' } }
    catch (error) { return uiDesignerOperationError('runtime:install', error) }
  })
  ipcMain.handle('ui-designer:scene:stage', (_event, request: UiDesignerSceneStageRequest) => {
    try { return { status: 'success', value: dependencies.runtime.stageUiDesignerSceneExport(dependencies.workflowRoot, dependencies.resolveProject(request.project), request.scene, { sceneRelativePath: request.targetPath, overwrite: request.overwrite }), message: 'Scene staged.' } }
    catch (error) { return uiDesignerOperationError('scene:stage', error) }
  })
  ipcMain.handle('ui-designer:global-data:read', (_event, request: UiDesignerGlobalDataRequest = {}) => {
    try {
      if (typeof request?.project !== 'string' || !request.project.trim()) {
        throw Object.assign(new Error('A selected RPG Maker project is required.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
      }
      return { status: 'success', operation: 'global-data:read', value: dependencies.file.readProjectUiDesignerGlobalData(dependencies.resolveProject(request.project)), message: 'Ready.' }
    } catch (error) { return uiDesignerOperationError('global-data:read', error) }
  })
  ipcMain.handle('ui-designer:global-data:save', (_event, request: UiDesignerGlobalDataRequest = {}, data?: UiDesignerGlobalDataValue) => {
    try {
      if (typeof request?.project !== 'string' || !request.project.trim()) {
        throw Object.assign(new Error('A selected RPG Maker project is required.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
      }
      const metadata = dependencies.file.saveProjectUiDesignerGlobalData(dependencies.resolveProject(request.project), data as UiDesignerGlobalDataValue, {
        expected: request.expected,
        force: request.force,
      })
      return { status: 'success', operation: 'global-data:save', metadata, message: 'Saved.' }
    } catch (error) { return uiDesignerOperationError('global-data:save', error) }
  })
  ipcMain.handle('ui-designer:global-data:stage', (_event, request: UiDesignerGlobalDataStageRequest) => {
    try {
      if (typeof request?.project !== 'string' || !request.project.trim()) {
        throw Object.assign(new Error('A selected RPG Maker project is required.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
      }
      return { status: 'success', value: dependencies.runtime.stageUiDesignerGlobalDataExport(dependencies.workflowRoot, dependencies.resolveProject(request.project), request.data), message: 'Global data staged.' }
    } catch (error) { return uiDesignerOperationError('global-data:stage', error) }
  })
  ipcMain.handle('ui-designer:runtime:export', async (event, request: UiDesignerRuntimeExportRequest) => {
    const defaultName = `Scene_${request.scene.meta.sceneName.replace(/^Scene_/, '')}.json`
    const filePath = request?.path || await selectedPath(dialog, dependencies.dialogParent?.(event.sender), 'save', 'json', defaultName)
    if (!filePath) return { status: 'idle', operation: 'runtime:export', message: 'Canceled.' }
    try {
      const metadata = dependencies.runtime.writeUiDesignerRuntimeExport(filePath, request.scene, { overwrite: request.overwrite })
      return { status: 'success', operation: 'runtime:export', value: metadata.path, path: metadata.path, digest: metadata.digest, mtimeMs: metadata.mtimeMs, message: 'Runtime export saved.' }
    } catch (error) { return uiDesignerOperationError('runtime:export', error) }
  })
  ipcMain.handle('ui-designer:renderer:start', async (_event, request?: UiDesignerProjectRequest & { generation?: number }) => {
    try {
      if (!dependencies.rendererHost) throw new Error('UI designer canvas renderer is unavailable.')
      if (typeof request?.project !== 'string' || !request.project.trim()) {
        throw Object.assign(new Error('A selected RPG Maker project is required.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
      }
      if (!Number.isSafeInteger(request.generation) || Number(request.generation) < 0) throw new Error('UI designer renderer generation must be a non-negative safe integer.')
      const value = await dependencies.rendererHost.start(dependencies.resolveProject(request.project), Number(request.generation))
      return { status: 'success', operation: 'renderer:start', value, message: 'Isolated UI designer canvas renderer prepared.' }
    } catch (error) { return uiDesignerOperationError('renderer:start', error) }
  })
  ipcMain.handle('ui-designer:renderer:confirm', (_event, sessionId?: string) => {
    try {
      if (!dependencies.rendererHost) throw new Error('UI designer canvas renderer is unavailable.')
      if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('UI designer renderer session id is required.')
      return { status: 'success', operation: 'renderer:confirm', value: dependencies.rendererHost.confirm(sessionId), message: 'Isolated renderer process confirmed.' }
    } catch (error) { return uiDesignerOperationError('renderer:confirm', error) }
  })
  ipcMain.handle('ui-designer:renderer:stop', (_event, request?: { sessionId?: string; reason?: UiDesignerRendererHostStopReason }) => {
    try {
      if (!dependencies.rendererHost) throw new Error('UI designer canvas renderer is unavailable.')
      const reason = request?.reason
      if (reason !== undefined && !['project-change', 'unload', 'shutdown', 'protocol-error'].includes(reason)) throw new Error('UI designer renderer stop reason is invalid.')
      dependencies.rendererHost.stop(request?.sessionId)
      return { status: 'success', operation: 'renderer:stop', value: null, message: 'UI designer canvas renderer stopped.' }
    } catch (error) { return uiDesignerOperationError('renderer:stop', error) }
  })
  ipcMain.handle('ui-designer:renderer:sync-resources', (_event, request?: UiDesignerRendererResourceSyncRequest) => {
    try {
      if (!dependencies.rendererHost?.syncResources) throw new Error('UI designer renderer resource synchronization is unavailable.')
      if (!request || typeof request.project !== 'string' || !request.project.trim()) throw new Error('A selected RPG Maker project is required.')
      const value = dependencies.rendererHost.syncResources({
        ...request,
        project: dependencies.resolveProject(request.project),
      })
      return { status: 'success', operation: 'renderer:sync-resources', value, message: 'Renderer resources synchronized.' }
    } catch (error) { return uiDesignerOperationError('renderer:sync-resources', error) }
  })

  ipcMain.handle('ui-designer:recovery:list', () => safeStoreCall(dependencies, 'list-recovery', (store) => store.listRecovery()))
  ipcMain.handle('ui-designer:recovery:write', (_event, request: UiDesignerRecoveryWriteRequest) => safeStoreCall(dependencies, 'write-recovery', (store) => store.writeRecovery(request.document, request.sourcePath, request.sourceMetadata, request.key)))
  ipcMain.handle('ui-designer:recovery:read', (_event, id: string) => safeStoreCall(dependencies, 'read-recovery', (store) => store.readRecovery(String(id))))
  ipcMain.handle('ui-designer:recovery:clear', (_event, id: string) => safeStoreCall(dependencies, 'clear-recovery', (store) => { store.clearRecovery(String(id)); return null }))
  ipcMain.handle('ui-designer:recent:list', (_event, request?: UiDesignerProjectRequest) => safeStoreCall(dependencies, 'list-recent', (store) => {
    const project = typeof request?.project === 'string' && request.project.trim()
      ? dependencies.resolveProject(request.project)
      : undefined
    return store.listRecentFiles(project)
  }))
  ipcMain.handle('ui-designer:recent:remove', (_event, filePath: string) => safeStoreCall(dependencies, 'remove-recent', (store) => { store.removeRecentFile(String(filePath)); return null }))
  ipcMain.handle('ui-designer:preferences:read', () => safeStoreCall(dependencies, 'read-preferences', (store) => store.readPreferences()))
  ipcMain.handle('ui-designer:preferences:write', (_event, value: Record<string, unknown>) => safeStoreCall(dependencies, 'write-preferences', (store) => { store.writePreferences(value); return value }))
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function safeStoreCall(
  dependencies: UiDesignerIpcDependencies,
  operation: string,
  callback: (store: UiDesignerUserDataStoreLike) => unknown,
): Record<string, unknown> {
  try {
    const store = dependencies.userDataStore()
    return { status: 'success', value: callback(store), message: 'Ready.' }
  } catch (error) { return uiDesignerOperationError(operation, error) }
}

export function cleanupUiDesignerIpcHandlers(ipcMain: Pick<IpcMain, 'removeHandler'>): void {
  for (const channel of [
    'ui-designer:file:open', 'ui-designer:file:save', 'ui-designer:file:save-as', 'ui-designer:file:reveal-source',
    'ui-designer:project:profile', 'ui-designer:scenes:list',
    'ui-designer:resources:list', 'ui-designer:resources:references', 'ui-designer:resources:read-scene-data', 'ui-designer:file:select-frame-folder', 'ui-designer:runtime:check', 'ui-designer:runtime:install',
    'ui-designer:scene:stage', 'ui-designer:global-data:read', 'ui-designer:global-data:save', 'ui-designer:global-data:stage', 'ui-designer:runtime:export', 'ui-designer:recovery:list', 'ui-designer:recovery:write', 'ui-designer:recovery:read',
    'ui-designer:renderer:start', 'ui-designer:renderer:confirm', 'ui-designer:renderer:stop', 'ui-designer:renderer:sync-resources',
    'ui-designer:recovery:clear', 'ui-designer:recent:list', 'ui-designer:recent:remove', 'ui-designer:preferences:read',
    'ui-designer:preferences:write',
  ]) ipcMain.removeHandler(channel)
}
