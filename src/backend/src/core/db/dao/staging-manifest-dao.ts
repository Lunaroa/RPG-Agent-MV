// Staging Manifest 数据访问对象
import { getDatabase } from '../pool.ts';

export interface StagingManifest {
  id: number;
  project_id: string;
  manifest: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class StagingManifestDao {
  /**
   * 获取项目的所有清单
   */
  static listByProject(projectId: string): StagingManifest[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM staging_manifests WHERE project_id = ? ORDER BY updated_at DESC, id DESC'
    ).all(projectId) as unknown as StagingManifest[];
    return rows.map(row => ({
      ...row,
      manifest: JSON.parse(row.manifest as unknown as string)
    }));
  }

  /**
   * 获取单个清单
   */
  static get(id: number): StagingManifest | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM staging_manifests WHERE id = ?').get(id) as StagingManifest | undefined;
    if (!row) return null;
    return {
      ...row,
      manifest: JSON.parse(row.manifest as unknown as string)
    };
  }

  /**
   * 获取项目的最新清单
   */
  static getLatestByProject(projectId: string): StagingManifest | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM staging_manifests WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1'
    ).get(projectId) as StagingManifest | undefined;
    if (!row) return null;
    return {
      ...row,
      manifest: JSON.parse(row.manifest as unknown as string)
    };
  }

  /**
   * 创建清单
   */
  static create(projectId: string, manifest: Record<string, unknown>): StagingManifest {
    const db = getDatabase();
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO staging_manifests (project_id, manifest, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(projectId, JSON.stringify(manifest), now, now);

    return this.get(Number(result.lastInsertRowid))!;
  }

  /**
   * 更新清单
   */
  static update(id: number, manifest: Record<string, unknown>): StagingManifest | null {
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE staging_manifests
      SET manifest = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(manifest), now, id);

    return this.get(id);
  }

  /**
   * 删除清单
   */
  static delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM staging_manifests WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * 删除项目的所有清单
   */
  static deleteByProject(projectId: string): number {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM staging_manifests WHERE project_id = ?').run(projectId);
    return Number(result.changes);
  }

  /**
   * 检查项目是否有清单
   */
  static hasManifests(projectId: string): boolean {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT 1 FROM staging_manifests WHERE project_id = ? LIMIT 1'
    ).get(projectId);
    return !!row;
  }
}
