import { after, beforeEach, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import { closeDatabase, configureDatabase, getDatabase } from "../../db/pool.ts";
import { migrate } from "../../db/migrate.ts";

import { EventContractDao } from "../../db/dao/event-contract-dao.ts";
import { withProductLanguage } from "../../i18n/request-language.ts";
import {
  normalizeContractEnvelope,
  validateContractFile,
  scaffoldContract,
  validateContract,
  detectConflicts,
  registerContract,
  listContracts,
  showContract,
  updateContractPlacement,
  reconcile,
  approveContract,
  rejectContract,
  adoptOrphan,
  registryPathFor,
} from "./event-registry.ts";
import { eventContentFingerprint } from "./event-fingerprint.ts";

interface EventContract {
  engine: string;
  kind: string;
  id: string;
  purpose: string;
  summary?: string;
  sceneId?: string;
  questline?: string;
  status?: string;
  rmmvTarget: {
    operation: string;
    mapId?: number;
    eventId?: number;
    eventName?: string;
    commonEventId?: number;
    trigger?: string;
    [key: string]: unknown;
  };
  implementation: {
    commands?: unknown[];
    pages?: unknown[];
    [key: string]: unknown;
  };
  effects?: {
    switches?: { id: number }[];
    variables?: { id: number }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const sqliteRoot = tmpDir("rmmv-event-registry-sqlite-");
configureDatabase({ path: path.join(sqliteRoot, "data", "test.db") });
migrate();
beforeEach(() => {
  getDatabase().exec("DELETE FROM event_contracts");
});

after(() => {
  closeDatabase();
  fs.rmSync(sqliteRoot, { recursive: true, force: true });
});

function tmpProject(): string {
  const root: string = tmpDir("rmmv-event-registry-");
  const data: string = path.join(root, "www", "data");
  fs.mkdirSync(data, { recursive: true });
  return root;
}

function baseContract(overrides: Partial<EventContract> = {}): EventContract {
  return {
    engine: "rpg-maker-mv",
    kind: "EventContract",
    id: "village.scholar.intro",
    purpose: "学者初见，提示玩家前往湖畔。",
    rmmvTarget: {
      operation: "add-map-event",
      mapId: 1,
      eventName: "EV_ScholarIntro",
      trigger: "action-button",
    },
    implementation: {
      commands: [{ kind: "text", text: "你好旅人" }],
    },
    ...overrides,
  };
}

test("validateContract accepts a well-formed contract", () => {
  const errors = validateContract(baseContract());
  assert.deepEqual(errors, []);
});

test("validateContract rejects wrong engine", () => {
  const errors = validateContract(baseContract({ engine: "godot" }));
  assert.ok(errors.some((e) => e.field === "engine"));
});

test("normalizeContractEnvelope fills missing engine and kind", () => {
  const raw = {
    id: "village.smith.intro",
    purpose: "铁匠初见，向玩家介绍武器店与修理服务。",
    rmmvTarget: {
      operation: "add-map-event",
      mapId: 2,
      eventName: "EV_Blacksmith",
      trigger: "action-button",
    },
    implementation: {
      commands: [{ kind: "text", text: "欢迎光临。" }],
    },
  } as EventContract;
  const { contract, normalizedFields } = normalizeContractEnvelope(raw);
  assert.equal(contract.engine, "rpg-maker-mv");
  assert.equal(contract.kind, "EventContract");
  assert.deepEqual(normalizedFields, ["engine", "kind"]);
  assert.deepEqual(validateContract(contract), []);
});

test("validateContractFile accepts envelope auto-fill", async () => {
  const result = await validateContractFile({
    id: "village.smith.intro",
    purpose: "铁匠初见，向玩家介绍武器店与修理服务。",
    rmmvTarget: {
      operation: "add-map-event",
      mapId: 2,
      eventName: "EV_Blacksmith",
      trigger: "action-button",
    },
    implementation: {
      commands: [{ kind: "text", text: "欢迎光临。" }],
    },
  } as EventContract);
  assert.equal(result.status, "ok");
  assert.equal(result.contract?.engine, "rpg-maker-mv");
  assert.equal(result.contract?.kind, "EventContract");
});

test("registerContract auto-fills missing engine and kind", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  const result = await registerContract(project, {
    id: "village.smith.intro",
    purpose: "铁匠初见，向玩家介绍武器店与修理服务。",
    rmmvTarget: {
      operation: "add-map-event",
      mapId: 2,
      eventName: "EV_Blacksmith",
      trigger: "action-button",
    },
    implementation: {
      commands: [{ kind: "text", text: "欢迎光临。" }],
    },
  } as EventContract, opts);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.normalizedFields, ["engine", "kind"]);
});

test("scaffoldContract produces a valid draft", () => {
  const contract = scaffoldContract({
    id: "village.smith.intro",
    mapId: 2,
    purpose: "铁匠初见，向玩家介绍武器店与修理服务。",
    text: "欢迎光临。",
  });
  assert.equal(contract.engine, "rpg-maker-mv");
  assert.equal(contract.kind, "EventContract");
  assert.equal(contract.rmmvTarget.eventName, "EV_village_smith_intro");
  assert.deepEqual(validateContract(contract), []);
});

test("validateContract rejects bad id pattern", () => {
  const errors = validateContract(baseContract({ id: "村庄 学者" }));
  assert.ok(errors.some((e) => e.field === "id"));
});

test("validateContract requires dotted id naming", () => {
  const errors = validateContract(baseContract({ id: "noDotsHere" }));
  assert.ok(errors.some((e) => e.field === "id" && /dotted/.test(e.message)));
});

test("validateContract rejects placeholder purpose", () => {
  const errors = validateContract(baseContract({ purpose: "AAAAAAAAAA" }));
  assert.ok(errors.some((e) => e.field === "purpose"));
});

test("validateContract rejects short purpose", () => {
  const errors = validateContract(baseContract({ purpose: "too short" }));
  assert.ok(errors.some((e) => e.field === "purpose"));
});

test("validateContract requires implementation commands or pages", () => {
  const errors = validateContract(baseContract({ implementation: { commands: [] } }));
  assert.ok(errors.some((e) => e.field === "implementation"));
});

test("validateContract accepts valid raw MV commands", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [
        { kind: "raw-command", code: 103, indent: 0, parameters: [1, 3] },
        { kind: "mv-command", code: 117, indent: 0, parameters: [1] },
        { kind: "raw-command", code: 302, indent: 0, parameters: [0, 1, 0, 0, false] },
      ],
    },
  }));
  assert.deepEqual(errors, []);
});

