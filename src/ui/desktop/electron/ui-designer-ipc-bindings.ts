import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, Dialog, IpcMain } from 'electron'
import type {
  UiDesignerDocument,
  UiDesignerFileMetadata,
  UiDesignerFileRequest,
  UiDesignerFrameFolderRequest,
  UiDesignerPreviewStartRequest,
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
  UiDesignerSceneStageRequest,
  UiDesignerNodeTemplateExportRequest,
  UiNodeGroup,
  UiNodeGroupRecord,
  UiPreviewResult,
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
    readUiDesignerNodeTemplate(filePath: string): UiNodeGroup
    writeUiDesignerNodeTemplate(filePath: string, group: UiNodeGroup): string
    revealSource(filePath: string): void
    UiDesignerUserDataStore: new (root: string) => UiDesignerUserDataStoreLike
  }
  resources: {
    inspectUiDesignerResources(project: string, options?: UiDesignerResourceRequest): UiProjectResourceCatalog
    selectUiDesignerFrameFolder?(project: string, selectedDirectory: string): UiResourceEntry[]
    readUiDesignerSceneData(project: string, requestedPath: string): UiDesignerSceneDataReadResult
  }
  runtime: {
    inspectUiDesignerRuntime(workflowRoot: string, project: string): UiRuntimeStatus
    stageUiDesignerRuntimeInstall(workflowRoot: string, project: string, options?: UiDesignerRuntimeInstallRequest): UiDesignerRuntimeStageResult
    stageUiDesignerSceneExport(workflowRoot: string, project: string, scene: UiRuntimeSceneExport, options?: Pick<UiDesignerSceneStageRequest, 'targetPath' | 'overwrite'>): UiDesignerRuntimeStageResult
    writeUiDesignerRuntimeExport(filePath: string, scene: UiRuntimeSceneExport, options?: { overwrite?: boolean }): { path: string; digest: string; mtimeMs: number; size: number }
  }
  preview?: {
    start(workflowRoot: string, project: string, scene: UiRuntimeSceneExport, options?: Pick<UiDesignerPreviewStartRequest, 'temporaryPrefix'>): Promise<UiPreviewResult>
    current(): Promise<UiPreviewResult>
    stop(sessionId?: string): Promise<UiPreviewResult>
  }
  userDataStore: () => UiDesignerUserDataStoreLike
}

interface UiDesignerUserDataStoreLike {
  listRecentFiles(): UiDesignerRecentFileRecord[]
  recordRecentFile(path: string, options?: { opened?: boolean; saved?: boolean; sceneName?: string }): UiDesignerRecentFileRecord
  removeRecentFile(path: string): void
  listNodeTemplates(): UiNodeGroupRecord[]
  readNodeTemplate(name: string): UiNodeGroup
  writeNodeTemplate(name: string, group: UiNodeGroup): string
  removeNodeTemplate(name: string): void
  writeRecovery(document: UiDesignerDocument, sourcePath?: string, sourceMetadata?: Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>, key?: string): UiDesignerRecoveryRecord
  listRecovery(): UiDesignerRecoveryRecord[]
  readRecovery(id: string): { record: UiDesignerRecoveryRecord; document: UiDesignerDocument }
  clearRecovery(id: string): void
  readPreferences(): Record<string, unknown>
  writePreferences(value: Record<string, unknown>): void
}

type DialogLike = Pick<Dialog, 'showOpenDialog' | 'showSaveDialog'>
type IpcLike = Pick<IpcMain, 'handle'>

function operationError(operation: string, error: unknown): Record<string, unknown> {
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
      ? { conflict: { expected: (error as { expected?: unknown }).expected, actual: (error as { actual?: unknown }).actual } }
      : {}),
    ...(typeof error === 'object' && error && 'affectedFiles' in error
      ? { affectedFiles: (error as { affectedFiles?: unknown }).affectedFiles, digest: (error as { digest?: unknown }).digest, mtimeMs: (error as { mtimeMs?: unknown }).mtimeMs }
      : {}),
  }
}

