import type { ProductLanguage } from '../../../../contract/i18n.ts';
import type { ProjectManagedEntry } from '../api/client';

export type StoryCategoryId =
  | 'overview'
  | 'maps'
  | 'switches'
  | 'variables'
  | 'commonEvents'
  | 'audio'
  | 'images'
  | 'database';

export const STORY_CATEGORY_LABELS: Record<StoryCategoryId, Record<ProductLanguage, string>> = {
  overview: { 'zh-CN': '总览', 'en-US': 'Overview' },
  maps: { 'zh-CN': '地图与事件', 'en-US': 'Maps & Events' },
  switches: { 'zh-CN': '开关', 'en-US': 'Switches' },
  variables: { 'zh-CN': '变量', 'en-US': 'Variables' },
  commonEvents: { 'zh-CN': '公共事件', 'en-US': 'Common Events' },
  audio: { 'zh-CN': '音频', 'en-US': 'Audio' },
  images: { 'zh-CN': '图片', 'en-US': 'Images' },
  database: { 'zh-CN': '数据库', 'en-US': 'Database' },
};

export const IMAGE_BUCKET_LABELS: Record<string, Record<ProductLanguage, string>> = {
  animations: { 'zh-CN': '动画', 'en-US': 'Animations' },
  battlebacks1: { 'zh-CN': '战斗背景 1', 'en-US': 'Battlebacks 1' },
  battlebacks2: { 'zh-CN': '战斗背景 2', 'en-US': 'Battlebacks 2' },
  characters: { 'zh-CN': '行走图', 'en-US': 'Characters' },
  enemies: { 'zh-CN': '敌人', 'en-US': 'Enemies' },
  faces: { 'zh-CN': '脸图', 'en-US': 'Faces' },
  parallaxes: { 'zh-CN': '远景', 'en-US': 'Parallaxes' },
  pictures: { 'zh-CN': '图片', 'en-US': 'Pictures' },
  sv_actors: { 'zh-CN': 'SV 角色', 'en-US': 'SV Actors' },
  sv_enemies: { 'zh-CN': 'SV 敌人', 'en-US': 'SV Enemies' },
  system: { 'zh-CN': '系统', 'en-US': 'System' },
  tilesets: { 'zh-CN': '图块', 'en-US': 'Tilesets' },
  titles1: { 'zh-CN': '标题 1', 'en-US': 'Titles 1' },
  titles2: { 'zh-CN': '标题 2', 'en-US': 'Titles 2' },
};

export const MANAGED_KIND_LABELS: Record<ProjectManagedEntry['kind'], Record<ProductLanguage, string>> = {
  switch: { 'zh-CN': '开关', 'en-US': 'Switch' },
  variable: { 'zh-CN': '变量', 'en-US': 'Variable' },
  commonEvent: { 'zh-CN': '公共事件', 'en-US': 'Common Event' },
  database: { 'zh-CN': '数据库', 'en-US': 'Database' },
};

export const NEW_COMMON_EVENT_NAME = '新建公共事件';
