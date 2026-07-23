import path from 'node:path';

import type {
  MapPreviewPreflightFailure,
  MapPreviewStagingConflictFile,
  MapPreviewStagingConflictReasonCode,
} from '../../../../contract/types.ts';
import { STAGING_ERROR_CODES, StagingError } from './staging-errors.ts';
import { getProjectStagingStatus } from './staging-service.ts';

const REASON_CODES = new Set<MapPreviewStagingConflictReasonCode>([
  'SOURCE_EXISTENCE_CHANGED',
  'SOURCE_HASH_CHANGED',
  'DRAFT_MISSING',
  'DRAFT_HASH_CHANGED',
]);

export function inspectMapPreviewStagingConflict(
  workflowRoot: string,
  project: string,
): MapPreviewPreflightFailure | undefined {
  const status = getProjectStagingStatus(workflowRoot, project) as {
    files?: unknown[];
  };
  return mapPreviewStagingConflictFromEntries(status.files || []);
}

export function mapPreviewStagingConflictFromError(
  error: unknown,
): MapPreviewPreflightFailure | undefined {
  if (!(error instanceof StagingError) || error.code !== STAGING_ERROR_CODES.conflict) return undefined;
  const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details as { conflicts?: unknown[] }
    : {};
  return mapPreviewStagingConflictFromEntries(details.conflicts || []);
}

function mapPreviewStagingConflictFromEntries(
  entries: readonly unknown[],
): MapPreviewPreflightFailure | undefined {
  const conflicts = normalizeMapPreviewStagingConflictFiles(entries);
  if (!conflicts.length) return undefined;
  return {
    code: 'staging-conflict',
    stage: 'staging-preflight',
    conflictCount: conflicts.length,
    conflicts,
  };
}

export function normalizeMapPreviewStagingConflictFiles(
  entries: readonly unknown[],
): MapPreviewStagingConflictFile[] {
  return entries.flatMap((entry) => {
    const conflict = mapPreviewStagingConflictFile(entry);
    return conflict ? [conflict] : [];
  });
}

function mapPreviewStagingConflictFile(value: unknown): MapPreviewStagingConflictFile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entry = value as {
    conflict?: unknown;
    relativePath?: unknown;
    conflictReasons?: unknown;
    reasons?: unknown;
  };
  const rawReasons = Array.isArray(entry.reasons) ? entry.reasons : entry.conflictReasons;
  const reasons = Array.isArray(rawReasons)
    ? rawReasons.flatMap((reason) => {
      if (typeof reason === 'string') {
        const code = reason as MapPreviewStagingConflictReasonCode;
        return REASON_CODES.has(code) ? [code] : [];
      }
      if (!reason || typeof reason !== 'object' || Array.isArray(reason)) return [];
      const code = String((reason as { code?: unknown }).code || '') as MapPreviewStagingConflictReasonCode;
      return REASON_CODES.has(code) ? [code] : [];
    })
    : [];
  if (entry.conflict !== true && reasons.length === 0) return undefined;
  const relativePath = normalizeConflictRelativePath(entry.relativePath);
  if (!relativePath || reasons.length === 0) return undefined;
  return {
    relativePath,
    reasons: [...new Set(reasons)],
  };
}

function normalizeConflictRelativePath(value: unknown): string {
  const relativePath = String(value || '').trim().replace(/\\/g, '/');
  if (
    !relativePath
    || relativePath.startsWith('/')
    || /^[a-z]:\//i.test(relativePath)
    || relativePath.split('/').includes('..')
    || path.posix.normalize(relativePath) !== relativePath
  ) {
    throw new Error('Map preview staging conflict contains an invalid relative path.');
  }
  return relativePath;
}
