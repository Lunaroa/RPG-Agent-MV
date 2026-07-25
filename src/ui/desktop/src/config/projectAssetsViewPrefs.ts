/** localStorage persistence for project-asset explorer view preferences (sort + thumbnail size). */

import {
  isProjectAssetSortDir,
  isProjectAssetSortKey,
  type ProjectAssetSortDir,
  type ProjectAssetSortKey,
} from '../utils/projectAssetSorting.ts';

export const PROJECT_ASSETS_VIEW_PREFS_PREFIX = 'rpg-agent-project-assets';

export const PROJECT_ASSET_THUMB_SIZE_MIN = 48;
export const PROJECT_ASSET_THUMB_SIZE_MAX = 512;
export const PROJECT_ASSET_THUMB_SIZE_DEFAULT = 72;

export interface ProjectAssetSortPreference {
  key: ProjectAssetSortKey;
  dir: ProjectAssetSortDir;
}

export const PROJECT_ASSET_SORT_DEFAULT: ProjectAssetSortPreference = { key: 'name', dir: 'asc' };

export function clampProjectAssetThumbSize(value: unknown): number {
  const size = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN;
  if (Number.isNaN(size)) return PROJECT_ASSET_THUMB_SIZE_DEFAULT;
  return Math.min(PROJECT_ASSET_THUMB_SIZE_MAX, Math.max(PROJECT_ASSET_THUMB_SIZE_MIN, size));
}

function storageKey(suffix: string): string {
  return `${PROJECT_ASSETS_VIEW_PREFS_PREFIX}.${suffix}`;
}

export function loadProjectAssetSortPreference(): ProjectAssetSortPreference {
  try {
    const stored = localStorage.getItem(storageKey('sort'));
    if (stored) {
      const parsed = JSON.parse(stored) as { key?: unknown; dir?: unknown };
      if (isProjectAssetSortKey(parsed?.key) && isProjectAssetSortDir(parsed?.dir)) {
        return { key: parsed.key, dir: parsed.dir };
      }
    }
  } catch {
    /* ignore */
  }
  return { ...PROJECT_ASSET_SORT_DEFAULT };
}

export function saveProjectAssetSortPreference(preference: ProjectAssetSortPreference): void {
  try {
    localStorage.setItem(storageKey('sort'), JSON.stringify(preference));
  } catch {
    /* ignore */
  }
}

export function loadProjectAssetThumbSize(): number {
  try {
    const stored = localStorage.getItem(storageKey('thumbSize'));
    if (stored !== null) return clampProjectAssetThumbSize(Number(stored));
  } catch {
    /* ignore */
  }
  return PROJECT_ASSET_THUMB_SIZE_DEFAULT;
}

export function saveProjectAssetThumbSize(size: number): void {
  try {
    localStorage.setItem(storageKey('thumbSize'), String(clampProjectAssetThumbSize(size)));
  } catch {
    /* ignore */
  }
}