test("validateContract rejects bad raw MV command codes and parameter shapes", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [
        { kind: "raw-command", code: 999, indent: 0, parameters: [] },
        { kind: "mv-command", code: 103, indent: 0, parameters: ["1", 3] },
      ],
    },
  }));
  assert.ok(errors.some((e) => e.field === "implementation.commands[0]" && /not a standard RPG Maker MV event command code/.test(e.message)));
  assert.ok(errors.some((e) => e.field === "implementation.commands[1]" && /variableId.*integer/.test(e.message)));
});

test("validateContract checks raw MV commands nested inside branch commands", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [{
        kind: "battle",
        troopId: 1,
        onWin: [{ kind: "raw-command", code: 205, indent: 1, parameters: [0, { list: [{ code: 46, parameters: [] }, { code: 0, parameters: [] }], repeat: true, skippable: false, wait: false }] }],
      }],
    },
  }));
  assert.ok(errors.some((e) => e.field === "implementation.commands[0].onWin[0]" && /move route command code/.test(e.message)));
});

test("validateContract accepts switch / variable / self-switch with valid fields", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [
        { kind: "switch", id: 5, value: true },
        { kind: "variable", id: 10, value: 1 },
        { kind: "self-switch", name: "A", value: true },
      ],
    },
  }));
  assert.deepEqual(errors, []);
});

test("validateContract rejects switch missing id, id 0, or string id", () => {
  const missing = validateContract(baseContract({
    implementation: { commands: [{ kind: "switch", value: true }] },
  }));
  assert.ok(missing.some((e) => e.field === "implementation.commands[0].id" && /switch\.id must be an integer >= 1/.test(e.message)));

  const zero = validateContract(baseContract({
    implementation: { commands: [{ kind: "switch", id: 0, value: true }] },
  }));
  assert.ok(zero.some((e) => e.field === "implementation.commands[0].id" && /switch\.id must be an integer >= 1/.test(e.message)));

  const stringId = validateContract(baseContract({
    implementation: { commands: [{ kind: "switch", id: "42", value: true }] },
  }));
  assert.ok(stringId.some((e) => e.field === "implementation.commands[0].id" && /switch\.id must be an integer >= 1/.test(e.message)));
});

