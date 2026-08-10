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
  previewStatus: ValueRef<UiPreviewState>
  previewMessage: ValueRef<string>
  previewSessionId: ValueRef<string | undefined>
  previewDiagnostics: ValueRef<UiRuntimeDiagnostic[]>
  poller: Pick<ReturnType<typeof import('./previewLifecycle').createUiDesignerPreviewPoller>, 'start' | 'clear'>
  flushDrafts: () => void
}

/**
 * Game Preview deliberately lives outside the document controller. The game
 * runner consumes validated Runtime JSON in an isolated temporary project;
 * editor preview execution-mode switching is owned by the renderer host.
 */
export function createUiDesignerPreviewOperations(context: UiDesignerPreviewOperationContext) {
  let operationSequence = 0
  const startPreview = async () => {
    if (context.previewStatus.value === 'preparing' || context.isPreviewing.value || context.previewSessionId.value) return false
    if (!context.canPreview.value) {
      context.previewStatus.value = 'unavailable'
      context.previewMessage.value = 'Game preview adapter is not connected; the game was not started.'
      context.previewDiagnostics.value = []
      return false
    }
    context.previewStatus.value = 'preparing'
    context.previewDiagnostics.value = []
    const generation = context.projectGeneration.value
    const operation = ++operationSequence
    try {
      context.flushDrafts()
      const runtimeScene = exportRuntimeDocument(context.document.value)
      const result = await context.getPreview().start(runtimeScene, context.projectPath.value)
      if (operation !== operationSequence) return false
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
      context.previewSessionId.value = result.state === 'running' || (result.state === 'error' && result.cleanup?.ok === false) ? result.sessionId : undefined
      if (context.isPreviewing.value && !context.previewSessionId.value) {
        context.isPreviewing.value = false
        context.previewStatus.value = 'error'
        context.previewMessage.value = 'Preview runner did not return a session id.'
      }
      if (context.isPreviewing.value && context.previewSessionId.value) context.poller.start(generation, context.previewSessionId.value)
      return context.isPreviewing.value
    } catch (error) {
      if (operation !== operationSequence) return false
      context.previewStatus.value = 'error'
      context.previewMessage.value = error instanceof Error ? error.message : String(error)
      context.isPreviewing.value = false
      return false
    }
  }

  const stopPreview = async () => {
    if (context.previewStatus.value !== 'preparing' && !context.isPreviewing.value && !context.previewSessionId.value) return true
    const capturedGeneration = context.projectGeneration.value
    const capturedSessionId = context.previewSessionId.value
    const operation = ++operationSequence
    context.poller.clear()
    try {
      const result = await context.getPreview().stop(capturedSessionId)
      if (operation !== operationSequence) return false
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
      if (operation !== operationSequence) return false
      context.previewStatus.value = 'error'
      context.previewMessage.value = error instanceof Error ? error.message : String(error)
      if (capturedSessionId && capturedGeneration === context.projectGeneration.value && capturedSessionId === context.previewSessionId.value) {
        context.isPreviewing.value = true
        context.poller.start(capturedGeneration, capturedSessionId)
      }
      return false
    }
  }

  const supersede = () => { operationSequence += 1 }
  return { startPreview, stopPreview, supersede }
}
