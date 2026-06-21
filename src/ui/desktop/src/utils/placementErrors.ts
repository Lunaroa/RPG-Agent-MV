import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import { translate } from '../i18n/messages.ts'

export function formatPlacementError(
  error: unknown,
  context?: { contractId?: string; eventName?: string },
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): string {
  language = normalizeProductLanguage(language);
  const message = error instanceof Error ? error.message : String(error || '');
  const label = context?.eventName || context?.contractId || translate('place.error.fallbackEventLabel', language);
  if (/完整实现|无法放置|contractId=/.test(message)) {
    return translate('place.error.missingImplementation', language, { label, contractId: context?.contractId || '' });
  }
  if (message.startsWith('放置失败') || message.startsWith('无法放置') || message.startsWith('Placement failed') || message.startsWith('Cannot place')) {
    return message;
  }
  return translate('place.error.failedPrefix', language, { message });
}

export function toPlacementError(
  error: unknown,
  context?: { contractId?: string; eventName?: string },
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): Error {
  language = normalizeProductLanguage(language);
  return new Error(formatPlacementError(error, context, language));
}
