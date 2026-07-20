// Event Feedback 数据访问对象
//
// 自进化闭环的人类评估反馈：把作者对某个 EventContract 的裁决（接受/要改/拒）、
// rubric 标签（固定枚举 + 自由标签混存于 JSON 数组）、原因落库，并关联到 contract 与会话 trace。
// session_id = 桌面会话 id，可定位该轮 agent-console 下的新 events.jsonl(.gz) 或旧 events.json。
import { getDatabase } from '../pool.ts';

export type FeedbackVerdict = 'accept' | 'revise' | 'reject';

/**
 * 固定 rubric 标签（对齐自进化方案 §5.4 标签→进化对象路由表）。
 * tags 字段同时接受这些之外的自由标签：固定枚举给快捷选项且可聚合统计，
 * 自由标签兜住枚举没覆盖的新问题；累积到一定频次可考虑提升为固定枚举。
 */
export const RUBRIC_TAGS = [
  'tone-drift',        // 语气漂移 → 角色口吻层
  'staging-weak',      // 干堆台词 / 缺停顿气泡音效 / 缺走位 → story-writing-constraints 演出节奏
  'choice-meaningless',// 选择分支没意义 → story-writing-constraints 分支设计
  'npc-proper-name',   // 次要 NPC 用了专名 → story-writing-constraints
  'positive',          // 台词好（正向）→ 可升格为黄金示例/voiceSamples
] as const;

export interface EventFeedback {
  rid: number;
  project_id: string;
  contract_id: string;
  session_id: string | null;
  verdict: FeedbackVerdict;
  tags: string[];
  note: string | null;
  created_at: string;
}

interface EventFeedbackRow {
  rid: number;
  project_id: string;
  contract_id: string;
  session_id: string | null;
  verdict: string;
  tags: string;
  note: string | null;
  created_at: string;
}

function hydrate(row: EventFeedbackRow): EventFeedback {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.map((t) => String(t));
  } catch {
    // 容错：tags 损坏时返回空数组，不阻断读取
  }
  return {
    rid: row.rid,
    project_id: row.project_id,
    contract_id: row.contract_id,
    session_id: row.session_id,
    verdict: row.verdict as FeedbackVerdict,
    tags,
    note: row.note,
    created_at: row.created_at,
  };
}

export interface FeedbackSummary {
  total: number;
  /** 不满意率 = (revise + reject) / total */
  dissatisfactionRate: number;
  byVerdict: Record<FeedbackVerdict, number>;
  /** 标签 → 出现次数，按频次降序 */
  tagCounts: Array<{ tag: string; count: number }>;
}

export class EventFeedbackDao {
  /** 录入一条反馈。tags 为固定枚举 + 自由标签混合数组。 */
  static record(input: {
    projectId: string;
    contractId: string;
    verdict: FeedbackVerdict;
    tags?: string[];
    note?: string | null;
    sessionId?: string | null;
  }): EventFeedback {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tags = JSON.stringify(input.tags ?? []);
    const result = db.prepare(`
      INSERT INTO event_feedback (project_id, contract_id, session_id, verdict, tags, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.projectId,
      input.contractId,
      input.sessionId ?? null,
      input.verdict,
      tags,
      input.note ?? null,
      now,
    );
    return this.getByRid(Number(result.lastInsertRowid))!;
  }

  static getByRid(rid: number): EventFeedback | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM event_feedback WHERE rid = ?').get(rid) as EventFeedbackRow | undefined;
    return row ? hydrate(row) : null;
  }

  static listByProject(projectId: string): EventFeedback[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM event_feedback WHERE project_id = ? ORDER BY rid',
    ).all(projectId) as unknown as EventFeedbackRow[];
    return rows.map(hydrate);
  }

  static listByContract(projectId: string, contractId: string): EventFeedback[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM event_feedback WHERE project_id = ? AND contract_id = ? ORDER BY rid',
    ).all(projectId, contractId) as unknown as EventFeedbackRow[];
    return rows.map(hydrate);
  }

  /** 聚合统计：不满意率 + verdict 分布 + 标签频次（tags 是 JSON，故在 JS 侧聚合）。 */
  static summary(projectId: string): FeedbackSummary {
    const all = this.listByProject(projectId);
    const byVerdict: Record<FeedbackVerdict, number> = { accept: 0, revise: 0, reject: 0 };
    const tagMap = new Map<string, number>();
    for (const fb of all) {
      byVerdict[fb.verdict] += 1;
      for (const tag of fb.tags) tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
    const total = all.length;
    const dissatisfied = byVerdict.revise + byVerdict.reject;
    return {
      total,
      dissatisfactionRate: total > 0 ? dissatisfied / total : 0,
      byVerdict,
      tagCounts: [...tagMap.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
}
