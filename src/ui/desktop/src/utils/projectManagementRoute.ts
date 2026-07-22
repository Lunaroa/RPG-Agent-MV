import type { StoryCategoryId } from './consoleStoryLocalization'

const STORY_CATEGORY_IDS = new Set<StoryCategoryId>([
  'overview', 'maps', 'switches', 'variables', 'commonEvents', 'audio', 'images', 'database',
])

export type AppRailItemId = 'workbench' | 'database' | 'map-overview' | 'console'

export function normalizeProjectManagementSection(value: unknown): StoryCategoryId {
  return typeof value === 'string' && STORY_CATEGORY_IDS.has(value as StoryCategoryId)
    ? value as StoryCategoryId
    : 'overview'
}

export function resolveAppRailItem(
  routePath: string,
  query: Record<string, unknown>,
): AppRailItemId {
  if (routePath === '/console') {
    return query.page === 'story' && query.section === 'database' ? 'database' : 'console'
  }
  if (routePath === '/map-overview') return 'map-overview'
  return 'workbench'
}
