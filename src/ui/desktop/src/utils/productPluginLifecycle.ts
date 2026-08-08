import type { ProductPluginId } from '@contract/product-plugin'

export type ProductPluginDirtyAction = 'save' | 'discard' | 'cancel'

export interface ProductPluginLifecycleGuard {
  isDirty?: () => boolean | Promise<boolean>
  save: () => boolean | Promise<boolean>
  discard: () => boolean | Promise<boolean>
}

export type ProductPluginDisableReason =
  | 'cancelled'
  | 'save-failed'
  | 'discard-failed'
  | 'guard-failed'

export interface ProductPluginDisableResult {
  allowed: boolean
  reason?: ProductPluginDisableReason
  error?: unknown
}

const guards = new Map<ProductPluginId, ProductPluginLifecycleGuard>()

/** Register the renderer-side lifecycle contract for a product plugin. */
export function registerProductPluginLifecycleGuard(
  pluginId: ProductPluginId,
  guard: ProductPluginLifecycleGuard,
): () => void {
  guards.set(pluginId, guard)
  return () => {
    if (guards.get(pluginId) === guard) guards.delete(pluginId)
  }
}

export function clearProductPluginLifecycleGuards(): void {
  guards.clear()
}

export function getProductPluginLifecycleGuard(
  pluginId: ProductPluginId,
): ProductPluginLifecycleGuard | undefined {
  return guards.get(pluginId)
}

/**
 * Ask the current renderer surface to settle dirty state before disabling.
 * Missing guards are clean by definition until the surface integrates this
 * protocol. A failed save/discard never authorizes the caller to disable.
 */
export async function requestProductPluginDisable(
  pluginId: ProductPluginId,
  chooseDirtyAction: () => ProductPluginDirtyAction | Promise<ProductPluginDirtyAction>,
): Promise<ProductPluginDisableResult> {
  const guard = guards.get(pluginId)
  if (!guard) return { allowed: true }

  let dirty = false
  try {
    dirty = Boolean(await guard.isDirty?.())
  } catch (error) {
    return { allowed: false, reason: 'guard-failed', error }
  }
  if (!dirty) return { allowed: true }

  let action: ProductPluginDirtyAction
  try {
    action = await chooseDirtyAction()
  } catch (error) {
    return { allowed: false, reason: 'cancelled', error }
  }
  if (action === 'cancel') return { allowed: false, reason: 'cancelled' }

  try {
    const settled = action === 'save' ? await guard.save() : await guard.discard()
    if (settled !== true) {
      return {
        allowed: false,
        reason: action === 'save' ? 'save-failed' : 'discard-failed',
      }
    }
    // A successful callback must actually clear the renderer's dirty state.
    // Re-checking here prevents a stale/partial save from disabling the plugin.
    if (Boolean(await guard.isDirty?.())) {
      return {
        allowed: false,
        reason: action === 'save' ? 'save-failed' : 'discard-failed',
      }
    }
    return { allowed: true }
  } catch (error) {
    return {
      allowed: false,
      reason: action === 'save' ? 'save-failed' : 'discard-failed',
      error,
    }
  }
}
