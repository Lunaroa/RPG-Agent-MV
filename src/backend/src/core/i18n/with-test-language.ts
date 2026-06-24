import { withProductLanguage, type ProductLanguage } from './request-language.ts';
import { normalizeProductLanguage } from '../../../../contract/i18n.ts';

// Tests pin to zh-CN so error-message regex assertions remain stable when the
// product default locale changes (e.g. the en-US flip for v0.2.0).
const TEST_DEFAULT_LANGUAGE: ProductLanguage = 'zh-CN';

export function withTestLanguage<T>(fn: () => T, language: ProductLanguage = TEST_DEFAULT_LANGUAGE): T {
  return withProductLanguage(normalizeProductLanguage(language), fn);
}