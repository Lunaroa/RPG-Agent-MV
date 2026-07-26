// 资产备注/收藏数据访问对象（素材库文件/文件夹与地图收藏共用）
import { getDatabase } from '../pool.ts';

export interface AssetAnnotationRow {
  project: string;
  target_id: string;
  kind: string;
  note: string;
  favorite: number;
  updated_at: string;
}

export class AssetAnnotationDao {
  /**
   * 列出项目的全部备注/收藏
   */
  static listByProject(project: string): AssetAnnotationRow[] {
    const db = getDatabase();
    return db.prepare(
      'SELECT * FROM asset_annotations WHERE project = ? ORDER BY target_id',
    ).all(project) as unknown as AssetAnnotationRow[];
  }

  /**
   * 获取单条备注/收藏
   */
  static get(project: string, targetId: string): AssetAnnotationRow | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM asset_annotations WHERE project = ? AND target_id = ?',
    ).get(project, targetId) as AssetAnnotationRow | undefined;
    return row ?? null;
  }

  /**
   * 写入（插入或覆盖）单条备注/收藏
   */
  static upsert(project: string, targetId: string, kind: string, note: string, favorite: boolean): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO asset_annotations (project, target_id, kind, note, favorite, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, target_id) DO UPDATE SET
        kind = excluded.kind,
        note = excluded.note,
        favorite = excluded.favorite,
        updated_at = excluded.updated_at
    `).run(project, targetId, kind, note, favorite ? 1 : 0, now);
  }

  /**
   * 删除单条备注/收藏
   */
  static delete(project: string, targetId: string): boolean {
    const db = getDatabase();
    const result = db.prepare(
      'DELETE FROM asset_annotations WHERE project = ? AND target_id = ?',
    ).run(project, targetId);
    return result.changes > 0;
  }

  /**
   * 目标改名/移动时迁移 target_id（目标位置已有记录则覆盖）
   */
  static transfer(project: string, fromTargetId: string, toTargetId: string): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE OR REPLACE asset_annotations
      SET target_id = ?, updated_at = ?
      WHERE project = ? AND target_id = ?
    `).run(toTargetId, now, project, fromTargetId);
  }

  /**
   * 按前缀列出 target_id（substr 精确比较，避免 LIKE 转义问题）
   */
  static listTargetIdsByPrefix(project: string, prefix: string): string[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT target_id FROM asset_annotations WHERE project = ? AND substr(target_id, 1, ?) = ?',
    ).all(project, prefix.length, prefix) as unknown as Array<{ target_id: string }>;
    return rows.map((row) => row.target_id);
  }
}
