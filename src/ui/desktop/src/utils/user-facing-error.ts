import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE } from '../../../../contract/i18n.ts';
import { translate } from '../i18n/messages.ts'

const IPC_REMOTE_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const WRAPPED_ERROR_PREFIX = /^Error:\s*/i;

const DEVELOPER_TERMS = /\b(remote|origin|push|pull|fetch|upstream|downstream)\b/i;
const SESSION_PLAN_DIRECTORY_ERROR_PATTERN = /\[(SESSION_PLAN_DIRECTORY_(?:NOT_WRITABLE|PATH_CONFLICT|CREATE_FAILED))\]\s*([^\r\n]*)/i;

export type UserFacingErrorCode =
  | 'session-plan-directory-not-writable'
  | 'session-plan-directory-path-conflict'
  | 'session-plan-directory-create-failed';

export interface UserFacingError {
  message: string;
  detail?: string;
  code?: UserFacingErrorCode;
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
  const planDirectoryError = message.match(SESSION_PLAN_DIRECTORY_ERROR_PATTERN);
  if (planDirectoryError) {
    const marker = planDirectoryError[1].toUpperCase();
    const detail = String(planDirectoryError[2] || '').trim() || undefined;
    if (marker.endsWith('NOT_WRITABLE')) {
      return {
        code: 'session-plan-directory-not-writable',
        message: translate('error.sessionPlanDirectoryNotWritable', language),
        detail,
      };
    }
    if (marker.endsWith('PATH_CONFLICT')) {
      return {
        code: 'session-plan-directory-path-conflict',
        message: translate('error.sessionPlanDirectoryPathConflict', language),
        detail,
      };
    }
    return {
      code: 'session-plan-directory-create-failed',
      message: translate('error.sessionPlanDirectoryCreateFailed', language),
      detail,
    };
  }
  return { message };
}

function sanitizeDeveloperTerms(result: UserFacingError, language: ProductLanguage): UserFacingError {
  const combined = `${result.message} ${result.detail || ''}`;
  if (!DEVELOPER_TERMS.test(combined)) {
    return result;
  }
  return {
    ...result,
    message: result.message.includes('失败') || result.message.includes('failed') ? result.message : translate('error.operationFailedRetry', language),
    detail: result.detail || combined,
  };
}
