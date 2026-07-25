import type { RpgMakerEngine } from './types.ts';

/** Engine category that may expose disk subfolders in the project asset browser (MZ only). */
export const PROJECT_ASSET_PICTURES_CATEGORY_ID = 'pictures';

/**
 * Split a browser tree/node id into the engine category and optional subdirectory.
 * Examples: `pictures` → { categoryId: 'pictures', subpath: '' };
 * `pictures/ui/foo` → { categoryId: 'pictures', subpath: 'ui/foo' }.
 */
export function parseProjectAssetBrowserNodeId(nodeId: string): {
  categoryId: string;
  subpath: string;
} {
  const normalized = String(nodeId || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    throw new Error('Project asset browser node id must be a non-empty category path.');
  }
  if (normalized.includes('..')) {
    throw new Error(`Project asset browser node id must not contain '..': ${nodeId}`);
  }
  const slash = normalized.indexOf('/');
  if (slash < 0) return { categoryId: normalized, subpath: '' };
  return {
    categoryId: normalized.slice(0, slash),
    subpath: normalized.slice(slash + 1),
  };
}

export function projectAssetBrowserNodeId(categoryId: string, subpath = ''): string {
  const category = String(categoryId || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!category || category.includes('/')) {
    throw new Error(`Invalid project asset category id: ${categoryId}`);
  }
  const cleanSubpath = String(subpath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (cleanSubpath.includes('..')) {
    throw new Error(`Project asset subpath must not contain '..': ${subpath}`);
  }
  return cleanSubpath ? `${category}/${cleanSubpath}` : category;
}

/** MZ picture pickers browse nested folders under img/pictures; MV lists the folder itself only. */
export function projectAssetBrowserAllowsPictureSubfolders(engine: RpgMakerEngine): boolean {
  return engine === 'rpg-maker-mz';
}
