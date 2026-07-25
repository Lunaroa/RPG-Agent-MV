import { pickByLocale } from '../../../../contract/i18n.ts';
import type { ProductLanguage } from '../../../../contract/i18n.ts';
import type { ProjectManagedEntry } from '../api/client';

export type DatabaseCategoryId = 'switches' | 'variables' | 'database' | 'commonEvents';

/** @deprecated Use DatabaseCategoryId; kept alias for transitional call sites. */
export type StoryCategoryId = DatabaseCategoryId;

export const DATABASE_CATEGORY_LABELS: Record<'switches' | 'variables' | 'database', Record<ProductLanguage, string>> = {
  switches: { 'zh-CN': '开关', 'en-US': 'Switches' },
  variables: { 'zh-CN': '变量', 'en-US': 'Variables' },
  database: { 'zh-CN': '数据库', 'en-US': 'Database' },
};

export const MANAGED_KIND_LABELS: Record<ProjectManagedEntry['kind'], Record<ProductLanguage, string>> = {
  switch: { 'zh-CN': '开关', 'en-US': 'Switch' },
  variable: { 'zh-CN': '变量', 'en-US': 'Variable' },
  commonEvent: { 'zh-CN': '公共事件', 'en-US': 'Common Event' },
  database: { 'zh-CN': '数据库', 'en-US': 'Database' },
};

export function newCommonEventName(language: ProductLanguage): string {
  return pickByLocale(language, {
    'zh-CN': '新建公共事件',
    'en-US': 'New Common Event',
  });
}
