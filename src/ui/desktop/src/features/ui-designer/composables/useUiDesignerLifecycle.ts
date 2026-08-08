import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { UiDesignerLifecycleAdapter, UiDesignerLifecycleGuard } from '@contract/ui-designer'

export interface UiDesignerLifecycleOptions {
  adapter?: UiDesignerLifecycleAdapter
  isDirty: () => boolean
  save: () => void | Promise<void> | Promise<boolean>
  discard: () => void | Promise<void> | Promise<boolean>
  confirmDiscard: () => Promise<boolean>
}

/**
 * Registers the designer's dirty-state guard with the host renderer when one
 * is available. During development, the browser-level guard is intentionally
 * limited to the unload boundary; route/dialog decisions stay with the host
 * lifecycle adapter so the designer never silently discards edits.
 */
export function useUiDesignerLifecycle(options: UiDesignerLifecycleOptions) {
  const registered = ref(false)
  let unregisterHost: (() => void) | undefined

  const guard: UiDesignerLifecycleGuard = {
    isDirty: options.isDirty,
    save: options.save,
    discard: options.discard,
    confirmDiscard: options.confirmDiscard,
  }

  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!options.isDirty()) return
    event.preventDefault()
    event.returnValue = ''
  }

  onMounted(() => {
    if (options.adapter) {
      unregisterHost = options.adapter.registerGuard(guard)
      registered.value = true
      return
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', beforeUnload)
      registered.value = true
    }
  })

  onBeforeUnmount(() => {
    unregisterHost?.()
    unregisterHost = undefined
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeUnload)
    registered.value = false
  })

  const requestDiscard = async () => {
    if (!options.isDirty()) return true
    return options.confirmDiscard()
  }

  return { guard, registered, requestDiscard }
}
