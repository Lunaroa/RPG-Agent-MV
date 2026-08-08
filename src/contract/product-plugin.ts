/**
 * Product-level plugins are extensions to RPG Agent MV itself. They are
 * intentionally separate from an RPG Maker project's `plugins.js` entries.
 */
export type ProductPluginId = string

export interface ProductPluginLocaleText {
  'en-US': string
  'zh-CN': string
}

/** Static built-in product extension metadata shared by renderer and Electron. */
export interface ProductPluginDescriptor {
  id: ProductPluginId
  version: string
  route: string
  icon: string
  name: ProductPluginLocaleText
  description: ProductPluginLocaleText
  compatibleProductVersion: string
  defaultEnabled: false
}

/** Built-in catalog shared by the Electron boundary and renderer registry. */
export const PRODUCT_PLUGIN_DESCRIPTORS = [
  {
    id: 'ui-designer',
    version: '1.0.0',
    route: '/ui-designer',
    icon: 'Brush',
    name: { 'en-US': 'UI Designer', 'zh-CN': '界面设计器' },
    description: {
      'en-US': 'Design RPG Maker MV/MZ scenes locally.',
      'zh-CN': '在本地设计 RPG Maker MV/MZ 界面场景。',
    },
    compatibleProductVersion: '^0.7.1',
    defaultEnabled: false,
  },
] as const satisfies readonly ProductPluginDescriptor[]

/** Persisted enablement state for product plugins in workspace settings. */
export type ProductPluginSettings = Record<ProductPluginId, boolean>

export interface ProductPluginSnapshot {
  id: ProductPluginId
  enabled: boolean
  version: string
}

export interface ProductPluginListResult {
  descriptors: ProductPluginDescriptor[]
  snapshot: ProductPluginSnapshot[]
  error?: ProductPluginIpcError
}

export interface ProductPluginSnapshotResult {
  snapshot: ProductPluginSnapshot[]
  error?: ProductPluginIpcError
}

export interface ProductPluginSetEnabledRequest {
  id: ProductPluginId
  enabled: boolean
}

export interface ProductPluginSetEnabledResult {
  ok: boolean
  id: ProductPluginId
  enabled: boolean
  snapshot: ProductPluginSnapshot
  settings: ProductPluginSettings
  error?: ProductPluginIpcError
}

export interface ProductPluginIpcError {
  code: 'unknown-plugin' | 'invalid-request' | 'persistence-failed'
  operation: 'list' | 'snapshot' | 'set-enabled'
  recoverable: boolean
  choices?: readonly ('retry' | 'open-settings')[]
}

/**
 * Normalize a persisted product-plugin map without dropping unknown ids. The
 * registry may gain entries in a later release, so preserving valid unknown
 * values avoids silently losing a user's workspace state during upgrades.
 */
export function normalizeProductPluginSettings(
  value: unknown,
  keepEmpty = false,
): ProductPluginSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const normalized: ProductPluginSettings = {}
  for (const [rawId, enabled] of Object.entries(value as Record<string, unknown>)) {
    const id = rawId.trim()
    if (!id || typeof enabled !== 'boolean') continue
    normalized[id] = enabled
  }

  return Object.keys(normalized).length || keepEmpty ? normalized : undefined
}

/** Missing entries are deliberately disabled until the user enables them. */
export function isProductPluginEnabled(
  settings: ProductPluginSettings | undefined,
  id: ProductPluginId,
): boolean {
  return settings?.[id] === true
}
