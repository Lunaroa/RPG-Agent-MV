import type { DatabaseCategoryId } from './consoleStoryLocalization'

// Switches/variables no longer live on the database page; legacy deep links fall back to 'database'.
const DATABASE_SECTION_IDS = new Set<DatabaseCategoryId>([
  'database', 'commonEvents',
])

export type AppRailItemId = 'workbench' | 'database' | 'project-assets' | 'map-overview' | 'console'

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
  _query: Record<string, unknown>,
): AppRailItemId {
  if (routePath === '/database') return 'database'
  if (routePath === '/console') return 'console'
  if (routePath === '/project-assets') return 'project-assets'
  if (routePath === '/map-overview') return 'map-overview'
  return 'workbench'
}
