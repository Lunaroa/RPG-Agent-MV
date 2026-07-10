import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { STAGING_ERROR_CODES, StagingError } from './staging-errors.ts';

interface ProjectStagingLockContext {
  lockFile: string;
  projectHash: string;
}

export function withProjectStagingLock<T>(context: ProjectStagingLockContext, action: () => T): T {
  fs.mkdirSync(path.dirname(context.lockFile), { recursive: true });
  const database = new DatabaseSync(context.lockFile);
  try {
    database.exec('PRAGMA busy_timeout = 0');
    database.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    database.close();
    if (isSqliteLockContention(error)) {
      throw new StagingError(
        STAGING_ERROR_CODES.busy,
        `Project staging is busy: ${context.projectHash}`,
        { projectHash: context.projectHash },
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
      // Preserve the action or commit error; close still releases the OS lock.
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
