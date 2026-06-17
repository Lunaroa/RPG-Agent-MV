// Provider 数据访问对象
import { getDatabase } from '../pool.ts';

export interface Provider {
  id: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class ProviderDao {
  /**
   * 获取所有 providers
   */
  static list(): Provider[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM providers ORDER BY id').all() as unknown as Provider[];
    return rows.map(row => ({
      ...row,
      config: JSON.parse(row.config as unknown as string)
    }));
  }

  /**
   * 获取单个 provider
   */
  static get(id: string): Provider | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Provider | undefined;
    if (!row) return null;
    return {
      ...row,
      config: JSON.parse(row.config as unknown as string)
    };
  }

  /**
   * 创建或更新 provider
   */
  static upsert(id: string, config: Record<string, unknown>): Provider {
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO providers (id, config, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        config = excluded.config,
        updated_at = excluded.updated_at
    `).run(id, JSON.stringify(config), now, now);

    return this.get(id)!;
  }

  /**
   * 删除 provider
   */
  static delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * 删除所有 providers
   */
  static clearAll(): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM providers').run();
    return Number(result.changes || 0);
  }

  /**
   * 检查 provider 是否存在
   */
  static exists(id: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT 1 FROM providers WHERE id = ?').get(id);
    return !!row;
  }

  /**
   * 获取 provider 数量
   */
  static count(): number {
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as count FROM providers').get() as { count: number };
    return row.count;
  }
}
