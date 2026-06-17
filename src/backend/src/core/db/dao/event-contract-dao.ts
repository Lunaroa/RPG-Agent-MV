// Event Contract 数据访问对象
//
// 表自 migration v4 起以自增整数 `rid` 为主键，`contract_id`（点号命名）为唯一副键。
// 返回对象同时暴露 `rid`、`contract_id`，并保留 `id`（= contract_id）兼容旧调用。
import { getDatabase } from '../pool.ts';

export interface EventContract {
  rid: number;
  /** 兼容字段：等于 contract_id */
  id: string;
  contract_id: string;
  project_id: string;
  contract: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

interface EventContractRow {
  rid: number;
  contract_id: string;
  project_id: string;
  contract: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function hydrate(row: EventContractRow): EventContract {
  return {
    rid: row.rid,
    id: row.contract_id,
    contract_id: row.contract_id,
    project_id: row.project_id,
    contract: JSON.parse(row.contract),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class EventContractDao {
  /**
   * 获取项目的所有 contracts（按 rid 升序，等价于注册顺序）
   */
  static listByProject(projectId: string): EventContract[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM event_contracts WHERE project_id = ? ORDER BY rid'
    ).all(projectId) as unknown as EventContractRow[];
    return rows.map(hydrate);
  }

  /**
   * 获取所有 contracts
   */
  static list(): EventContract[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM event_contracts ORDER BY rid').all() as unknown as EventContractRow[];
    return rows.map(hydrate);
  }

  /**
   * 按 contract_id 获取单个 contract
   */
  static get(contractId: string): EventContract | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM event_contracts WHERE contract_id = ?').get(contractId) as EventContractRow | undefined;
    return row ? hydrate(row) : null;
  }

  /**
   * 按自增主键 rid 获取单个 contract
   */
  static getByRid(rid: number): EventContract | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM event_contracts WHERE rid = ?').get(rid) as EventContractRow | undefined;
    return row ? hydrate(row) : null;
  }

  /**
   * 创建 contract。若 contract.rid 已分配则显式写入主键，
   * 否则交给 SQLite autoincrement 分配。
   */
  static create(contractId: string, projectId: string, contract: Record<string, unknown>, status: string = 'draft'): EventContract {
    const db = getDatabase();
    const now = new Date().toISOString();
    const rid = contract.rid;

    if (Number.isInteger(rid)) {
      db.prepare(`
        INSERT INTO event_contracts (rid, contract_id, project_id, contract, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(rid as number, contractId, projectId, JSON.stringify(contract), status, now, now);
    } else {
      db.prepare(`
        INSERT INTO event_contracts (contract_id, project_id, contract, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(contractId, projectId, JSON.stringify(contract), status, now, now);
    }

    return this.get(contractId)!;
  }

  /**
   * 按 contract_id 更新 contract（不改 rid）
   */
  static update(contractId: string, contract: Record<string, unknown>, status?: string): EventContract | null {
    const db = getDatabase();
    const now = new Date().toISOString();

    if (status) {
      db.prepare(`
        UPDATE event_contracts
        SET contract = ?, status = ?, updated_at = ?
        WHERE contract_id = ?
      `).run(JSON.stringify(contract), status, now, contractId);
    } else {
      db.prepare(`
        UPDATE event_contracts
        SET contract = ?, updated_at = ?
        WHERE contract_id = ?
      `).run(JSON.stringify(contract), now, contractId);
    }

    return this.get(contractId);
  }

  /**
   * 按 contract_id 删除 contract
   */
  static delete(contractId: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM event_contracts WHERE contract_id = ?').run(contractId);
    return result.changes > 0;
  }

  /** 当前库内已分配的最大 rid（无则 0）。 */
  static maxRid(): number {
    const db = getDatabase();
    const row = db.prepare('SELECT MAX(rid) AS max FROM event_contracts').get() as { max: number | null };
    return Number.isInteger(row?.max) ? (row.max as number) : 0;
  }

  /**
   * 检查 contract 是否存在
   */
  static exists(contractId: string): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT 1 FROM event_contracts WHERE contract_id = ?').get(contractId);
    return !!row;
  }

  /**
   * 获取指定状态的 contracts
   */
  static listByStatus(status: string): EventContract[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM event_contracts WHERE status = ? ORDER BY rid'
    ).all(status) as unknown as EventContractRow[];
    return rows.map(hydrate);
  }
}
