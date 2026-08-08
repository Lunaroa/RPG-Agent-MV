import type { IpcMain } from 'electron'

import {
  normalizeProductPluginSettings,
  PRODUCT_PLUGIN_DESCRIPTORS,
  type ProductPluginIpcError,
  type ProductPluginListResult,
  type ProductPluginSnapshotResult,
  type ProductPluginSetEnabledRequest,
  type ProductPluginSetEnabledResult,
  type ProductPluginSettings,
} from '../../../contract/product-plugin.ts'

export interface ProductPluginIpcDependencies {
  readSettings(): { productPlugins?: ProductPluginSettings } | unknown
  patchSettings(patch: { productPlugins: ProductPluginSettings }): { productPlugins?: ProductPluginSettings } | unknown
}

function snapshot(settings: unknown) {
  const normalized = normalizeProductPluginSettings(
    settings && typeof settings === 'object' ? (settings as { productPlugins?: unknown }).productPlugins : undefined,
  ) || {}
  return PRODUCT_PLUGIN_DESCRIPTORS.map((descriptor) => ({
    id: descriptor.id,
    version: descriptor.version,
    enabled: normalized[descriptor.id] === true,
  }))
}

function error(
  operation: ProductPluginIpcError['operation'],
  code: ProductPluginIpcError['code'],
): ProductPluginIpcError {
  return { operation, code, recoverable: code !== 'unknown-plugin', choices: code === 'persistence-failed' ? ['retry', 'open-settings'] : ['retry'] }
}

export function registerProductPluginIpcHandlers(
  ipcMain: Pick<IpcMain, 'handle'>,
  dependencies: ProductPluginIpcDependencies,
): void {
  ipcMain.handle('product-plugin:list', () => {
    try {
      const result: ProductPluginListResult = {
        descriptors: PRODUCT_PLUGIN_DESCRIPTORS.map((descriptor) => ({ ...descriptor })),
        snapshot: snapshot(dependencies.readSettings()),
      }
      return result
    } catch {
      return {
        descriptors: PRODUCT_PLUGIN_DESCRIPTORS.map((descriptor) => ({ ...descriptor })),
        snapshot: [],
        error: error('list', 'persistence-failed'),
      }
    }
  })
  ipcMain.handle('product-plugin:snapshot', (): ProductPluginSnapshotResult => {
    try { return { snapshot: snapshot(dependencies.readSettings()) } }
    catch { return { snapshot: [], error: error('snapshot', 'persistence-failed') } }
  })
  ipcMain.handle('product-plugin:set-enabled', (_event, request: ProductPluginSetEnabledRequest): ProductPluginSetEnabledResult => {
    const id = String(request?.id || '').trim()
    const enabled = request?.enabled
    const descriptor = PRODUCT_PLUGIN_DESCRIPTORS.find((entry) => entry.id === id)
    if (!descriptor || typeof enabled !== 'boolean') {
      const operation = 'set-enabled' as const
      const code = !descriptor ? 'unknown-plugin' as const : 'invalid-request' as const
      let current = { id, version: descriptor?.version || '', enabled: false }
      let currentSettings: ProductPluginSettings = {}
      try {
        current = snapshot(dependencies.readSettings()).find((entry) => entry.id === id) || current
        currentSettings = normalizeProductPluginSettings((dependencies.readSettings() as { productPlugins?: unknown })?.productPlugins) || {}
      } catch {
        return { ok: false, id, enabled: current.enabled, snapshot: current, settings: currentSettings, error: error(operation, 'persistence-failed') }
      }
      return { ok: false, id, enabled: current.enabled, snapshot: current, settings: currentSettings, error: error(operation, code) }
    }
    try {
      const settings = dependencies.patchSettings({ productPlugins: { [id]: enabled } })
      const normalized = normalizeProductPluginSettings((settings as { productPlugins?: unknown })?.productPlugins) || { [id]: enabled }
      const current = snapshot({ productPlugins: normalized }).find((entry) => entry.id === id)!
      return { ok: true, id, enabled: current.enabled, snapshot: current, settings: normalized }
    } catch {
      let current = { id, version: descriptor.version, enabled: false }
      let currentSettings: ProductPluginSettings = {}
      try {
        current = snapshot(dependencies.readSettings()).find((entry) => entry.id === id) || current
        currentSettings = normalizeProductPluginSettings((dependencies.readSettings() as { productPlugins?: unknown })?.productPlugins) || {}
      } catch { /* keep a safe structured failure result */ }
      return { ok: false, id, enabled: current.enabled, snapshot: current, settings: currentSettings, error: error('set-enabled', 'persistence-failed') }
    }
  })
}

export function cleanupProductPluginIpcHandlers(ipcMain: Pick<IpcMain, 'removeHandler'>): void {
  ipcMain.removeHandler('product-plugin:list')
  ipcMain.removeHandler('product-plugin:snapshot')
  ipcMain.removeHandler('product-plugin:set-enabled')
}
