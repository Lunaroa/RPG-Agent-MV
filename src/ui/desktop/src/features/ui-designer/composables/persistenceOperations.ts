import type { Ref } from 'vue'
import type {
  UiDesignerPersistenceAdapter,
  UiDesignerRecentFileRecord,
  UiDesignerRecoveryRecord,
  UiFileStatus,
} from '@contract/ui-designer'
import { normalizeUiDesignerPaneSize } from '@contract/ui-designer-geometry'

type ValueRef<T> = Pick<Ref<T>, 'value'>

/** Bundled JetBrains Mono first; generic monospace families guarantee a monospaced fallback. */
export const UI_DESIGNER_DEFAULT_CODE_FONT_FAMILY = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "Cascadia Code", Consolas, Menlo, monospace'
export interface UiDesignerPersistencePreferences {
  historyLimit: number
  gridEnabled: boolean
  snapEnabled: boolean
  tourCompleted: boolean
  [key: string]: unknown
}

const finiteOr = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export interface UiDesignerPersistenceOperationContext {
  getFile: () => UiDesignerPersistenceAdapter
  canSave: ValueRef<boolean>
  generation: ValueRef<number>
  recentFiles: ValueRef<UiDesignerRecentFileRecord[]>
  recoveryRecords: ValueRef<UiDesignerRecoveryRecord[]>
  preferences: ValueRef<UiDesignerPersistencePreferences>
  setFileStatus: (status: UiFileStatus, message: string) => void
  normalizeHistoryLimit: (value: unknown) => number
  applyHistoryLimit: (value: number) => void
  onRecoveryRemoved?: () => void
}

/** Persistence/recent/preferences operations kept outside the document model controller. */
export function createUiDesignerPersistenceOperations(context: UiDesignerPersistenceOperationContext) {
  const removeRecentFile = async (path: string) => {
    if (!context.canSave.value) return false
    try {
      const result = await context.getFile().removeRecentFile(path)
      if (result.status === 'success') context.recentFiles.value = context.recentFiles.value.filter((item) => item.sourcePath !== path)
      else context.setFileStatus(result.status, result.message)
      return result.status === 'success'
    } catch (error) {
      context.setFileStatus('error', error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const removeRecovery = async (recoveryId: string) => {
    if (!context.canSave.value) return false
    try {
      const result = await context.getFile().clearRecovery(recoveryId)
      if (result.status !== 'success') { context.setFileStatus(result.status, result.message); return false }
      context.recoveryRecords.value = context.recoveryRecords.value.filter((record) => record.id !== recoveryId)
      context.onRecoveryRemoved?.()
      return true
    } catch (error) {
      context.setFileStatus('error', error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const loadPreferences = async () => {
    if (!context.canSave.value) return false
    const generation = context.generation.value
    try {
      const result = await context.getFile().readPreferences()
      if (generation !== context.generation.value) return false
      if (result.status === 'success' && result.value) {
        const next = { ...context.preferences.value, ...result.value }
        // Drop the obsolete left resource splitter size from older settings.
        const obsoletePanePreference = ['leftNodePane', 'Height'].join('')
        if (obsoletePanePreference in next) delete next[obsoletePanePreference]
        next.historyLimit = context.normalizeHistoryLimit(next.historyLimit)
        if (typeof next.gridEnabled !== 'boolean') next.gridEnabled = true
        if (typeof next.snapEnabled !== 'boolean') next.snapEnabled = true
        if (typeof next.tourCompleted !== 'boolean') next.tourCompleted = false
        next.autoSaveIntervalMinutes = finiteOr(next.autoSaveIntervalMinutes, 1, 0, 120)
        next.gridSize = finiteOr(next.gridSize, 16, 1, 256)
        next.gridColor = typeof next.gridColor === 'string' && next.gridColor.trim() ? next.gridColor : '#394150'
        next.snapSensitivity = finiteOr(next.snapSensitivity, 8, 0, 64)
        next.defaultCanvasWidth = finiteOr(next.defaultCanvasWidth, 816, 1, 8192)
        next.defaultCanvasHeight = finiteOr(next.defaultCanvasHeight, 624, 1, 8192)
        // Migrate the legacy bare ui-monospace default; Windows has no such
        // family, so it silently rendered as the proportional browser default.
        if (typeof next.codeFontFamily === 'string' && next.codeFontFamily.trim() === 'ui-monospace') next.codeFontFamily = UI_DESIGNER_DEFAULT_CODE_FONT_FAMILY
        next.codeFontFamily = typeof next.codeFontFamily === 'string' && next.codeFontFamily.trim() ? next.codeFontFamily : UI_DESIGNER_DEFAULT_CODE_FONT_FAMILY
        next.codeFontSize = finiteOr(next.codeFontSize, 12, 8, 32)
        next.codeTabSize = finiteOr(next.codeTabSize, 2, 1, 8)
        next.theme = next.theme === 'light' || next.theme === 'dark' ? next.theme : 'system'
        next.defaultAuthor = typeof next.defaultAuthor === 'string' ? next.defaultAuthor : ''
        if (typeof next.autoFormat !== 'boolean') next.autoFormat = false
        next.leftPaneWidth = normalizeUiDesignerPaneSize('left', next.leftPaneWidth)
        next.centerPaneWidth = normalizeUiDesignerPaneSize('center', next.centerPaneWidth)
        next.rightPaneWidth = normalizeUiDesignerPaneSize('right', next.rightPaneWidth)
        context.preferences.value = next
        context.applyHistoryLimit(next.historyLimit)
      }
      return result.status === 'success'
    } catch {
      return false
    }
  }

  const savePreferences = async (next: Record<string, unknown>) => {
    const normalized = { ...next }
    if ('leftPaneWidth' in normalized) normalized.leftPaneWidth = normalizeUiDesignerPaneSize('left', normalized.leftPaneWidth, Number(context.preferences.value.leftPaneWidth ?? 260))
    if ('centerPaneWidth' in normalized) normalized.centerPaneWidth = normalizeUiDesignerPaneSize('center', normalized.centerPaneWidth, Number(context.preferences.value.centerPaneWidth ?? 640))
    if ('rightPaneWidth' in normalized) normalized.rightPaneWidth = normalizeUiDesignerPaneSize('right', normalized.rightPaneWidth, Number(context.preferences.value.rightPaneWidth ?? 320))
    context.preferences.value = { ...context.preferences.value, ...normalized }
    if (!context.canSave.value) return false
    const generation = context.generation.value
    try {
      const result = await context.getFile().writePreferences(context.preferences.value)
      if (generation !== context.generation.value) return false
      if (result.status !== 'success') context.setFileStatus(result.status, result.message)
      return result.status === 'success'
    } catch {
      return false
    }
  }

  return { removeRecentFile, removeRecovery, loadPreferences, savePreferences }
}