async function selectedPath(dialog: DialogLike, parent: Parameters<Dialog['showOpenDialog']>[0], mode: 'open' | 'save', extension = 'mzui', defaultName?: string): Promise<string | null> {
  const label = extension === 'mztemplate' ? 'UI Designer node template' : 'UI Designer'
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
  ipcMain.handle('ui-designer:file:open', async (event, request?: Pick<UiDesignerFileRequest, 'path'>) => {
    const parent = dependencies.dialogParent?.(event.sender)
    const filePath = request?.path || await selectedPath(dialog, parent, 'open')
    if (!filePath) return { status: 'idle', operation: 'open', message: 'Canceled.' }
    try {
      const result = dependencies.file.readUiDesignerFile(filePath)
      dependencies.userDataStore().recordRecentFile(filePath, { opened: true, sceneName: result.document.meta.sceneName })
      return { status: 'ready', operation: 'open', value: result.document, metadata: result.metadata, sourcePath: filePath, message: 'Ready.' }
    } catch (error) { return operationError('open', error) }
  })

  const save = async (event: { sender: unknown }, request: UiDesignerFileRequest, document: UiDesignerDocument, mode: 'save' | 'saveAs') => {
    const parent = dependencies.dialogParent?.(event.sender)
    const filePath = mode === 'save' && request?.path ? request.path : await selectedPath(dialog, parent, 'save')
    if (!filePath) return { status: 'idle', operation: mode, message: 'Canceled.' }
    try {
      const metadata = dependencies.file.saveUiDesignerFile(filePath, document, { expected: request?.expected, force: request?.force })
      dependencies.userDataStore().recordRecentFile(filePath, { saved: true, opened: mode === 'saveAs', sceneName: document.meta.sceneName })
      return { status: 'success', operation: mode, metadata, sourcePath: filePath, message: 'Saved.' }
    } catch (error) { return operationError(mode, error) }
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
    } catch (error) { return operationError('reveal-source', error) }
  })

  ipcMain.handle('ui-designer:resources:list', (_event, request: UiDesignerResourceRequest = {}) => {
    try { return { status: 'success', value: dependencies.resources.inspectUiDesignerResources(dependencies.resolveProject(request.project), request), message: 'Ready.' } }
    catch (error) { return operationError('resources:list', error) }
  })
  ipcMain.handle('ui-designer:resources:read-scene-data', (_event, request: UiDesignerSceneDataReadRequest) => {
    try {
      return { status: 'success', operation: 'resources:read-scene-data', value: dependencies.resources.readUiDesignerSceneData(dependencies.resolveProject(request?.project), request?.path), message: 'Ready.' }
    } catch (error) { return operationError('resources:read-scene-data', error) }
  })
  ipcMain.handle('ui-designer:file:select-frame-folder', async (event, request: UiDesignerFrameFolderRequest = {}) => {
    const selected = await selectedDirectory(dialog, dependencies.dialogParent?.(event.sender))
    if (!selected) return { status: 'idle', operation: 'file:select-frame-folder', message: 'Canceled.' }
    try {
      if (!dependencies.resources.selectUiDesignerFrameFolder) throw Object.assign(new Error('Frame folder selection is unavailable.'), { code: 'UI_DESIGNER_FRAME_FOLDER_UNAVAILABLE' })
      const entries = dependencies.resources.selectUiDesignerFrameFolder(dependencies.resolveProject(request.project), selected)
      return { status: 'success', operation: 'file:select-frame-folder', value: entries, message: 'Ready.' }
    } catch (error) { return operationError('file:select-frame-folder', error) }
  })
  ipcMain.handle('ui-designer:runtime:check', (_event, request: UiDesignerProjectRequest = {}) => {
    try { return { status: 'success', value: dependencies.runtime.inspectUiDesignerRuntime(dependencies.workflowRoot, dependencies.resolveProject(request.project)), message: 'Ready.' } }
    catch (error) { return operationError('runtime:check', error) }
  })
  ipcMain.handle('ui-designer:runtime:install', (_event, request?: UiDesignerRuntimeInstallRequest) => {
    if (!request || request.enable !== true) {
      return operationError('runtime:install', { code: 'UI_DESIGNER_RUNTIME_ENABLE_REQUIRED' })
    }
    try { return { status: 'success', value: dependencies.runtime.stageUiDesignerRuntimeInstall(dependencies.workflowRoot, dependencies.resolveProject(request.project), request), message: 'Runtime staged.' } }
    catch (error) { return operationError('runtime:install', error) }
  })
  ipcMain.handle('ui-designer:scene:stage', (_event, request: UiDesignerSceneStageRequest) => {
    try { return { status: 'success', value: dependencies.runtime.stageUiDesignerSceneExport(dependencies.workflowRoot, dependencies.resolveProject(request.project), request.scene, { sceneRelativePath: request.targetPath, overwrite: request.overwrite }), message: 'Scene staged.' } }
    catch (error) { return operationError('scene:stage', error) }
  })
  ipcMain.handle('ui-designer:runtime:export', async (event, request: UiDesignerRuntimeExportRequest) => {
    const defaultName = `Scene_${request.scene.meta.sceneName.replace(/^Scene_/, '')}.json`
    const filePath = request?.path || await selectedPath(dialog, dependencies.dialogParent?.(event.sender), 'save', 'json', defaultName)
    if (!filePath) return { status: 'idle', operation: 'runtime:export', message: 'Canceled.' }
    try {
      const metadata = dependencies.runtime.writeUiDesignerRuntimeExport(filePath, request.scene, { overwrite: request.overwrite })
      return { status: 'success', operation: 'runtime:export', value: metadata.path, path: metadata.path, digest: metadata.digest, mtimeMs: metadata.mtimeMs, message: 'Runtime export saved.' }
    } catch (error) { return operationError('runtime:export', error) }
  })
  ipcMain.handle('ui-designer:preview:start', async (_event, request: UiDesignerPreviewStartRequest) => {
    try {
      if (!dependencies.preview) throw new Error('UI designer preview is unavailable.')
      return await dependencies.preview.start(dependencies.workflowRoot, dependencies.resolveProject(request.project), request.scene, { temporaryPrefix: request.temporaryPrefix })
    } catch (error) { return operationError('preview:start', error) }
  })
  ipcMain.handle('ui-designer:preview:current', async () => {
    try { return await dependencies.preview?.current() || { state: 'unavailable', message: 'UI designer preview is unavailable.' } }
    catch (error) { return operationError('preview:current', error) }
  })
  ipcMain.handle('ui-designer:preview:stop', async (_event, sessionId?: string) => {
    try { return await dependencies.preview?.stop(sessionId) || { state: 'idle', message: 'No isolated UI designer preview is running.' } }
    catch (error) { return operationError('preview:stop', error) }
  })

  ipcMain.handle('ui-designer:recovery:list', () => safeStoreCall(dependencies, 'list-recovery', (store) => store.listRecovery()))
  ipcMain.handle('ui-designer:recovery:write', (_event, request: UiDesignerRecoveryWriteRequest) => safeStoreCall(dependencies, 'write-recovery', (store) => store.writeRecovery(request.document, request.sourcePath, request.sourceMetadata, request.key)))
  ipcMain.handle('ui-designer:recovery:read', (_event, id: string) => safeStoreCall(dependencies, 'read-recovery', (store) => store.readRecovery(String(id))))
  ipcMain.handle('ui-designer:recovery:clear', (_event, id: string) => safeStoreCall(dependencies, 'clear-recovery', (store) => { store.clearRecovery(String(id)); return null }))
  ipcMain.handle('ui-designer:recent:list', () => safeStoreCall(dependencies, 'list-recent', (store) => store.listRecentFiles()))
  ipcMain.handle('ui-designer:recent:remove', (_event, filePath: string) => safeStoreCall(dependencies, 'remove-recent', (store) => { store.removeRecentFile(String(filePath)); return null }))
  ipcMain.handle('ui-designer:preferences:read', () => safeStoreCall(dependencies, 'read-preferences', (store) => store.readPreferences()))
  ipcMain.handle('ui-designer:preferences:write', (_event, value: Record<string, unknown>) => safeStoreCall(dependencies, 'write-preferences', (store) => { store.writePreferences(value); return value }))
  ipcMain.handle('ui-designer:node-templates:list', () => safeStoreCall(dependencies, 'node-templates:list', (store) => store.listNodeTemplates()))
  ipcMain.handle('ui-designer:node-templates:read', (_event, name: string) => safeStoreCall(dependencies, 'node-templates:read', (store) => store.readNodeTemplate(String(name))))
  ipcMain.handle('ui-designer:node-templates:write', (_event, name: string, group: UiNodeGroup) => safeStoreCall(dependencies, 'node-templates:write', (store) => store.writeNodeTemplate(String(name), group)))
  ipcMain.handle('ui-designer:node-templates:remove', (_event, name: string) => safeStoreCall(dependencies, 'node-templates:remove', (store) => { store.removeNodeTemplate(String(name)); return null }))
  ipcMain.handle('ui-designer:node-templates:import', async (event) => {
    const filePath = await selectedPath(dialog, dependencies.dialogParent?.(event.sender), 'open', 'mztemplate')
    if (!filePath) return { status: 'idle', operation: 'node-templates:import', message: 'Canceled.' }
    try {
      return { status: 'success', operation: 'node-templates:import', value: dependencies.file.readUiDesignerNodeTemplate(filePath), sourcePath: filePath, message: 'Ready.' }
    } catch (error) { return operationError('node-templates:import', error) }
  })
  ipcMain.handle('ui-designer:node-templates:export', async (event, request: UiDesignerNodeTemplateExportRequest) => {
    const filePath = request?.path || await selectedPath(dialog, dependencies.dialogParent?.(event.sender), 'save', 'mztemplate')
    if (!filePath) return { status: 'idle', operation: 'node-templates:export', message: 'Canceled.' }
    try {
      const savedPath = dependencies.file.writeUiDesignerNodeTemplate(filePath, request.group)
      return { status: 'success', operation: 'node-templates:export', value: savedPath, message: 'Exported.' }
    } catch (error) { return operationError('node-templates:export', error) }
  })
}