test("validateContract rejects non-boolean switch.value", () => {
  const errors = validateContract(baseContract({
    implementation: { commands: [{ kind: "switch", id: 1, value: 1 }] },
  }));
  assert.ok(errors.some((e) => e.field === "implementation.commands[0].value" && /boolean/.test(e.message)));
});

test("validateContract rejects invalid variable.id and self-switch.name", () => {
  const variable = validateContract(baseContract({
    implementation: { commands: [{ kind: "variable", id: 0, value: 1 }] },
  }));
  assert.ok(variable.some((e) => e.field === "implementation.commands[0].id" && /variable\.id must be an integer >= 1/.test(e.message)));

  const selfSwitch = validateContract(baseContract({
    implementation: { commands: [{ kind: "self-switch", name: "E", value: true }] },
  }));
  assert.ok(selfSwitch.some((e) => e.field === "implementation.commands[0].name" && /A.*B.*C.*D/.test(e.message)));
});

test("validateContract rejects invalid variable and self-switch values", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [
        { kind: "variable", id: 1, value: -1 },
        { kind: "self-switch", name: "A", value: "yes" },
      ],
    },
  }));
  assert.ok(errors.some((e) =>
    e.field === "implementation.commands[0].value"
    && /variable\.value must be an integer >= 0/.test(e.message)
  ));
  assert.ok(errors.some((e) =>
    e.field === "implementation.commands[1].value"
    && /self-switch\.value.*boolean/.test(e.message)
  ));
});

test("validateContract enforces every conditional-branch condition field", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [
        { kind: "conditional-branch" },
        { kind: "conditional-branch", condition: { type: "switch", id: 1 } },
        { kind: "conditional-branch", condition: { kind: "switch", id: 0, value: "on" } },
        { kind: "conditional-branch", condition: { kind: "variable", id: 0, value: -1, operator: "==" } },
        { kind: "conditional-branch", condition: { kind: "self-switch", name: "E", value: 1 } },
      ],
    },
  }));
  const fields = new Set(errors.map((error) => error.field));
  assert.ok(fields.has("implementation.commands[0].condition"));
  assert.ok(fields.has("implementation.commands[1].condition.kind"));
  assert.ok(fields.has("implementation.commands[2].condition.id"));
  assert.ok(fields.has("implementation.commands[2].condition.value"));
  assert.ok(fields.has("implementation.commands[3].condition.id"));
  assert.ok(fields.has("implementation.commands[3].condition.value"));
  assert.ok(fields.has("implementation.commands[3].condition.operator"));
  assert.ok(fields.has("implementation.commands[4].condition.name"));
  assert.ok(fields.has("implementation.commands[4].condition.value"));
});

test("validateContract applies conditional semantics through nested command containers", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [{
        kind: "choice",
        choices: [{
          text: "Continue",
          commands: [{
            kind: "loop",
            commands: [{
              kind: "conditional-branch",
              condition: { kind: "variable", id: 1, value: -1 },
            }],
          }],
        }],
      }],
    },
  }));
  assert.ok(errors.some((error) =>
    error.field === "implementation.commands[0].choices[0].commands[0].commands[0].condition.value"
  ));
});

test("validateContract rejects invalid switch.id nested inside conditional-branch", () => {
  const errors = validateContract(baseContract({
    implementation: {
      commands: [{
        kind: "conditional-branch",
        condition: { type: "self-switch", name: "A" },
        then: [{ kind: "switch", id: 0, value: true }],
      }],
    },
  }));
  assert.ok(errors.some((e) => e.field === "implementation.commands[0].then[0].id" && /switch\.id must be an integer >= 1/.test(e.message)));
});

test("validateContract checks add-map-event mapId / eventName", () => {
  const errors = validateContract(baseContract({
    rmmvTarget: { operation: "add-map-event" },
  }));
  assert.ok(errors.some((e) => e.field === "rmmvTarget.mapId"));
  assert.ok(errors.some((e) => e.field === "rmmvTarget.eventName"));
});

test("detectConflicts catches switch effect overlap", () => {
  const incoming = baseContract({
    id: "village.bell.toll",
    rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "EV_BellToll" },
    effects: { switches: [{ id: 5 }] },
  });
  const existing = [
    baseContract({
      id: "village.scholar.intro",
      effects: { switches: [{ id: 5 }] },
    }),
  ];
  const conflicts = detectConflicts(incoming, existing);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].code, "switch-write-write");
});

