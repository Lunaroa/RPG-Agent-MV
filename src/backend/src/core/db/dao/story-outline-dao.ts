import { getDatabase } from '../pool.ts';

// 创意大纲 DAO：大纲是项目级 Markdown 文本，只承载创作意图。
// EventContract 才是生产进度、地图、依赖和验收的权威来源。

export interface StoryOutlineRow {
  project_id: string;
  outline: Record<string, unknown>;
  updated_at: string;
}

interface RawStoryOutlineRow {
  project_id: string;
  title: string | null;
  body: string;
  updated_by: string | null;
  row_version: number;
  updated_at: string;
}

export class StoryOutlineDao {
  static get(projectId: string): StoryOutlineRow | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM story_outline WHERE project_id = ?').get(projectId) as RawStoryOutlineRow | undefined;
    if (!row) return null;
    return {
      project_id: projectId,
      outline: assembleOutline(row),
      updated_at: row.updated_at,
    };
  }

  static upsert(projectId: string, outline: Record<string, unknown>): StoryOutlineRow {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO story_outline (project_id, title, body, updated_by, row_version, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        updated_by = excluded.updated_by,
        row_version = story_outline.row_version + 1,
        updated_at = excluded.updated_at
    `).run(
      projectId,
      str(outline.title),
      String(outline.body ?? ''),
      str(outline.updatedBy),
      now,
    );
    return this.get(projectId)!;
  }

  static delete(projectId: string): boolean {
    const result = getDatabase().prepare('DELETE FROM story_outline WHERE project_id = ?').run(projectId);
    return Number(result.changes) > 0;
  }
}

function assembleOutline(row: RawStoryOutlineRow): Record<string, unknown> {
  return prune({
    projectId: row.project_id,
    title: row.title ?? undefined,
    body: row.body,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? undefined,
  });
}

function str(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function prune<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}
