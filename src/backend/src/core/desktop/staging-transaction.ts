import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface StagingTransactionEntry {
  relativePath: string;
  sourceFile: string;
  draftFile: string;
  delete: boolean;
}

export interface StagingTransactionHookEntry extends StagingTransactionEntry {
  index: number;
}

export interface StagingTransactionDependencies {
  beforeReplace?: (entry: StagingTransactionHookEntry) => void;
  beforeDelete?: (entry: StagingTransactionHookEntry) => void;
  beforeDraftMove?: (entry: StagingTransactionHookEntry) => void;
  beforeDraftRestore?: (entry: StagingTransactionHookEntry) => void;
  beforeManifestUpdate?: () => void;
}

interface StagingTransactionInput {
  entries: StagingTransactionEntry[];
  transactionRoot: string;
  updateManifest: () => void;
  dependencies?: StagingTransactionDependencies;
}

interface PreparedSourceEntry extends StagingTransactionHookEntry {
  sourceExisted: boolean;
  backupFile: string | null;
  replacementFile: string | null;
  createdDirectories: string[];
}

interface MovedDraft {
  entry: StagingTransactionHookEntry;
  draftFile: string;
  trashFile: string;
}

export function commitStagingTransaction(input: StagingTransactionInput): void {
  const transactionId = crypto.randomUUID();
  const transactionRoot = path.join(input.transactionRoot, transactionId);
  const prepared: PreparedSourceEntry[] = [];
  const committed: PreparedSourceEntry[] = [];
  const movedDrafts: MovedDraft[] = [];
  let metadataCommitted = false;

  try {
    for (const [index, entry] of input.entries.entries()) {
      prepared.push(prepareSourceEntry(entry, index, transactionId));
    }

    for (const entry of prepared) {
      if (entry.delete) {
        input.dependencies?.beforeDelete?.(entry);
        if (fs.existsSync(entry.sourceFile)) fs.unlinkSync(entry.sourceFile);
      } else {
        input.dependencies?.beforeReplace?.(entry);
        if (!entry.replacementFile) throw new Error(`Prepared replacement is missing: ${entry.relativePath}`);
        fs.renameSync(entry.replacementFile, entry.sourceFile);
      }
      committed.push(entry);
    }

    moveDraftsToTrash(input.entries, transactionRoot, movedDrafts, input.dependencies);
    input.dependencies?.beforeManifestUpdate?.();
    input.updateManifest();
    metadataCommitted = true;
  } catch (error) {
    if (metadataCommitted) throw error;
    const rollbackErrors = [
      ...restoreMovedDrafts(movedDrafts, input.dependencies),
      ...rollbackCommittedSources(committed),
    ];
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Staging transaction failed and rollback could not restore every file.',
      );
    }
    const cleanupErrors = cleanupPreparedAfterFailure(prepared);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Staging transaction failed and prepared-file cleanup was incomplete.',
      );
    }
    removeTreeIfPresent(transactionRoot);
    throw error;
  }

  cleanupPreparedFiles(prepared);
  removeTreeIfPresent(transactionRoot);
}

export function discardStagingTransaction(input: StagingTransactionInput): void {
  const transactionRoot = path.join(input.transactionRoot, crypto.randomUUID());
  const movedDrafts: MovedDraft[] = [];
  let metadataCommitted = false;
  try {
    moveDraftsToTrash(input.entries, transactionRoot, movedDrafts, input.dependencies);
    input.dependencies?.beforeManifestUpdate?.();
    input.updateManifest();
    metadataCommitted = true;
  } catch (error) {
    if (metadataCommitted) throw error;
    const rollbackErrors = restoreMovedDrafts(movedDrafts, input.dependencies);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Staging discard failed and draft rollback could not restore every file.',
      );
    }
    removeTreeIfPresent(transactionRoot);
    throw error;
  }
  removeTreeIfPresent(transactionRoot);
}

