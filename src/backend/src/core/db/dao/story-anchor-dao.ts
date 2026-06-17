import crypto from 'node:crypto';

import { getDatabase } from '../pool.ts';
import type {
  BaselineStoryEventAnchorInput,
  EditableStoryEventAnchorInput,
  ModStoryEventAnchorInput,
  StoryEventAnchor,
  StoryIntegrityStatus,
} from '../../../../../contract/types.ts';

// 事件锚点 DAO（story_event_anchors）：记录事件公共部分的来源与当前/原版快照。
// 页面权限由 story_pages 单独决定。

interface RawAnchorRow {
  project_id: string;
  anchor_id: string;
  origin: StoryEventAnchor['origin'];
  map_id: number;
  event_id: number | null;
  event_name: string | null;
  x: number | null;
  y: number | null;
  event_rid: number | null;
  baseline_version: string | null;
  current_shell: string | null;
  baseline_shell: string | null;
  current_shell_fingerprint: string | null;
  baseline_shell_fingerprint: string | null;
  integrity_status: StoryIntegrityStatus;
  detail: string | null;
}

export class StoryAnchorDao {
  static listByProject(projectId: string): StoryEventAnchor[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM story_event_anchors WHERE project_id = ? ORDER BY map_id, event_id, anchor_id',
    ).all(projectId) as unknown as RawAnchorRow[];
    return rows.map(parseRow);
  }

  static get(projectId: string, anchorId: string): StoryEventAnchor | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM story_event_anchors WHERE project_id = ? AND anchor_id = ?',
    ).get(projectId, anchorId) as unknown as RawAnchorRow | undefined;
    return row ? parseRow(row) : null;
  }

  static getByMapEvent(projectId: string, mapId: number, eventId: number): StoryEventAnchor | null {
    const row = getDatabase().prepare(
      'SELECT * FROM story_event_anchors WHERE project_id = ? AND map_id = ? AND event_id = ?',
    ).get(projectId, mapId, eventId) as unknown as RawAnchorRow | undefined;
    return row ? parseRow(row) : null;
  }

  /** 历史兼容：按稳定 eventRid 幂等 upsert。当前默认流程不再区分 MOD/原版。 */
  static upsertMod(anchor: ModStoryEventAnchorInput): StoryEventAnchor {
    validatePositiveInteger(anchor.eventRid, 'story anchor eventRid');
    if (!Number.isInteger(anchor.eventId) || typeof anchor.eventName !== 'string'
      || !Number.isInteger(anchor.x) || !Number.isInteger(anchor.y)) {
      throw new Error('story anchor eventId/eventName/x/y are required');
    }
    const existing = getDatabase().prepare(
      'SELECT * FROM story_event_anchors WHERE project_id = ? AND event_rid = ?',
    ).get(anchor.projectId, anchor.eventRid) as unknown as RawAnchorRow | undefined;
    if (existing) {
      const currentShell = anchor.currentShell ? JSON.stringify(anchor.currentShell) : null;
      getDatabase().prepare(`
        UPDATE story_event_anchors
        SET origin = 'mod', map_id = ?, event_id = ?, event_name = ?,
            x = ?, y = ?, current_shell = ?, current_shell_fingerprint = ?,
            integrity_status = 'synced', detail = ?
        WHERE project_id = ? AND event_rid = ?
      `).run(
        anchor.mapId,
        anchor.eventId,
        anchor.eventName,
        anchor.x,
        anchor.y,
        currentShell,
        anchor.currentShell ? jsonFingerprint(anchor.currentShell) : null,
        anchor.detail ? JSON.stringify(anchor.detail) : null,
        anchor.projectId,
        anchor.eventRid,
      );
      return this.get(anchor.projectId, existing.anchor_id)!;
    }
    return this.upsertEditable({
      ...anchor,
      origin: 'mod',
      eventId: anchor.eventId,
      eventName: anchor.eventName,
      x: anchor.x,
      y: anchor.y,
      currentShell: anchor.currentShell,
    });
  }

  static upsertEditable(anchor: EditableStoryEventAnchorInput): StoryEventAnchor {
    const db = getDatabase();
    validateProjectId(anchor.projectId);
    validatePositiveInteger(anchor.mapId, 'editable story anchor mapId');
    validatePositiveInteger(anchor.eventId, 'editable story anchor eventId');
    validateInteger(anchor.x, 'editable story anchor x');
    validateInteger(anchor.y, 'editable story anchor y');
    if (anchor.origin !== 'original' && anchor.origin !== 'mod') {
      throw new Error('editable story anchor origin must be original or mod');
    }
    if (typeof anchor.eventName !== 'string') throw new Error('editable story anchor eventName must be a string');
    if (anchor.eventRid !== undefined) validatePositiveInteger(anchor.eventRid, 'editable story anchor eventRid');
    const anchorId = anchor.anchorId?.trim()
      || `${anchor.origin}-${anchor.projectId}-${anchor.mapId}-${anchor.eventId}`;
    const currentShell = anchor.currentShell ? JSON.stringify(anchor.currentShell) : null;
    db.prepare(`
      INSERT INTO story_event_anchors (
        project_id, anchor_id, origin, map_id, event_id, event_name, x, y,
        event_rid, baseline_version, current_shell, baseline_shell,
        current_shell_fingerprint, baseline_shell_fingerprint, integrity_status, detail
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, 'synced', ?)
      ON CONFLICT(project_id, map_id, event_id) DO UPDATE SET
        origin = excluded.origin,
        map_id = excluded.map_id,
        event_id = excluded.event_id,
        event_name = excluded.event_name,
        x = excluded.x,
        y = excluded.y,
        event_rid = COALESCE(excluded.event_rid, story_event_anchors.event_rid),
        current_shell = excluded.current_shell,
        current_shell_fingerprint = excluded.current_shell_fingerprint,
        integrity_status = 'synced',
        detail = excluded.detail
    `).run(
      anchor.projectId,
      anchorId,
      anchor.origin,
      anchor.mapId,
      anchor.eventId,
      anchor.eventName,
      anchor.x,
      anchor.y,
      anchor.eventRid ?? null,
      currentShell,
      anchor.currentShell ? jsonFingerprint(anchor.currentShell) : null,
      anchor.detail ? JSON.stringify(anchor.detail) : null,
    );
    const row = db.prepare(
      'SELECT * FROM story_event_anchors WHERE project_id = ? AND map_id = ? AND event_id = ?',
    ).get(anchor.projectId, anchor.mapId, anchor.eventId) as unknown as RawAnchorRow;
    return parseRow(row);
  }

  /**
   * 原版锚点幂等 upsert：自然键 = (project_id, baseline_version, map_id, event_id) WHERE event_rid IS NULL。
   * 基线导入重复跑只更新、不建重复影子事件。event_rid 恒为 NULL（原版不发 rid）。
   */
  static upsertBaseline(anchor: BaselineStoryEventAnchorInput): StoryEventAnchor {
    const db = getDatabase();
    validateProjectId(anchor.projectId);
    validatePositiveInteger(anchor.mapId, 'baseline story anchor mapId');
    validatePositiveInteger(anchor.eventId, 'baseline story anchor eventId');
    validateInteger(anchor.x, 'baseline story anchor x');
    validateInteger(anchor.y, 'baseline story anchor y');
    if (typeof anchor.eventName !== 'string') throw new Error('baseline story anchor eventName must be a string');
    const baselineVersion = anchor.baselineVersion.trim();
    if (!baselineVersion) throw new Error('baseline story anchor baselineVersion is required');
    const anchorId = anchor.anchorId?.trim()
      || `baseline-${baselineVersion}-${anchor.mapId}-${anchor.eventId}`;
    db.prepare(`
      INSERT INTO story_event_anchors (
        project_id, anchor_id, origin, map_id, event_id, event_name, x, y,
        event_rid, baseline_version, current_shell, baseline_shell,
        current_shell_fingerprint, baseline_shell_fingerprint, integrity_status, detail
      )
      VALUES (?, ?, 'baseline', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'synced', ?)
      ON CONFLICT(project_id, baseline_version, map_id, event_id) WHERE origin = 'baseline' DO UPDATE SET
        event_name = excluded.event_name,
        x = excluded.x,
        y = excluded.y,
        current_shell = excluded.current_shell,
        baseline_shell = excluded.baseline_shell,
        current_shell_fingerprint = excluded.current_shell_fingerprint,
        baseline_shell_fingerprint = excluded.baseline_shell_fingerprint,
        integrity_status = excluded.integrity_status,
        detail = excluded.detail
    `).run(
      anchor.projectId,
      anchorId,
      anchor.mapId,
      anchor.eventId,
      anchor.eventName,
      anchor.x,
      anchor.y,
      baselineVersion,
      anchor.currentShell ? JSON.stringify(anchor.currentShell) : null,
      anchor.baselineShell ? JSON.stringify(anchor.baselineShell) : null,
      anchor.currentShell ? jsonFingerprint(anchor.currentShell) : null,
      anchor.baselineShell ? jsonFingerprint(anchor.baselineShell) : null,
      anchor.detail ? JSON.stringify(anchor.detail) : null,
    );
    const row = db.prepare(`
      SELECT * FROM story_event_anchors
      WHERE project_id = ? AND origin = 'baseline'
        AND baseline_version = ? AND map_id = ? AND event_id = ?
    `).get(
      anchor.projectId,
      baselineVersion,
      anchor.mapId,
      anchor.eventId,
    ) as unknown as RawAnchorRow | undefined;
    return parseRow(row!);
  }

  static updateSyncState(
    projectId: string,
    anchorId: string,
    patch: {
      eventName?: string;
      x?: number;
      y?: number;
      currentShell?: Record<string, unknown> | null;
      integrityStatus: StoryIntegrityStatus;
    },
  ): StoryEventAnchor {
    const currentShell = patch.currentShell === undefined
      ? undefined
      : patch.currentShell === null ? null : JSON.stringify(patch.currentShell);
    const fingerprint = patch.currentShell === undefined || patch.currentShell === null
      ? null
      : jsonFingerprint(patch.currentShell);
    const result = getDatabase().prepare(`
      UPDATE story_event_anchors
      SET event_name = COALESCE(?, event_name),
          x = COALESCE(?, x),
          y = COALESCE(?, y),
          current_shell = CASE WHEN ? = 1 THEN ? ELSE current_shell END,
          current_shell_fingerprint = CASE WHEN ? = 1 THEN ? ELSE current_shell_fingerprint END,
          integrity_status = ?
      WHERE project_id = ? AND anchor_id = ?
    `).run(
      patch.eventName ?? null,
      patch.x ?? null,
      patch.y ?? null,
      patch.currentShell === undefined ? 0 : 1,
      currentShell ?? null,
      patch.currentShell === undefined ? 0 : 1,
      fingerprint,
      patch.integrityStatus,
      projectId,
      anchorId,
    );
    if (!Number(result.changes)) throw new Error(`Story anchor not found: ${projectId}/${anchorId}`);
    return this.get(projectId, anchorId)!;
  }

  static updateOrigin(projectId: string, anchorId: string, origin: 'original' | 'mod'): StoryEventAnchor {
    const result = getDatabase().prepare(`
      UPDATE story_event_anchors
      SET origin = ?, baseline_version = NULL, baseline_shell = NULL,
          baseline_shell_fingerprint = NULL, integrity_status = 'synced'
      WHERE project_id = ? AND anchor_id = ?
    `).run(origin, projectId, anchorId);
    if (!Number(result.changes)) throw new Error(`Story anchor not found: ${projectId}/${anchorId}`);
    return this.get(projectId, anchorId)!;
  }

  static delete(projectId: string, anchorId: string): boolean {
    const result = getDatabase().prepare(
      'DELETE FROM story_event_anchors WHERE project_id = ? AND anchor_id = ?',
    ).run(projectId, anchorId);
    return Number(result.changes) > 0;
  }
}

function validateProjectId(value: string): void {
  if (!value.trim()) throw new Error('story anchor projectId is required');
}

function validatePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be an integer >= 1`);
}

function validateInteger(value: number, field: string): void {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
}

function parseRow(row: RawAnchorRow): StoryEventAnchor {
  return {
    projectId: row.project_id,
    anchorId: row.anchor_id,
    origin: row.origin,
    mapId: row.map_id,
    eventId: row.event_id ?? undefined,
    eventName: row.event_name ?? undefined,
    x: row.x ?? undefined,
    y: row.y ?? undefined,
    eventRid: row.event_rid ?? undefined,
    baselineVersion: row.baseline_version ?? undefined,
    currentShell: row.current_shell ? JSON.parse(row.current_shell) : undefined,
    baselineShell: row.baseline_shell ? JSON.parse(row.baseline_shell) : undefined,
    currentShellFingerprint: row.current_shell_fingerprint ?? undefined,
    baselineShellFingerprint: row.baseline_shell_fingerprint ?? undefined,
    integrityStatus: row.integrity_status,
    detail: row.detail ? JSON.parse(row.detail) : undefined,
  };
}

function jsonFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
