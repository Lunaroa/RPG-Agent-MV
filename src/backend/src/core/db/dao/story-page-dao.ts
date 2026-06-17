import { getDatabase } from '../pool.ts';
import type {
  StoryIntegrityStatus,
  StoryPage,
  StoryPageHistoryEntry,
} from '../../../../../contract/types.ts';

// 页 DAO（story_pages）：剧情原子单位。当前默认流程不再区分原创/MOD；
// baseline/origin 字段仅保留历史兼容与旧数据读取。
// contract_id/scene_id 为逻辑引用（不硬 FK）；anchor_id 硬 FK ON DELETE CASCADE（锚点删 → 页随删）。

interface RawPageRow {
  project_id: string;
  page_node_id: string;
  anchor_id: string;
  origin: StoryPage['origin'];
  page_ref: string;
  page_uid: string | null;
  order_hint: number | null;
  contract_id: string | null;
  scene_id: string | null;
  gating: string | null;
  current_page: string | null;
  baseline_page: string | null;
  current_fingerprint: string | null;
  baseline_fingerprint: string | null;
  integrity_status: StoryIntegrityStatus;
  last_synced_at: string | null;
  detail: string | null;
  row_version: number;
}

interface RawHistoryRow {
  history_id: number;
  project_id: string;
  page_node_id: string;
  action: StoryPageHistoryEntry['action'];
  before_page: string | null;
  after_page: string | null;
  before_fingerprint: string | null;
  after_fingerprint: string | null;
  actor_type: StoryPageHistoryEntry['actorType'];
  actor_id: string | null;
  session_id: string | null;
  created_at: string;
}

export class StoryPageDao {
  static listByProject(projectId: string): StoryPage[] {
    const rows = getDatabase().prepare(
      'SELECT * FROM story_pages WHERE project_id = ? ORDER BY anchor_id, order_hint, page_node_id',
    ).all(projectId) as unknown as RawPageRow[];
    return rows.map(parseRow);
  }

