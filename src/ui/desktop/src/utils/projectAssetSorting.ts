/** Pure sorting helpers for the project-asset explorer grid. */

import type { ProjectAssetBrowseEntry } from '@contract/types';

export type ProjectAssetSortKey = 'name' | 'mtimeMs' | 'type' | 'bytes';
export type ProjectAssetSortDir = 'asc' | 'desc';

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

export function isProjectAssetSortDir(value: unknown): value is ProjectAssetSortDir {
  return typeof value === 'string' && (PROJECT_ASSET_SORT_DIRS as readonly string[]).includes(value);
}

/**
 * Return a sorted copy of `entries`; the input array is never mutated.
 * Ties keep the original relative order (Array.prototype.sort is stable).
 */
export function sortProjectAssetEntries(
  entries: readonly ProjectAssetBrowseEntry[],
  key: ProjectAssetSortKey,
  dir: ProjectAssetSortDir,
): ProjectAssetBrowseEntry[] {
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