test("detectConflicts catches duplicate event name on same map", () => {
  const incoming = baseContract({
    id: "village.scholar.alt",
    rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "EV_ScholarIntro" },
  });
  const existing = [baseContract()];
  const conflicts = detectConflicts(incoming, existing);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].code, "duplicate-event-name");
});

test("detectConflicts ignores self-update (same id)", () => {
  const c = baseContract({ effects: { switches: [{ id: 5 }] } });
  const conflicts = detectConflicts(c, [c]);
  assert.deepEqual(conflicts, []);
});

test("registerContract rejects invalid schema with status=rejected reason=schema", async () => {
  const project = tmpProject();
  const result = await registerContract(project, baseContract({ engine: "godot" }), {
    runtimeRoot: path.join(project, "runtime"),
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "schema");
  assert.ok(result.errors.length > 0);
});

test("registerContract rejects conflict with status=rejected reason=conflict", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  const first = await registerContract(project, baseContract(), opts);
  assert.equal(first.status, "ok");
  const second = await registerContract(
    project,
    baseContract({
      id: "village.scholar.alt",
      rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "EV_ScholarIntro" },
    }),
    opts,
  );
  assert.equal(second.status, "rejected");
  assert.equal(second.reason, "conflict");
});

test("registerContract persists to SQLite and is idempotent on re-register", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  const result1 = await registerContract(project, baseContract(), opts);
  assert.equal(result1.status, "ok");
  assert.equal(result1.action, "created");
  const stored = EventContractDao.get("village.scholar.intro");
  assert.ok(stored);
  assert.equal(stored.contract.id, "village.scholar.intro");
  assert.equal(stored.status, "reviewing");
  assert.equal(stored.contract.status, "reviewing");

  const result2 = await registerContract(project, baseContract({ purpose: "更新后的学者初见说明，更详细。" }), opts);
  assert.equal(result2.status, "ok");
  assert.equal(result2.action, "updated");
  assert.equal(result2.contractCount, 1);
  assert.equal(EventContractDao.listByProject(path.basename(project)).length, 1);
});

test("registerContract defaults new map events to reviewing until approved", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract(), opts);
  const before = await showContract(project, "village.scholar.intro", opts);
  assert.equal(before.contract!.status, "reviewing");

  const approved = approveContract(project, "village.scholar.intro", {
    ...opts,
    note: "内容可以，稍后放到柜台旁。",
  });
  assert.equal(approved.status, "ok");
  assert.equal(approved.previousStatus, "reviewing");
  assert.equal(approved.contract!.status, "draft");

  const after = await showContract(project, "village.scholar.intro", opts);
  assert.equal(after.contract!.status, "draft");
  assert.ok((after.contract!.recordedBy as Record<string, unknown>).approvedAt);
  assert.equal((after.contract!.recordedBy as Record<string, unknown>).approvalNote, "内容可以，稍后放到柜台旁。");
});

test("listContracts returns skeleton view", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ status: "draft" }), opts);
  const out = await listContracts(project, opts);
  assert.equal(out.count, 1);
  assert.equal(out.contracts[0].id, "village.scholar.intro");
  assert.equal(out.contracts[0].operation, "add-map-event");
});

test("showContract returns full contract or not-found", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ status: "draft" }), opts);
  const found = await showContract(project, "village.scholar.intro", opts);
  assert.equal(found.status, "ok");
  const missing = await showContract(project, "nope.missing", opts);
  assert.equal(missing.status, "not-found");
});

test("reconcile flags event-not-placed when map exists but event not in map", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ status: "draft" }), opts);
  fs.writeFileSync(
    path.join(project, "www", "data", "Map001.json"),
    JSON.stringify({ events: [null, { id: 1, name: "Other" }] }),
    "utf8",
  );
  const out = await reconcile(project, opts);
  assert.equal(out.status, "drifted");
  assert.equal(out.drifts[0].code, "event-not-placed");
});

test("reconcile clean when event placed and status not draft", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ status: "placed" }), opts);
  fs.writeFileSync(
    path.join(project, "www", "data", "Map001.json"),
    JSON.stringify({ events: [null, { id: 1, name: "EV_ScholarIntro" }] }),
    "utf8",
  );
  const out = await reconcile(project, opts);
  assert.equal(out.status, "clean");
});

