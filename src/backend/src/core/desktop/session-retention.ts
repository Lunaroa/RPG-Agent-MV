import fs from 'node:fs';
import path from 'node:path';

/** 默认保留天数；可用环境变量 RMMV_SESSION_RETENTION_DAYS 覆盖。 */
export const SESSION_RETENTION_DAYS = Number(process.env.RMMV_SESSION_RETENTION_DAYS || 30);

export interface PruneExpiredSessionsOptions {
  retentionDays?: number;
  dryRun?: boolean;
  now?: Date;
}

export interface PruneExpiredSessionsResult {
  scanned: number;
  removed: string[];
  skipped: string[];
}

function parseTime(value: unknown): number | null {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readSessionMeta(sessionDir: string): Record<string, unknown> | null {
  const metaPath = path.join(sessionDir, 'agent-console', 'session-meta.json');
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function shouldPruneSession(
  sessionDir: string,
  meta: Record<string, unknown> | null,
  cutoffMs: number,
): boolean {
  if (meta) {
    const finishedAt = parseTime(meta.finishedAt);
    if (finishedAt !== null && finishedAt < cutoffMs) return true;

    const createdAt = parseTime(meta.createdAt);
    if (createdAt !== null && createdAt < cutoffMs) return true;

    return false;
  }

  const stat = fs.statSync(sessionDir);
  return stat.mtimeMs < cutoffMs;
}

/**
 * 删除 runtime/sessions/ 下已超过保留期的会话目录。
 * 判定：finishedAt 或 createdAt 早于 cutoff；无 meta 时用目录 mtime。
 */
export function pruneExpiredSessionDirectories(
  workflowRoot: string,
  options: PruneExpiredSessionsOptions = {},
): PruneExpiredSessionsResult {
  const retentionDays = options.retentionDays ?? SESSION_RETENTION_DAYS;
  const now = options.now ?? new Date();
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const sessionsRoot = path.join(path.resolve(workflowRoot), 'runtime', 'sessions');
  const result: PruneExpiredSessionsResult = { scanned: 0, removed: [], skipped: [] };

  if (!fs.existsSync(sessionsRoot)) return result;

  for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    result.scanned += 1;
    const sessionDir = path.join(sessionsRoot, entry.name);
    const meta = readSessionMeta(sessionDir);

    if (!shouldPruneSession(sessionDir, meta, cutoffMs)) {
      result.skipped.push(entry.name);
      continue;
    }

    if (!options.dryRun) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    result.removed.push(entry.name);
  }

  return result;
}

/** 启动时可选清理：设置 RMMV_PRUNE_SESSIONS=1 启用，RMMV_PRUNE_SESSIONS=0 显式禁用。 */
export function maybePruneExpiredSessions(
  workflowRoot: string,
  options: PruneExpiredSessionsOptions = {},
): PruneExpiredSessionsResult | null {
  if (process.env.RMMV_PRUNE_SESSIONS !== '1') return null;
  return pruneExpiredSessionDirectories(workflowRoot, options);
}
