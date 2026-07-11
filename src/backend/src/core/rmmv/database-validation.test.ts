import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createDefaultRmmvDatabaseEntry,
  getRmmvDatabaseSchema,
  type RmmvDatabaseTableKey,
} from "./database-schema.ts";
import {
  validateRmmvDatabaseSnapshot,
  validateRmmvDatabaseTransition,
  type RmmvDatabaseSnapshot,
} from "./database-validation.ts";

function one<T>(entry: T): Array<T | null> {
  return [null, entry];
}

function validSnapshot(): RmmvDatabaseSnapshot {
  const actor = createDefaultRmmvDatabaseEntry("Actors", 1);
  actor.equips = [1, 1];

  const classEntry = createDefaultRmmvDatabaseEntry("Classes", 1);
  classEntry.learnings = [{ level: 1, note: "", skillId: 1 }];

  const skill = createDefaultRmmvDatabaseEntry("Skills", 1);
  skill.animationId = -1;
  skill.requiredWtypeId1 = 1;
  skill.damage = { type: 1, elementId: -1, formula: "a.atk * 4 - b.def * 2", variance: 20, critical: false };
  skill.effects = [{ code: 44, dataId: 1, value1: 0, value2: 0 }];

  const item = createDefaultRmmvDatabaseEntry("Items", 1);
  item.animationId = -1;
  item.damage = { type: 1, elementId: 1, formula: "Math.max(0, a.atk - b.def)", variance: 20, critical: false };
  item.effects = [{ code: 21, dataId: 1, value1: 1, value2: 0 }];

  const weapon = createDefaultRmmvDatabaseEntry("Weapons", 1);
  weapon.animationId = 1;
  weapon.traits = [{ code: 43, dataId: 1, value: 1 }];

  const armor = createDefaultRmmvDatabaseEntry("Armors", 1);
  armor.traits = [{ code: 14, dataId: 1, value: 1 }];

  const enemy = createDefaultRmmvDatabaseEntry("Enemies", 1);
  enemy.actions = [{ conditionParam1: 0, conditionParam2: 0, conditionType: 0, rating: 5, skillId: 1 }];
  enemy.dropItems = [{ kind: 1, dataId: 1, denominator: 1 }];
  enemy.traits = [{ code: 41, dataId: 1, value: 1 }];

  const troop = createDefaultRmmvDatabaseEntry("Troops", 1);
  troop.members = [{ enemyId: 1, hidden: false, x: 400, y: 300 }];
  const troopPage = (troop.pages as Array<Record<string, unknown>>)[0];
  troopPage.conditions = {
    actorHp: 50,
    actorId: 1,
    actorValid: true,
    enemyHp: 50,
    enemyIndex: 0,
    enemyValid: true,
    switchId: 1,
    switchValid: true,
    turnA: 0,
    turnB: 0,
    turnEnding: false,
    turnValid: false,
  };

  const state = createDefaultRmmvDatabaseEntry("States", 1);
  state.traits = [{ code: 31, dataId: 1, value: 1 }];

  const commonEvent = createDefaultRmmvDatabaseEntry("CommonEvents", 1);
  commonEvent.trigger = 1;
  commonEvent.switchId = 1;

  const system = createDefaultRmmvDatabaseEntry("System");
  system.elements = ["", "Fire"];
  system.skillTypes = ["", "Magic"];
  system.weaponTypes = ["", "Sword"];
  system.armorTypes = ["", "Armor"];
  system.equipTypes = ["", "Weapon", "Shield"];
  system.switches = ["", ""];
  system.variables = ["", ""];
  system.partyMembers = [1];
  system.testBattlers = [{ actorId: 1, equips: [1, 1], level: 1 }];
  system.testTroopId = 1;
  system.startMapId = 1;
  system.editMapId = 1;
  system.magicSkills = [1];

  return {
    actors: one(actor),
    classes: one(classEntry),
    skills: one(skill),
    items: one(item),
    weapons: one(weapon),
    armors: one(armor),
    enemies: one(enemy),
    troops: one(troop),
    states: one(state),
    animations: one(createDefaultRmmvDatabaseEntry("Animations", 1)),
    tilesets: one(createDefaultRmmvDatabaseEntry("Tilesets", 1)),
    commonEvents: one(commonEvent),
    system,
  };
}

function issuePaths(snapshot: RmmvDatabaseSnapshot): string[] {
  return validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] }).issues.map((issue) => issue.source.path);
}

