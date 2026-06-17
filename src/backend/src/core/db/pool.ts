// 数据库连接池管理
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface WorkflowDatabase extends DatabaseSync {
  pragma(statement: string): void;
  transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
}

let db: WorkflowDatabase | null = null;
let configuredPath: string | null = null;

export interface DatabaseConfig {
  path: string;
  walMode?: boolean;
  foreignKeys?: boolean;
}

/**
 * Bind DAO access to an explicit workflow database before any lazy DAO call.
 */
export function configureDatabase(config: DatabaseConfig): void {
  const nextPath = path.resolve(config.path);
  if (db && configuredPath !== nextPath) {
    closeDatabase();
  }
  configuredPath = nextPath;
}

/**
 * 获取数据库实例（单例模式）
 */
export function getDatabase(config?: DatabaseConfig): WorkflowDatabase {
  if (db) return db;

  const dbPath = path.resolve(config?.path || configuredPath || getDefaultDbPath());
  const dir = path.dirname(dbPath);

  // 确保目录存在
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = createDatabase(dbPath);
  configuredPath = dbPath;

  // 启用 WAL 模式（更好的并发性能）
  if (config?.walMode !== false) {
    db.pragma('journal_mode = WAL');
  }

  // 启用外键约束
  if (config?.foreignKeys !== false) {
    db.pragma('foreign_keys = ON');
  }

  return db;
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getConfiguredDatabasePath(): string | null {
  return configuredPath;
}

/**
 * 获取默认数据库路径
 */
function getDefaultDbPath(): string {
  if (process.env.RMMV_WORKFLOW_DB) {
    return path.resolve(process.env.RMMV_WORKFLOW_DB);
  }
  throw new Error(
    'Database is not configured. Call bootstrapDatabase(workflowRoot) before using SQLite DAOs.'
  );
}

/**
 * 在事务中执行多个操作
 */
export function transaction<T>(fn: (db: WorkflowDatabase) => T): T {
  const database = getDatabase();
  const transaction = database.transaction(fn);
  return transaction(database);
}

function createDatabase(dbPath: string): WorkflowDatabase {
  const database = new DatabaseSync(dbPath) as WorkflowDatabase;
  database.pragma = statement => database.exec(`PRAGMA ${statement}`);
  database.transaction = fn => (...args) => {
    database.exec('BEGIN');
    try {
      const result = fn(...args);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
  return database;
}
