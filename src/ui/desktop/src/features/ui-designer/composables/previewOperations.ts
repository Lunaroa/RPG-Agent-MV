import type { Ref } from 'vue'
import type {
  UiDesignerDocument,
  UiDesignerPreviewAdapter,
  UiPreviewState,
  UiRuntimeDiagnostic,
} from '@contract/ui-designer'
import { exportRuntimeDocument } from '../models/export'
type ValueRef<T> = Pick<Ref<T>, 'value'>

export interface UiDesignerPreviewOperationContext {
  getPreview: () => UiDesignerPreviewAdapter
  projectPath: ValueRef<string | undefined>
  projectGeneration: ValueRef<number>
  document: ValueRef<UiDesignerDocument>
  canPreview: ValueRef<boolean>
  isPreviewing: ValueRef<boolean>
  isEditorPreviewing: ValueRef<boolean>
  editorPreviewStatus: ValueRef<'idle' | 'running' | 'stopped'>
  previewStatus: ValueRef<UiPreviewState>
  previewMessage: ValueRef<string>
  previewSessionId: ValueRef<string | undefined>
  previewDiagnostics: ValueRef<UiRuntimeDiagnostic[]>
  poller: Pick<ReturnType<typeof import('./previewLifecycle').createUiDesignerPreviewPoller>, 'start' | 'clear'>
  flushDrafts: () => void
}

/**
 * Preview operations deliberately live outside the document controller.  The
 * game runner consumes validated Runtime JSON, while editor preview only
 * changes view state and never touches document history.
 */
export function createUiDesignerPreviewOperations(context: UiDesignerPreviewOperationContext) {
  const startPreview = async () => {
    if (!context.canPreview.value) {
      context.previewStatus.value = 'unavailable'
      context.previewMessage.value = 'Game preview adapter is not connected; the game was not started.'
      context.previewDiagnostics.value = []
      return false
    }
    context.previewStatus.value = 'preparing'
    context.previewDiagnostics.value = []
    const generation = context.projectGeneration.value
    try {
      context.flushDrafts()
      const runtimeScene = exportRuntimeDocument(context.document.value)
      const result = await context.getPreview().start(runtimeScene, context.projectPath.value)
      if (generation !== context.projectGeneration.value) {
        context.previewDiagnostics.value = result.diagnostics ? [...result.diagnostics] : []
        if (result.sessionId) {
          try {
            const stopped = await context.getPreview().stop(result.sessionId)
            context.previewDiagnostics.value = stopped.diagnostics ? [...stopped.diagnostics] : []
            if (stopped.state !== 'stopped') throw new Error(stopped.message)
            context.previewDiagnostics.value = []
          } catch (error) {
            // A stale start must remain actionable: retain the runner handle
            // and poll it rather than creating an orphaned process.
            context.previewSessionId.value = result.sessionId
            context.isPreviewing.value = true
            context.previewStatus.value = 'error'
            context.previewMessage.value = error instanceof Error ? error.message : String(error)
            context.poller.start(context.projectGeneration.value, result.sessionId)
          }
        } else {
          context.previewDiagnostics.value = []
        }
        return false
      }
      context.previewStatus.value = result.state
      context.previewMessage.value = result.message
      context.previewDiagnostics.value = result.diagnostics ? [...result.diagnostics] : []
      context.isPreviewing.value = result.state === 'running'
      context.previewSessionId.value = result.sessionId
      if (context.isPreviewing.value && !context.previewSessionId.value) {
        context.isPreviewing.value = false
        context.previewStatus.value = 'error'
        context.previewMessage.value = 'Preview runner did not return a session id.'
      }
      if (context.isPreviewing.value && context.previewSessionId.value) context.poller.start(generation, context.previewSessionId.value)
      return context.isPreviewing.value
    } catch (error) {
      context.previewStatus.value = 'error'
      context.previewMessage.value = error instanceof Error ? error.message : String(error)
      context.isPreviewing.value = false
      return false
    }
  }

  const stopPreview = async () => {
    if (!context.isPreviewing.value && !context.previewSessionId.value) return true
    const capturedGeneration = context.projectGeneration.value
    const capturedSessionId = context.previewSessionId.value
    context.poller.clear()
    try {
      const result = await context.getPreview().stop(capturedSessionId)
      if (capturedGeneration !== context.projectGeneration.value || capturedSessionId !== context.previewSessionId.value) return false
      context.previewStatus.value = result.state
      context.previewMessage.value = result.message
      context.previewDiagnostics.value = result.diagnostics ? [...result.diagnostics] : []
      if (result.state === 'stopped') {
        context.isPreviewing.value = false
        context.previewSessionId.value = undefined
        return true
      }
      context.isPreviewing.value = true
      if (capturedSessionId) context.poller.start(capturedGeneration, capturedSessionId)
      return false
    } catch (error) {
      context.previewStatus.value = 'error'
      context.previewMessage.value = error instanceof Error ? error.message : String(error)
      if (capturedSessionId && capturedGeneration === context.projectGeneration.value && capturedSessionId === context.previewSessionId.value) {
        context.isPreviewing.value = true
        context.poller.start(capturedGeneration, capturedSessionId)
      }
      return false
    }
  }

  const startEditorPreview = () => {
    context.isEditorPreviewing.value = true
    context.editorPreviewStatus.value = 'running'
    return true
  }

  const stopEditorPreview = () => {
    context.isEditorPreviewing.value = false
    context.editorPreviewStatus.value = 'stopped'
    return true
  }

  return { startPreview, stopPreview, startEditorPreview, stopEditorPreview }
}
