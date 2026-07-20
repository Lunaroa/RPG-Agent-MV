// 数据库迁移管理
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, type WorkflowDatabase } from './pool.ts';

interface Migration {
  version: number;
  name: string;
  up: string | ((db: WorkflowDatabase) => void);
}

const EVENT_CONTRACTS_RID_MIGRATION_SQL = `
  ALTER TABLE event_contracts RENAME TO event_contracts_pre_rid;
  CREATE TABLE event_contracts (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id TEXT UNIQUE NOT NULL,
    project_id TEXT NOT NULL,
    contract TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO event_contracts (contract_id, project_id, contract, status, created_at, updated_at)
    SELECT id, project_id, contract, status, created_at, updated_at FROM event_contracts_pre_rid ORDER BY created_at, id;
  DROP TABLE event_contracts_pre_rid;
  CREATE INDEX IF NOT EXISTS idx_event_contracts_project ON event_contracts(project_id);
  CREATE INDEX IF NOT EXISTS idx_event_contracts_status ON event_contracts(status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_event_contracts_contract_id ON event_contracts(contract_id);
`;

const STORY_TASK_SCENE_CONTRACTS_MIGRATION_SQL = `
  ALTER TABLE story_tasks RENAME TO story_tasks_pre_scene_contracts;
  CREATE TABLE story_tasks (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    map_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    priority TEXT NOT NULL DEFAULT 'normal',
    contract_id TEXT,
    task TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, id)
  );
  INSERT INTO story_tasks (id, project_id, map_id, status, priority, contract_id, task, created_at, updated_at)
    SELECT id, project_id, map_id, status, priority, contract_id, task, created_at, updated_at
    FROM story_tasks_pre_scene_contracts;
  CREATE TABLE story_task_contracts (
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    required INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, task_id, contract_id),
    FOREIGN KEY (project_id, task_id) REFERENCES story_tasks(project_id, id) ON DELETE CASCADE
  );
  INSERT OR IGNORE INTO story_task_contracts (project_id, task_id, contract_id, required, created_at)
    SELECT project_id, id, contract_id, 1, created_at
    FROM story_tasks_pre_scene_contracts
    WHERE contract_id IS NOT NULL AND trim(contract_id) <> '';
  DROP TABLE story_tasks_pre_scene_contracts;
  CREATE INDEX IF NOT EXISTS idx_story_tasks_project ON story_tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_story_tasks_map ON story_tasks(project_id, map_id);
  CREATE INDEX IF NOT EXISTS idx_story_tasks_status ON story_tasks(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_story_tasks_priority ON story_tasks(project_id, priority);
  CREATE INDEX IF NOT EXISTS idx_story_tasks_contract ON story_tasks(project_id, contract_id);
  CREATE INDEX IF NOT EXISTS idx_story_task_contracts_contract ON story_task_contracts(project_id, contract_id);
`;

