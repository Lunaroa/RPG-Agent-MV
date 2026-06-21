import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import { translate, type MessageKey } from '../i18n/messages.ts';

/** 静态素材来源 slug / 包名 → 侧栏显示名 key（未命中则 humanize）。 */
const SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  'sample-main': 'assetsource.sampleMain',
  'dlc-amusement-park-tile-75aef5d5': 'assetsource.amusementPark',
  'pack': 'assetsource.samplePack',
};

export function formatSourceLabel(sourceId: string, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  const id = String(sourceId || '').trim();
  if (!id || id === 'ungrouped') return translate('assetsource.ungrouped', language);
  const key = SOURCE_LABEL_KEYS[id];
  if (key) return translate(key, language);
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
