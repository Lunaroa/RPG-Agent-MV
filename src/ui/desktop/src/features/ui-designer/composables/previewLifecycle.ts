import type { Ref } from 'vue'
import type { UiDesignerPreviewAdapter, UiPreviewState, UiRuntimeDiagnostic } from '@contract/ui-designer'

export interface UiDesignerPreviewPollState {
  isPreviewing: Ref<boolean>
  previewStatus: Ref<UiPreviewState>
  previewMessage: Ref<string>
  previewSessionId: Ref<string | undefined>
  previewDiagnostics: Ref<UiRuntimeDiagnostic[]>
  projectGeneration: Ref<number>
}

/** Keeps runner polling and cleanup semantics outside the document controller. */
export function createUiDesignerPreviewPoller(getAdapter: () => UiDesignerPreviewAdapter, state: UiDesignerPreviewPollState) {
  let timer: ReturnType<typeof setInterval> | undefined
  const clear = () => { if (timer) { clearInterval(timer); timer = undefined } }
  const start = (generation: number, sessionId: string) => {
    clear()
    timer = setInterval(() => {
      void getAdapter().current().then((current) => {
        if (generation !== state.projectGeneration.value || sessionId !== state.previewSessionId.value) return
        state.previewStatus.value = current.state
        state.previewMessage.value = current.message
        state.previewDiagnostics.value = current.diagnostics ? [...current.diagnostics] : []
        if (current.state !== 'running' && current.state !== 'preparing') {
          state.isPreviewing.value = false
          clear()
          const cleanupFailed = Boolean(current.cleanup && !current.cleanup.ok)
          if (cleanupFailed) state.previewMessage.value = current.cleanup?.message ?? current.message
          else state.previewSessionId.value = undefined
        }
      }).catch((error: unknown) => {
        if (generation !== state.projectGeneration.value || sessionId !== state.previewSessionId.value) return
        state.isPreviewing.value = true
        state.previewStatus.value = 'error'
        state.previewMessage.value = error instanceof Error ? error.message : String(error)
      })
    }, 1000)
  }
  return { start, clear }
}
