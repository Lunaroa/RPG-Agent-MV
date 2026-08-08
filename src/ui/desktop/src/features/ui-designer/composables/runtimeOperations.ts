import type { Ref } from 'vue'
import type {
  UiDesignerDocument,
  UiDesignerFileConflict,
  UiDesignerPersistenceAdapter,
  UiDesignerRuntimeAdapter,
  UiDesignerRuntimeStageResult,
  UiFileResult,
  UiFileStatus,
  UiRuntimeSceneExport,
  UiRuntimeStatus,
} from '@contract/ui-designer'
import { exportRuntimeDocument, UiExportValidationError } from '../models/export'

type ValueRef<T> = Pick<Ref<T>, 'value'>

export interface UiDesignerRuntimeOperationContext {
  getRuntime: () => UiDesignerRuntimeAdapter
  getFile: () => UiDesignerPersistenceAdapter
  projectPath: ValueRef<string | undefined>
  projectGeneration: ValueRef<number>
  hasProject: ValueRef<boolean>
  canSave: ValueRef<boolean>
  canExport: ValueRef<boolean>
  canManageRuntime: ValueRef<boolean>
  document: ValueRef<UiDesignerDocument>
  flushDrafts: () => void
  fileStatus: ValueRef<UiFileStatus>
  fileMessage: ValueRef<string>
  runtimeStatus: ValueRef<UiRuntimeStatus>
  runtimeStaging: ValueRef<UiDesignerRuntimeStageResult | null>
  runtimeProofMissing: ValueRef<boolean>
  runtimeConflict: ValueRef<boolean>
  runtimeConflictPath: ValueRef<string | undefined>
  runtimeConflictOperation: ValueRef<'stage' | 'export' | null>
  runtimeConflictFiles: ValueRef<string[]>
  fileConflict: ValueRef<UiDesignerFileConflict | null>
}

const conflictCode = (result: UiFileResult<unknown>) => result.code ?? result.error?.code

