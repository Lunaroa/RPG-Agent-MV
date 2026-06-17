// Console Settings 数据访问对象
import { getDatabase } from '../pool.ts';

export interface ConsoleSetting {
  key: string;
  value: unknown;
  updated_at: string;
}

export class ConsoleSettingsDao {
  /**
   * 获取所有设置
   */
  static list(): ConsoleSetting[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM console_settings ORDER BY key').all() as unknown as ConsoleSetting[];
    return rows.map(row => ({
      ...row,
      value: JSON.parse(row.value as unknown as string)
    }));
  }

  /**
   * 获取单个设置
   */
  static get(key: string): unknown | null {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM console_settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.value);
  }

  /**
   * 设置值
   */
  static set(key: string, value: unknown): void {
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO console_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), now);
  }

  /**
   * 删除设置
   */
  static delete(key: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM console_settings WHERE key = ?').run(key);
    return result.changes > 0;
  }

  /**
   * 检查设置是否存在
   */
  static exists(key: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT 1 FROM console_settings WHERE key = ?').get(key);
    return !!row;
  }

  /**
   * 获取多个设置
   */
  static getMultiple(keys: string[]): Record<string, unknown> {
    const db = getDatabase();
    const placeholders = keys.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT key, value FROM console_settings WHERE key IN (${placeholders})`
    ).all(...keys) as unknown as { key: string; value: string }[];

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }
    return result;
  }

  /**
   * 设置多个值
   */
  static setMultiple(entries: Record<string, unknown>): void {
    const db = getDatabase();
    const now = new Date().toISOString();

    const transaction = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT INTO console_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);

      for (const [key, value] of Object.entries(entries)) {
        stmt.run(key, JSON.stringify(value), now);
      }
    });

    transaction();
  }
}