test("reconcile reports status-stale-draft when event placed but contract still draft", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ status: "draft" }), opts);
  fs.writeFileSync(
    path.join(project, "www", "data", "Map001.json"),
    JSON.stringify({ events: [null, { id: 1, name: "EV_ScholarIntro" }] }),
    "utf8",
  );
  const out = await reconcile(project, opts);
  assert.equal(out.status, "drifted");
  assert.equal(out.drifts[0].code, "status-stale-draft");
  assert.equal(out.drifts[0].eventId, 1);
  assert.equal(out.drifts[0].matchedBy, "eventName");
});

test("updateContractPlacement marks contract placed with event id and coordinates", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract(), opts);
  const update = updateContractPlacement(project, "village.scholar.intro", {
    mapId: 1,
    eventId: 7,
    x: 3,
    y: 4,
  }, opts);
  assert.equal(update.status, "ok");
  const found = await showContract(project, "village.scholar.intro", opts);
  assert.equal(found.status, "ok");
  assert.equal(found.contract!.status, "placed");
  assert.equal(found.contract!.rmmvTarget.eventId, 7);
  assert.equal(found.contract!.rmmvTarget.x, 3);
  assert.equal(found.contract!.rmmvTarget.y, 4);
});

test("reconcile --apply equivalent marks stale placed events", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ status: "draft" }), opts);
  fs.writeFileSync(
    path.join(project, "www", "data", "Map001.json"),
    JSON.stringify({
      events: [null, {
        id: 3,
        name: "EV_ScholarIntro",
        x: 5,
        y: 6,
        note: "AIWF:event-contract:village.scholar.intro",
      }],
    }),
    "utf8",
  );
  const out = await reconcile(project, { ...opts, apply: true });
  assert.equal(out.status, "synced");
  assert.equal(out.appliedCount, 1);
  assert.equal(out.drifts[0].matchedBy, "AIWF:event-contract:village.scholar.intro");
  const found = await showContract(project, "village.scholar.intro", opts);
  assert.equal(found.contract!.status, "placed");
  assert.equal(found.contract!.rmmvTarget.eventId, 3);
  assert.equal(found.contract!.rmmvTarget.x, 5);
  assert.equal(found.contract!.rmmvTarget.y, 6);
});

test("registryPathFor isolates by project basename", () => {
  const a = registryPathFor("/tmp/project-A");
  const b = registryPathFor("/tmp/project-B");
  assert.notEqual(a, b);
  assert.ok(a.includes("project-A"));
  assert.ok(b.includes("project-B"));
});

function writeMap(project: string, events: unknown[], extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(project, "www", "data", "Map001.json"),
    JSON.stringify({ width: 20, height: 20, events, ...extra }),
    "utf8",
  );
}

test("register assigns a stable, non-reused auto-increment rid", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ id: "scene.a.one", rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "One" } }), opts);
  await registerContract(project, baseContract({ id: "scene.a.two", rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "Two" } }), opts);
  let list = await listContracts(project, opts);
  assert.equal(list.contracts.find((c) => c.id === "scene.a.one")!.rid, 1);
  assert.equal(list.contracts.find((c) => c.id === "scene.a.two")!.rid, 2);
  // 重新登记同一契约：rid 保持不变。
  await registerContract(project, baseContract({ id: "scene.a.one", rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "One" } }), opts);
  list = await listContracts(project, opts);
  assert.equal(list.contracts.find((c) => c.id === "scene.a.one")!.rid, 1);
  assert.equal(list.contracts.find((c) => c.id === "scene.a.two")!.rid, 2);
});

test("rejectContract sets rejected / abandoned status and records reason", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ id: "scene.r.one", rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "R1" } }), opts);
  const res = rejectContract(project, "scene.r.one", { ...opts, reason: "玩家不要" });
  assert.equal(res.status, "ok");
  assert.equal(res.contract!.status, "rejected");
  const shown = await showContract(project, "scene.r.one", opts);
  assert.equal(shown.contract!.status, "rejected");
  assert.equal((shown.contract!.recordedBy as Record<string, unknown>).rejectReason, "玩家不要");
  // 按 rid 定位 + 弃用。
  const res2 = rejectContract(project, 1, { ...opts, abandon: true });
  assert.equal(res2.status, "ok");
  assert.equal(res2.contract!.status, "abandoned");
});

test("reconcile reports state-writer-missing for a rejected contract that declared effects", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({
    id: "scene.s.one",
    rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "S1" },
    effects: { switches: [{ id: 5 }], variables: [{ id: 3 }] },
  }), opts);
  rejectContract(project, "scene.s.one", opts);
  writeMap(project, [null]);
  const out = await reconcile(project, opts);
  const drift = out.drifts.find((d) => d.code === "state-writer-missing");
  assert.ok(drift, "expected state-writer-missing drift");
  assert.deepEqual(drift!.switches, [5]);
  assert.deepEqual(drift!.variables, [3]);
});