function safeStoreCall(
  dependencies: UiDesignerIpcDependencies,
  operation: string,
  callback: (store: UiDesignerUserDataStoreLike) => unknown,
): Record<string, unknown> {
  try {
    const store = dependencies.userDataStore()
    return { status: 'success', value: callback(store), message: 'Ready.' }
  } catch (error) { return operationError(operation, error) }
}

export function cleanupUiDesignerIpcHandlers(ipcMain: Pick<IpcMain, 'removeHandler'>): void {
  for (const channel of [
    'ui-designer:file:open', 'ui-designer:file:save', 'ui-designer:file:save-as', 'ui-designer:file:reveal-source',
    'ui-designer:resources:list', 'ui-designer:resources:read-scene-data', 'ui-designer:file:select-frame-folder', 'ui-designer:runtime:check', 'ui-designer:runtime:install',
    'ui-designer:scene:stage', 'ui-designer:runtime:export', 'ui-designer:preview:start', 'ui-designer:preview:current', 'ui-designer:preview:stop', 'ui-designer:recovery:list', 'ui-designer:recovery:write', 'ui-designer:recovery:read',
    'ui-designer:recovery:clear', 'ui-designer:recent:list', 'ui-designer:recent:remove', 'ui-designer:preferences:read',
    'ui-designer:preferences:write',
    'ui-designer:node-templates:list', 'ui-designer:node-templates:read', 'ui-designer:node-templates:write', 'ui-designer:node-templates:remove', 'ui-designer:node-templates:import', 'ui-designer:node-templates:export',
  ]) ipcMain.removeHandler(channel)
}
