/**
 * Legacy favorites store for the project asset browser (localStorage).
 * Favorites now live in rmmv.db (asset_annotations); this module remains only
 * to read and clear old data during the one-time migration.
 */

const STORAGE_KEY_PREFIX = 'project-asset-favorites:'

function storageKey(project: string): string {
  return `${STORAGE_KEY_PREFIX}${project.toLowerCase()}`
}

export function getProjectAssetFavorites(project: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(project))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'))
    return new Set()
  } catch {
    return new Set()
  }
}

export function clearProjectAssetFavorites(project: string): void {
  try {
    localStorage.removeItem(storageKey(project))
  } catch {
    /* storage unavailable */
  }
}

