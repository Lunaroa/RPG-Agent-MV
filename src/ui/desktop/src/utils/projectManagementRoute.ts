import type { DatabaseCategoryId } from './consoleStoryLocalization'

const DATABASE_SECTION_IDS = new Set<DatabaseCategoryId>([
  'database', 'commonEvents', 'switches', 'variables',
])

export type AppRailItemId =
  | 'workbench'
  | 'database'
  | 'project-assets'
  | 'map-overview'
  | 'plugins'
  | 'plugin-marketplace'
  | 'ui-designer'
  | 'console'

export const PRODUCT_PLUGIN_DISABLED_REASON = 'disabled'

export function productPluginDisabledRedirect(pluginId: string, from?: string): {
  path: '/plugin-marketplace'
  query: Record<string, string>
} {
  const query: Record<string, string> = {
    reason: PRODUCT_PLUGIN_DISABLED_REASON,
    plugin: pluginId,
  }
  if (from) query.from = from
  return { path: '/plugin-marketplace', query }
}

export function normalizeDatabaseSection(value: unknown): DatabaseCategoryId {
  if (typeof value === 'string' && DATABASE_SECTION_IDS.has(value as DatabaseCategoryId)) {
    return value as DatabaseCategoryId
  }
  return 'database'
}

/** @deprecated Use normalizeDatabaseSection */
export const normalizeProjectManagementSection = normalizeDatabaseSection

export function resolveAppRailItem(
  routePath: string,
  query: Record<string, unknown>,
): AppRailItemId {
  if (routePath === '/database') return 'database'
  // Plugin manager lives on the console route but owns its own rail entry.
  if (routePath === '/console') return query.page === 'plugins' ? 'plugins' : 'console'
  if (routePath === '/project-assets') return 'project-assets'
  if (routePath === '/map-overview') return 'map-overview'
  if (routePath === '/plugin-marketplace') return 'plugin-marketplace'
  if (routePath === '/ui-designer') return 'ui-designer'
  return 'workbench'
}
