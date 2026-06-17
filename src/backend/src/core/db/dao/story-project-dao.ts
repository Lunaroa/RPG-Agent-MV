import path from 'node:path';

import type {
  StoryProjectMode,
  StoryProjectProfile,
} from '../../../../../contract/types.ts';
import { getDatabase } from '../pool.ts';

interface RawProjectRow {
  project_id: string;
  project_path: string;
  mode: StoryProjectMode;
  default_origin: 'original' | 'mod';
  baseline_version: string | null;
  baseline_project_path: string | null;
  initialized_at: string;
  updated_at: string;
}

export class StoryProjectDao {
  static get(projectId: string): StoryProjectProfile | null {
    const row = getDatabase().prepare(
      'SELECT * FROM story_projects WHERE project_id = ?',
    ).get(projectId) as RawProjectRow | undefined;
    return row ? parseRow(row) : null;
  }

  static getByPath(projectPath: string): StoryProjectProfile | null {
    const row = getDatabase().prepare(
      'SELECT * FROM story_projects WHERE project_path = ?',
    ).get(path.resolve(projectPath)) as RawProjectRow | undefined;
    return row ? parseRow(row) : null;
  }

  static upsertOriginal(projectId: string, projectPath: string): StoryProjectProfile {
    return this.upsert({
      projectId,
      projectPath: path.resolve(projectPath),
      mode: 'original',
      defaultOrigin: 'original',
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  static upsertMod(
    projectId: string,
    projectPath: string,
    baselineVersion: string,
    baselineProjectPath: string,
  ): StoryProjectProfile {
    if (!baselineVersion.trim()) throw new Error('MOD baselineVersion is required');
    if (!baselineProjectPath.trim()) throw new Error('MOD baselineProjectPath is required');
    return this.upsert({
      projectId,
      projectPath: path.resolve(projectPath),
      mode: 'mod',
      defaultOrigin: 'mod',
      baselineVersion: baselineVersion.trim(),
      baselineProjectPath: path.resolve(baselineProjectPath),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  static delete(projectId: string): boolean {
    const result = getDatabase().prepare('DELETE FROM story_projects WHERE project_id = ?').run(projectId);
    return Number(result.changes) > 0;
  }

  private static upsert(profile: StoryProjectProfile): StoryProjectProfile {
    if (!profile.projectId.trim()) throw new Error('story project projectId is required');
    const now = new Date().toISOString();
    getDatabase().prepare(`
      INSERT INTO story_projects (
        project_id, project_path, mode, default_origin, baseline_version,
        baseline_project_path, initialized_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        project_path = excluded.project_path,
        mode = excluded.mode,
        default_origin = excluded.default_origin,
        baseline_version = excluded.baseline_version,
        baseline_project_path = excluded.baseline_project_path,
        updated_at = excluded.updated_at
    `).run(
      profile.projectId,
      path.resolve(profile.projectPath),
      profile.mode,
      profile.defaultOrigin,
      profile.baselineVersion ?? null,
      profile.baselineProjectPath ? path.resolve(profile.baselineProjectPath) : null,
      profile.initializedAt || now,
      now,
    );
    return this.get(profile.projectId)!;
  }
}

function parseRow(row: RawProjectRow): StoryProjectProfile {
  return {
    projectId: row.project_id,
    projectPath: row.project_path,
    mode: row.mode,
    defaultOrigin: row.default_origin,
    baselineVersion: row.baseline_version ?? undefined,
    baselineProjectPath: row.baseline_project_path ?? undefined,
    initializedAt: row.initialized_at,
    updatedAt: row.updated_at,
  };
}
