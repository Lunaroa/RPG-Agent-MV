import {
  parseProjectAssetBrowserNodeId,
  PROJECT_ASSET_PICTURES_CATEGORY_ID,
} from '../../../../contract/project-asset-browser-nodes.ts';

/**
 * User-created MZ picture subfolders (e.g. pictures/busts) may be renamed/deleted.
 * Engine category roots (characters, faces, pictures, …) are protected — reveal only.
 */
export function isProjectAssetUserPictureSubfolder(nodeId: string): boolean {
  try {
    const { categoryId, subpath } = parseProjectAssetBrowserNodeId(nodeId);
    return categoryId === PROJECT_ASSET_PICTURES_CATEGORY_ID && Boolean(subpath);
  } catch {
    return false;
  }
}

/** Single path segment for a folder rename; rejects path separators and reserved names. */
export function normalizeProjectAssetFolderLeafName(value: string): string {
  const name = String(value || '').trim();
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error('Invalid folder name');
  }
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid folder name');
  }
  return name;
}
