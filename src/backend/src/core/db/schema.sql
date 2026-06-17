-- RMMV Agent Workflow 数据库 Schema
-- 版本: 1（冻结为 v1 迁移链的种子；勿改历史形态）
-- 注意：剧情模块（story_*）的最终形态见 migrate.ts 的 v7/v8 迁移——
--   本文件的 story_tasks 是 v1 旧形态，新库先按此建、再被 v7 drop 并重建为
--   story_projects / story_event_anchors / story_pages / story_page_history / story_integrity_issues；
--   大纲在 v8 收敛为 story_outline Markdown 文本表。

-- Provider 配置（LLM 提供商）
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  config TEXT NOT NULL,  -- JSON
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Event Contracts（事件合同）
-- 注意：此为 v1 初始形态（id TEXT 主键），仅用于全新库的种子建表。
-- 自 migration v4 起，本表演进为自增整数主键 rid + contract_id 唯一副键，
-- 见 migrate.ts 的 event_contract_autoincrement_rid 迁移。新库会先按本表建立、
-- 再被迁移重建为 rid 形态，故此处保持 v1 形态以兼容历史迁移链。
CREATE TABLE IF NOT EXISTS event_contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  contract TEXT NOT NULL,  -- JSON
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Console Settings（控制台设置）
CREATE TABLE IF NOT EXISTS console_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,  -- JSON
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Map Selections（地图选择）
CREATE TABLE IF NOT EXISTS map_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  selection TEXT NOT NULL,  -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

-- Staging Manifests（暂存区清单）
CREATE TABLE IF NOT EXISTS staging_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  manifest TEXT NOT NULL,  -- JSON
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Story Tasks（剧情制作待办）
CREATE TABLE IF NOT EXISTS story_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  map_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  priority TEXT NOT NULL DEFAULT 'normal',
  contract_id TEXT,
  task TEXT NOT NULL,  -- JSON
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_event_contracts_project ON event_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_event_contracts_status ON event_contracts(status);
CREATE INDEX IF NOT EXISTS idx_map_selections_project ON map_selections(project_id);
CREATE INDEX IF NOT EXISTS idx_staging_manifests_project ON staging_manifests(project_id);
CREATE INDEX IF NOT EXISTS idx_story_tasks_project ON story_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_story_tasks_map ON story_tasks(project_id, map_id);
CREATE INDEX IF NOT EXISTS idx_story_tasks_status ON story_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_story_tasks_priority ON story_tasks(project_id, priority);
CREATE INDEX IF NOT EXISTS idx_story_tasks_contract ON story_tasks(project_id, contract_id);
