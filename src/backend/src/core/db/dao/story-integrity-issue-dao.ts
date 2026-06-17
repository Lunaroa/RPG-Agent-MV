import crypto from 'node:crypto';

import type { StoryIntegrityIssue } from '../../../../../contract/types.ts';
import { getDatabase } from '../pool.ts';

interface RawIssueRow {
  issue_id: string;
  project_id: string;
  scope_type: StoryIntegrityIssue['scopeType'];
  scope_id: string;
  code: string;
  severity: StoryIntegrityIssue['severity'];
  message: string;
  map_id: number | null;
  event_id: number | null;
  page_node_id: string | null;
  detail: string | null;
  detected_at: string;
  resolved_at: string | null;
}

export class StoryIntegrityIssueDao {
  static listActive(projectId: string): StoryIntegrityIssue[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM story_integrity_issues
      WHERE project_id = ? AND resolved_at IS NULL
      ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END, detected_at DESC, issue_id
    `).all(projectId) as unknown as RawIssueRow[];
    return rows.map(parseRow);
  }

  static listActiveForScope(projectId: string, scopeType: StoryIntegrityIssue['scopeType'], scopeId: string): StoryIntegrityIssue[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM story_integrity_issues
      WHERE project_id = ? AND scope_type = ? AND scope_id = ? AND resolved_at IS NULL
      ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END, detected_at DESC, issue_id
    `).all(projectId, scopeType, scopeId) as unknown as RawIssueRow[];
    return rows.map(parseRow);
  }

  static replaceSyncIssues(projectId: string, issues: Array<Omit<StoryIntegrityIssue, 'issueId' | 'projectId' | 'detectedAt'>>): StoryIntegrityIssue[] {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE story_integrity_issues
      SET resolved_at = ?
      WHERE project_id = ? AND resolved_at IS NULL
        AND json_extract(COALESCE(detail, '{}'), '$.source') = 'page-sync'
    `).run(now, projectId);

    const insert = db.prepare(`
      INSERT INTO story_integrity_issues (
        issue_id, project_id, scope_type, scope_id, code, severity, message,
        map_id, event_id, page_node_id, detail, detected_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(issue_id) DO UPDATE SET
        severity = excluded.severity,
        message = excluded.message,
        map_id = excluded.map_id,
        event_id = excluded.event_id,
        page_node_id = excluded.page_node_id,
        detail = excluded.detail,
        detected_at = excluded.detected_at,
        resolved_at = NULL
    `);
    for (const issue of issues) {
      const issueId = issueKey(projectId, issue.scopeType, issue.scopeId, issue.code);
      insert.run(
        issueId,
        projectId,
        issue.scopeType,
        issue.scopeId,
        issue.code,
        issue.severity,
        issue.message,
        issue.mapId ?? null,
        issue.eventId ?? null,
        issue.pageNodeId ?? null,
        JSON.stringify({ source: 'page-sync', ...(issue.detail || {}) }),
        now,
      );
    }
    return this.listActive(projectId);
  }
}

function issueKey(projectId: string, scopeType: string, scopeId: string, code: string): string {
  return crypto.createHash('sha256').update(`${projectId}\0${scopeType}\0${scopeId}\0${code}`).digest('hex');
}

function parseRow(row: RawIssueRow): StoryIntegrityIssue {
  return {
    issueId: row.issue_id,
    projectId: row.project_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    code: row.code,
    severity: row.severity,
    message: row.message,
    mapId: row.map_id ?? undefined,
    eventId: row.event_id ?? undefined,
    pageNodeId: row.page_node_id ?? undefined,
    detail: row.detail ? JSON.parse(row.detail) : undefined,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}
