import { projectAssetCategoryLabel as sharedLabel } from '../../../../contract/project-asset-category-labels.ts';
import type { ProductLanguage } from '../../../../contract/i18n.ts';
import type { AssetPreviewMediaKind } from './assetPreview';

export function projectAssetCategoryLabel(
  categoryId: string,
  language: ProductLanguage,
): string {
  return sharedLabel(categoryId, language);
}

const IMAGE_CATEGORY_IDS = new Set([
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

export function isProjectAssetGroupCategory(categoryId: string): boolean {
  return GROUP_CATEGORY_IDS.has(categoryId);
}

export function isProjectAssetImageCategory(categoryId: string): boolean {
  return IMAGE_CATEGORY_IDS.has(categoryId);
}

export function projectAssetMediaKind(categoryId: string): AssetPreviewMediaKind {
  if (IMAGE_CATEGORY_IDS.has(categoryId)) return 'image';
  if (AUDIO_CATEGORY_IDS.has(categoryId)) return 'audio';
  if (categoryId === 'movies') return 'movie';
  return 'other';
}

export function projectAssetCanPreview(
  categoryId: string,
  encrypted: boolean,
): boolean {
  if (encrypted) return false;
  if (categoryId === 'effects') return false;
  const kind = projectAssetMediaKind(categoryId);
  return kind === 'image' || kind === 'audio' || kind === 'movie';
}