describe("RMMV prospective database validation", () => {
  test("declares original MV entry limits and omits the non-MV State default field", () => {
    const expected = new Map<string, number | null>([
      ["Actors", 1000],
      ["Classes", 1000],
      ["Skills", 2000],
      ["Items", 2000],
      ["Weapons", 2000],
      ["Armors", 2000],
      ["Enemies", 2000],
      ["Troops", 2000],
      ["States", 1000],
      ["Animations", 1000],
      ["Tilesets", 1000],
      ["CommonEvents", 1000],
      ["System", null],
      ["Types", null],
      ["Terms", null],
    ]);

    for (const [group, maxEntries] of expected) {
      assert.equal(getRmmvDatabaseSchema(group).maxEntries, maxEntries, group);
    }

    const state = createDefaultRmmvDatabaseEntry("States", 1);
    assert.equal(Object.hasOwn(state, "releaseByDamage"), false);
    assert.equal(Object.hasOwn(state, "removeByDamage"), true);
  });

  test("accepts standard direct, trait, effect, equipment, map, and special-value references", () => {
    const result = validateRmmvDatabaseSnapshot(validSnapshot(), { mapIds: [1] });
    assert.equal(result.ok, true, result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
    assert.equal(result.pluginSemanticsValidated, false);
    assert.match(result.limitations.join("\n"), /plugin/i);
  });

  test("reports missing standard references at exact source paths", () => {
    const snapshot = validSnapshot();
    (snapshot.actors as Array<Record<string, unknown> | null>)[1]!.classId = 2;
    ((snapshot.classes as Array<Record<string, unknown> | null>)[1]!.learnings as Array<Record<string, unknown>>)[0].skillId = 2;
    ((snapshot.skills as Array<Record<string, unknown> | null>)[1]!.damage as Record<string, unknown>).elementId = 2;
    ((snapshot.weapons as Array<Record<string, unknown> | null>)[1]!.traits as Array<Record<string, unknown>>)[0].dataId = 2;
    ((snapshot.items as Array<Record<string, unknown> | null>)[1]!.effects as Array<Record<string, unknown>>)[0] = {
      code: 44,
      dataId: 2,
      value1: 0,
      value2: 0,
    };
    (snapshot.system as Record<string, unknown>).startMapId = 2;
    (snapshot.system as Record<string, unknown>).magicSkills = [2];
    (snapshot.commonEvents as Array<Record<string, unknown> | null>)[1]!.switchId = 2;

    const paths = issuePaths(snapshot);
    assert.ok(paths.includes("actors[1].classId"));
    assert.ok(paths.includes("classes[1].learnings[0].skillId"));
    assert.ok(paths.includes("skills[1].damage.elementId"));
    assert.ok(paths.includes("weapons[1].traits[0].dataId"));
    assert.ok(paths.includes("items[1].effects[0].dataId"));
    assert.ok(paths.includes("system.startMapId"));
    assert.ok(paths.includes("system.magicSkills[0]"));
    assert.ok(paths.includes("commonEvents[1].switchId"));
  });

  test("validates fixed trait/effect operands and compiles formulas without executing them", () => {
    const snapshot = validSnapshot();
    const marker = "__rmmvFormulaExecuted";
    delete (globalThis as Record<string, unknown>)[marker];
    ((snapshot.skills as Array<Record<string, unknown> | null>)[1]!.damage as Record<string, unknown>).formula =
      `globalThis.${marker} = true`;

    const safe = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(safe.ok, true);
    assert.equal((globalThis as Record<string, unknown>)[marker], undefined);

    ((snapshot.skills as Array<Record<string, unknown> | null>)[1]!.damage as Record<string, unknown>).formula = "a.(";
    ((snapshot.states as Array<Record<string, unknown> | null>)[1]!.traits as Array<Record<string, unknown>>)[0] = {
      code: 21,
      dataId: 8,
      value: 1,
    };
    ((snapshot.items as Array<Record<string, unknown> | null>)[1]!.effects as Array<Record<string, unknown>>)[0] = {
      code: 31,
      dataId: 8,
      value1: 1,
      value2: 0,
    };

    const invalid = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(invalid.ok, false);
    const codes = invalid.issues.map((issue) => issue.code);
    assert.ok(codes.includes("DB_FORMULA_SYNTAX"));
    assert.ok(codes.includes("DB_TRAIT_DATA_ID"));
    assert.ok(codes.includes("DB_EFFECT_DATA_ID"));
  });

  test("reports existing over-limit data but only blocks newly occupied over-limit slots", () => {
    const beforeSkills: Array<Record<string, unknown> | null> = [null];
    beforeSkills[2001] = { id: 2001, name: "" };
    const before: RmmvDatabaseSnapshot = { skills: beforeSkills };

    const unchanged = validateRmmvDatabaseTransition(before, structuredClone(before));
    assert.equal(unchanged.ok, true);
    assert.ok(unchanged.issues.some((issue) => issue.code === "DB_LIMIT_EXCEEDED" && issue.severity === "warning"));

    const afterSkills = structuredClone(beforeSkills);
    afterSkills[2002] = { id: 2002, name: "" };
    const changed = validateRmmvDatabaseTransition(before, { skills: afterSkills });
    assert.equal(changed.ok, false);
    assert.ok(changed.issues.some((issue) =>
      issue.code === "DB_NEW_ENTRY_OVER_LIMIT" && issue.source.path === "skills[2002]"
    ));
  });

  test("validates the final batch state so a record may reference another record created in the same batch", () => {
    const snapshot = validSnapshot();
    const skills = snapshot.skills as Array<Record<string, unknown> | null>;
    const classes = snapshot.classes as Array<Record<string, unknown> | null>;
    skills[2] = { ...createDefaultRmmvDatabaseEntry("Skills", 2), stypeId: 1 };
    (classes[1]!.learnings as Array<Record<string, unknown>>).push({ level: 2, note: "", skillId: 2 });

    const result = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(result.ok, true, result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
  });

  test("requires array record ids to match their stable slot", () => {
    const snapshot: Partial<Record<RmmvDatabaseTableKey, unknown>> = {
      actors: [null, { id: 2, name: "" }],
    };
    const result = validateRmmvDatabaseSnapshot(snapshot);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) =>
      issue.code === "DB_ENTRY_ID_MISMATCH" && issue.source.path === "actors[1].id"
    ));
  });
});
