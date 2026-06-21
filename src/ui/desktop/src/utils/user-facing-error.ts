import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE } from '../../../../contract/i18n.ts';
import { translate } from '../i18n/messages.ts'

const IPC_REMOTE_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const WRAPPED_ERROR_PREFIX = /^Error:\s*/i;

const DEVELOPER_TERMS = /\b(remote|origin|push|pull|fetch|upstream|downstream)\b/i;

export interface UserFacingError {
  message: string;
  detail?: string;
}

export function formatUserFacingError(
  errorValue: unknown,
  context: 'version' | 'general' = 'general',
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): UserFacingError {
  const raw = errorValue instanceof Error ? errorValue.message : String(errorValue || translate('error.operationFailed', language));
  const stripped = unwrapIpcError(raw, language);
  const mapped = mapKnownError(stripped, context, language);
  return sanitizeDeveloperTerms(mapped, language);
}

export function formatUserFacingErrorMessage(
  errorValue: unknown,
  context: 'version' | 'general' = 'general',
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): string {
  return formatUserFacingError(errorValue, context, language).message;
}

function unwrapIpcError(message: string, language: ProductLanguage): string {
  let next = message.trim();
  if (IPC_REMOTE_PREFIX.test(next)) {
    next = next.replace(IPC_REMOTE_PREFIX, '').trim();
  }
  while (WRAPPED_ERROR_PREFIX.test(next)) {
    next = next.replace(WRAPPED_ERROR_PREFIX, '').trim();
  }
  return next || translate('error.operationFailed', language);
}

function mapKnownError(message: string, _context: 'version' | 'general', language: ProductLanguage): UserFacingError {
  if (/\[CONTROLLED_EDITING_DISABLED\]/i.test(message)) {
    return { message: translate('error.enableVersionFirst', language) };
  }
  return { message };
}

function sanitizeDeveloperTerms(result: UserFacingError, language: ProductLanguage): UserFacingError {
  const combined = `${result.message} ${result.detail || ''}`;
  if (!DEVELOPER_TERMS.test(combined)) {
    return result;
  }
  return {
    message: result.message.includes('失败') || result.message.includes('failed') ? result.message : translate('error.operationFailedRetry', language),
    detail: result.detail || combined,
  };
}
