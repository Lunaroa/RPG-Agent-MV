import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, pickByLocale } from '../../../../contract/i18n.ts';

export function unsupportedAssetUrl(relativeUrl: string, language?: ProductLanguage | null): string {
  return pickByLocale(language ?? DEFAULT_PRODUCT_LANGUAGE, {
    'zh-CN': `不支持的资源 URL：${relativeUrl}`,
    'en-US': `Resource URL is not supported: ${relativeUrl}`,
  });
}