/** Runtime staging/export operations, including overwrite proof and conflict replay. */
export function createUiDesignerRuntimeOperations(context: UiDesignerRuntimeOperationContext) {
  const clearConflictState = () => {
    context.runtimeConflict.value = false
    context.runtimeConflictOperation.value = null
    context.runtimeConflictPath.value = undefined
    context.runtimeConflictFiles.value = []
    context.fileConflict.value = null
  }
  const setConflictState = (result: UiFileResult<unknown>, operation: 'stage' | 'export', requestedPath?: string) => {
    const code = conflictCode(result)
    if (code !== 'UI_DESIGNER_CONFLICT' && code !== 'UI_DESIGNER_OVERWRITE_REQUIRED') return false
    context.runtimeConflict.value = true
    context.runtimeConflictOperation.value = operation
    context.runtimeConflictPath.value = result.path ?? requestedPath
    context.runtimeConflictFiles.value = [...(result.affectedFiles ?? [])]
    context.fileConflict.value = {
      code: 'UI_DESIGNER_CONFLICT',
      recoverable: result.recoverable ?? result.error?.recoverable ?? true,
      actual: result.digest || result.mtimeMs !== undefined ? { path: context.runtimeConflictPath.value ?? '', digest: result.digest ?? '', mtimeMs: result.mtimeMs ?? 0, size: 0 } : undefined,
    }
    return true
  }
  const applyStageResult = (result: UiFileResult<UiDesignerRuntimeStageResult>) => {
    if (result.value) {
      context.runtimeStaging.value = result.value
      context.runtimeStatus.value = result.value.runtime
      if (result.value.transaction?.sourceUnchanged) context.fileMessage.value = `${result.message} Source project files were not modified.`
    }
    context.runtimeProofMissing.value = result.status === 'success' && result.value?.transaction?.sourceUnchanged !== true
  }

  const exportRuntime = async () => stageRuntime()

  const exportRuntimeJson = async (path?: string, overwrite = false) => {
    if (!context.canSave.value) {
      context.fileStatus.value = 'unavailable'
      context.fileMessage.value = 'Runtime JSON export adapter is not connected; no file was written.'
      return false
    }
    try {
      context.flushDrafts()
      context.fileStatus.value = 'busy'
      const runtime = exportRuntimeDocument(context.document.value)
      const result = await context.getFile().exportRuntime(runtime, { path, overwrite })
      context.fileStatus.value = result.status
      context.fileMessage.value = result.message
      setConflictState(result, 'export', path)
      if (result.status === 'success') clearConflictState()
      return result.status === 'success'
    } catch (error) {
      context.fileStatus.value = 'error'
      context.fileMessage.value = error instanceof UiExportValidationError ? error.issues.map((item) => item.message).join(' ') : error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (context.fileStatus.value === 'busy') context.fileStatus.value = 'error'
    }
  }

  const installRuntime = async (options: { enable: true; forceModifiedRuntime?: boolean } = { enable: true }) => {
    if (!context.canManageRuntime.value) return false
    context.fileStatus.value = 'busy'
    context.runtimeProofMissing.value = false
    const generation = context.projectGeneration.value
    try {
      const result = await context.getRuntime().installRuntime(context.projectPath.value ?? '', options)
      if (generation !== context.projectGeneration.value) return false
      context.fileStatus.value = result.status
      context.fileMessage.value = result.message
      applyStageResult(result)
      if (result.status !== 'success' || context.runtimeProofMissing.value) {
        if (context.runtimeProofMissing.value) { context.fileStatus.value = 'error'; context.fileMessage.value = 'Runtime staging proof was not returned; the operation is not reported as complete.' }
        return false
      }
      return true
    } catch (error) {
      context.fileStatus.value = 'error'
      context.fileMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (context.fileStatus.value === 'busy') context.fileStatus.value = 'error'
    }
  }

  const stageRuntime = async (options: { targetPath?: string; overwrite?: boolean } = {}) => {
    if (!context.canExport.value) return false
    context.fileStatus.value = 'busy'
    context.runtimeProofMissing.value = false
    const generation = context.projectGeneration.value
    try {
      context.flushDrafts()
      context.runtimeConflict.value = false
      context.runtimeConflictOperation.value = 'stage'
      context.runtimeConflictFiles.value = []
      context.runtimeConflictPath.value = options.targetPath
      const runtime = exportRuntimeDocument(context.document.value)
      const result = await context.getRuntime().stageScene(context.projectPath.value ?? '', runtime, options)
      if (generation !== context.projectGeneration.value) return false
      context.fileStatus.value = result.status
      context.fileMessage.value = result.message
      setConflictState(result, 'stage', options.targetPath)
      applyStageResult(result)
      if (result.status === 'success') clearConflictState()
      if (result.status !== 'success' || context.runtimeProofMissing.value) {
        if (context.runtimeProofMissing.value) { context.fileStatus.value = 'error'; context.fileMessage.value = 'Runtime staging proof was not returned; the operation is not reported as complete.' }
        return false
      }
      return true
    } catch (error) {
      context.fileStatus.value = 'error'
      context.fileMessage.value = error instanceof UiExportValidationError ? error.issues.map((item) => item.message).join(' ') : error instanceof Error ? error.message : String(error)
      return false
    } finally {
      if (context.fileStatus.value === 'busy') context.fileStatus.value = 'error'
    }
  }

  const resolveRuntimeConflict = async () => {
    if (!context.runtimeConflict.value) return false
    const operation = context.runtimeConflictOperation.value
    const path = context.runtimeConflictPath.value
    const success = operation === 'export' ? await exportRuntimeJson(path, true) : await stageRuntime({ targetPath: path, overwrite: true })
    if (success) clearConflictState()
    return success
  }

  const checkRuntime = async () => {
    if (!context.hasProject.value) {
      context.runtimeStatus.value = { state: 'file-unconfigured', message: 'Select a project before checking Runtime.' }
      return context.runtimeStatus.value
    }
    const generation = context.projectGeneration.value
    try {
      const result = await context.getRuntime().checkRuntime(context.projectPath.value)
      if (generation === context.projectGeneration.value) context.runtimeStatus.value = result
    } catch (error) {
      if (generation === context.projectGeneration.value) {
        context.runtimeStatus.value = { state: 'error', message: error instanceof Error ? error.message : String(error) }
      }
    }
    return context.runtimeStatus.value
  }

  return { exportRuntime, exportRuntimeJson, installRuntime, stageRuntime, resolveRuntimeConflict, clearConflictState, checkRuntime }
}
