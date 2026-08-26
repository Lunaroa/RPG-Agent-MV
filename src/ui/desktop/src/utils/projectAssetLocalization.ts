import { projectAssetCategoryLabel as sharedLabel } from '../../../../contract/project-asset-category-labels.ts';
import { parseProjectAssetBrowserNodeId } from '../../../../contract/project-asset-browser-nodes.ts';
import type { ProductLanguage } from '../../../../contract/i18n.ts';
import type { AssetPreviewMediaKind } from './assetPreview';

export function projectAssetCategoryLabel(
  categoryId: string,
  language: ProductLanguage,
): string {
  try {
    return sharedLabel(categoryId, language);
  } catch {
    // Image subfolders use their disk directory names as labels.
    const { categoryId: baseId, subpath } = parseProjectAssetBrowserNodeId(categoryId);
    if ((baseId === 'img' || IMAGE_CATEGORY_IDS.has(baseId)) && subpath) {
      const segments = subpath.split('/').filter(Boolean);
      return segments[segments.length - 1] || subpath;
    }
    throw new Error(`Missing localized label for project asset category: ${categoryId}`);
  }
}

const IMAGE_CATEGORY_IDS = new Set([
  'img',
  'animations',
  'battlebacks1',
  'battlebacks2',
  'characters',
  'enemies',
  'faces',
  'parallaxes',
  'pictures',
  'svActors',
  'svEnemies',
  'system',
  'tilesets',
  'titles1',
  'titles2',
]);

const AUDIO_CATEGORY_IDS = new Set(['bgm', 'bgs', 'me', 'se']);

const GROUP_CATEGORY_IDS = new Set(['audio', 'img']);

export function projectAssetBrowserBaseCategoryId(categoryId: string): string {
  try {
    return parseProjectAssetBrowserNodeId(categoryId).categoryId;
  } catch {
    return categoryId;
  }
}

export function isProjectAssetGroupCategory(categoryId: string): boolean {
  return GROUP_CATEGORY_IDS.has(categoryId);
}

export function isProjectAssetImageCategory(categoryId: string): boolean {
  return IMAGE_CATEGORY_IDS.has(projectAssetBrowserBaseCategoryId(categoryId));
}

export function projectAssetMediaKind(categoryId: string): AssetPreviewMediaKind {
  const baseId = projectAssetBrowserBaseCategoryId(categoryId);
  if (IMAGE_CATEGORY_IDS.has(baseId)) return 'image';
  if (AUDIO_CATEGORY_IDS.has(baseId)) return 'audio';
  if (baseId === 'movies') return 'movie';
  if (baseId === 'fonts') return 'font';
  if (baseId === 'effects') return 'effect';
  return 'other';
}

export function projectAssetCanPreview(
  categoryId: string,
  encrypted: boolean,
): boolean {
  if (encrypted) return false;
  const kind = projectAssetMediaKind(categoryId);
  // Effects open an info page, not a playable preview — keep canPreview false.
  return kind === 'image' || kind === 'audio' || kind === 'movie' || kind === 'font';
}
