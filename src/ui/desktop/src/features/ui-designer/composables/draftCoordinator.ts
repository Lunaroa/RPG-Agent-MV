export type UiDesignerDraftFlusher = () => void
export type UiDesignerDraftCanceller = () => void
export type UiDesignerDraftPending = () => boolean

export interface UiDesignerDraftRegistrationOptions {
  /** Optional scene identity for operations that target one tab. */
  sceneId?: string | (() => string | undefined)
  /** Cancel a pending debounce without emitting it into document history. */
  cancel?: UiDesignerDraftCanceller
  /** Report whether this editor currently owns an uncommitted value. */
  pending?: UiDesignerDraftPending
}

/**
 * A controller-scoped registry for debounced editors.  Components register
 * their pending emitters while mounted; persistence/runtime operations call
 * flush() before cloning/exporting the document.
 */
export interface UiDesignerDraftCoordinator {
  register(flusher: UiDesignerDraftFlusher, options?: UiDesignerDraftRegistrationOptions): () => void
  flush(sceneId?: string): void
  cancel(sceneId?: string): void
  hasPending(sceneId?: string): boolean
}

export function createUiDesignerDraftCoordinator(): UiDesignerDraftCoordinator {
  type Registration = {
    flush: UiDesignerDraftFlusher
    cancel?: UiDesignerDraftCanceller
    pending?: UiDesignerDraftPending
    sceneId?: string | (() => string | undefined)
  }
  const registrations = new Set<Registration>()
  const matchesScene = (registration: Registration, sceneId?: string) => {
    if (sceneId === undefined) return true
    const identity = typeof registration.sceneId === 'function' ? registration.sceneId() : registration.sceneId
    return identity === sceneId
  }
  return {
    register(flush, options = {}) {
      const registration: Registration = { flush, ...options }
      registrations.add(registration)
      return () => registrations.delete(registration)
    },
    flush(sceneId) {
      for (const registration of [...registrations]) {
        if (matchesScene(registration, sceneId)) registration.flush()
      }
    },
    cancel(sceneId) {
      for (const registration of [...registrations]) {
        if (matchesScene(registration, sceneId)) registration.cancel?.()
      }
    },
    hasPending(sceneId) {
      return [...registrations].some((registration) => matchesScene(registration, sceneId) && Boolean(registration.pending?.()))
    },
  }
}
