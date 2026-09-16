import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { createDefaultRmmvDatabaseEntry } from "./database-schema.ts";
import {
  commitRmmvDatabaseChanges,
  dryRunRmmvDatabaseChanges,
  validateEffectiveRmmvDatabaseState,
  type RmmvDatabaseChange,
} from "./database-changes.ts";
import { readJson, writeJson } from "./json.ts";

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

  test("commits an approved plan directly to the project", () => {
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Updated Item" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });

    const committed = commitRmmvDatabaseChanges(workflowRoot, project, {
      changes,
      planHash: plan.planHash,
    });

    assert.equal(committed.planHash, plan.planHash);
    assert.deepEqual(committed.files, ["www/data/Items.json"]);
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Updated Item");
  });

  test("commits a validated multi-file plan atomically", () => {
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
        patches: [{ op: "add", path: "/learnings/-", value: { level: 2, note: "", skillId: 2 } }],
      },
      { op: "type.rename", field: "skillTypes", id: 1, name: "Arcana" },
    ];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });

    const committed = commitRmmvDatabaseChanges(workflowRoot, project, {
      changes,
      planHash: plan.planHash,
    });

    assert.deepEqual(committed.files.map((file) => path.basename(file)).sort(), [
      "Classes.json",
      "Skills.json",
      "System.json",
    ]);
    assert.equal((readJson(path.join(dataDir, "Skills.json")) as Array<Record<string, unknown> | null>)[2]!.name, "Second Skill");
    const system = readJson(path.join(dataDir, "System.json")) as Record<string, unknown>;
    assert.equal((system.skillTypes as unknown[])[1], "Arcana");
  });

  test("rejects a stale plan before overwriting an external change", () => {
    const changes: RmmvDatabaseChange[] = [{
      op: "patch",
      table: "items",
      id: 1,
      patches: [{ op: "replace", path: "/name", value: "Agent Value" }],
    }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
    const itemsFile = path.join(dataDir, "Items.json");
    const items = readJson(itemsFile) as Array<Record<string, unknown> | null>;
    items[1]!.name = "External Value";
    writeJson(itemsFile, items);

    assert.throws(
      () => commitRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash }),
      /planHash is stale/i,
    );
    assert.equal((readJson(itemsFile) as Array<Record<string, unknown> | null>)[1]!.name, "External Value");
  });

  test("does not write a plan with semantic validation errors", () => {
    const skillFile = path.join(dataDir, "Skills.json");
    const before = fs.readFileSync(skillFile);
    const changes: RmmvDatabaseChange[] = [{ op: "reset", table: "skills", id: 1 }];
    const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });

    assert.equal(plan.validation.ok, false);
    assert.throws(
      () => commitRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash }),
      /validation error/i,
    );
    assert.deepEqual(fs.readFileSync(skillFile), before);
  });

  test("allows unrelated legacy semantic warnings during direct save", () => {
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
    commitRmmvDatabaseChanges(workflowRoot, project, { changes, planHash: plan.planHash });
    assert.equal((readJson(path.join(dataDir, "Items.json")) as Array<Record<string, unknown> | null>)[1]!.name, "Legacy-Compatible Item");
  });

  test("tolerates declared maps whose files are already missing during inspection", () => {
    const mapInfos = readJson(path.join(dataDir, "MapInfos.json")) as unknown[];
    mapInfos.push({ id: 2, name: "Missing Map", parentId: 0, order: 2, expanded: true });
    writeJson(path.join(dataDir, "MapInfos.json"), mapInfos);

    const result = validateEffectiveRmmvDatabaseState(workflowRoot, project);

    assert.equal(fs.existsSync(path.join(dataDir, "Map002.json")), false);
    assert.ok(result, "inspection must succeed instead of throwing for the missing map");
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
