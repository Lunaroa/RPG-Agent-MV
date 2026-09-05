import type { MapPreviewStagingConflictFile, MapPreviewStagingConflictReasonCode, ProductLanguage } from '@contract/types';
import { parseIpcStructuredError } from '../../../../contract/desktop-errors.ts';
import { translate } from '../i18n/messages.ts';

export type { MapPreviewStagingConflictFile };

export interface StagingConflictDetails {
  conflicts: MapPreviewStagingConflictFile[];
}

const STAGING_CONFLICT_CODE = 'STAGING_CONFLICT';

const REASON_CODES: readonly MapPreviewStagingConflictReasonCode[] = [
  'SOURCE_EXISTENCE_CHANGED',
  'SOURCE_HASH_CHANGED',
  'DRAFT_MISSING',
  'DRAFT_HASH_CHANGED',
];

const REASON_LABEL_KEYS: Record<MapPreviewStagingConflictReasonCode, string> = {
  SOURCE_EXISTENCE_CHANGED: 'editor.preview.stagingConflict.reason.sourceExistenceChanged',
  SOURCE_HASH_CHANGED: 'editor.preview.stagingConflict.reason.sourceHashChanged',
  DRAFT_MISSING: 'editor.preview.stagingConflict.reason.draftMissing',
  DRAFT_HASH_CHANGED: 'editor.preview.stagingConflict.reason.draftHashChanged',
};

export function stagingConflictReasonLabel(reason: MapPreviewStagingConflictReasonCode, language: ProductLanguage): string {
  return translate(REASON_LABEL_KEYS[reason], language);
}

export function readStagingConflictDetails(errorValue: unknown): StagingConflictDetails | null {
  const raw = errorValue instanceof Error ? errorValue.message : String(errorValue || '');
  const parsed = parseIpcStructuredError(raw);
  const direct = isRecord(errorValue) && errorValue.code === STAGING_CONFLICT_CODE ? errorValue : null;
  if (parsed?.code === STAGING_CONFLICT_CODE) {
    return normalizeConflictDetails(parsed.details);
  }
  if (direct) {
    return normalizeConflictDetails(direct.details);
  }
  return null;
}

function normalizeConflictDetails(details: unknown): StagingConflictDetails | null {
  if (!isRecord(details) || !Array.isArray(details.conflicts)) return null;
  const conflicts: MapPreviewStagingConflictFile[] = [];
  for (const entry of details.conflicts) {
    if (!isRecord(entry) || typeof entry.relativePath !== 'string' || !entry.relativePath) return null;
    const rawReasons = Array.isArray(entry.reasons)
      ? entry.reasons
      : Array.isArray(entry.conflictReasons)
        ? entry.conflictReasons
        : null;
    if (!rawReasons) return null;
    const reasons: MapPreviewStagingConflictReasonCode[] = [];
    for (const rawReason of rawReasons) {
      const code = typeof rawReason === 'string'
        ? rawReason
        : isRecord(rawReason) && typeof rawReason.code === 'string'
          ? rawReason.code
          : '';
      if (!REASON_CODES.includes(code as MapPreviewStagingConflictReasonCode)) return null;
      reasons.push(code as MapPreviewStagingConflictReasonCode);
    }
    conflicts.push({ relativePath: entry.relativePath, reasons });
  }
  return conflicts.length ? { conflicts } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
