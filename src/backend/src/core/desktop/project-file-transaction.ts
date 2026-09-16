import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_FILE_ERROR_CODES, ProjectFileError } from './project-file-errors.ts';

export type ProjectFileTransactionEntry =
  | {
    relativePath: string;
    targetFile: string;
    content: Buffer;
    delete?: false;
  }
  | {
    relativePath: string;
    targetFile: string;
    delete: true;
    content?: never;
  };

export type ProjectFileTransactionHookEntry = ProjectFileTransactionEntry & { index: number };

export interface ProjectFileTransactionDependencies {
  beforePrepare?: (entry: ProjectFileTransactionHookEntry) => void;
  beforeReplace?: (entry: ProjectFileTransactionHookEntry) => void;
  beforeDelete?: (entry: ProjectFileTransactionHookEntry) => void;
}

type PreparedEntry = ProjectFileTransactionHookEntry & {
  targetExisted: boolean;
  backupFile: string | null;
  replacementFile: string | null;
  createdDirectories: string[];
};

export function commitProjectFileTransaction(
  entries: readonly ProjectFileTransactionEntry[],
  dependencies: ProjectFileTransactionDependencies = {},
): void {
  if (entries.length === 0) throw new Error('A project file transaction requires at least one mutation.');
  const transactionId = crypto.randomUUID();
  const prepared: PreparedEntry[] = [];
  const committed: PreparedEntry[] = [];

  try {
    for (const [index, entry] of entries.entries()) {
      const hookEntry = { ...entry, index } as ProjectFileTransactionHookEntry;
      dependencies.beforePrepare?.(hookEntry);
      prepared.push(prepareEntry(hookEntry, transactionId));
    }

    for (const entry of prepared) {
      if (entry.delete) {
        dependencies.beforeDelete?.(entry);
        if (fs.existsSync(entry.targetFile)) fs.unlinkSync(entry.targetFile);
      } else {
        dependencies.beforeReplace?.(entry);
        if (!entry.replacementFile) throw new Error(`Prepared replacement is missing: ${entry.relativePath}`);
        fs.renameSync(entry.replacementFile, entry.targetFile);
      }
      committed.push(entry);
    }
  } catch (error) {
    const rollbackErrors = rollbackCommittedEntries(committed);
    const cleanupErrors = cleanupPreparedAfterFailure(prepared);
    if (rollbackErrors.length > 0 || cleanupErrors.length > 0) {
      throw new ProjectFileError(
        PROJECT_FILE_ERROR_CODES.transactionFailed,
        'The project write failed and not every file could be restored automatically. Stop editing and restore the affected files from version management or a backup.',
        {
          files: entries.map((entry) => entry.relativePath),
          rollbackErrors: rollbackErrors.map((item) => item.message),
          cleanupErrors: cleanupErrors.map((item) => item.message),
        },
        { cause: error },
      );
    }
    throw error;
  }

  cleanupPreparedFiles(prepared);
}

function prepareEntry(entry: ProjectFileTransactionHookEntry, transactionId: string): PreparedEntry {
  const targetFile = path.resolve(entry.targetFile);
  const targetDirectory = path.dirname(targetFile);
  const targetExisted = fs.existsSync(targetFile);
  const createdDirectories = entry.delete ? [] : ensureDirectory(targetDirectory);
  const suffix = `.rpg-agent-write-${transactionId}-${entry.index}`;
  const backupFile = targetExisted ? `${targetFile}${suffix}.backup` : null;
  const replacementFile = entry.delete ? null : `${targetFile}${suffix}.replacement`;

  try {
    if (backupFile) fs.copyFileSync(targetFile, backupFile, fs.constants.COPYFILE_EXCL);
    if (replacementFile) fs.writeFileSync(replacementFile, entry.content, { flag: 'wx' });
  } catch (error) {
    removeFileIfPresent(backupFile);
    removeFileIfPresent(replacementFile);
    removeCreatedDirectories(createdDirectories);
    throw error;
  }

  return {
    ...entry,
    targetFile,
    targetExisted,
    backupFile,
    replacementFile,
    createdDirectories,
  } as PreparedEntry;
}

function rollbackCommittedEntries(entries: readonly PreparedEntry[]): Error[] {
  const errors: Error[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      if (!entry.targetExisted) {
        removeFileIfPresent(entry.targetFile);
        removeCreatedDirectories(entry.createdDirectories);
        continue;
      }
      if (!entry.backupFile || !fs.existsSync(entry.backupFile)) {
        throw new Error(`Project write backup is missing: ${entry.relativePath}`);
      }
      const restoreFile = `${entry.backupFile}.restore`;
      fs.copyFileSync(entry.backupFile, restoreFile, fs.constants.COPYFILE_EXCL);
      try {
        fs.renameSync(restoreFile, entry.targetFile);
      } finally {
        removeFileIfPresent(restoreFile);
      }
    } catch (error) {
      errors.push(asError(error));
    }
  }
  return errors;
}

function cleanupPreparedFiles(entries: readonly PreparedEntry[]): void {
  for (const entry of entries) {
    removeFileIfPresent(entry.backupFile);
    removeFileIfPresent(entry.replacementFile);
  }
}

function cleanupPreparedAfterFailure(entries: readonly PreparedEntry[]): Error[] {
  const errors: Error[] = [];
  for (const entry of [...entries].reverse()) {
    try {
      removeFileIfPresent(entry.replacementFile);
      removeFileIfPresent(entry.backupFile);
      removeCreatedDirectories(entry.createdDirectories);
    } catch (error) {
      errors.push(asError(error));
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

function removeCreatedDirectories(directories: readonly string[]): void {
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
