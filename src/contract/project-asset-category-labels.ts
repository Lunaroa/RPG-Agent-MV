import { pickByLocale, type ProductLanguage } from './i18n.ts';

/**
 * Localized labels for project asset browser category ids (SSOT for UI + backend messages).
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

export function projectAssetCategoryLabel(
  categoryId: string,
  language: ProductLanguage,
): string {
  const labels = PROJECT_ASSET_CATEGORY_LABELS[categoryId];
  if (!labels) {
    throw new Error(`Missing localized label for project asset category: ${categoryId}`);
  }
  return pickByLocale(language, labels);
}
