import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale, PRODUCT_LOCALE_CODES } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

const STALE_TERMINAL_MENU_TEXT_BY_LOCALE = {
  'zh-CN': '显示终端',
  'en-US': 'Show Terminal',
} as const satisfies Record<ProductLanguage, string>;

export function staleTerminalMenuTextMarker(language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), STALE_TERMINAL_MENU_TEXT_BY_LOCALE);
}

export function allStaleTerminalMenuTextMarkers(): readonly string[] {
  return PRODUCT_LOCALE_CODES.map((code) => STALE_TERMINAL_MENU_TEXT_BY_LOCALE[code]);
}
