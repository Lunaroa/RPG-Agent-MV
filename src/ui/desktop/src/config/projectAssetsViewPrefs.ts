/** localStorage persistence for project-asset explorer view preferences (sort + thumbnail size). */

import {
  isProjectAssetSortDir,
  isProjectAssetSortKeySetting,
  type ProjectAssetSortDir,
  type ProjectAssetSortKeySetting,
} from '../utils/projectAssetSorting.ts';
import type { AssetPreviewMediaKind } from '../utils/assetPreview.ts';

export const PROJECT_ASSETS_VIEW_PREFS_PREFIX = 'rpg-agent-project-assets';

export const PROJECT_ASSET_THUMB_SIZE_MIN = 48;
export const PROJECT_ASSET_THUMB_SIZE_MAX = 512;
export const PROJECT_ASSET_THUMB_SIZE_DEFAULT = 72;

export type ProjectAssetViewMode = 'icons' | 'list' | 'details';
export const PROJECT_ASSET_VIEW_MODES: readonly ProjectAssetViewMode[] = ['icons', 'list', 'details'];
export const PROJECT_ASSET_VIEW_MODE_DEFAULT: ProjectAssetViewMode = 'icons';

export function isProjectAssetViewMode(value: unknown): value is ProjectAssetViewMode {
  return typeof value === 'string' && (PROJECT_ASSET_VIEW_MODES as readonly string[]).includes(value);
}

/** Audio categories default to details; everything else defaults to icons. */
export function defaultProjectAssetViewModeForMedia(media: AssetPreviewMediaKind): ProjectAssetViewMode {
  return media === 'audio' ? 'details' : PROJECT_ASSET_VIEW_MODE_DEFAULT;
}

export interface ProjectAssetSortPreference {
  key: ProjectAssetSortKeySetting;
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
      if (isProjectAssetSortKeySetting(parsed?.key) && isProjectAssetSortDir(parsed?.dir)) {
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

export function loadProjectAssetViewMode(media: AssetPreviewMediaKind = 'other'): ProjectAssetViewMode {
  try {
    const byMedia = localStorage.getItem(storageKey(`viewMode.${media}`));
    if (isProjectAssetViewMode(byMedia)) return byMedia;
    // Audio must keep its details default: never let the legacy global key
    // (written by pre-per-media builds) override it.
    if (media !== 'audio') {
      const legacy = localStorage.getItem(storageKey('viewMode'));
      if (isProjectAssetViewMode(legacy)) return legacy;
    }
  } catch {
    /* ignore */
  }
  return defaultProjectAssetViewModeForMedia(media);
}

export function saveProjectAssetViewMode(mode: ProjectAssetViewMode, media: AssetPreviewMediaKind = 'other'): void {
  try {
    localStorage.setItem(storageKey(`viewMode.${media}`), mode);
  } catch {
    /* ignore */
  }
}
