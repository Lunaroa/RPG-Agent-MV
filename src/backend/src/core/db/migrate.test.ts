import { after, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

import { closeDatabase, configureDatabase, getDatabase } from "./pool.ts";
import { backfillEventContractEngines, backfillEventContractRids, migrate, reconcileSchemaDrift } from "./migrate.ts";
import { bootstrapDatabase } from "./bootstrap.ts";
import { EventContractDao } from "./dao/event-contract-dao.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-migrate-rid-"));
configureDatabase({ path: path.join(root, "test.db") });

after(() => {
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

test("migration v4 moves event_contracts to rid PK and backfills rid into contract JSON", () => {
  // 先以 v1 形态（id TEXT 主键）建表并塞两条旧数据（contract JSON 里没有 rid）。
  initializeLegacyV1Schema();
  const db = getDatabase();
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO event_contracts (id, project_id, contract, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  );
  insert.run("scene.a.one", "Demo", JSON.stringify({ id: "scene.a.one", purpose: "x" }), "draft", "2026-01-01T00:00:00.000Z", now);
  insert.run("scene.a.two", "Demo", JSON.stringify({ id: "scene.a.two", purpose: "y" }), "placed", "2026-01-02T00:00:00.000Z", now);

  migrate();
  backfillEventContractRids(root); // root 下没有 runtime/event-registry，JSON 回填为 no-op

  // 表已演进为 rid 形态。
  const cols = (db.prepare("PRAGMA table_info(event_contracts)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("rid"), "rid column present");
  assert.ok(cols.includes("contract_id"), "contract_id column present");

  // 老数据完整迁移，rid 按 created_at 顺序分配。
  const rows = EventContractDao.listByProject("Demo");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].contract_id, "scene.a.one");
  assert.equal(rows[0].rid, 1);
  assert.equal(rows[1].contract_id, "scene.a.two");
  assert.equal(rows[1].rid, 2);

  // rid 已回填进 contract JSON（DB 列 rid == contract.rid）。
  assert.equal((rows[0].contract as Record<string, unknown>).rid, 1);
  assert.equal((rows[1].contract as Record<string, unknown>).rid, 2);

  // get / getByRid 双向可用。
  assert.equal(EventContractDao.getByRid(2)!.contract_id, "scene.a.two");
  assert.equal(EventContractDao.get("scene.a.one")!.rid, 1);

  // 新建：contract.rid 显式落库为主键。
  EventContractDao.create("scene.a.three", "Demo", { id: "scene.a.three", purpose: "z", rid: 3 }, "draft");
  assert.equal(EventContractDao.get("scene.a.three")!.rid, 3);

  // 注：当前迁移链已 drop 旧 story_tasks/story_task_contracts，
  // 故此处不再断言旧剧情表；剧情新表的迁移断言见当前 story module 用例。
});

test("legacy story_tasks missing contract_id does not block migration through current story schema", () => {
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-migrate-drift-"));
  configureDatabase({ path: path.join(driftRoot, "drift.db") });
  const db = getDatabase();
  const now = new Date().toISOString();
  initializeLegacyV1Schema();

  db.exec(`
    CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec("DROP TABLE story_tasks");
  db.exec(`
    CREATE TABLE story_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      map_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      priority TEXT NOT NULL DEFAULT 'normal',
      task TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  db.prepare(
    "INSERT INTO story_tasks (id, project_id, map_id, status, priority, task, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    "story.legacy",
    "Demo",
    1,
    "planned",
    "normal",
    JSON.stringify({ id: "story.legacy", projectId: "Demo", mapId: 1 }),
    now,
    now,
  );
  db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(4, "event_contract_autoincrement_rid");

  migrate();

  // 旧库 story_tasks 缺 contract_id 不阻塞迁移：reconcile 先补列让 v5 能跑，最终当前迁移链 drop 旧表。
  assert.ok(!tableExists(db, "story_tasks"), "legacy story_tasks dropped");
  assert.ok(!tableExists(db, "story_task_contracts"), "legacy story_task_contracts dropped");
  assert.ok(!tableExists(db, "story_blocks"), "old story board table removed");
  assert.ok(tableExists(db, "story_event_anchors"), "story_event_anchors created");
  assert.ok(tableExists(db, "story_pages"), "story_pages created");

  closeDatabase();
  fs.rmSync(driftRoot, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});

test("reconcileSchemaDrift repairs event_contracts still on id-only schema", () => {
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-migrate-ec-"));
  configureDatabase({ path: path.join(driftRoot, "ec.db") });
  const db = getDatabase();
  db.exec(`
    CREATE TABLE event_contracts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      contract TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at TEXT,
      updated_at TEXT
    )
  `);
  db.prepare(
    "INSERT INTO event_contracts (id, project_id, contract, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run("scene.old.one", "Demo", JSON.stringify({ id: "scene.old.one" }), "draft", nowIso(), nowIso());
  db.exec(`
    CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(6, "story_outline");

  reconcileSchemaDrift(db);

  const cols = (db.prepare("PRAGMA table_info(event_contracts)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("contract_id"), "event_contracts.contract_id present");
  assert.ok(cols.includes("rid"), "event_contracts.rid present");
  assert.equal(EventContractDao.get("scene.old.one")!.rid, 1);

  closeDatabase();
  fs.rmSync(driftRoot, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});

function tableExists(db: ReturnType<typeof getDatabase>, name: string): boolean {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function nowIso(): string {
  return new Date().toISOString();
}

﻿test("reconcileSchemaDrift rebuilds story_task_contracts missing contract_id column", () => {
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-migrate-stc-"));
  configureDatabase({ path: path.join(driftRoot, "stc.db") });
  const db = getDatabase();
  const now = new Date().toISOString();
  db.exec(`
    CREATE TABLE story_tasks (
      id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      map_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      priority TEXT NOT NULL DEFAULT 'normal',
      contract_id TEXT,
      task TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (project_id, id)
    )
  `);
  db.prepare(
    "INSERT INTO story_tasks (id, project_id, map_id, status, priority, contract_id, task, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "story.linked",
    "Demo",
    1,
    "planned",
    "normal",
    "scene.a.one",
    JSON.stringify({ id: "story.linked", projectId: "Demo", mapId: 1 }),
    now,
    now,
  );
  db.exec(`
    CREATE TABLE story_task_contracts (
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      PRIMARY KEY (project_id, task_id)
    )
  `);

  reconcileSchemaDrift(db);

  const cols = (db.prepare("PRAGMA table_info(story_task_contracts)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("contract_id"), "story_task_contracts.contract_id present");
  const links = db.prepare(
    "SELECT contract_id FROM story_task_contracts WHERE project_id = ? AND task_id = ?",
  ).all("Demo", "story.linked") as Array<{ contract_id: string }>;
  assert.deepEqual(links.map((row) => row.contract_id), ["scene.a.one"]);

  closeDatabase();
  fs.rmSync(driftRoot, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});


test("bootstrap repairs event_contracts id-only when migrations already at v6", async () => {
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-bootstrap-ec-"));
  const dbPath = path.join(driftRoot, "runtime", "rmmv.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  configureDatabase({ path: dbPath });
  const db = getDatabase();
  initializeLegacyV1Schema();
  db.exec(`
    CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(6, "story_outline");
  closeDatabase();

  await bootstrapDatabase(driftRoot, { importLegacyJson: false });
  const migratedDbPath = path.join(driftRoot, "data", "rmmv.db");
  assert.ok(fs.existsSync(migratedDbPath), "legacy runtime db moved to data/rmmv.db");
  assert.ok(!fs.existsSync(dbPath), "legacy runtime/rmmv.db removed after migration");
  const cols = (getDatabase().prepare("PRAGMA table_info(event_contracts)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("contract_id"), "event_contracts.contract_id present after bootstrap");
  assert.ok(cols.includes("rid"), "event_contracts.rid present after bootstrap");
  EventContractDao.list();

  closeDatabase();
  fs.rmSync(driftRoot, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});

test("bootstrap migrates legacy runtime db with wal/shm sidecars to data/", async () => {
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-bootstrap-legacy-"));
  const legacyDbPath = path.join(driftRoot, "runtime", "rmmv.db");
  fs.mkdirSync(path.dirname(legacyDbPath), { recursive: true });
  configureDatabase({ path: legacyDbPath });
  getDatabase().exec("CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  closeDatabase();
  fs.writeFileSync(legacyDbPath + "-wal", "wal");
  fs.writeFileSync(legacyDbPath + "-shm", "shm");

  const migratedPath = await bootstrapDatabase(driftRoot, { importLegacyJson: false });

  assert.equal(migratedPath, path.join(driftRoot, "data", "rmmv.db"));
  assert.ok(fs.existsSync(migratedPath));
  assert.ok(fs.existsSync(migratedPath + "-wal"));
  assert.ok(fs.existsSync(migratedPath + "-shm"));
  assert.ok(!fs.existsSync(legacyDbPath));

  closeDatabase();
  fs.rmSync(driftRoot, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});

test("bootstrap repairs drifted story_tasks through the migration chain", async () => {
  const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-bootstrap-drift-"));
  const dbPath = path.join(driftRoot, "runtime", "rmmv.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  configureDatabase({ path: dbPath });
  const db = getDatabase();
  initializeLegacyV1Schema();
  db.exec("DROP TABLE story_tasks");
  db.exec(`
    CREATE TABLE story_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      map_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      priority TEXT NOT NULL DEFAULT 'normal',
      task TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(3, "story_tasks");
  closeDatabase();

  await bootstrapDatabase(driftRoot, { importLegacyJson: false });
  const migratedDbPath = path.join(driftRoot, "data", "rmmv.db");
  assert.ok(fs.existsSync(migratedDbPath), "legacy runtime db moved to data/rmmv.db");
  assert.ok(!fs.existsSync(dbPath), "legacy runtime/rmmv.db removed after migration");
  assert.ok(!tableExists(getDatabase(), "story_tasks"), "legacy story_tasks dropped after bootstrap");
  assert.ok(!tableExists(getDatabase(), "story_blocks"), "old story board table absent after bootstrap");
  EventContractDao.list();

  closeDatabase();
  fs.rmSync(driftRoot, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});

test("backfillEventContractRids writes rid into contract JSON blobs in SQLite", () => {
  migrate();
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO event_contracts (rid, contract_id, project_id, contract, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(7, "a.b.two", "JsonOnly", JSON.stringify({ id: "a.b.two", purpose: "y" }), "draft", now, now);
  db.prepare(`
    INSERT INTO event_contracts (rid, contract_id, project_id, contract, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(8, "a.b.one", "JsonOnly", JSON.stringify({ id: "a.b.one", purpose: "x" }), "draft", now, now);

  backfillEventContractRids();

  const byId = Object.fromEntries(
    (db.prepare("SELECT contract_id, contract FROM event_contracts WHERE project_id = ?").all("JsonOnly") as Array<{
      contract_id: string;
      contract: string;
    }>).map((row) => [row.contract_id, JSON.parse(row.contract).rid as number]),
  );
  assert.equal(byId["a.b.two"], 7);
  assert.equal(byId["a.b.one"], 8);
});

test("migration v11 backfills legacy contracts as MV without changing their identity or status", () => {
  migrate();
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO event_contracts (contract_id, project_id, contract, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "scene.engine.legacy",
    "Sample",
    JSON.stringify({ id: "scene.engine.legacy", purpose: "fixture", rmmvTarget: { mapId: 1 } }),
    "reviewing",
    now,
    now,
  );

  backfillEventContractEngines();
  backfillEventContractEngines();

  const row = db.prepare(`
    SELECT contract_id, project_id, contract, status, created_at, updated_at
    FROM event_contracts WHERE contract_id = ?
  `).get("scene.engine.legacy") as Record<string, string>;
  const contract = JSON.parse(row.contract) as Record<string, unknown>;
  assert.equal(contract.engine, "rpg-maker-mv");
  assert.equal(contract.id, "scene.engine.legacy");
  assert.equal(row.project_id, "Sample");
  assert.equal(row.status, "reviewing");
  assert.equal(row.created_at, now);
  assert.equal(row.updated_at, now);
});

test("migration v10 builds the current story module tables and markdown outline", () => {
  const storyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-migrate-story-"));
  configureDatabase({ path: path.join(storyRoot, "story.db") });
  const db = getDatabase();
  migrate();

  for (const legacy of ["story_tasks", "story_task_contracts", "story_outline"]) {
    if (legacy === "story_outline") continue;
    assert.ok(!tableExists(db, legacy), `${legacy} dropped by current migrations`);
  }
  for (const created of [
    "story_projects", "story_outline",
    "story_event_anchors", "story_pages", "story_page_history", "story_integrity_issues",
  ]) {
    assert.ok(tableExists(db, created), `${created} created by current migrations`);
  }
  for (const removed of ["story_blocks", "story_block_contracts"]) {
    assert.ok(!tableExists(db, removed), `${removed} removed by current migrations`);
  }
  for (const dropped of ["story_outline_meta", "story_outline_scenes", "story_outline_characters", "story_outline_state_slots"]) {
    assert.ok(!tableExists(db, dropped), `${dropped} dropped by v8`);
  }

  // 页随锚点 CASCADE 删除
  db.prepare("INSERT INTO story_event_anchors (project_id, anchor_id, origin, map_id, event_id, event_name, x, y, event_rid) VALUES ('P','a1','mod',1,1,'Event',1,1,101)").run();
  db.prepare("INSERT INTO story_pages (project_id, page_node_id, anchor_id, origin, page_ref, page_uid) VALUES ('P','pg1','a1','mod','stamp:1','stamp:1')").run();
  db.prepare("DELETE FROM story_event_anchors WHERE project_id='P' AND anchor_id='a1'").run();
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS c FROM story_pages WHERE project_id='P'").get() as { c: number }).c,
    0,
    "page cascade-deleted with its anchor",
  );

  // 原版锚点自然键幂等：同 (project,baseline,map,event)、event_rid IS NULL 插两次只 1 行
  const ins = db.prepare(
    "INSERT INTO story_event_anchors (project_id, anchor_id, origin, map_id, event_id, event_name, x, y, baseline_version) VALUES (?,?,'baseline',?,?,?,?,?,?) " +
    "ON CONFLICT(project_id, baseline_version, map_id, event_id) WHERE origin = 'baseline' DO UPDATE SET event_name = excluded.event_name",
  );
  ins.run("P", "base-1", 5, 3, "Old Name", 1, 2, "1.0.0");
  ins.run("P", "base-1-dup", 5, 3, "New Name", 1, 2, "1.0.0");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS c FROM story_event_anchors WHERE project_id='P' AND baseline_version='1.0.0' AND map_id=5 AND event_id=3").get() as { c: number }).c,
    1,
    "baseline anchor idempotent on natural key",
  );

  closeDatabase();
  fs.rmSync(storyRoot, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});

test("migration v10 drops structured outline tables and old story board artifacts", () => {
  const v8Root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-migrate-v8-"));
  configureDatabase({ path: path.join(v8Root, "v8.db") });
  const db = getDatabase();
  db.exec(`
    CREATE TABLE migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO migrations (version, name) VALUES (7, 'story_module_rebuild');
    CREATE TABLE story_outline_meta (project_id TEXT PRIMARY KEY);
    CREATE TABLE story_outline_scenes (project_id TEXT NOT NULL, scene_id TEXT NOT NULL);
    CREATE TABLE story_outline_characters (project_id TEXT NOT NULL, character_id TEXT NOT NULL);
    CREATE TABLE story_outline_state_slots (project_id TEXT NOT NULL, slot_id TEXT NOT NULL);
    CREATE TABLE story_blocks (project_id TEXT NOT NULL, block_id TEXT NOT NULL, scene_id TEXT);
    CREATE TABLE story_block_contracts (project_id TEXT NOT NULL, block_id TEXT NOT NULL, contract_id TEXT NOT NULL);
    CREATE TABLE story_event_anchors (project_id TEXT NOT NULL, anchor_id TEXT NOT NULL, block_id TEXT);
  `);

  migrate();

  for (const dropped of ["story_outline_meta", "story_outline_scenes", "story_outline_characters", "story_outline_state_slots"]) {
    assert.ok(!tableExists(db, dropped), `${dropped} dropped`);
  }
  assert.ok(tableExists(db, "story_outline"), "markdown story_outline created");
  assert.ok(!tableExists(db, "story_blocks"), "old story board table dropped");
  assert.ok(!tableExists(db, "story_block_contracts"), "old story board link table dropped");
  const anchorCols = (db.prepare("PRAGMA table_info(story_event_anchors)").all() as { name: string }[]).map((col) => col.name);
  assert.equal(anchorCols.includes("block_id"), false);
  assert.equal((db.prepare("SELECT MAX(version) AS version FROM migrations").get() as { version: number }).version, 11);

  closeDatabase();
  fs.rmSync(v8Root, { recursive: true, force: true });
  configureDatabase({ path: path.join(root, "test.db") });
});

function initializeLegacyV1Schema(): void {
  getDatabase().exec(fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8"));
}
