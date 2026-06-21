import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, isProductLanguage } from '../i18n/messages.ts';

const messages = {
  'zh-CN': {
    loadFailed: '项目列表加载失败',
    unknownProject: '未知项目：{{project}}',
    saveSelectionFailed: '项目选择保存失败',
    clearSelectionFailed: '项目选择清空失败',
    refreshFailed: '项目列表刷新失败',
    projectPathRequired: '请输入 RPG Maker MV 项目目录',
    removeTargetRequired: '请选择要清除的项目',
    removeFailed: '项目清除失败',
    addFailed: '项目添加失败',
  },
  'en-US': {
    loadFailed: 'Failed to load project list',
    unknownProject: 'Unknown project: {{project}}',
    saveSelectionFailed: 'Failed to save project selection',
    clearSelectionFailed: 'Failed to clear project selection',
    refreshFailed: 'Failed to refresh project list',
    projectPathRequired: 'Enter an RPG Maker MV project folder',
    removeTargetRequired: 'Select a project to remove',
    removeFailed: 'Failed to remove project',
    addFailed: 'Failed to add project',
  },
} as const satisfies Record<ProductLanguage, Record<string, string>>;

export type ProjectStoreMessageKey = keyof typeof messages[DEFAULT_PRODUCT_LANGUAGE];

export function projectStoreText(
  language: ProductLanguage | null | undefined,
  key: ProjectStoreMessageKey,
  params: Record<string, string | number> = {},
): string {
  const normalized = isProductLanguage(language) ? language : DEFAULT_PRODUCT_LANGUAGE;
  let text = messages[normalized][key] || messages[DEFAULT_PRODUCT_LANGUAGE][key] || key;
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}
