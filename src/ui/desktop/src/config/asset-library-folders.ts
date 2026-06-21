import type { AssetLibraryCategoryId, AssetLibraryEntry } from '../api/client';
import type { ProductLanguage } from '@contract/types';
import { classifyMapFolder } from './map-library-folders.ts';
import { formatSourceLabel } from './asset-library-source-labels.ts';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import { translate } from '../i18n/messages.ts';

export const ASSET_LIBRARY_FOLDER_STORAGE_PREFIX = 'console-assets.library-folder';
export const ASSET_LIBRARY_FOLDERS_EXPANDED_PREFIX = 'console-assets.folders-expanded';

export interface AssetLibraryFolderDef {
  id: string;
  label: string;
}

export function classifyAssetFolder(entry: AssetLibraryEntry): string {
  if (entry.kind === 'map') return classifyMapFolder(entry.map);
  if (entry.kind === 'skill') return entry.sourcePackage || 'ungrouped';
  return entry.sourceSlug || 'ungrouped';
}

export function assetFolderLabel(entry: AssetLibraryEntry, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  if (entry.kind === 'map') {
    return entry.map.packageLabel || formatSourceLabel(entry.map.packageId, language);
  }
  if (entry.kind === 'skill') return formatSourceLabel(entry.sourcePackage, language);
  return formatSourceLabel(entry.sourceSlug, language);
}

export function buildAssetLibraryFolders(entries: readonly AssetLibraryEntry[], language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): AssetLibraryFolderDef[] {
  language = normalizeProductLanguage(language)
  const all: AssetLibraryFolderDef = { id: 'all', label: translate('assetfolder.all', language) };
  const labels = new Map<string, string>();
  for (const entry of entries) {
    const id = classifyAssetFolder(entry);
    const label = assetFolderLabel(entry, language);
    if (!labels.has(id)) labels.set(id, label);
  }
  const folders = [...labels.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], language))
    .map(([id, label]) => ({ id, label }));
  return [all, ...folders];
}

export function filterAssetByFolder<T extends AssetLibraryEntry>(
  entries: readonly T[],
  folderId: string,
): T[] {
  if (!folderId || folderId === 'all') return [...entries];
  return entries.filter((entry) => classifyAssetFolder(entry) === folderId);
}

export function countAssetFolders(entries: readonly AssetLibraryEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const entry of entries) {
    const folder = classifyAssetFolder(entry);
    counts[folder] = (counts[folder] || 0) + 1;
  }
  return counts;
}

export function isValidAssetFolderId(folderId: string, folders: readonly AssetLibraryFolderDef[]): boolean {
  return folders.some((folder) => folder.id === folderId);
}

export function loadStoredFolderId(
  categoryId: AssetLibraryCategoryId,
  folders: readonly AssetLibraryFolderDef[],
): string {
  try {
    const stored = localStorage.getItem(`${ASSET_LIBRARY_FOLDER_STORAGE_PREFIX}.${categoryId}`);
    if (stored && isValidAssetFolderId(stored, folders)) return stored;
  } catch {
    /* ignore */
  }
  return 'all';
}

export function saveStoredFolderId(categoryId: AssetLibraryCategoryId, folderId: string): void {
  try {
    localStorage.setItem(`${ASSET_LIBRARY_FOLDER_STORAGE_PREFIX}.${categoryId}`, folderId);
  } catch {
    /* ignore */
  }
}

export function loadFoldersPaneExpanded(categoryId: AssetLibraryCategoryId): boolean {
  try {
    const stored = localStorage.getItem(`${ASSET_LIBRARY_FOLDERS_EXPANDED_PREFIX}.${categoryId}`);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function saveFoldersPaneExpanded(categoryId: AssetLibraryCategoryId, expanded: boolean): void {
  try {
    localStorage.setItem(`${ASSET_LIBRARY_FOLDERS_EXPANDED_PREFIX}.${categoryId}`, expanded ? '1' : '0');
  } catch {
    /* ignore */
  }
}