function prepareSourceEntry(
  entry: StagingTransactionEntry,
  index: number,
  transactionId: string,
): PreparedSourceEntry {
  const sourceFile = path.resolve(entry.sourceFile);
  const sourceDirectory = path.dirname(sourceFile);
  const sourceExisted = fs.existsSync(sourceFile);
  const createdDirectories = entry.delete ? [] : ensureDirectory(sourceDirectory);
  const suffix = `.rmmv-staging-${transactionId}-${index}`;
  const backupFile = sourceExisted ? `${sourceFile}${suffix}.backup` : null;
  const replacementFile = entry.delete ? null : `${sourceFile}${suffix}.replacement`;

  try {
    if (backupFile) fs.copyFileSync(sourceFile, backupFile, fs.constants.COPYFILE_EXCL);
    if (replacementFile) {
      if (!fs.existsSync(entry.draftFile)) {
        throw new Error(`Staged project file is missing: ${entry.relativePath}`);
      }
      fs.copyFileSync(entry.draftFile, replacementFile, fs.constants.COPYFILE_EXCL);
    }
  } catch (error) {
    removeFileIfPresent(backupFile);
    removeFileIfPresent(replacementFile);
    removeCreatedDirectories(createdDirectories);
    throw error;
  }

  return {
    ...entry,
    sourceFile,
    index,
    sourceExisted,
    backupFile,
    replacementFile,
    createdDirectories,
  };
}

function moveDraftsToTrash(
  entries: StagingTransactionEntry[],
  transactionRoot: string,
  moved: MovedDraft[],
  dependencies: StagingTransactionDependencies | undefined,
): void {
  for (const [index, entry] of entries.entries()) {
    if (!fs.existsSync(entry.draftFile)) continue;
    const hookEntry = { ...entry, index };
    dependencies?.beforeDraftMove?.(hookEntry);
    const trashFile = path.join(transactionRoot, 'draft', ...entry.relativePath.split('/'));
    fs.mkdirSync(path.dirname(trashFile), { recursive: true });
    fs.renameSync(entry.draftFile, trashFile);
    moved.push({ entry: hookEntry, draftFile: entry.draftFile, trashFile });
  }
}

function rollbackCommittedSources(entries: PreparedSourceEntry[]): Error[] {
  const errors: Error[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      if (!entry.sourceExisted) {
        removeFileIfPresent(entry.sourceFile);
        removeCreatedDirectories(entry.createdDirectories);
        continue;
      }
      if (!entry.backupFile || !fs.existsSync(entry.backupFile)) {
        throw new Error(`Staging source backup is missing: ${entry.relativePath}`);
      }
      const restoreFile = `${entry.backupFile}.restore`;
      fs.copyFileSync(entry.backupFile, restoreFile, fs.constants.COPYFILE_EXCL);
      try {
        fs.renameSync(restoreFile, entry.sourceFile);
      } finally {
        removeFileIfPresent(restoreFile);
      }
    } catch (error) {
      errors.push(asError(error));
    }
  }
  return errors;
}

function restoreMovedDrafts(
  moved: MovedDraft[],
  dependencies: StagingTransactionDependencies | undefined,
): Error[] {
  const errors: Error[] = [];
  for (const entry of [...moved].reverse()) {
    try {
      dependencies?.beforeDraftRestore?.(entry.entry);
      fs.mkdirSync(path.dirname(entry.draftFile), { recursive: true });
      fs.renameSync(entry.trashFile, entry.draftFile);
    } catch (error) {
      errors.push(asError(error));
    }
  }
  return errors;
}

function cleanupPreparedFiles(entries: PreparedSourceEntry[]): void {
  for (const entry of entries) {
    removeFileIfPresent(entry.backupFile);
    removeFileIfPresent(entry.replacementFile);
  }
}

function cleanupPreparedAfterFailure(entries: PreparedSourceEntry[]): Error[] {
  const errors: Error[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      removeFileIfPresent(entry.replacementFile);
      removeFileIfPresent(entry.backupFile);
      removeCreatedDirectories(entry.createdDirectories);
    } catch (error) {
      errors.push(asError(error));
      break;
    }
  }
  return errors;
}

function ensureDirectory(directory: string): string[] {
  if (fs.existsSync(directory)) return [];
  const parent = path.dirname(directory);
  const created = parent === directory ? [] : ensureDirectory(parent);
  fs.mkdirSync(directory);
  created.push(directory);
  return created;
}

function removeCreatedDirectories(directories: string[]): void {
  for (const directory of [...directories].reverse()) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
    }
  }
}

function removeFileIfPresent(file: string | null): void {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function removeTreeIfPresent(directory: string): void {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // The committed source and manifest state remains authoritative. A later
    // staging cleanup can safely remove an unreferenced transaction directory.
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
