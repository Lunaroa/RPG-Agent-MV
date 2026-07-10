import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { STAGING_ERROR_CODES, StagingError } from './staging-errors.ts';

interface ProjectStagingLockContext {
  lockFile: string;
  projectHash: string;
}

export function withProjectStagingLock<T>(context: ProjectStagingLockContext, action: () => T): T {
  const token = acquireProjectStagingLock(context);
  try {
    return action();
  } finally {
    releaseProjectStagingLock(context, token);
  }
}

function acquireProjectStagingLock(context: ProjectStagingLockContext): string {
  fs.mkdirSync(path.dirname(context.lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = crypto.randomUUID();
    try {
      const descriptor = fs.openSync(context.lockFile, 'wx');
      try {
        fs.writeFileSync(descriptor, JSON.stringify({
          pid: process.pid,
          token,
          createdAt: new Date().toISOString(),
          projectHash: context.projectHash,
        }), { encoding: 'utf8' });
      } catch (error) {
        if (fs.existsSync(context.lockFile)) fs.unlinkSync(context.lockFile);
        throw error;
      } finally {
        fs.closeSync(descriptor);
      }
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt === 0 && removeDeadProjectStagingLock(context.lockFile)) continue;
      throw new StagingError(
        STAGING_ERROR_CODES.busy,
        `Project staging is busy: ${context.projectHash}`,
        { projectHash: context.projectHash },
      );
    }
  }
  throw new StagingError(STAGING_ERROR_CODES.busy, `Project staging is busy: ${context.projectHash}`);
}

function removeDeadProjectStagingLock(lockFile: string): boolean {
  let metadata: { pid?: unknown };
  try {
    metadata = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { pid?: unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    return false;
  }
  const pid = Number(metadata.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
  }
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function releaseProjectStagingLock(context: ProjectStagingLockContext, token: string): void {
  let metadata: { token?: unknown };
  try {
    metadata = JSON.parse(fs.readFileSync(context.lockFile, 'utf8')) as { token?: unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (metadata.token !== token) return;
  try {
    fs.unlinkSync(context.lockFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
