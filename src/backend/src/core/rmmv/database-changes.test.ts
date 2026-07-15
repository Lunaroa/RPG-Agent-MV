import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import {
  applyProjectStaging,
  getDatabaseStagingOperation,
  getProjectFileForRead,
  listDatabaseStagingOperations,
  writeStagedProjectJson,
} from "../desktop/staging-service.ts";
import { readJson, writeJson } from "./json.ts";
import { createDefaultRmmvDatabaseEntry } from "./database-schema.ts";
import {
  applyRmmvDatabaseChanges,
  discardRmmvDatabaseChanges,
  dryRunRmmvDatabaseChanges,
  preflightRmmvDatabaseProjectApply,
  stageRmmvDatabaseChanges,
  type RmmvDatabaseChange,
} from "./database-changes.ts";

describe("controlled RMMV database changes", { concurrency: false }, () => {
  let workflowRoot: string;
  let project: string;
  let dataDir: string;

  beforeEach(async () => {
    workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-db-change-"));
    project = path.join(workflowRoot, "projects", "sample");
    dataDir = path.join(project, "www", "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(workflowRoot, "data"), { recursive: true });
    writeValidProject(dataDir);
    await bootstrapDatabase(workflowRoot, {
      dbPath: path.join(workflowRoot, "data", "test.db"),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  });

  test("dry-runs a batch against the final database and coalesces System/Types/Terms into one file", () => {
    const changes: RmmvDatabaseChange[] = [
      {
        op: "create",
        table: "skills",
        patches: [{ op: "replace", path: "/name", value: "Second Skill" }],
      },
      {
        op: "patch",
        table: "classes",
        id: 1,
        patches: [{
          op: "add",
          path: "/learnings/-",
          value: { level: 2, note: "", skillId: 2 },
        }],
      },
      { op: "type.rename", field: "skillTypes", id: 1, name: "Arcana" },
      { op: "type.append", field: "weaponTypes", name: "Staff" },
      {
        op: "patch",
        table: "terms",
        id: 0,
        patches: [{ op: "replace", path: "/basic/0", value: "Level" }],
      },
    ];

    const first = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const second = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });

    assert.equal(first.validation.ok, true, first.validation.issues.map((issue) => issue.message).join("\n"));
    assert.equal(first.planHash, second.planHash);
    assert.equal(first.resolvedChanges[0].op, "create");
    assert.equal((first.resolvedChanges[0] as { id: number }).id, 2);
    assert.deepEqual(first.files.map((file) => path.basename(file.relativePath)).sort(), [
      "Classes.json",
      "Skills.json",
      "System.json",
    ]);
    assert.equal(first.files.filter((file) => path.basename(file.relativePath) === "System.json").length, 1);
    assert.ok(first.diffs.some((diff) => diff.path === "/skills/2/name"));
    assert.ok(first.diffs.some((diff) => diff.path === "/types/skillTypes/1"));
    assert.equal((readJson(path.join(dataDir, "Skills.json")) as unknown[])[2], null);
  });

  test("returns exact blocking references when reset would leave an invalid id", () => {
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, {
      changes: [{ op: "reset", table: "skills", id: 1 }],
    });
    assert.equal(plan.validation.ok, false);
    assert.ok(plan.validation.issues.some((issue) =>
      issue.code === "DB_REFERENCE_MISSING"
      && issue.source.path === "classes[1].learnings[0].skillId"
    ));
  });

  test("stages an approved plan without writing source and discard removes only its drafts", () => {
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Updated Item" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const staged = stageRmmvDatabaseChanges(workflowRoot, project, {
      changes,
      planHash: plan.planHash,
      sessionId: "session-example",
    });

    assert.match(staged.operationId, /^db:/);
    assert.equal(staged.planHash, plan.planHash);
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Item");
    const effective = getProjectFileForRead(workflowRoot, project, "www/data/Items.json");
    assert.ok(effective);
    assert.equal((readJson(effective) as Array<Record<string, unknown> | null>)[1]!.name, "Updated Item");
    const operation = getDatabaseStagingOperation(workflowRoot, project, staged.operationId);
    assert.equal(operation?.planHash, plan.planHash);
    assert.equal(operation?.sessionId, "session-example");

    const discarded = discardRmmvDatabaseChanges(workflowRoot, project, staged.operationId);
    assert.equal(discarded.discarded, true);
    assert.equal(listDatabaseStagingOperations(workflowRoot, project).length, 0);
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Item");
  });

  test("rejects a stale plan hash before staging any operation", () => {
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Updated Item" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const itemsFile = path.join(dataDir, "Items.json");
    const items = readJson(itemsFile) as Array<Record<string, unknown> | null>;
    items[1]!.note = "External change";
    writeJson(itemsFile, items);

    assert.throws(
      () => stageRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash }),
      /planHash is stale/i,
    );
    assert.equal(listDatabaseStagingOperations(workflowRoot, project).length, 0);
  });

  test("applies exactly one approved operation after revalidating its complete staged state", () => {
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Applied Item" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const staged = stageRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash });

    const applied = applyRmmvDatabaseChanges(workflowRoot, project, staged.operationId);
    assert.equal(applied.applied, true);
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Applied Item");
    assert.equal(listDatabaseStagingOperations(workflowRoot, project).length, 0);
  });

  test("applies disjoint staged operations individually in reverse order", () => {
    const itemChanges: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Applied Item" }],
    }];
    const itemPlan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes: itemChanges });
    const itemOperation = stageRmmvDatabaseChanges(workflowRoot, project, {
      changes: itemChanges,
      planHash: itemPlan.planHash,
    });

    const skillChanges: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "skills",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Applied Skill" }],
    }];
    const skillPlan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes: skillChanges });
    const skillOperation = stageRmmvDatabaseChanges(workflowRoot, project, {
      changes: skillChanges,
      planHash: skillPlan.planHash,
    });

    applyRmmvDatabaseChanges(workflowRoot, project, skillOperation.operationId);
    applyRmmvDatabaseChanges(workflowRoot, project, itemOperation.operationId);

    assert.equal((readJson(path.join(dataDir, "Skills.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Applied Skill");
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Applied Item");
    assert.equal(listDatabaseStagingOperations(workflowRoot, project).length, 0);
  });

  test("allows unrelated legacy semantic errors throughout dry-run, stage, and apply", () => {
    const systemFile = path.join(dataDir, "System.json");
    const system = readJson(systemFile) as Record<string, unknown>;
    ((system.sounds as Array<Record<string, unknown>>)[0]).pitch = 200;
    writeJson(systemFile, system);

    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Legacy-Compatible Item" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    assert.equal(plan.validation.ok, true);
    const staged = stageRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash });
    applyRmmvDatabaseChanges(workflowRoot, project, staged.operationId);

    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Legacy-Compatible Item");

    const secondChanges: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Desktop Legacy-Compatible Item" }],
    }];
    const secondPlan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes: secondChanges });
    const second = stageRmmvDatabaseChanges(workflowRoot, project, {
      changes: secondChanges,
      planHash: secondPlan.planHash,
    });
    applyProjectStaging(workflowRoot, project, {
      expectedOperationIds: [second.operationId],
      validate: () => preflightRmmvDatabaseProjectApply(workflowRoot, project),
    });
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Desktop Legacy-Compatible Item");
  });

  test("requires the confirmed Agent operation set for desktop Apply All", () => {
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Desktop Applied Item" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const staged = stageRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash });

    assert.throws(
      () => applyProjectStaging(workflowRoot, project, { expectedOperationIds: [] }),
      /operation set changed/i,
    );
    const applied = applyProjectStaging(workflowRoot, project, {
      expectedOperationIds: [staged.operationId],
      validate: () => preflightRmmvDatabaseProjectApply(workflowRoot, project),
    });
    assert.equal(applied.applied, true);
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Desktop Applied Item");
  });

  test("allows unrelated source changes made after staging", () => {
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Blocked Item" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const staged = stageRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash });
    const actorsFile = path.join(dataDir, "Actors.json");
    const actors = readJson(actorsFile) as Array<Record<string, unknown> | null>;
    actors[1]!.nickname = "External change";
    writeJson(actorsFile, actors);

    const applied = applyRmmvDatabaseChanges(workflowRoot, project, staged.operationId);
    assert.equal(applied.applied, true);
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Blocked Item");
  });

  test("blocks apply when a changed input makes the staged operation semantically invalid", () => {
    const changes: RmmvDatabaseChange[] = [{ op: "reset", table: "skills", id: 3 }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const staged = stageRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash });

    const classesFile = path.join(dataDir, "Classes.json");
    const classes = readJson(classesFile) as Array<Record<string, unknown> | null>;
    (classes[1]!.learnings as Array<Record<string, unknown>>).push({ level: 2, note: "", skillId: 3 });
    writeJson(classesFile, classes);

    assert.throws(
      () => applyRmmvDatabaseChanges(workflowRoot, project, staged.operationId),
      /semantic revalidation/i,
    );
    assert.ok(getDatabaseStagingOperation(workflowRoot, project, staged.operationId));
  });

  test("does not claim a file that already contains a user draft", () => {
    const items = readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>;
    items[1]!.name = "User Draft";
    writeStagedProjectJson(workflowRoot, project, "www/data/Items.json", items);
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Agent Draft" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });

    assert.throws(
      () => stageRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash }),
      /unowned staging draft/i,
    );
    assert.equal(listDatabaseStagingOperations(workflowRoot, project).length, 0);
  });
});

