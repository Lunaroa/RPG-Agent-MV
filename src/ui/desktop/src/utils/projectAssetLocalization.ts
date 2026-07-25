import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import type { AssetPreviewMediaKind } from './assetPreview';

/**
 * Localized labels for project asset browser category ids (SSOT).
 * Backend image leaf ids use svActors/svEnemies (camelCase).
 */
const PROJECT_ASSET_CATEGORY_LABELS: Record<string, Record<ProductLanguage, string>> = {
  audio: { 'zh-CN': '音频', 'en-US': 'Audio' },
  img: { 'zh-CN': '图片', 'en-US': 'Images' },
  fonts: { 'zh-CN': '字体', 'en-US': 'Fonts' },
  movies: { 'zh-CN': '视频', 'en-US': 'Movies' },
  effects: { 'zh-CN': '特效', 'en-US': 'Effects' },
  bgm: { 'zh-CN': 'BGM', 'en-US': 'BGM' },
  bgs: { 'zh-CN': 'BGS', 'en-US': 'BGS' },
  me: { 'zh-CN': 'ME', 'en-US': 'ME' },
  se: { 'zh-CN': 'SE', 'en-US': 'SE' },
  animations: { 'zh-CN': '动画', 'en-US': 'Animations' },
  battlebacks1: { 'zh-CN': '战斗背景 1', 'en-US': 'Battlebacks 1' },
  battlebacks2: { 'zh-CN': '战斗背景 2', 'en-US': 'Battlebacks 2' },
  characters: { 'zh-CN': '行走图', 'en-US': 'Characters' },
  enemies: { 'zh-CN': '敌人', 'en-US': 'Enemies' },
  faces: { 'zh-CN': '脸图', 'en-US': 'Faces' },
  parallaxes: { 'zh-CN': '远景', 'en-US': 'Parallaxes' },
  pictures: { 'zh-CN': '图片', 'en-US': 'Pictures' },
  svActors: { 'zh-CN': 'SV 角色', 'en-US': 'SV Actors' },
  svEnemies: { 'zh-CN': 'SV 敌人', 'en-US': 'SV Enemies' },
  system: { 'zh-CN': '系统', 'en-US': 'System' },
  tilesets: { 'zh-CN': '图块', 'en-US': 'Tilesets' },
  titles1: { 'zh-CN': '标题 1', 'en-US': 'Titles 1' },
  titles2: { 'zh-CN': '标题 2', 'en-US': 'Titles 2' },
};

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

export function projectAssetCategoryLabel(
  categoryId: string,
  language: ProductLanguage,
): string {
  const labels = PROJECT_ASSET_CATEGORY_LABELS[categoryId];
  if (!labels) return categoryId;
  return pickByLocale(language, labels);
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
