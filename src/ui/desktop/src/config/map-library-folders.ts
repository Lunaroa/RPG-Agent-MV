// 地图库浏览文件夹：按源资源包/样例工程（packageId）分组，不再按 forest/cave 等标签归类。
import type { MapLibraryEntry } from '../api/client';

export const LIBRARY_FOLDER_STORAGE_KEY = 'console-assets.map-library-folder';

export interface LibraryFolderDef {
  id: string;
  label: string;
}

export function classifyMapFolder(entry: MapLibraryEntry): string {
  return entry.packageId || 'ungrouped';
}

/** 根据当前条目列表生成侧栏文件夹（含「全部」）。 */
export function buildLibraryFolders(entries: readonly MapLibraryEntry[]): LibraryFolderDef[] {
  const all: LibraryFolderDef = { id: 'all', label: '全部' };
  const labels = new Map<string, string>();
  for (const entry of entries) {
    const id = classifyMapFolder(entry);
    const label = entry.packageLabel || id;
    if (!labels.has(id)) labels.set(id, label);
  }
  const packages = [...labels.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
    .map(([id, label]) => ({ id, label }));
  return [all, ...packages];
}

export function filterByFolder<T extends MapLibraryEntry>(
  entries: readonly T[],
  folderId: string,
): T[] {
  if (!folderId || folderId === 'all') return [...entries];
  return entries.filter((entry) => classifyMapFolder(entry) === folderId);
}

export function countByFolder(entries: readonly MapLibraryEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const entry of entries) {
    const folder = classifyMapFolder(entry);
    counts[folder] = (counts[folder] || 0) + 1;
  }
  return counts;
}

export function isValidFolderId(folderId: string, folders: readonly LibraryFolderDef[]): boolean {
  return folders.some((f) => f.id === folderId);
}

export function loadStoredFolderId(folders: readonly LibraryFolderDef[]): string {
  try {
    const stored = localStorage.getItem(LIBRARY_FOLDER_STORAGE_KEY);
    if (stored && isValidFolderId(stored, folders)) return stored;
  } catch {
    /* ignore */
  }
  return 'all';
}

export function saveStoredFolderId(folderId: string): void {
  try {
    localStorage.setItem(LIBRARY_FOLDER_STORAGE_KEY, folderId);
  } catch {
    /* ignore */
  }
}