function writeValidProject(dataDir: string): void {
  const actor = createDefaultRmmvDatabaseEntry("Actors", 1);
  actor.name = "Actor";
  actor.equips = [1, 1];
  const classEntry = createDefaultRmmvDatabaseEntry("Classes", 1);
  classEntry.name = "Class";
  classEntry.learnings = [{ level: 1, note: "", skillId: 1 }];
  const skill1 = createDefaultRmmvDatabaseEntry("Skills", 1);
  skill1.name = "Skill";
  skill1.pluginData = { preserved: true };
  const skill3 = createDefaultRmmvDatabaseEntry("Skills", 3);
  skill3.name = "Third Skill";
  const item = createDefaultRmmvDatabaseEntry("Items", 1);
  item.name = "Item";
  const weapon = createDefaultRmmvDatabaseEntry("Weapons", 1);
  weapon.name = "Weapon";
  const armor = createDefaultRmmvDatabaseEntry("Armors", 1);
  armor.name = "Armor";
  const enemy = createDefaultRmmvDatabaseEntry("Enemies", 1);
  enemy.name = "Enemy";
  const troop = createDefaultRmmvDatabaseEntry("Troops", 1);
  troop.name = "Troop";
  troop.members = [{ enemyId: 1, hidden: false, x: 400, y: 300 }];
  const state = createDefaultRmmvDatabaseEntry("States", 1);
  state.name = "State";
  const animation = createDefaultRmmvDatabaseEntry("Animations", 1);
  animation.name = "Animation";
  const tileset = createDefaultRmmvDatabaseEntry("Tilesets", 1);
  tileset.name = "Tileset";
  const commonEvent = createDefaultRmmvDatabaseEntry("CommonEvents", 1);
  commonEvent.name = "Common Event";
  commonEvent.switchId = 0;

  const system = createDefaultRmmvDatabaseEntry("System");
  system.gameTitle = "Sample";
  system.elements = ["", "Fire"];
  system.skillTypes = ["", "Magic"];
  system.weaponTypes = ["", "Sword"];
  system.armorTypes = ["", "Armor"];
  system.equipTypes = ["", "Weapon", "Shield"];
  system.switches = ["", "Switch"];
  system.variables = ["", "Variable"];
  system.partyMembers = [1];
  system.testBattlers = [{ actorId: 1, equips: [1, 1], level: 1 }];
  system.testTroopId = 1;
  system.startMapId = 1;
  system.editMapId = 1;
  system.magicSkills = [1];

  const tables: Record<string, unknown> = {
    "Actors.json": [null, actor],
    "Classes.json": [null, classEntry],
    "Skills.json": [null, skill1, null, skill3],
    "Items.json": [null, item],
    "Weapons.json": [null, weapon],
    "Armors.json": [null, armor],
    "Enemies.json": [null, enemy],
    "Troops.json": [null, troop],
    "States.json": [null, state],
    "Animations.json": [null, animation],
    "Tilesets.json": [null, tileset],
    "CommonEvents.json": [null, commonEvent],
    "System.json": system,
    "MapInfos.json": [null, { id: 1, name: "Map", parentId: 0, order: 1, expanded: true }],
    "Map001.json": {
      width: 2,
      height: 2,
      data: Array(24).fill(0),
      tilesetId: 1,
      encounterList: [],
      events: [null],
    },
  };
  for (const [fileName, value] of Object.entries(tables)) writeJson(path.join(dataDir, fileName), value);
}
