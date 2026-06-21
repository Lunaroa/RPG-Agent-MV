import { withProductLanguage, type ProductLanguage } from './request-language.ts';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../../../../contract/i18n.ts';

export function withTestLanguage<T>(fn: () => T, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): T {
  return withProductLanguage(normalizeProductLanguage(language), fn);
}