  static listByAnchor(projectId: string, anchorId: string): StoryPage[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM story_pages WHERE project_id = ? AND anchor_id = ? ORDER BY order_hint, page_node_id',
    ).all(projectId, anchorId) as unknown as RawPageRow[];
    return rows.map(parseRow);
  }

  static listByScene(projectId: string, sceneId: string): StoryPage[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM story_pages WHERE project_id = ? AND scene_id = ? ORDER BY anchor_id, order_hint, page_node_id',
    ).all(projectId, sceneId) as unknown as RawPageRow[];
    return rows.map(parseRow);
  }

  static get(projectId: string, pageNodeId: string): StoryPage | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT * FROM story_pages WHERE project_id = ? AND page_node_id = ?',
    ).get(projectId, pageNodeId) as RawPageRow | undefined;
    return row ? parseRow(row) : null;
  }

  static getByUid(projectId: string, pageUid: string): StoryPage | null {
    const row = getDatabase().prepare(
      'SELECT * FROM story_pages WHERE project_id = ? AND page_uid = ?',
    ).get(projectId, pageUid) as RawPageRow | undefined;
    return row ? parseRow(row) : null;
  }

  static upsert(page: StoryPage): StoryPage {
    const db = getDatabase();
    const pageNodeId = page.pageNodeId?.trim()
      || `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    validatePageIdentity(page);
    db.prepare(`
      INSERT INTO story_pages (
        project_id, page_node_id, anchor_id, origin, page_ref, page_uid, order_hint,
        contract_id, scene_id, gating, current_page, baseline_page,
        current_fingerprint, baseline_fingerprint, integrity_status, last_synced_at,
        detail, row_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(project_id, page_node_id) DO UPDATE SET
        anchor_id = excluded.anchor_id,
        origin = excluded.origin,
        page_ref = excluded.page_ref,
        page_uid = excluded.page_uid,
        order_hint = excluded.order_hint,
        contract_id = excluded.contract_id,
        scene_id = excluded.scene_id,
        gating = excluded.gating,
        current_page = excluded.current_page,
        baseline_page = COALESCE(story_pages.baseline_page, excluded.baseline_page),
        current_fingerprint = excluded.current_fingerprint,
        baseline_fingerprint = COALESCE(story_pages.baseline_fingerprint, excluded.baseline_fingerprint),
        integrity_status = excluded.integrity_status,
        last_synced_at = excluded.last_synced_at,
        detail = excluded.detail,
        row_version = story_pages.row_version + 1
    `).run(
      page.projectId,
      pageNodeId,
      page.anchorId,
      page.origin,
      page.pageRef,
      page.pageUid ?? null,
      page.orderHint ?? null,
      page.contractId ?? null,
      page.sceneId ?? null,
      page.gating ? JSON.stringify(page.gating) : null,
      page.currentPage ? JSON.stringify(page.currentPage) : null,
      page.baselinePage ? JSON.stringify(page.baselinePage) : null,
      page.currentFingerprint ?? null,
      page.baselineFingerprint ?? null,
      page.integrityStatus,
      page.lastSyncedAt ?? new Date().toISOString(),
      page.detail ? JSON.stringify(page.detail) : null,
    );
    return this.get(page.projectId, pageNodeId)!;
  }

  static updateOrigin(
    projectId: string,
    pageNodeId: string,
    origin: StoryPage['origin'],
    pageUid?: string,
  ): StoryPage {
    const existing = this.get(projectId, pageNodeId);
    if (!existing) throw new Error(`Story page not found: ${projectId}/${pageNodeId}`);
    const nextUid = origin === 'baseline' ? undefined : pageUid || existing.pageUid;
    if (origin !== 'baseline' && !nextUid) throw new Error('editable story page requires pageUid');
    const baselinePage = origin === 'baseline' ? existing.baselinePage || existing.currentPage : undefined;
    const baselineFingerprint = origin === 'baseline'
      ? existing.baselineFingerprint || existing.currentFingerprint
      : undefined;
    return this.upsert({
      ...existing,
      origin,
      pageUid: nextUid,
      pageRef: origin === 'baseline' ? String(baselineFingerprint || existing.pageRef) : String(nextUid),
      baselinePage,
      baselineFingerprint,
      integrityStatus: 'synced',
    });
  }

  static markMissing(projectId: string, pageNodeId: string, status: StoryIntegrityStatus): void {
    getDatabase().prepare(`
      UPDATE story_pages
      SET integrity_status = ?, current_page = NULL, current_fingerprint = NULL,
          last_synced_at = ?, row_version = row_version + 1
      WHERE project_id = ? AND page_node_id = ?
    `).run(status, new Date().toISOString(), projectId, pageNodeId);
  }

  static addHistory(entry: Omit<StoryPageHistoryEntry, 'historyId' | 'createdAt'>): void {
    getDatabase().prepare(`
      INSERT INTO story_page_history (
        project_id, page_node_id, action, before_page, after_page,
        before_fingerprint, after_fingerprint, actor_type, actor_id, session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.projectId,
      entry.pageNodeId,
      entry.action,
      entry.beforePage ? JSON.stringify(entry.beforePage) : null,
      entry.afterPage ? JSON.stringify(entry.afterPage) : null,
      entry.beforeFingerprint ?? null,
      entry.afterFingerprint ?? null,
      entry.actorType,
      entry.actorId ?? null,
      entry.sessionId ?? null,
      new Date().toISOString(),
    );
  }

  static listHistory(projectId: string, pageNodeId: string): StoryPageHistoryEntry[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM story_page_history
      WHERE project_id = ? AND page_node_id = ?
      ORDER BY created_at DESC, history_id DESC
    `).all(projectId, pageNodeId) as unknown as RawHistoryRow[];
    return rows.map((row) => ({
      historyId: row.history_id,
      projectId: row.project_id,
      pageNodeId: row.page_node_id,
      action: row.action,
      beforePage: row.before_page ? JSON.parse(row.before_page) : undefined,
      afterPage: row.after_page ? JSON.parse(row.after_page) : undefined,
      beforeFingerprint: row.before_fingerprint ?? undefined,
      afterFingerprint: row.after_fingerprint ?? undefined,
      actorType: row.actor_type,
      actorId: row.actor_id ?? undefined,
      sessionId: row.session_id ?? undefined,
      createdAt: row.created_at,
    }));
  }

  /** 把页关联到某个事件契约语义标签/节拍标签（或传 null 解除关联）。 */
  static assignScene(projectId: string, pageNodeId: string, sceneId: string | null): boolean {
    const result = getDatabase().prepare(
      'UPDATE story_pages SET scene_id = ? WHERE project_id = ? AND page_node_id = ?',
    ).run(sceneId, projectId, pageNodeId);
    return Number(result.changes) > 0;
  }

  static delete(projectId: string, pageNodeId: string): boolean {
    const result = getDatabase().prepare(
      'DELETE FROM story_pages WHERE project_id = ? AND page_node_id = ?',
    ).run(projectId, pageNodeId);
    return Number(result.changes) > 0;
  }
}

function parseRow(row: RawPageRow): StoryPage {
  return {
    projectId: row.project_id,
    pageNodeId: row.page_node_id,
    anchorId: row.anchor_id,
    origin: row.origin,
    pageRef: row.page_ref,
    pageUid: row.page_uid ?? undefined,
    orderHint: row.order_hint ?? undefined,
    contractId: row.contract_id ?? undefined,
    sceneId: row.scene_id ?? undefined,
    gating: row.gating ? JSON.parse(row.gating) : undefined,
    currentPage: row.current_page ? JSON.parse(row.current_page) : undefined,
    baselinePage: row.baseline_page ? JSON.parse(row.baseline_page) : undefined,
    currentFingerprint: row.current_fingerprint ?? undefined,
    baselineFingerprint: row.baseline_fingerprint ?? undefined,
    integrityStatus: row.integrity_status,
    lastSyncedAt: row.last_synced_at ?? undefined,
    detail: row.detail ? JSON.parse(row.detail) : undefined,
    rowVersion: row.row_version,
  };
}

function validatePageIdentity(page: StoryPage): void {
  if (!page.projectId.trim()) throw new Error('story page projectId is required');
  if (!page.anchorId.trim()) throw new Error('story page anchorId is required');
  if (!page.pageRef.trim()) throw new Error('story page pageRef is required');
  if (page.origin === 'baseline') {
    if (page.pageUid) throw new Error('baseline story page must not have pageUid');
    if (!page.baselinePage || !page.baselineFingerprint) {
      throw new Error('baseline story page requires baselinePage and baselineFingerprint');
    }
  } else if (!page.pageUid?.trim()) {
    throw new Error('editable story page requires pageUid');
  }
}
