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

type TaskBoardMessages = (typeof messages)['en-US'];
export type TaskBoardMessageKey = keyof TaskBoardMessages;

export function taskBoardText(language: ProductLanguage | null | undefined, key: TaskBoardMessageKey): string {
  const normalized = isProductLanguage(language) ? language : DEFAULT_PRODUCT_LANGUAGE;
  const lookup = messages[normalized] as TaskBoardMessages;
  return lookup[key] || (messages['en-US'] as TaskBoardMessages)[key] || key;
}