import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, isProductLanguage } from '../i18n/messages.ts';

const messages = {
  'zh-CN': {
    title: '选择目标地图',
    placeholder: '选择地图',
    unnamed: '未命名',
    confirm: '进入编排',
    cancel: '取消',
  },
  'en-US': {
    title: 'Select Target Map',
    placeholder: 'Select a map',
    unnamed: 'Unnamed',
    confirm: 'Open',
    cancel: 'Cancel',
  },
} as const satisfies Record<ProductLanguage, Record<string, string>>;

export function mapPickText(language: ProductLanguage | null | undefined, key: keyof typeof messages[DEFAULT_PRODUCT_LANGUAGE]): string {
  const normalized = isProductLanguage(language) ? language : DEFAULT_PRODUCT_LANGUAGE;
  return messages[normalized][key] || messages[DEFAULT_PRODUCT_LANGUAGE][key] || key;
}
