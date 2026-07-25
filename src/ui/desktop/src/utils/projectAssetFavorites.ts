/**
 * Favorites store for the project asset browser.
 * Persists a set of favorite file/folder IDs per project in localStorage.
 */

const STORAGE_KEY_PREFIX = 'project-asset-favorites:'

function storageKey(project: string): string {
  return `${STORAGE_KEY_PREFIX}${project.toLowerCase()}`
}

function readFavorites(project: string): Set<string> {
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

function writeFavorites(project: string, favorites: Set<string>): void {
  try {
    localStorage.setItem(storageKey(project), JSON.stringify([...favorites]))
  } catch {
    /* storage full or unavailable */
  }
}

export function getProjectAssetFavorites(project: string): Set<string> {
  return readFavorites(project)
}

export function isProjectAssetFavorite(project: string, id: string): boolean {
  return readFavorites(project).has(id)
}

export function toggleProjectAssetFavorite(project: string, id: string): Set<string> {
  const favorites = readFavorites(project)
  if (favorites.has(id)) {
    favorites.delete(id)
  } else {
    favorites.add(id)
  }
  writeFavorites(project, favorites)
  return favorites
}

export function addProjectAssetFavorite(project: string, id: string): Set<string> {
  const favorites = readFavorites(project)
  favorites.add(id)
  writeFavorites(project, favorites)
  return favorites
}

export function removeProjectAssetFavorite(project: string, id: string): Set<string> {
  const favorites = readFavorites(project)
  favorites.delete(id)
  writeFavorites(project, favorites)
  return favorites
}
