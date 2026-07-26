import type { DatabaseCategoryId } from './consoleStoryLocalization'

// Switches/variables no longer live on the database page; legacy deep links fall back to 'database'.
const DATABASE_SECTION_IDS = new Set<DatabaseCategoryId>([
  'database', 'commonEvents',
])

export type AppRailItemId = 'workbench' | 'database' | 'project-assets' | 'map-overview' | 'plugins' | 'console'

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
  return 'workbench'
}
