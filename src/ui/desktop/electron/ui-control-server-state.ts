import fs from 'node:fs';
import path from 'node:path';

export function prepareUiControlServerInfo(
  filePath: string,
  isAlive: (pid: number) => boolean = isProcessAlive,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) return;
  let existing: { pid?: unknown };
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { pid?: unknown };
  } catch {
    throw new Error('Existing UI control bridge metadata is invalid and cannot be safely replaced.');
  }
  const existingPid = Number(existing.pid);
  if (!Number.isInteger(existingPid) || existingPid < 1) {
    throw new Error('Existing UI control bridge metadata has no valid process ID and cannot be safely replaced.');
  }
  if (isAlive(existingPid)) {
    throw new Error(`A background UI control bridge is already running with process ID ${existingPid}.`);
  }
  fs.rmSync(filePath, { force: true });
}

export function acquireUiControlServerLock(
  lockPath: string,
  ownerPid = process.pid,
  isAlive: (pid: number) => boolean = isProcessAlive,
): () => void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) {
    let existingPid = 0;
    try {
      existingPid = Number(JSON.parse(fs.readFileSync(lockPath, 'utf8'))?.pid);
    } catch {
      throw new Error('Existing UI control bridge lock is invalid and cannot be safely replaced.');
    }
    if (!Number.isInteger(existingPid) || existingPid < 1) {
      throw new Error('Existing UI control bridge lock has no valid process ID and cannot be safely replaced.');
    }
    if (isAlive(existingPid)) {
      throw new Error(`A background UI control bridge is already running with process ID ${existingPid}.`);
    }
    fs.rmSync(lockPath, { force: true });
  }
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: ownerPid }) + '\n', { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Another background UI control bridge acquired the workspace lock.');
    }
    throw error;
  }
  return () => {
    if (!fs.existsSync(lockPath)) return;
    try {
      const currentPid = Number(JSON.parse(fs.readFileSync(lockPath, 'utf8'))?.pid);
      if (currentPid === ownerPid) fs.rmSync(lockPath, { force: true });
    } catch {
      // Do not remove a lock whose ownership can no longer be proven.
    }
  };
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EPERM');
  }
}