// 剧情模块数据库重建（v7）：按目标模型「地图 ► 事件 ► 页」干净重建。
// 旧的 story_tasks / story_outline / story_task_contracts 直接 drop（不保数据，已与用户确认）。
// v8 会把结构化 story_outline_* 再收敛为 Markdown 创意大纲。注意：
//  - row_version = 行级乐观锁（编辑该行才 +1），与游戏版本无关；原版基线版本是 baseline_version。
//  - 锚点 origin 明确区分 baseline/original/mod；event_rid 只用于 MOD 事件稳定身份。
//  - page.scene_id / page.contract_id 为「逻辑引用」不设硬 FK：被引用对象删除时要上报断链，不让外键挡住编辑。
//  - 设硬 FK 的仅一处：页→锚点(ON DELETE CASCADE)。
const STORY_MODULE_REBUILD_MIGRATION_SQL = `
  DROP TABLE IF EXISTS story_task_contracts;
  DROP TABLE IF EXISTS story_tasks;
  DROP TABLE IF EXISTS story_outline;

  CREATE TABLE story_projects (
    project_id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK (mode IN ('original', 'mod')),
    default_origin TEXT NOT NULL CHECK (default_origin IN ('original', 'mod')),
    baseline_version TEXT,
    baseline_project_path TEXT,
    initialized_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
      (mode = 'original' AND default_origin = 'original' AND baseline_version IS NULL AND baseline_project_path IS NULL)
      OR
      (mode = 'mod' AND default_origin = 'mod' AND baseline_version IS NOT NULL AND trim(baseline_version) <> ''
        AND baseline_project_path IS NOT NULL AND trim(baseline_project_path) <> '')
    )
  );
  CREATE INDEX idx_story_projects_path ON story_projects(project_path);

  CREATE TABLE story_outline_meta (
    project_id TEXT PRIMARY KEY,
    title TEXT,
    logline TEXT,
    premise TEXT,
    theme TEXT,
    open_questions TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE story_outline_scenes (
    project_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    order_key TEXT,
    title TEXT,
    description TEXT,
    detail TEXT,
    state_change TEXT,
    maps TEXT,
    characters TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, scene_id)
  );

  CREATE TABLE story_outline_characters (
    project_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    name TEXT,
    want TEXT,
    need TEXT,
    flaw TEXT,
    arc TEXT,
    relationships TEXT,
    notes TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (project_id, character_id)
  );

  CREATE TABLE story_outline_state_slots (
    project_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    name TEXT,
    kind TEXT,
    purpose TEXT,
    beats TEXT,
    PRIMARY KEY (project_id, slot_id)
  );

  CREATE TABLE story_event_anchors (
    project_id TEXT NOT NULL,
    anchor_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('baseline', 'original', 'mod')),
    map_id INTEGER NOT NULL CHECK (map_id >= 1),
    event_id INTEGER,
    event_name TEXT,
    x INTEGER,
    y INTEGER,
    event_rid INTEGER,
    baseline_version TEXT,
    current_shell TEXT,
    baseline_shell TEXT,
    current_shell_fingerprint TEXT,
    baseline_shell_fingerprint TEXT,
    integrity_status TEXT NOT NULL DEFAULT 'synced'
      CHECK (integrity_status IN ('synced', 'baseline-modified', 'baseline-deleted', 'missing', 'sync-error')),
    detail TEXT,
    PRIMARY KEY (project_id, anchor_id),
    CHECK (
      (
        origin = 'baseline'
        AND event_rid IS NULL
        AND baseline_version IS NOT NULL AND trim(baseline_version) <> ''
        AND event_id IS NOT NULL AND event_id >= 1
        AND event_name IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL
      ) OR (
        origin IN ('original', 'mod')
        AND baseline_version IS NULL
        AND event_id IS NOT NULL AND event_id >= 1
        AND event_name IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL
        AND (event_rid IS NULL OR event_rid >= 1)
      )
    )
  );
  CREATE INDEX idx_story_anchors_map_event ON story_event_anchors(project_id, map_id, event_id, anchor_id);
  CREATE UNIQUE INDEX idx_story_anchors_baseline_natural
    ON story_event_anchors(project_id, baseline_version, map_id, event_id)
    WHERE origin = 'baseline';
  CREATE UNIQUE INDEX idx_story_anchors_mod_rid
    ON story_event_anchors(project_id, event_rid)
    WHERE event_rid IS NOT NULL;
  CREATE UNIQUE INDEX idx_story_anchors_live_event
    ON story_event_anchors(project_id, map_id, event_id);

  CREATE TABLE story_pages (
    project_id TEXT NOT NULL,
    page_node_id TEXT NOT NULL,
    anchor_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('baseline', 'original', 'mod')),
    page_ref TEXT NOT NULL,
    page_uid TEXT,
    order_hint INTEGER,
    contract_id TEXT,
    scene_id TEXT,
    gating TEXT,
    current_page TEXT,
    baseline_page TEXT,
    current_fingerprint TEXT,
    baseline_fingerprint TEXT,
    integrity_status TEXT NOT NULL DEFAULT 'synced'
      CHECK (integrity_status IN ('synced', 'baseline-modified', 'baseline-deleted', 'missing', 'sync-error')),
    last_synced_at TEXT,
    detail TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (project_id, page_node_id),
    CHECK (
      (origin = 'baseline' AND page_uid IS NULL AND baseline_page IS NOT NULL AND baseline_fingerprint IS NOT NULL)
      OR
      (origin IN ('original', 'mod') AND page_uid IS NOT NULL AND trim(page_uid) <> '')
    ),
    FOREIGN KEY (project_id, anchor_id) REFERENCES story_event_anchors(project_id, anchor_id) ON DELETE CASCADE
  );
  CREATE INDEX idx_story_pages_anchor ON story_pages(project_id, anchor_id, order_hint, page_node_id);
  CREATE INDEX idx_story_pages_contract ON story_pages(project_id, contract_id, page_node_id);
  CREATE INDEX idx_story_pages_scene ON story_pages(project_id, scene_id, anchor_id, order_hint, page_node_id);
  CREATE UNIQUE INDEX idx_story_pages_uid ON story_pages(project_id, page_uid) WHERE page_uid IS NOT NULL;

  CREATE TABLE story_page_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    page_node_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored', 'origin-changed')),
    before_page TEXT,
    after_page TEXT,
    before_fingerprint TEXT,
    after_fingerprint TEXT,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'user', 'external', 'system')),
    actor_id TEXT,
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_story_page_history_page
    ON story_page_history(project_id, page_node_id, created_at DESC, history_id DESC);

  CREATE TABLE story_integrity_issues (
    issue_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('project', 'event', 'page', 'scene', 'contract')),
    scope_id TEXT NOT NULL,
    code TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
    message TEXT NOT NULL,
    map_id INTEGER,
    event_id INTEGER,
    page_node_id TEXT,
    detail TEXT,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  CREATE UNIQUE INDEX idx_story_integrity_issue_active
    ON story_integrity_issues(project_id, scope_type, scope_id, code)
    WHERE resolved_at IS NULL;
  CREATE INDEX idx_story_integrity_issue_project
    ON story_integrity_issues(project_id, resolved_at, severity, detected_at DESC, issue_id);

  DROP INDEX IF EXISTS idx_event_contracts_contract_id;
  DROP INDEX IF EXISTS idx_event_contracts_project;
  DROP INDEX IF EXISTS idx_event_contracts_status;
  CREATE INDEX idx_event_contracts_project ON event_contracts(project_id, rid);
  CREATE INDEX idx_event_contracts_status ON event_contracts(status, rid);

  DROP INDEX IF EXISTS idx_map_selections_project;
  CREATE INDEX idx_map_selections_project ON map_selections(project_id, created_at DESC, id DESC);
  DROP INDEX IF EXISTS idx_staging_manifests_project;
  CREATE INDEX idx_staging_manifests_project ON staging_manifests(project_id, updated_at DESC, id DESC);
`;

