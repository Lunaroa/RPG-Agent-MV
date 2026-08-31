import type {
  ProductPluginDescriptor,
  ProductPluginId,
} from '@contract/product-plugin'
import { PRODUCT_PLUGIN_DESCRIPTORS } from '@contract/product-plugin'
import type { MessageKey } from '../i18n/messages'

export interface ProductPluginDefinition extends ProductPluginDescriptor {
  titleKey: MessageKey
  descriptionKey: MessageKey
}

/**
 * Built-in product extensions. This is intentionally static for now: the
 * marketplace surface is a local catalog and does not fetch or install code.
 */
export const PRODUCT_PLUGIN_REGISTRY = [
  {
    ...PRODUCT_PLUGIN_DESCRIPTORS[0],
    titleKey: 'productPlugin.uiDesigner.title',
    descriptionKey: 'productPlugin.uiDesigner.description',
  },
  {
    ...PRODUCT_PLUGIN_DESCRIPTORS[1],
    titleKey: 'productPlugin.unlimitedMapLayers.title',
    descriptionKey: 'productPlugin.unlimitedMapLayers.description',
  },
  {
    ...PRODUCT_PLUGIN_DESCRIPTORS[2],
    titleKey: 'productPlugin.mapOverview.title',
    descriptionKey: 'productPlugin.mapOverview.description',
  },
] as const satisfies readonly ProductPluginDefinition[]

function validSemverRange(value: string): boolean {
  return /^(?:\^|~)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
}

export function validateProductPluginRegistry(
  definitions: readonly ProductPluginDefinition[] = PRODUCT_PLUGIN_REGISTRY,
): void {
  const ids = new Set<string>()
  const routes = new Set<string>()
  for (const definition of definitions) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.id)) throw new Error(`Invalid product plugin id: ${definition.id}`)
    if (ids.has(definition.id)) throw new Error(`Duplicate product plugin id: ${definition.id}`)
    if (routes.has(definition.route)) throw new Error(`Duplicate product plugin route: ${definition.route}`)
    if (!definition.route.startsWith('/')) throw new Error(`Product plugin route must be absolute: ${definition.route}`)
    if (!definition.version.match(/^\d+\.\d+\.\d+$/)) throw new Error(`Invalid product plugin version: ${definition.id}`)
    if (!validSemverRange(definition.compatibleProductVersion)) throw new Error(`Invalid compatible product version: ${definition.id}`)
    if (definition.defaultEnabled !== false) throw new Error(`Product plugin defaults must be disabled: ${definition.id}`)
    if (!definition.name['en-US'].trim() || !definition.name['zh-CN'].trim()) throw new Error(`Product plugin names are required: ${definition.id}`)
    if (!definition.description['en-US'].trim() || !definition.description['zh-CN'].trim()) throw new Error(`Product plugin descriptions are required: ${definition.id}`)
    ids.add(definition.id)
    routes.add(definition.route)
  }
}

validateProductPluginRegistry()

export function getProductPluginDefinition(id: ProductPluginId): ProductPluginDefinition | undefined {
  return PRODUCT_PLUGIN_REGISTRY.find((plugin) => plugin.id === id)
}

export function isRegisteredProductPlugin(id: ProductPluginId): boolean {
  return Boolean(getProductPluginDefinition(id))
}
