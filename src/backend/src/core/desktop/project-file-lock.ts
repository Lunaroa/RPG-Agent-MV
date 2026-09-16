import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { PROJECT_FILE_ERROR_CODES, ProjectFileError } from './project-file-errors.ts';

export interface ProjectFileLockContext {
  lockFile: string;
  projectHash: string;
}

export function withProjectFileLock<T>(context: ProjectFileLockContext, action: () => T): T {
  fs.mkdirSync(path.dirname(context.lockFile), { recursive: true });
  const database = new DatabaseSync(context.lockFile);
  try {
    database.exec('PRAGMA busy_timeout = 0');
    database.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    database.close();
    if (isSqliteLockContention(error)) {
      throw new ProjectFileError(
        PROJECT_FILE_ERROR_CODES.busy,
        'Another project write is still in progress. Wait for it to finish, then save again.',
        { projectHash: context.projectHash },
        { cause: error },
      );
    }
    throw error;
  }

  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // The original write failure is more useful than a secondary lock rollback failure.
    }
    throw error;
  } finally {
    database.close();
  }
}

function isSqliteLockContention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errcode = Number((error as { errcode?: unknown }).errcode);
  return errcode === 5 || errcode === 6;
}