test("reconcile reports event-modified when a placed event's content changed", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ id: "scene.m.one", rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "M1" } }), opts);
  const ev: Record<string, unknown> = {
    id: 1,
    name: "M1",
    note: "AIWF:event-contract:scene.m.one",
    pages: [{ list: [{ code: 101, indent: 0, parameters: ["hi"] }, { code: 0, indent: 0, parameters: [] }] }],
  };
  writeMap(project, [null, ev]);
  const hash = eventContentFingerprint(ev);
  updateContractPlacement(project, "scene.m.one", { mapId: 1, eventId: 1, x: 2, y: 3, contentHash: hash }, opts);

  let out = await reconcile(project, opts);
  assert.ok(!out.drifts.some((d) => d.code === "event-modified"), "pristine event must not be flagged");

  // 玩家手改对话内容。
  (((ev.pages as Record<string, unknown>[])[0]).list as Record<string, unknown>[])[0].parameters = ["changed dialogue"];
  writeMap(project, [null, ev]);
  out = await reconcile(project, opts);
  const drift = out.drifts.find((d) => d.code === "event-modified");
  assert.ok(drift, "expected event-modified drift");
  assert.equal(drift!.expectedHash, hash);
  assert.notEqual(drift!.actualHash, hash);
});

test("matchMapEvent falls back to eventId anchor after note markers are removed", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  await registerContract(project, baseContract({ id: "scene.f.one", rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "DIFFERENT" } }), opts);
  updateContractPlacement(project, "scene.f.one", { mapId: 1, eventId: 4, x: 1, y: 1 }, opts);
  // 事件被玩家清掉了备注、改了名字，只剩 eventId 锚点能找回。
  const ev = { id: 4, name: "PlayerRenamed", note: "", pages: [{ list: [{ code: 0, indent: 0, parameters: [] }] }] };
  writeMap(project, [null, null, null, null, ev]);
  const out = await reconcile(project, opts);
  assert.ok(!out.drifts.some((d) => d.code === "event-not-placed"), "anchor should find the event");
  assert.ok(out.drifts.some((d) => d.code === "note-token-missing"), "expected note-token-missing");
});

test("adoptOrphan registers a legacy map event with rid, fingerprint and markers", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  const ev = {
    id: 1,
    name: "OldSign",
    note: "",
    x: 3,
    y: 4,
    pages: [{ list: [{ code: 101, indent: 0, parameters: ["", 0, 0, 2] }, { code: 401, indent: 0, parameters: ["legacy"] }, { code: 0, indent: 0, parameters: [] }] }],
  };
  writeMap(project, [null, ev]);
  const res = withProductLanguage("zh-CN", () => adoptOrphan(project, { mapId: 1, eventId: 1, id: "legacy.old.sign" }, opts));
  assert.equal(res.status, "ok");
  assert.ok(Number.isInteger(res.rid));
  const shown = await showContract(project, "legacy.old.sign", opts);
  assert.equal(shown.contract!.status, "placed");
  assert.ok((shown.contract!.placement as Record<string, unknown>).contentHash);
  const map = JSON.parse(fs.readFileSync(path.join(project, "www", "data", "Map001.json"), "utf8"));
  assert.ok((map.events[1].note as string).includes(`AIWF:rid:${res.rid}`));
  // 收编后不再被当作孤儿。
  const out = await reconcile(project, opts);
  assert.ok(!out.drifts.some((d) => d.code.startsWith("orphan")));
});

test("reconcile flags orphan-tagged always and orphan-untracked only with --orphans", async () => {
  const project = tmpProject();
  const opts = { runtimeRoot: path.join(project, "runtime") };
  writeMap(project, [
    null,
    { id: 1, name: "Ghost", note: "AIWF:event-contract:nope.missing" },
    { id: 2, name: "Door", note: "" },
  ]);
  let out = await reconcile(project, opts);
  assert.ok(out.drifts.some((d) => d.code === "orphan-tagged" && d.eventId === 1));
  assert.ok(!out.drifts.some((d) => d.code === "orphan-untracked"));
  out = await reconcile(project, { ...opts, orphans: true });
  assert.ok(out.drifts.some((d) => d.code === "orphan-untracked" && d.eventId === 2));
});
