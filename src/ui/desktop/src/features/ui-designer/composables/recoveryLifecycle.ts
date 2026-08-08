import type { UiDesignerPersistenceAdapter, UiFileStatus } from '@contract/ui-designer'

export interface UiRecoveryClearResult {
  ok: boolean
  status: UiFileStatus
  message: string
}

/** Persistence-only recovery cleanup; callers decide how a failed guard blocks UI. */
export async function clearRecoverySnapshot(adapter: UiDesignerPersistenceAdapter, recoveryId: string): Promise<UiRecoveryClearResult> {
  try {
    const result = await adapter.clearRecovery(recoveryId)
    return { ok: result.status === 'success', status: result.status, message: result.message }
  } catch (error) {
    return { ok: false, status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
