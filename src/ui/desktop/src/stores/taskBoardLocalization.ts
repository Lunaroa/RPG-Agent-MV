import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, isProductLanguage } from '../i18n/messages.ts';

const messages = {
  'zh-CN': {
    loadFailed: '加载任务失败',
  },
  'en-US': {
    loadFailed: 'Failed to load tasks',
  },
} as const satisfies Record<ProductLanguage, Record<string, string>>;

export function taskBoardText(language: ProductLanguage | null | undefined, key: keyof typeof messages[DEFAULT_PRODUCT_LANGUAGE]): string {
  const normalized = isProductLanguage(language) ? language : DEFAULT_PRODUCT_LANGUAGE;
  return messages[normalized][key] || messages[DEFAULT_PRODUCT_LANGUAGE][key] || key;
}
