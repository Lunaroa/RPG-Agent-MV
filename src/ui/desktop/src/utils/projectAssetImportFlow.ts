import type { ProjectAssetImportItemResult } from '@contract/types';

/** One item taken from a system file drag, after path resolution. */
export interface PlannedDropImportItem {
  isDirectory: boolean;
  name: string;
  /** Absolute path from preload path resolution; null when unresolved. */
  absolutePath: string | null;
}

export interface DropImportRejection {
  name: string;
  reason: 'directory' | 'path_unresolved';
}

export interface DropImportPlan {
  sourceFiles: string[];
  rejections: DropImportRejection[];
}

/**
 * Pure planning step for OS file drops: directories and unresolved paths become
 * rejections; resolved files become import source paths. Does not read the disk.
 */
export function planDroppedImportItems(
  items: readonly PlannedDropImportItem[],
): DropImportPlan {
  const sourceFiles: string[] = [];
  const rejections: DropImportRejection[] = [];
  for (const item of items) {
    if (item.isDirectory) {
      rejections.push({ name: item.name, reason: 'directory' });
      continue;
    }
    if (!item.absolutePath) {
      rejections.push({ name: item.name, reason: 'path_unresolved' });
      continue;
    }
    sourceFiles.push(item.absolutePath);
  }
  return { sourceFiles, rejections };
}

export type OverwriteBatchDecision = 'overwrite' | 'skip' | 'cancel';

export interface ImportOverwriteCandidate {
  sourceFile: string;
  name: string;
  overwrite: boolean;
}

export interface OverwriteDecisionApplication {
  outcome: 'proceed' | 'cancel';
  candidates: ImportOverwriteCandidate[];
  skipped: Array<{ sourceFile: string; name: string }>;
}

/**
 * Map the batch overwrite dialog decision onto candidates.
 * - overwrite: mark conflicting candidates with overwrite=true
 * - skip: remove conflicting candidates and report them as skipped
 * - cancel: abort the whole import
 */
export function applyOverwriteBatchDecision(
  candidates: readonly ImportOverwriteCandidate[],
  conflictNames: ReadonlySet<string>,
  decision: OverwriteBatchDecision,
): OverwriteDecisionApplication {
  if (decision === 'cancel') {
    return { outcome: 'cancel', candidates: [...candidates], skipped: [] };
  }
  if (decision === 'overwrite') {
    return {
      outcome: 'proceed',
      candidates: candidates.map((candidate) => (
        conflictNames.has(candidate.name)
          ? { ...candidate, overwrite: true }
          : { ...candidate }
      )),
      skipped: [],
    };
  }
  const skipped = candidates
    .filter((candidate) => conflictNames.has(candidate.name))
    .map((candidate) => ({ sourceFile: candidate.sourceFile, name: candidate.name }));
  return {
    outcome: 'proceed',
    candidates: candidates.filter((candidate) => !conflictNames.has(candidate.name)),
    skipped,
  };
}

export interface ImportResultMessageCopy {
  allImportedOne: string;
  allImportedMany: (imported: number) => string;
  mixed: (imported: number, skipped: number, failed: number) => string;
  skippedItem: (name: string, reason: string) => string;
  failedItem: (name: string, reason: string) => string;
  unknownReason: string;
}

function resultDisplayName(item: ProjectAssetImportItemResult): string {
  if (item.targetName) return item.targetName;
  const base = item.sourceFile.split(/[\\/]/).pop();
  if (base) return base;
  return item.sourceFile;
}

/** Pure summary text for per-item import results (success / skip / fail). */
export function formatImportResultMessage(
  results: readonly ProjectAssetImportItemResult[],
  copy: ImportResultMessageCopy,
): string {
  const imported = results.filter((item) => item.status === 'imported');
  const skipped = results.filter((item) => item.status === 'skipped');
  const failed = results.filter((item) => item.status === 'failed');
  const lines: string[] = [];
  if (skipped.length === 0 && failed.length === 0) {
    lines.push(
      imported.length === 1
        ? copy.allImportedOne
        : copy.allImportedMany(imported.length),
    );
    return lines.join('\n');
  }
  lines.push(copy.mixed(imported.length, skipped.length, failed.length));
  for (const item of skipped) {
    lines.push(copy.skippedItem(
      resultDisplayName(item),
      item.error || copy.unknownReason,
    ));
  }
  for (const item of failed) {
    lines.push(copy.failedItem(
      resultDisplayName(item),
      item.error || copy.unknownReason,
    ));
  }
  return lines.join('\n');
}

export function assertImportBatchResultShape(
  batch: unknown,
  expected: number,
): asserts batch is { results: ProjectAssetImportItemResult[] } {
  if (!batch || typeof batch !== 'object' || !('results' in batch)) {
    throw new Error(`Import batch missing results (expected ${expected} item(s)).`);
  }
  const results = (batch as { results: unknown }).results;
  if (!Array.isArray(results)) {
    throw new Error(`Import batch results must be an array (expected ${expected} item(s), got ${typeof results}).`);
  }
  if (results.length !== expected) {
    throw new Error(`Import batch result count mismatch (expected ${expected}, got ${results.length}).`);
  }
}
