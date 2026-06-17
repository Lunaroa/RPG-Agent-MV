// Map Selection 数据访问对象
import { getDatabase } from '../pool.ts';

export interface MapSelection {
  id: number;
  project_id: string;
  selection: Record<string, unknown>;
  created_at: string;
}

export class MapSelectionDao {
  /**
   * 获取项目的所有选择
   */
  static listByProject(projectId: string): MapSelection[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM map_selections WHERE project_id = ? ORDER BY created_at DESC, id DESC'
    ).all(projectId) as unknown as MapSelection[];
    return rows.map(row => ({
      ...row,
      selection: JSON.parse(row.selection as unknown as string)
    }));
  }

  /**
   * 获取单个选择
   */
  static get(id: number): MapSelection | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM map_selections WHERE id = ?').get(id) as MapSelection | undefined;
    if (!row) return null;
    return {
      ...row,
      selection: JSON.parse(row.selection as unknown as string)
    };
  }

  /**
   * 创建选择
   */
  static create(projectId: string, selection: Record<string, unknown>): MapSelection {
    const db = getDatabase();
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO map_selections (project_id, selection, created_at)
      VALUES (?, ?, ?)
    `).run(projectId, JSON.stringify(selection), now);

    return this.get(Number(result.lastInsertRowid))!;
  }

  /**
   * 更新选择
   */
  static update(id: number, selection: Record<string, unknown>): MapSelection | null {
    const db = getDatabase();

    db.prepare(`
      UPDATE map_selections
      SET selection = ?
      WHERE id = ?
    `).run(JSON.stringify(selection), id);

    return this.get(id);
  }

  /**
   * 删除选择
   */
  static delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM map_selections WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * 删除项目的所有选择
   */
  static deleteByProject(projectId: string): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM map_selections WHERE project_id = ?').run(projectId);
    return Number(result.changes);
  }

  /**
   * 获取最新的选择
   */
  static getLatest(projectId: string): MapSelection | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM map_selections WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
    ).get(projectId) as MapSelection | undefined;
    if (!row) return null;
    return {
      ...row,
      selection: JSON.parse(row.selection as unknown as string)
    };
  }
}
