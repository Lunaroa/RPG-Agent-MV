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

type MapPickMessages = (typeof messages)['en-US'];
export type MapPickMessageKey = keyof MapPickMessages;

export function mapPickText(language: ProductLanguage | null | undefined, key: MapPickMessageKey): string {
  const normalized = isProductLanguage(language) ? language : DEFAULT_PRODUCT_LANGUAGE;
  const lookup = messages[normalized] as MapPickMessages;
  return lookup[key] || (messages['en-US'] as MapPickMessages)[key] || key;
}