const STORY_OUTLINE_MARKDOWN_MIGRATION_SQL = `
  DROP TABLE IF EXISTS story_outline_meta;
  DROP TABLE IF EXISTS story_outline_scenes;
  DROP TABLE IF EXISTS story_outline_characters;
  DROP TABLE IF EXISTS story_outline_state_slots;
  DROP TABLE IF EXISTS story_outline;

  CREATE TABLE story_outline (
    project_id TEXT PRIMARY KEY,
    title TEXT,
    body TEXT NOT NULL DEFAULT '',
    updated_by TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function dropOldStoryBoardArtifacts(db: WorkflowDatabase): void {
  db.exec(`
    DROP TABLE IF EXISTS story_block_contracts;
    DROP TABLE IF EXISTS story_blocks;
    DROP INDEX IF EXISTS idx_story_anchors_block;
  `);
  if (tableExists(db, 'story_event_anchors') && tableColumns(db, 'story_event_anchors').has('block_id')) {
    db.exec('ALTER TABLE story_event_anchors DROP COLUMN block_id');
  }
  if (tableExists(db, 'story_integrity_issues') && tableColumns(db, 'story_integrity_issues').has('block_id')) {
    db.exec('ALTER TABLE story_integrity_issues DROP COLUMN block_id');
  }
}

function tableExists(db: WorkflowDatabase, name: string): boolean {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
  ).get(name);
}

function tableColumns(db: WorkflowDatabase, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function storyTasksUsesCompositePrimaryKey(db: WorkflowDatabase): boolean {
  const rows = db.prepare('PRAGMA table_info(story_tasks)').all() as { name: string; pk: number }[];
  const pkCols = rows.filter((row) => row.pk > 0).map((row) => row.name);
  return pkCols.includes('project_id') && pkCols.includes('id');
}

/**
 * 修复历史数据库中版本记录与实际表形状不一致、以及 v3/v5
 * 在 story_tasks 已存在但缺 contract_id 时无法继续执行所导致的 schema 漂移。
 *
 * `before`：仅补齐阻塞后续 migration 的列，避免与 v5 整表重建重复执行。
 * `after`：在 migration 跑完后兜底 composite PK 与 story_task_contracts。
 */
export function reconcileSchemaDrift(
  db: WorkflowDatabase = getDatabase(),
  phase: 'before' | 'after' = 'after',
): void {
  if (phase === 'before') {
    if (tableExists(db, 'story_tasks') && !tableColumns(db, 'story_tasks').has('contract_id')) {
      db.exec('ALTER TABLE story_tasks ADD COLUMN contract_id TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_story_tasks_contract ON story_tasks(project_id, contract_id)');
    }
    const appliedVersion = tableExists(db, 'migrations')
      ? (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM migrations').get() as { version: number }).version
      : 0;
    if (appliedVersion >= 4
      && tableExists(db, 'event_contracts') && !tableColumns(db, 'event_contracts').has('contract_id')) {
      const cols = tableColumns(db, 'event_contracts');
      if (cols.has('id')) db.exec(EVENT_CONTRACTS_RID_MIGRATION_SQL);
    }
    return;
  }

  if (tableExists(db, 'event_contracts') && !tableColumns(db, 'event_contracts').has('contract_id')) {
    const cols = tableColumns(db, 'event_contracts');
    if (cols.has('id')) {
      db.exec(EVENT_CONTRACTS_RID_MIGRATION_SQL);
    }
  }

  if (!tableExists(db, 'story_tasks')) return;

  if (!tableColumns(db, 'story_tasks').has('contract_id')) {
    db.exec('ALTER TABLE story_tasks ADD COLUMN contract_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_story_tasks_contract ON story_tasks(project_id, contract_id)');
  }

  if (!storyTasksUsesCompositePrimaryKey(db)) {
    db.exec(STORY_TASK_SCENE_CONTRACTS_MIGRATION_SQL);
    return;
  }

  const storyTaskContractsDrifted =
    tableExists(db, 'story_task_contracts')
    && !tableColumns(db, 'story_task_contracts').has('contract_id');
  if (storyTaskContractsDrifted) {
    db.exec('DROP TABLE story_task_contracts');
  }
  if (!tableExists(db, 'story_task_contracts')) {
    db.exec(`
      CREATE TABLE story_task_contracts (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (project_id, task_id, contract_id),
        FOREIGN KEY (project_id, task_id) REFERENCES story_tasks(project_id, id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO story_task_contracts (project_id, task_id, contract_id, required, created_at)
        SELECT project_id, id, contract_id, 1, created_at
        FROM story_tasks
        WHERE contract_id IS NOT NULL AND trim(contract_id) <> '';
      CREATE INDEX IF NOT EXISTS idx_story_task_contracts_contract ON story_task_contracts(project_id, contract_id);
    `);
  }
}

/**
 * 获取当前数据库版本
 */
export function getDatabaseVersion(): number {
  const db = getDatabase();

  // 检查 migrations 表是否存在
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
  ).get();

  if (!tableExists) {
    return 0;
  }

  const row = db.prepare('SELECT MAX(version) as version FROM migrations').get() as { version: number } | undefined;
  return row?.version || 0;
}

/**
 * 执行迁移
 */
export function migrate(): void {
  const db = getDatabase();

  // 创建 migrations 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  reconcileSchemaDrift(db, 'before');

  const currentVersion = getDatabaseVersion();
  const migrations = getMigrations();
  let migrated = false;

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      migrated = true;
      console.log(`[db] Running migration ${migration.version}: ${migration.name}`);

      // 在事务中执行迁移
      db.transaction(() => {
        if (typeof migration.up === 'function') {
          migration.up(db);
        } else {
          db.exec(migration.up);
        }
        db.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
      })();
    }
  }

  reconcileSchemaDrift(db, 'after');

  if (migrated) {
    console.log(`[db] Database at version ${getDatabaseVersion()}`);
  }
}

/**
 * 获取所有迁移
 */
function getMigrations(): Migration[] {
  // 这里可以扩展为从文件读取迁移
  return [
    {
      version: 1,
      name: 'initial_schema',
      up: fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8')
    },
    {
      version: 2,
      name: 'event_contract_status_is_domain_owned',
      up: `
        ALTER TABLE event_contracts RENAME TO event_contracts_v1;
        CREATE TABLE event_contracts (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          contract TEXT NOT NULL,
          status TEXT DEFAULT 'draft',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO event_contracts (id, project_id, contract, status, created_at, updated_at)
          SELECT id, project_id, contract, status, created_at, updated_at FROM event_contracts_v1;
        DROP TABLE event_contracts_v1;
        CREATE INDEX IF NOT EXISTS idx_event_contracts_project ON event_contracts(project_id);
        CREATE INDEX IF NOT EXISTS idx_event_contracts_status ON event_contracts(status);
      `
    },
    {
      version: 3,
      name: 'story_tasks',
      up: `
        CREATE TABLE IF NOT EXISTS story_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          map_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'planned',
          priority TEXT NOT NULL DEFAULT 'normal',
          contract_id TEXT,
          task TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_story_tasks_project ON story_tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_story_tasks_map ON story_tasks(project_id, map_id);
        CREATE INDEX IF NOT EXISTS idx_story_tasks_status ON story_tasks(project_id, status);
        CREATE INDEX IF NOT EXISTS idx_story_tasks_priority ON story_tasks(project_id, priority);
        CREATE INDEX IF NOT EXISTS idx_story_tasks_contract ON story_tasks(project_id, contract_id);
      `
    },
    {
      // event_contracts 主键从 contract_id(TEXT) 改为自增整数 rid；contract_id 退为唯一副键。
      // rid 作为稳定身份锚点，不随 contract_id 改名/复用漂移。
      // 注意：把 rid 回填进每行 contract JSON 的步骤在 SQL 之外（见 backfillEventContractRids）。
      version: 4,
      name: 'event_contract_autoincrement_rid',
      up: EVENT_CONTRACTS_RID_MIGRATION_SQL,
    },
    {
      version: 5,
      name: 'story_task_scene_contracts',
      up: (db) => {
        if (!tableColumns(db, 'story_tasks').has('contract_id')) {
          db.exec('ALTER TABLE story_tasks ADD COLUMN contract_id TEXT');
        }
        if (storyTasksUsesCompositePrimaryKey(db) && tableExists(db, 'story_task_contracts')) {
          return;
        }
        db.exec(STORY_TASK_SCENE_CONTRACTS_MIGRATION_SQL);
      },
    },
    {
      // 剧情大纲：项目级单例，每个 project 一行，outline 为结构化 JSON blob。
      // 给"大纲"一个持久化的家（剧情管理的大纲层），与扁平的 story_tasks 并列。
      version: 6,
      name: 'story_outline',
      up: `
        CREATE TABLE IF NOT EXISTS story_outline (
          project_id TEXT PRIMARY KEY,
          outline TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `
    },
    {
      // 剧情模块数据库重建：按目标模型 地图►事件►页 干净重建。
      // drop 旧的 story_tasks/story_outline/story_task_contracts（不保数据），建当前 story_* 表。
      // 旧表的漂移补丁（reconcileSchemaDrift 中 story_tasks 分支）在本迁移后变为 tableExists 守卫下的 no-op。
      version: 7,
      name: 'story_module_rebuild',
      up: STORY_MODULE_REBUILD_MIGRATION_SQL,
    },
    {
      // 大纲降级为 Markdown 创意文本。
      // 破坏性清理旧结构化大纲。
      version: 8,
      name: 'story_outline_markdown',
      up: STORY_OUTLINE_MARKDOWN_MIGRATION_SQL,
    },
    {
      // 自进化闭环：人类评估反馈。作者对某个 EventContract 的裁决（接受/要改/拒）
      // + rubric 标签（固定枚举 + 自由标签混存于 JSON 数组）+ 原因，关联 contract 与会话 trace。
      // contract_id / session_id 为逻辑引用（不设硬 FK）：反馈是审美台账，被评事件即便后续改名/删除，
      // 历史反馈仍应留存可追溯；session_id 可定位 runtime/sessions/*/agent-console 的新旧事件日志。
      version: 9,
      name: 'event_feedback',
      up: `
        CREATE TABLE IF NOT EXISTS event_feedback (
          rid INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          contract_id TEXT NOT NULL,
          session_id TEXT,
          verdict TEXT NOT NULL CHECK (verdict IN ('accept', 'revise', 'reject')),
          tags TEXT NOT NULL DEFAULT '[]',
          note TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_event_feedback_contract ON event_feedback(project_id, contract_id, rid);
        CREATE INDEX IF NOT EXISTS idx_event_feedback_verdict ON event_feedback(project_id, verdict, rid);
        CREATE INDEX IF NOT EXISTS idx_event_feedback_session ON event_feedback(session_id);
      `,
    },
    {
      version: 10,
      name: 'drop_old_story_board_artifacts',
      up: dropOldStoryBoardArtifacts,
    },
    {
      version: 11,
      name: 'event_contract_engine_backfill',
      up: backfillEventContractEngines,
    },
  ];
}

/**
 * Existing contracts predate multi-engine support. They are deterministically
 * MV contracts; keep every other field and all relational metadata untouched.
 */
export function backfillEventContractEngines(db: WorkflowDatabase = getDatabase()): void {
  if (!tableExists(db, 'event_contracts') || !tableColumns(db, 'event_contracts').has('contract')) return;
  const rows = db.prepare('SELECT rid, contract FROM event_contracts ORDER BY rid').all() as Array<{
    rid: number;
    contract: string;
  }>;
  const update = db.prepare('UPDATE event_contracts SET contract = ? WHERE rid = ?');
  for (const row of rows) {
    let contract: Record<string, unknown>;
    try {
      const parsed = JSON.parse(row.contract) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      contract = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (contract.engine !== undefined) continue;
    update.run(JSON.stringify({ ...contract, engine: 'rpg-maker-mv' }), row.rid);
  }
}

/**
 * 把 SQLite 行的 rid 回填进每行 contract JSON。
 *
 * 迁移 v4 只把表结构改成 rid 主键并按 created_at 顺序分配 rid，但 contract
 * 文本里还没有 rid 字段；本函数补齐，使 DB 列 rid == contract.rid。幂等：已对齐则跳过。
 */
export function backfillEventContractRids(_workflowRoot?: string): void {
  const db = getDatabase();
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='event_contracts'",
  ).get();
  const hasRidColumn = tableExists
    ? (db.prepare("PRAGMA table_info(event_contracts)").all() as { name: string }[])
      .some((col) => col.name === 'rid')
    : false;
  if (!hasRidColumn) return;

  const rows = db.prepare('SELECT rid, contract FROM event_contracts').all() as {
    rid: number;
    contract: string;
  }[];
  const update = db.prepare('UPDATE event_contracts SET contract = ? WHERE rid = ?');
  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.contract);
    } catch {
      continue;
    }
    if (parsed.rid !== row.rid) {
      parsed.rid = row.rid;
      update.run(JSON.stringify(parsed), row.rid);
    }
  }
}

/**
 * 重置数据库（危险！仅用于开发）
 */
export function resetDatabase(): void {
  const db = getDatabase();

  // 获取所有表
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all() as { name: string }[];

  // 删除所有表
  for (const table of tables) {
    db.exec(`DROP TABLE IF EXISTS ${table.name}`);
  }

  // 正常初始化只走迁移链；schema.sql 是 v1 历史种子，不应在当前结构上重复执行。
  migrate();
}
