import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';

const BACKUP_EXCLUDED_SEGMENTS = new Set(['node_modules', '.git', 'save']);

function isBackupTrackedPath(relative: string): boolean {
  const segments = relative.toLowerCase().split('/');
  if (segments.some((segment) => BACKUP_EXCLUDED_SEGMENTS.has(segment))) return false;
  if (segments[0] === 'www' && segments[1] === 'save') return false;
  if (segments[0] === '.luna_rpg' || segments[0] === '.rpg-agent') return false;
  return true;
}

interface BackupFileEntry {
  path: string;
  size: number;
}

async function scanDirectory(projectRoot: string, directory: string, output: BackupFileEntry[]): Promise<void> {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(projectRoot, absolute).replace(/\\/g, '/');
    if (!relative || !isBackupTrackedPath(relative)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await scanDirectory(projectRoot, absolute, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.promises.stat(absolute);
    output.push({ path: relative, size: stat.size });
  }
}

export async function backupProject(
  projectRoot: string,
  outputPath: string,
): Promise<{ path: string; fileCount: number; totalBytes: number }> {
  const root = path.resolve(projectRoot);
  const stat = await fs.promises.stat(root);
  if (!stat.isDirectory()) throw new Error('The selected RPG Maker project directory does not exist.');
  const entries: BackupFileEntry[] = [];
  await scanDirectory(root, root, entries);
  if (entries.length === 0) throw new Error('The selected project contains no files to back up.');
  const partial = `${outputPath}.rpg-agent-${crypto.randomUUID()}.partial`;
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await tar.c({
      cwd: root,
      file: partial,
      gzip: true,
      portable: true,
    }, entries.map((entry) => entry.path));
    await fs.promises.rename(partial, outputPath).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await fs.promises.copyFile(partial, outputPath);
      await fs.promises.rm(partial, { force: true });
    });
  } finally {
    await fs.promises.rm(partial, { force: true });
  }
  return {
    path: outputPath,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
}

export function defaultProjectBackupName(): string {
  return `project-backup-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.tar.gz`;
}
