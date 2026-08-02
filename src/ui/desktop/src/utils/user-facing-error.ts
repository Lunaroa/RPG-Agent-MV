import type { ProductLanguage } from '@contract/types';
import { parseIpcStructuredError } from '../../../../contract/desktop-errors.ts';
import { DEFAULT_PRODUCT_LANGUAGE } from '../../../../contract/i18n.ts';
import { translate } from '../i18n/messages.ts'

const IPC_REMOTE_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const WRAPPED_ERROR_PREFIX = /^Error:\s*/i;

const DEVELOPER_TERMS = /\b(remote|origin|push|pull|fetch|upstream|downstream)\b/i;
const SESSION_PLAN_DIRECTORY_ERROR_PATTERN = /\[(SESSION_PLAN_DIRECTORY_(?:NOT_WRITABLE|PATH_CONFLICT|CREATE_FAILED))\]\s*([^\r\n]*)/i;

export type UserFacingErrorCode =
  | 'rmmv-map-preflight'
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
  const structured = readStructuredIpcError(errorValue, raw);
  const stripped = unwrapIpcError(structured?.message ?? raw, language);
  const mapped = mapKnownError(stripped, context, language, structured?.code, structured?.details);
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

function mapKnownError(
  message: string,
  _context: 'version' | 'general',
  language: ProductLanguage,
  code?: string,
  details?: unknown,
): UserFacingError {
  const stagingCode = code || (message.startsWith('[STAGING_RMMV_MAP_PREFLIGHT]') ? 'STAGING_RMMV_MAP_PREFLIGHT' : undefined);
  if (stagingCode === 'STAGING_RMMV_MAP_PREFLIGHT') {
    return mapRmmvMapPreflightError(details, language);
  }
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

interface RmmvMapPreflightMapDetail {
  mapId: number;
  relativePath: string;
  reason: 'missing' | 'invalid';
}

interface RmmvMapPreflightDetails {
  kind: 'rmmv-map-preflight';
  transactionStarted: false;
  sourceFilesChanged: false;
  missingMaps: RmmvMapPreflightMapDetail[];
}

function mapRmmvMapPreflightError(details: unknown, language: ProductLanguage): UserFacingError {
  if (!isRmmvMapPreflightDetails(details)) {
    return {
      code: 'rmmv-map-preflight',
      message: translate('error.rmmvMapPreflightGeneric', language),
    };
  }
  const mapLines = details.missingMaps.map((entry) => translate(
    'error.rmmvMapPreflightMap',
    language,
    {
      mapId: entry.mapId,
      path: entry.relativePath,
      reason: translate(
        entry.reason === 'missing'
          ? 'error.rmmvMapPreflightMissing'
          : 'error.rmmvMapPreflightInvalid',
        language,
      ),
    },
  ));
  return {
    code: 'rmmv-map-preflight',
    message: translate('error.rmmvMapPreflightBlocked', language),
    detail: [
      ...mapLines,
      translate('error.rmmvMapPreflightBoundary', language),
      translate('error.rmmvMapPreflightRecovery', language),
    ].join('\n'),
  };
}

function readStructuredIpcError(errorValue: unknown, raw: string): {
  message: string;
  code?: string;
  details?: unknown;
} | null {
  const parsed = parseIpcStructuredError(raw);
  const value = isRecord(errorValue) ? errorValue : null;
  const directCode = typeof value?.code === 'string' ? value.code : undefined;
  const directDetails = value && Object.hasOwn(value, 'details') ? value.details : undefined;
  if (!parsed && !directCode) return null;
  return {
    message: parsed?.message ?? raw,
    code: parsed?.code ?? directCode,
    ...(parsed ? { details: parsed.details } : value && Object.hasOwn(value, 'details') ? { details: directDetails } : {}),
  };
}

function isRmmvMapPreflightDetails(value: unknown): value is RmmvMapPreflightDetails {
  if (!isRecord(value)
    || value.kind !== 'rmmv-map-preflight'
    || value.transactionStarted !== false
    || value.sourceFilesChanged !== false
    || !Array.isArray(value.missingMaps)
    || value.missingMaps.length === 0) {
    return false;
  }
  return value.missingMaps.every((entry) => isRecord(entry)
    && Number.isInteger(entry.mapId)
    && Number(entry.mapId) > 0
    && typeof entry.relativePath === 'string'
    && entry.relativePath.length > 0
    && (entry.reason === 'missing' || entry.reason === 'invalid'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
