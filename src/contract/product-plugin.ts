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
    name: { 'en-US': 'Custom Scenes', 'zh-CN': '自定义场景' },
    description: {
      'en-US': 'Design custom RPG Maker MV/MZ scenes locally.',
      'zh-CN': '在本地设计 RPG Maker MV/MZ 自定义场景。',
    },
    compatibleProductVersion: '^0.8.0',
    defaultEnabled: false,
  },
  {
    id: 'unlimited-map-layers',
    version: '1.0.0',
    route: '/workbench',
    icon: 'Picture',
    name: { 'en-US': 'Unlimited map layers', 'zh-CN': '无限图层' },
    description: {
      'en-US': 'Edit and preview ULDS layers in the map editor and map overview.',
      'zh-CN': '在地图编辑器与地图总览中编辑和预览 ULDS 无限图层。',
    },
    compatibleProductVersion: '^0.8.0',
    defaultEnabled: false,
  },
  {
    id: 'map-overview',
    version: '1.0.0',
    route: '/map-overview',
    icon: 'MapLocation',
    name: { 'en-US': 'Global Map', 'zh-CN': '全局地图' },
    description: {
      'en-US': 'Inspect and arrange the project-wide map relationship graph.',
      'zh-CN': '查看并整理整个工程的地图关系。',
    },
    compatibleProductVersion: '^0.8.0',
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
