/** Pure sorting helpers for the project-asset explorer grid. */

import type { ProjectAssetBrowseEntry } from '@contract/types';

export type ProjectAssetSortKey = 'name' | 'mtimeMs' | 'type' | 'bytes';
export type ProjectAssetSortDir = 'asc' | 'desc';
/** 'none' keeps the listing in its natural (backend) order. */
export type ProjectAssetSortKeySetting = ProjectAssetSortKey | 'none';

/** Explorer menu order: name, date modified, type, size. */
export const PROJECT_ASSET_SORT_KEYS: readonly ProjectAssetSortKey[] = ['name', 'mtimeMs', 'type', 'bytes'];
export const PROJECT_ASSET_SORT_DIRS: readonly ProjectAssetSortDir[] = ['asc', 'desc'];

/** Explorer-style name order: case-insensitive, number-aware ('b2' before 'b10'). */
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Lower-cased extension of the primary variant, the Explorer "type" dimension within a category. */
function extensionOf(entry: ProjectAssetBrowseEntry): string {
  return (entry.variants[0]?.extension ?? '').toLowerCase();
}

export function isProjectAssetSortKey(value: unknown): value is ProjectAssetSortKey {
  return typeof value === 'string' && (PROJECT_ASSET_SORT_KEYS as readonly string[]).includes(value);
}

export function isProjectAssetSortKeySetting(value: unknown): value is ProjectAssetSortKeySetting {
  return value === 'none' || isProjectAssetSortKey(value);
}

export function isProjectAssetSortDir(value: unknown): value is ProjectAssetSortDir {
  return typeof value === 'string' && (PROJECT_ASSET_SORT_DIRS as readonly string[]).includes(value);
}

/**
 * Explorer-style header click cycle for one column: ascending → descending → no sorting.
 * Clicking a different column always restarts at ascending.
 */
export function nextProjectAssetHeaderSort(
  currentKey: ProjectAssetSortKeySetting,
  currentDir: ProjectAssetSortDir,
  column: ProjectAssetSortKey,
): { key: ProjectAssetSortKeySetting; dir: ProjectAssetSortDir } {
  if (currentKey !== column) return { key: column, dir: 'asc' };
  if (currentDir === 'asc') return { key: column, dir: 'desc' };
  return { key: 'none', dir: 'asc' };
}

/**
 * Return a sorted copy of `entries`; the input array is never mutated.
 * Ties keep the original relative order (Array.prototype.sort is stable).
 * A 'none' key returns the natural listing order untouched.
 */
export function sortProjectAssetEntries(
  entries: readonly ProjectAssetBrowseEntry[],
  key: ProjectAssetSortKeySetting,
  dir: ProjectAssetSortDir,
): ProjectAssetBrowseEntry[] {
  if (key === 'none') return [...entries];
  const sign = dir === 'desc' ? -1 : 1;
  const compare = (a: ProjectAssetBrowseEntry, b: ProjectAssetBrowseEntry): number => {
    switch (key) {
      case 'bytes':
        return sign * (a.bytes - b.bytes);
      case 'mtimeMs':
        return sign * (a.mtimeMs - b.mtimeMs);
      case 'type':
        return sign * (nameCollator.compare(extensionOf(a), extensionOf(b))
          || nameCollator.compare(a.name, b.name));
      case 'name':
      default:
        return sign * nameCollator.compare(a.name, b.name);
    }
  };
  return [...entries].sort(compare);
}
