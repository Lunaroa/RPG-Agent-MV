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
    assert.deepEqual(createDefaultRmmvDatabaseEntry("Skills", 1).effects, []);
    assert.deepEqual(createDefaultRmmvDatabaseEntry("Items", 1).effects, []);
    assert.deepEqual(createDefaultRmmvDatabaseEntry("Weapons", 1).traits, []);
    assert.deepEqual(createDefaultRmmvDatabaseEntry("Armors", 1).traits, []);
    assert.deepEqual(createDefaultRmmvDatabaseEntry("Enemies", 1).traits, []);
  });

  test("accepts standard direct, trait, effect, equipment, map, and special-value references", () => {
    const result = validateRmmvDatabaseSnapshot(validSnapshot(), { mapIds: [1] });
    assert.equal(result.ok, true, result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
    assert.equal(result.pluginSemanticsValidated, false);
    assert.match(result.limitations.join("\n"), /plugin/i);
  });

  test("accepts MV skill type zero and ignores dataId for disabled enemy drop slots", () => {
    const snapshot = validSnapshot();
    (snapshot.skills as Array<Record<string, unknown> | null>)[1]!.stypeId = 0;
    (snapshot.enemies as Array<Record<string, unknown> | null>)[1]!.dropItems = [
      { kind: 0, dataId: 1, denominator: 1 },
    ];

    const valid = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(valid.ok, true, valid.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));

    (snapshot.enemies as Array<Record<string, unknown> | null>)[1]!.dropItems = [
      { kind: 1, dataId: 2, denominator: 1 },
    ];
    assert.ok(issuePaths(snapshot).includes("enemies[1].dropItems[0].dataId"));
  });

  test("accepts the MZ-only friend and everyone target scopes without widening MV", () => {
    for (const scope of [12, 13, 14]) {
      const snapshot = validSnapshot();
      (snapshot.skills as Array<Record<string, unknown> | null>)[1]!.scope = scope;
      const mz = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1], engine: "rpg-maker-mz" });
      assert.equal(mz.issues.some((issue) => issue.code === "DB_USABLE_SCOPE"), false);
    }

    const snapshot = validSnapshot();
    (snapshot.skills as Array<Record<string, unknown> | null>)[1]!.scope = 12;
    const mv = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1], engine: "rpg-maker-mv" });
    assert.ok(mv.issues.some((issue) => issue.code === "DB_USABLE_SCOPE"));
  });

  test("validates standard enemy action conditions and preserves unknown plugin conditions as warnings", () => {
    const snapshot = validSnapshot();
    const enemy = (snapshot.enemies as Array<Record<string, unknown> | null>)[1]!;
    enemy.actions = [
      { conditionParam1: 0, conditionParam2: 0, conditionType: 0, rating: 5, skillId: 1 },
      { conditionParam1: 1, conditionParam2: 3, conditionType: 1, rating: 5, skillId: 1 },
      { conditionParam1: 0.25, conditionParam2: 0.75, conditionType: 2, rating: 9, skillId: 1 },
      { conditionParam1: 0.1, conditionParam2: 1, conditionType: 3, rating: 5, skillId: 1 },
      { conditionParam1: 1, conditionParam2: 0, conditionType: 4, rating: 5, skillId: 1 },
      { conditionParam1: 12, conditionParam2: 0, conditionType: 5, rating: 5, skillId: 1 },
      { conditionParam1: 1, conditionParam2: 0, conditionType: 6, rating: 1, skillId: 1 },
      { conditionParam1: 0, conditionParam2: 0, conditionType: 99, rating: 5, skillId: 1 },
    ];

    const valid = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(valid.ok, true, valid.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
    assert.ok(valid.issues.some((issue) =>
      issue.code === "DB_PLUGIN_ENEMY_ACTION_CONDITION" && issue.severity === "warning"
    ));

    enemy.actions = [
      { conditionParam1: 0.8, conditionParam2: 0.2, conditionType: 3, rating: 10, skillId: 1 },
      { conditionParam1: 2, conditionParam2: 0, conditionType: 4, rating: 5, skillId: 1 },
      { conditionParam1: 2, conditionParam2: 0, conditionType: 6, rating: 5, skillId: 1 },
      { conditionParam1: -1, conditionParam2: 0, conditionType: 1, rating: 5, skillId: 1 },
    ];
    const invalid = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(invalid.ok, false);
    const paths = invalid.issues.map((issue) => issue.source.path);
    assert.ok(paths.includes("enemies[1].actions[0].conditionParam1"));
    assert.ok(paths.includes("enemies[1].actions[0].rating"));
    assert.ok(paths.includes("enemies[1].actions[1].conditionParam1"));
    assert.ok(paths.includes("enemies[1].actions[2].conditionParam1"));
    assert.ok(paths.includes("enemies[1].actions[3].conditionParam1"));
  });

  test("validates equipment against effective equip types and actor or class dual wield", () => {
    const snapshot = validSnapshot();
    const actor = (snapshot.actors as Array<Record<string, unknown> | null>)[1]!;
    const classEntry = (snapshot.classes as Array<Record<string, unknown> | null>)[1]!;
    const armor = (snapshot.armors as Array<Record<string, unknown> | null>)[1]!;

    classEntry.traits = [{ code: 55, dataId: 1, value: 1 }];
    assert.equal(validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] }).ok, true);

    classEntry.traits = [];
    armor.etypeId = 3;
    const mismatch = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(mismatch.ok, false);
    assert.ok(mismatch.issues.some((issue) =>
      issue.code === "DB_EQUIPMENT_SLOT_TYPE" && issue.source.path === "actors[1].equips[1]"
    ));

    armor.etypeId = 2;
    actor.equips = [1, 1, 0, 0, 0, 99];
    const pluginSlot = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(pluginSlot.ok, true);
    assert.ok(pluginSlot.issues.some((issue) =>
      issue.code === "DB_PLUGIN_EQUIPMENT_SLOT" && issue.severity === "warning"
    ));
  });

  test("validates System Battle Test actor levels from 1 through 99", () => {
    const snapshot = validSnapshot();
    const battlers = (snapshot.system as Record<string, unknown>).testBattlers as Array<Record<string, unknown>>;
    battlers[0].level = 100;
    const result = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.ok(result.issues.some((issue) => (
      issue.code === "DB_TEST_BATTLER_LEVEL"
      && issue.source.path === "system.testBattlers[0].level"
    )));
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

  test("validates the standard numeric range matrix at exact database paths", () => {
    const snapshot = validSnapshot();
    (snapshot.actors as Array<Record<string, unknown> | null>)[1]!.initialLevel = 0;
    ((snapshot.classes as Array<Record<string, unknown> | null>)[1]!.params as number[][])[0][99] = 10000;
    (snapshot.skills as Array<Record<string, unknown> | null>)[1]!.speed = 2001;
    (snapshot.items as Array<Record<string, unknown> | null>)[1]!.itypeId = 5;
    ((snapshot.weapons as Array<Record<string, unknown> | null>)[1]!.params as number[])[2] = 501;
    ((snapshot.enemies as Array<Record<string, unknown> | null>)[1]!.params as number[])[0] = 0;
    (snapshot.states as Array<Record<string, unknown> | null>)[1]!.overlay = 11;
    const animation = (snapshot.animations as Array<Record<string, unknown> | null>)[1]!;
    animation.frames = [[[0, 409, 0, 100, 0, 0, 255, 0]]];
    const tileset = (snapshot.tilesets as Array<Record<string, unknown> | null>)[1]!;
    tileset.mode = 2;
    tileset.flags = [65536];
    const system = snapshot.system as Record<string, unknown>;
    system.attackMotions = [{ type: 3, weaponImageId: 31 }];

    const paths = issuePaths(snapshot);
    assert.ok(paths.includes("actors[1].initialLevel"));
    assert.ok(paths.includes("classes[1].params[0][99]"));
    assert.ok(paths.includes("skills[1].speed"));
    assert.ok(paths.includes("items[1].itypeId"));
    assert.ok(paths.includes("weapons[1].params[2]"));
    assert.ok(paths.includes("enemies[1].params[0]"));
    assert.ok(paths.includes("states[1].overlay"));
    assert.ok(paths.includes("animations[1].frames[0][0][1]"));
    assert.ok(paths.includes("tilesets[1].mode"));
    assert.ok(paths.includes("tilesets[1].flags[0]"));
    assert.ok(paths.includes("system.attackMotions[0].type"));
    assert.ok(paths.includes("system.attackMotions[0].weaponImageId"));
  });

  test("accepts unused values on set traits, checks effect operands, and only warns for plugin codes", () => {
    const snapshot = validSnapshot();
    const state = (snapshot.states as Array<Record<string, unknown> | null>)[1]!;
    state.traits = [
      { code: 14, dataId: 1, value: 0 },
      { code: 41, dataId: 1, value: 0 },
      { code: 51, dataId: 1, value: 0 },
      { code: 52, dataId: 1, value: 0 },
      { code: 900, dataId: 999, value: -999, pluginField: true },
    ];
    const item = (snapshot.items as Array<Record<string, unknown> | null>)[1]!;
    item.effects = [
      { code: 43, dataId: 1, value1: 1, value2: 0 },
      { code: 901, dataId: 999, value1: -999, value2: 999, pluginField: true },
    ];

    const result = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.code === "DB_TRAIT_VALUE"), false);
    assert.ok(result.issues.some((issue) => issue.code === "DB_EFFECT_VALUE" && issue.source.path === "items[1].effects[0].value1"));
    assert.ok(result.issues.some((issue) => issue.code === "DB_PLUGIN_TRAIT_CODE" && issue.severity === "warning"));
    assert.ok(result.issues.some((issue) => issue.code === "DB_PLUGIN_EFFECT_CODE" && issue.severity === "warning"));
  });

  test("skips inactive animation-cell operands and reports malformed fixed-length arrays", () => {
    const snapshot = validSnapshot();
    const animation = (snapshot.animations as Array<Record<string, unknown> | null>)[1]!;
    animation.frames = [[[-1, 9999, -9999, 1, 9999, 3, -1, 99]]];

    const inactive = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    assert.equal(inactive.issues.some((issue) => issue.code.startsWith("DB_ANIMATION_CELL_") && issue.code !== "DB_ANIMATION_CELL_SHAPE"), false);

    const classEntry = (snapshot.classes as Array<Record<string, unknown> | null>)[1]!;
    (classEntry.expParams as unknown[]).pop();
    ((classEntry.params as unknown[][])[0]).pop();
    ((snapshot.weapons as Array<Record<string, unknown> | null>)[1]!.params as unknown[]).pop();
    ((snapshot.enemies as Array<Record<string, unknown> | null>)[1]!.params as unknown[]).pop();
    (snapshot.system as Record<string, unknown>).windowTone = [0, 0, 0];

    const malformed = validateRmmvDatabaseSnapshot(snapshot, { mapIds: [1] });
    const paths = malformed.issues
      .filter((issue) => issue.code === "DB_FIXED_ARRAY_LENGTH")
      .map((issue) => issue.source.path);
    assert.ok(paths.includes("classes[1].expParams"));
    assert.ok(paths.includes("classes[1].params[0]"));
    assert.ok(paths.includes("weapons[1].params"));
    assert.ok(paths.includes("enemies[1].params"));
    assert.ok(paths.includes("system.windowTone"));
  });

  test("transition validation ignores unchanged legacy errors but blocks newly introduced errors", () => {
    const before = validSnapshot();
    (before.items as Array<Record<string, unknown> | null>)[1]!.price = -1;
    const after = structuredClone(before);
    (after.items as Array<Record<string, unknown> | null>)[1]!.name = "Updated";

    const unrelated = validateRmmvDatabaseTransition(before, after, { mapIds: [1] });
    assert.equal(unrelated.ok, true);
    assert.equal(unrelated.issues.some((issue) => issue.source.path === "items[1].price"), false);

    (after.items as Array<Record<string, unknown> | null>)[1]!.price = -2;
    const worsenedLegacyValue = validateRmmvDatabaseTransition(before, after, { mapIds: [1] });
    assert.equal(worsenedLegacyValue.ok, false);
    assert.ok(worsenedLegacyValue.issues.some((issue) => issue.source.path === "items[1].price"));

    (after.items as Array<Record<string, unknown> | null>)[1]!.price = -1;
    (after.items as Array<Record<string, unknown> | null>)[1]!.speed = 2001;
    const introduced = validateRmmvDatabaseTransition(before, after, { mapIds: [1] });
    assert.equal(introduced.ok, false);
    assert.ok(introduced.issues.some((issue) => issue.source.path === "items[1].speed"));
  });

  test("transition validation compares map issues against the actual before and after documents", () => {
    const snapshot = validSnapshot();
    const beforeMap = {
      mapId: 1,
      value: {
        tilesetId: 1,
        encounterList: [],
        events: [null, { id: 2, pages: [] }],
      },
    };
    const afterMap = structuredClone(beforeMap);
    ((afterMap.value.events as Array<Record<string, unknown> | null>)[1]!).id = 3;

    const unchanged = validateRmmvDatabaseTransition(snapshot, structuredClone(snapshot), {
      beforeMaps: [beforeMap],
      maps: [structuredClone(beforeMap)],
    });
    assert.equal(unchanged.ok, true);

    const changed = validateRmmvDatabaseTransition(snapshot, structuredClone(snapshot), {
      beforeMaps: [beforeMap],
      maps: [afterMap],
    });
    assert.equal(changed.ok, false);
    assert.ok(changed.issues.some((issue) => issue.source.path === "maps[1].events[1].id"));
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

  test("uses the MZ 1.10 entry limit when validating new armor slots", () => {
    const before: RmmvDatabaseSnapshot = { armors: [null] };
    const armors: Array<Record<string, unknown> | null> = [null];
    armors[9999] = { id: 9999, name: "" };

    const mz = validateRmmvDatabaseTransition(before, { armors }, { engine: "rpg-maker-mz" });
    assert.equal(mz.ok, true);

    const overLimit = [...armors];
    overLimit[10000] = { id: 10000, name: "" };
    const invalidMZ = validateRmmvDatabaseTransition(before, { armors: overLimit }, { engine: "rpg-maker-mz" });
    assert.equal(invalidMZ.ok, false);
    assert.ok(invalidMZ.issues.some((issue) => (
      issue.code === "DB_NEW_ENTRY_OVER_LIMIT"
      && issue.source.path === "armors[10000]"
      && /RPG Maker MZ limit of 9999/.test(issue.message)
    )));

    const mv = validateRmmvDatabaseTransition(before, { armors }, { engine: "rpg-maker-mv" });
    assert.equal(mv.ok, false);
    assert.ok(mv.issues.some((issue) => issue.code === "DB_NEW_ENTRY_OVER_LIMIT"));
  });

  test("strictly validates MZ particle rotation, flash, and sound timing shapes", () => {
    const particle = {
      id: 1,
      name: "Sample Particle",
      displayType: 0,
      effectName: "fx/Spark",
      scale: 100,
      speed: 100,
      offsetX: 0,
      offsetY: 0,
      rotation: { x: 0, y: 0, z: 0 },
      alignBottom: false,
      flashTimings: [{ frame: 0, duration: 30, color: [255, 255, 255, 255] }],
      soundTimings: [{ frame: 0, se: { name: "Hit1", volume: 90, pitch: 100, pan: 0 } }],
    };
    const valid = validateRmmvDatabaseSnapshot({ animations: [null, particle] }, { engine: "rpg-maker-mz" });
    assert.equal(valid.ok, true);

    const invalid = structuredClone(particle);
    invalid.flashTimings[0].color[2] = 300;
    (invalid.soundTimings as unknown[])[0] = null;
    const result = validateRmmvDatabaseSnapshot({ animations: [null, invalid] }, { engine: "rpg-maker-mz" });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => (
      issue.code === "DB_MZ_ANIMATION_FLASH_COLOR"
      && issue.source.path === "animations[1].flashTimings[0].color[2]"
    )));
    assert.ok(result.issues.some((issue) => (
      issue.code === "DB_MZ_ANIMATION_SOUND_TIMING"
      && issue.source.path === "animations[1].soundTimings[0]"
    )));

    const malformed = structuredClone(particle) as Record<string, unknown>;
    malformed.flashTimings = {};
    malformed.soundTimings = "bad";
    const malformedResult = validateRmmvDatabaseSnapshot({ animations: [null, malformed] }, { engine: "rpg-maker-mz" });
    assert.ok(malformedResult.issues.some((issue) => issue.code === "DB_MZ_ANIMATION_FLASH_TIMINGS"));
    assert.ok(malformedResult.issues.some((issue) => issue.code === "DB_MZ_ANIMATION_SOUND_TIMINGS"));
  });

  test("exposes and strictly validates the MZ 1.10 advanced system settings", () => {
    const system = createDefaultRmmvDatabaseEntry("System", undefined, "rpg-maker-mz");
    system.partyMembers = [];
    system.testTroopId = 0;
    const advanced = system.advanced as Record<string, unknown>;
    assert.equal(advanced.picturesUpperLimit, 300);
    assert.equal(advanced.screenScale, 1);
    assert.equal(advanced.windowOpacity, 192);

    const valid = validateRmmvDatabaseSnapshot({ system }, { engine: "rpg-maker-mz" });
    assert.equal(valid.ok, true, valid.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));

    advanced.mainFontFilename = 42;
    advanced.fontSize = 0;
    advanced.picturesUpperLimit = 1.5;
    advanced.screenScale = 0;
    advanced.windowOpacity = 256;
    system.optMessageSkip = "yes";
    const invalid = validateRmmvDatabaseSnapshot({ system }, { engine: "rpg-maker-mz" });
    for (const code of [
      "DB_MZ_SYSTEM_TEXT",
      "DB_MZ_FONT_SIZE",
      "DB_MZ_PICTURE_LIMIT",
      "DB_MZ_SCREEN_SCALE",
      "DB_MZ_WINDOW_OPACITY",
      "DB_MZ_SYSTEM_OPTION",
    ]) {
      assert.ok(invalid.issues.some((issue) => issue.code === code), `missing ${code}`);
    }
  });

  test("allows reducing legacy troop and test-party overages but blocks extending them", () => {
    const before = validSnapshot();
    const troop = (before.troops as Array<Record<string, unknown> | null>)[1]!;
    troop.members = Array.from({ length: 9 }, () => ({ enemyId: 1, hidden: false, x: 408, y: 436 }));
    (before.system as Record<string, unknown>).testBattlers = Array.from({ length: 5 }, () => ({
      actorId: 1,
      equips: [1, 1],
      level: 1,
    }));

    const reduced = structuredClone(before);
    (reduced.troops as Array<Record<string, unknown> | null>)[1]!.members =
      ((reduced.troops as Array<Record<string, unknown> | null>)[1]!.members as unknown[]).slice(0, 8);
    (reduced.system as Record<string, unknown>).testBattlers =
      ((reduced.system as Record<string, unknown>).testBattlers as unknown[]).slice(0, 4);
    assert.equal(validateRmmvDatabaseTransition(before, reduced, { mapIds: [1] }).ok, true);

    const extended = structuredClone(before);
    ((extended.troops as Array<Record<string, unknown> | null>)[1]!.members as unknown[]).push({
      enemyId: 1,
      hidden: false,
      x: 408,
      y: 436,
    });
    ((extended.system as Record<string, unknown>).testBattlers as unknown[]).push({ actorId: 1, equips: [1, 1], level: 1 });
    const invalid = validateRmmvDatabaseTransition(before, extended, { mapIds: [1] });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.issues.some((issue) => issue.code === "DB_TROOP_MEMBER_LIMIT" && issue.severity === "error"));
    assert.ok(invalid.issues.some((issue) => issue.code === "DB_TEST_BATTLER_LIMIT" && issue.severity === "error"));
  });

  test("allows reducing legacy animation overages but blocks extending them", () => {
    const before = validSnapshot();
    const animation = (before.animations as Array<Record<string, unknown> | null>)[1]!;
    animation.frames = Array.from({ length: 201 }, () => (
      Array.from({ length: 17 }, () => [-1, 0, 0, 100, 0, 0, 255, 0])
    ));

    const reduced = structuredClone(before);
    (reduced.animations as Array<Record<string, unknown> | null>)[1]!.frames =
      ((reduced.animations as Array<Record<string, unknown> | null>)[1]!.frames as unknown[]).slice(0, 200);
    assert.equal(validateRmmvDatabaseTransition(before, reduced, { mapIds: [1] }).ok, true);

    const extended = structuredClone(before);
    ((extended.animations as Array<Record<string, unknown> | null>)[1]!.frames as unknown[]).push([]);
    (((extended.animations as Array<Record<string, unknown> | null>)[1]!.frames as unknown[][])[0]).push(
      [-1, 0, 0, 100, 0, 0, 255, 0],
    );
    const result = validateRmmvDatabaseTransition(before, extended, { mapIds: [1] });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "DB_ANIMATION_FRAME_LIMIT" && issue.severity === "error"));
    assert.ok(result.issues.some((issue) => issue.code === "DB_ANIMATION_CELL_LIMIT" && issue.severity === "error"));
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

  test("validates command and page-condition references in common events, troop pages, and maps", () => {
    const snapshot = validSnapshot();
    const commonEvent = (snapshot.commonEvents as Array<Record<string, unknown> | null>)[1]!;
    commonEvent.list = [
      { code: 117, indent: 0, parameters: [2] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const troop = (snapshot.troops as Array<Record<string, unknown> | null>)[1]!;
    const troopPage = (troop.pages as Array<Record<string, unknown>>)[0];
    troopPage.list = [
      { code: 333, indent: 0, parameters: [-1, 0, 2] },
      { code: 0, indent: 0, parameters: [] },
    ];

    const result = validateRmmvDatabaseSnapshot(snapshot, {
      mapIds: [1],
      maps: [{
        mapId: 1,
        value: {
          tilesetId: 2,
          encounterList: [{ troopId: 2, weight: 10, regionSet: [] }],
          events: [null, {
            id: 1,
            pages: [{
              conditions: {
                actorId: 2,
                actorValid: true,
                itemId: 2,
                itemValid: true,
                selfSwitchCh: "A",
                selfSwitchValid: false,
                switch1Id: 2,
                switch1Valid: true,
                switch2Id: 1,
                switch2Valid: false,
                variableId: 2,
                variableValid: true,
                variableValue: 0,
              },
              list: [
                { code: 126, indent: 0, parameters: [2, 0, 0, 1] },
                { code: 0, indent: 0, parameters: [] },
              ],
            }],
          }],
        },
      }],
    });

    assert.equal(result.ok, false);
    const paths = result.issues.map((issue) => issue.source.path);
    assert.ok(paths.includes("commonEvents[1].list[0].parameters[0]"));
    assert.ok(paths.includes("troops[1].pages[0].list[0].parameters[2]"));
    assert.ok(paths.includes("maps[1].tilesetId"));
    assert.ok(paths.includes("maps[1].encounterList[0].troopId"));
    assert.ok(paths.includes("maps[1].events[1].pages[0].conditions.actorId"));
    assert.ok(paths.includes("maps[1].events[1].pages[0].conditions.itemId"));
    assert.ok(paths.includes("maps[1].events[1].pages[0].conditions.switch1Id"));
    assert.ok(paths.includes("maps[1].events[1].pages[0].conditions.variableId"));
    assert.ok(paths.includes("maps[1].events[1].pages[0].list[0].parameters[0]"));
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
