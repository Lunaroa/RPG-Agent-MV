import fs from 'node:fs';
import path from 'node:path';

import { migrateJsonToSqlite } from './migrate-json-to-sqlite.ts';
import { backfillEventContractRids, migrate } from './migrate.ts';
import { configureDatabase, getDatabase } from './pool.ts';

const LEGACY_IMPORT_KEY = 'legacy_json_import_complete';

function migrateLegacyDatabasePath(root: string, dbPath: string): void {
  if (fs.existsSync(dbPath)) return;

  const legacyDbPath = path.join(root, 'runtime', 'rmmv.db');
  if (!fs.existsSync(legacyDbPath)) return;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.renameSync(legacyDbPath, dbPath);

  for (const suffix of ['-wal', '-shm']) {
    const legacySidecar = legacyDbPath + suffix;
    if (fs.existsSync(legacySidecar)) {
      fs.renameSync(legacySidecar, dbPath + suffix);
    }
  }
}

function migrateLegacySecretsPath(root: string): void {
  const target = path.join(root, 'runtime', 'secrets', '.env');
  if (fs.existsSync(target)) return;

  const legacy = path.join(root, 'secrets', '.env');
  if (!fs.existsSync(legacy)) return;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(legacy, target);
}

function warnIfWorkspaceLegacySkipped(skipped: string[]): void {
  if (skipped.length === 0) return;
  console.warn(
    `[bootstrap] ${skipped.length} legacy workspace path${skipped.length === 1 ? '' : 's'} could not be removed: ${skipped.join(', ')}`,
  );
}

function suppressSqliteExperimentalWarning(): void {
  const proc = process as NodeJS.Process & { __rmmvSqliteWarningFilter?: boolean };
  if (proc.__rmmvSqliteWarningFilter) return;
  proc.__rmmvSqliteWarningFilter = true;
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const message = typeof warning === 'string' ? warning : (warning as Error).message;
    const type = typeof warning === 'string'
      ? (rest[0] as string | undefined)
      : (warning as NodeJS.EmitWarningOptions).type;
    if (type === 'ExperimentalWarning' && /SQLite/i.test(message)) return;
    return original(warning as never, ...(rest as never[]));
  }) as typeof process.emitWarning;
}

export interface BootstrapDatabaseOptions {
  dbPath?: string;
  importLegacyJson?: boolean;
  /** 为 false 时跳过启动时 workspace 顶层遗留路径清理（默认执行）。 */
  skipWorkspaceLegacyCleanup?: boolean;
  /** 为 false 时跳过启动时 runtime 遗留路径清理（默认执行）。 */
  skipRuntimeLegacyCleanup?: boolean;
  /** 为 true 时清理 runtime/sessions/ 中超期目录（亦可通过 RMMV_PRUNE_SESSIONS=1 启用）。 */
  pruneExpiredSessions?: boolean;
}

/**
 * Configure the workflow-local SQLite database for the workspace.
 *
 * Legacy JSON import is opt-in only (`importLegacyJson: true`); it is not run
 * on normal startup. One-time DB path move from `runtime/rmmv.db` still runs
 * when `data/rmmv.db` is missing.
 *
 * The caller must pass the workspace root, not the repository root.
 */
export async function bootstrapDatabase(
  workflowRoot: string,
  options: BootstrapDatabaseOptions = {},
): Promise<string> {
  suppressSqliteExperimentalWarning();
  const root = path.resolve(workflowRoot);
  const dbPath = path.resolve(options.dbPath || path.join(root, 'data', 'rmmv.db'));
  if (!options.dbPath) {
    migrateLegacyDatabasePath(root, dbPath);
  }
  migrateLegacySecretsPath(root);
  configureDatabase({ path: dbPath });
  migrate();
  // 把 v4 分配的 rid 回填进 contract JSON 与 JSON 库，使两侧身份一致。
  backfillEventContractRids(root);

  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const imported = db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(LEGACY_IMPORT_KEY);
  if (!imported && options.importLegacyJson === true) {
    await migrateJsonToSqlite(root);
    db.prepare(`
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(LEGACY_IMPORT_KEY, new Date().toISOString(), new Date().toISOString());
  }

  if (!options.skipWorkspaceLegacyCleanup) {
    const { pruneWorkspaceLegacyArtifacts } = await import('../desktop/workspace-legacy-cleanup.ts');
    const workspaceCleanup = pruneWorkspaceLegacyArtifacts(root);
    if (workspaceCleanup.removed.length > 0) {
      process.stderr.write(
        `[bootstrap] removed ${workspaceCleanup.removed.length} legacy workspace path${workspaceCleanup.removed.length === 1 ? '' : 's'}\n`,
      );
    }
    warnIfWorkspaceLegacySkipped(workspaceCleanup.skipped);
  }

  if (!options.skipRuntimeLegacyCleanup) {
    const { pruneRuntimeLegacyArtifacts } = await import('../desktop/runtime-cleanup.ts');
    const { removed } = pruneRuntimeLegacyArtifacts(root);
    if (removed.length > 0) {
      process.stderr.write(
        `[bootstrap] removed ${removed.length} legacy runtime artifact${removed.length === 1 ? '' : 's'}\n`,
      );
    }
  }

  if (options.pruneExpiredSessions || process.env.RMMV_PRUNE_SESSIONS === '1') {
    const { pruneExpiredSessionDirectories } = await import('../desktop/session-retention.ts');
    const { removed } = pruneExpiredSessionDirectories(root);
    if (removed.length > 0) {
      process.stderr.write(`[bootstrap] pruned ${removed.length} expired session director${removed.length === 1 ? 'y' : 'ies'}\n`);
    }
  }

  return dbPath;
}
