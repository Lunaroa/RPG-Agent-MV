import { Script } from "node:vm";
import { isDeepStrictEqual } from "node:util";

import {
  getRmmvDatabaseSchemaByKey,
  listRmmvDatabaseSchemas,
  type RmmvDatabaseTableKey,
} from "./database-schema.ts";
import {
  collectEventCommandReferences,
  type RmmvEventCommandReference,
  type RmmvEventReferenceTarget,
} from "./event-command-references.ts";
import {
  hasStandardDualWield,
  MV_WEAPON_EQUIP_TYPE_ID,
  standardEquipSlotTypeIds,
} from "./equipment-slots.ts";

export type RmmvDatabaseSnapshot = Partial<Record<RmmvDatabaseTableKey, unknown>>;

export type RmmvDatabaseIssueSeverity = "error" | "warning";
export type RmmvDatabaseIssueTable = RmmvDatabaseTableKey | "maps";

export interface RmmvDatabaseIssueSource {
  table: RmmvDatabaseIssueTable;
  id?: number;
  path: string;
}

export interface RmmvDatabaseSemanticIssue {
  code: string;
  severity: RmmvDatabaseIssueSeverity;
  source: RmmvDatabaseIssueSource;
  message: string;
}

export interface RmmvDatabaseSemanticValidationResult {
  ok: boolean;
  issues: RmmvDatabaseSemanticIssue[];
  pluginSemanticsValidated: false;
  limitations: string[];
}

export interface RmmvDatabaseValidationOptions {
  mapIds?: readonly number[];
  maps?: readonly RmmvDatabaseMapDocument[];
}

export interface RmmvDatabaseTransitionValidationOptions extends RmmvDatabaseValidationOptions {
  beforeMaps?: readonly RmmvDatabaseMapDocument[];
}

export interface RmmvDatabaseMapDocument {
  mapId: number;
  value: unknown;
}

const ARRAY_TABLE_KEYS = listRmmvDatabaseSchemas()
  .filter((schema) => schema.isArrayTable)
  .map((schema) => schema.key);

const PLUGIN_LIMITATION = "Unknown plugin fields and note-tag semantics are preserved but are not validated.";
const STANDARD_TRAIT_CODES = new Set([11, 12, 13, 14, 21, 22, 23, 31, 32, 33, 34, 41, 42, 43, 44, 51, 52, 53, 54, 55, 61, 62, 63, 64]);
const STANDARD_EFFECT_CODES = new Set([11, 12, 13, 21, 22, 31, 32, 33, 34, 41, 42, 43, 44]);

export function validateRmmvDatabaseSnapshot(
  snapshot: RmmvDatabaseSnapshot,
  options: RmmvDatabaseValidationOptions = {},
): RmmvDatabaseSemanticValidationResult {
  const validator = new SnapshotValidator(snapshot, options);
  validator.validate();
  return validator.result();
}

export function validateRmmvDatabaseTransition(
  before: RmmvDatabaseSnapshot,
  after: RmmvDatabaseSnapshot,
  options: RmmvDatabaseTransitionValidationOptions = {},
): RmmvDatabaseSemanticValidationResult {
  const beforeOptions: RmmvDatabaseValidationOptions = {
    ...(options.mapIds ? { mapIds: options.mapIds } : {}),
    ...(options.beforeMaps || options.maps ? { maps: options.beforeMaps ?? options.maps } : {}),
  };
  const afterOptions: RmmvDatabaseValidationOptions = {
    ...(options.mapIds ? { mapIds: options.mapIds } : {}),
    ...(options.maps ? { maps: options.maps } : {}),
  };
  const beforeResult = validateRmmvDatabaseSnapshot(before, beforeOptions);
  const result = validateRmmvDatabaseSnapshot(after, afterOptions);
  const issues = prospectiveIssues(
    beforeResult.issues,
    result.issues,
    before,
    after,
    beforeOptions.maps ?? [],
    afterOptions.maps ?? [],
  );

  for (const table of ARRAY_TABLE_KEYS) {
    const schema = getRmmvDatabaseSchemaByKey(table);
    if (schema.maxEntries === null) continue;
    const beforeRecords = asArray(before[table]);
    const afterRecords = asArray(after[table]);
    for (let id = schema.maxEntries + 1; id < afterRecords.length; id += 1) {
      if (!isRecord(afterRecords[id]) || isRecord(beforeRecords[id])) continue;
      issues.push({
        code: "DB_NEW_ENTRY_OVER_LIMIT",
        severity: "error",
        source: { table, id, path: `${table}[${id}]` },
        message: `${schema.group} id ${id} exceeds the RPG Maker MV limit of ${schema.maxEntries}.`,
      });
    }
  }

  validateCollectionGrowth(before, after, issues);

  return completeResult(issues, result.limitations);
}

class SnapshotValidator {
  readonly snapshot: RmmvDatabaseSnapshot;
  readonly #issues: RmmvDatabaseSemanticIssue[] = [];
  readonly #limitations = [PLUGIN_LIMITATION];
  readonly #mapIds: ReadonlySet<number> | null;
  readonly #maps: readonly RmmvDatabaseMapDocument[];

  constructor(
    snapshot: RmmvDatabaseSnapshot,
    options: RmmvDatabaseValidationOptions,
  ) {
    this.snapshot = snapshot;
    this.#maps = options.maps ?? [];
    this.#mapIds = options.mapIds || this.#maps.length
      ? new Set([...(options.mapIds ?? []), ...this.#maps.map((entry) => entry.mapId)])
      : null;
  }

  validate(): void {
    this.validateShapesAndLimits();
    this.validateActors();
    this.validateClasses();
    this.validateSkills();
    this.validateItems();
    this.validateWeapons();
    this.validateArmors();
    this.validateEnemies();
    this.validateTroops();
    this.validateStates();
    this.validateAnimations();
    this.validateTilesets();
    this.validateCommonEvents();
    this.validateSystem();
    this.validateMaps();
  }

  result(): RmmvDatabaseSemanticValidationResult {
    return completeResult(this.#issues, this.#limitations);
  }

  private validateShapesAndLimits(): void {
    for (const table of ARRAY_TABLE_KEYS) {
      const value = this.snapshot[table];
      if (value === undefined) continue;
      if (!Array.isArray(value)) {
        this.add("DB_TABLE_SHAPE", table, `${table}`, `${table} must be an array.`);
        continue;
      }

      const schema = getRmmvDatabaseSchemaByKey(table);
      if (value[0] !== null && value[0] !== undefined) {
        this.add("DB_RESERVED_SLOT", table, `${table}[0]`, `${schema.group} slot 0 must stay empty.`, 0);
      }

      let highestId = 0;
      for (let id = 1; id < value.length; id += 1) {
        const entry = value[id];
        if (entry === null || entry === undefined) continue;
        highestId = id;
        if (!isRecord(entry)) {
          this.add("DB_ENTRY_SHAPE", table, `${table}[${id}]`, `${schema.group} slot ${id} must be an object or null.`, id);
          continue;
        }
        if (entry.id !== id) {
          this.add(
            "DB_ENTRY_ID_MISMATCH",
            table,
            `${table}[${id}].id`,
            `${schema.group} entry id must match its stable array slot ${id}.`,
            id,
          );
        }
        const structural = schema.validate(entry);
        for (const issue of structural.issues) {
          const suffix = issue.path === "$" ? "" : `.${issue.path}`;
          this.add(
            "DB_ENTRY_SHAPE",
            table,
            `${table}[${id}]${suffix}`,
            issue.message,
            id,
          );
        }
      }

      if (schema.maxEntries !== null && highestId > schema.maxEntries) {
        this.add(
          "DB_LIMIT_EXCEEDED",
          table,
          table,
          `${schema.group} contains id ${highestId}, above the RPG Maker MV limit of ${schema.maxEntries}. Existing data is readable but must not be extended.`,
          undefined,
          "warning",
        );
      }
    }

    const system = this.system();
    if (system) {
      const structural = getRmmvDatabaseSchemaByKey("system").validate(system);
      for (const issue of structural.issues) {
        const path = issue.path === "$" ? "system" : `system.${issue.path}`;
        this.add("DB_ENTRY_SHAPE", "system", path, issue.message);
      }
    }
  }

  private validateActors(): void {
    this.forEachRecord("actors", (actor, id) => {
      this.recordReference("actors", id, `actors[${id}].classId`, "classes", actor.classId);
      this.fixedRange("DB_ACTOR_LEVEL", "actors", id, `actors[${id}].initialLevel`, actor.initialLevel, 1, 99);
      this.fixedRange("DB_ACTOR_LEVEL", "actors", id, `actors[${id}].maxLevel`, actor.maxLevel, 1, 99);
      const initialLevel = asInteger(actor.initialLevel);
      const maxLevel = asInteger(actor.maxLevel);
      if (initialLevel !== null && maxLevel !== null && initialLevel > maxLevel) {
        this.add(
          "DB_ACTOR_LEVEL_ORDER",
          "actors",
          `actors[${id}].initialLevel`,
          "Initial level must not exceed max level.",
          id,
        );
      }
      this.fixedRange("DB_ACTOR_IMAGE_INDEX", "actors", id, `actors[${id}].characterIndex`, actor.characterIndex, 0, 7);
      this.fixedRange("DB_ACTOR_IMAGE_INDEX", "actors", id, `actors[${id}].faceIndex`, actor.faceIndex, 0, 7);
      this.validateTraits("actors", id, actor.traits, `actors[${id}].traits`);
      this.validateEquipment("actors", id, actor.equips, `actors[${id}].equips`, id);
    });
  }

  private validateClasses(): void {
    this.forEachRecord("classes", (classEntry, id) => {
      this.fixedArrayLength("classes", id, `classes[${id}].expParams`, classEntry.expParams, 4);
      this.validateClassParameterCurves(classEntry.params, id);
      forEachRecordValue(classEntry.learnings, (learning, index) => {
        this.fixedRange(
          "DB_CLASS_LEARNING_LEVEL",
          "classes",
          id,
          `classes[${id}].learnings[${index}].level`,
          learning.level,
          1,
          99,
        );
        this.recordReference(
          "classes",
          id,
          `classes[${id}].learnings[${index}].skillId`,
          "skills",
          learning.skillId,
        );
      });
      this.validateTraits("classes", id, classEntry.traits, `classes[${id}].traits`);
    });
  }

  private validateSkills(): void {
    this.forEachRecord("skills", (skill, id) => {
      this.typeReference("skills", id, `skills[${id}].stypeId`, "skillTypes", skill.stypeId, [0]);
      this.typeReference(
        "skills",
        id,
        `skills[${id}].requiredWtypeId1`,
        "weaponTypes",
        skill.requiredWtypeId1,
        [0],
      );
      this.typeReference(
        "skills",
        id,
        `skills[${id}].requiredWtypeId2`,
        "weaponTypes",
        skill.requiredWtypeId2,
        [0],
      );
      this.recordReference("skills", id, `skills[${id}].animationId`, "animations", skill.animationId, [0, -1]);
      this.validateUsableItemNumbers("skills", id, skill);
      this.fixedRange("DB_SKILL_MP_COST", "skills", id, `skills[${id}].mpCost`, skill.mpCost, 0, 999);
      this.fixedRange("DB_SKILL_TP_COST", "skills", id, `skills[${id}].tpCost`, skill.tpCost, 0, 100);
      this.validateDamage("skills", id, skill.damage, `skills[${id}].damage`);
      this.validateEffects("skills", id, skill.effects, `skills[${id}].effects`);
    });
  }

  private validateItems(): void {
    this.forEachRecord("items", (item, id) => {
      this.fixedRange("DB_REFERENCE_ID", "items", id, `items[${id}].itypeId`, item.itypeId, 1, 4);
      this.recordReference("items", id, `items[${id}].animationId`, "animations", item.animationId, [0, -1]);
      this.validateUsableItemNumbers("items", id, item);
      this.fixedRange("DB_SHOP_PRICE", "items", id, `items[${id}].price`, item.price, 0, 999999);
      this.validateDamage("items", id, item.damage, `items[${id}].damage`);
      this.validateEffects("items", id, item.effects, `items[${id}].effects`);
    });
  }

  private validateWeapons(): void {
    this.forEachRecord("weapons", (weapon, id) => {
      this.typeReference("weapons", id, `weapons[${id}].wtypeId`, "weaponTypes", weapon.wtypeId);
      this.typeReference("weapons", id, `weapons[${id}].etypeId`, "equipTypes", weapon.etypeId);
      this.recordReference("weapons", id, `weapons[${id}].animationId`, "animations", weapon.animationId, [0]);
      this.fixedRange("DB_SHOP_PRICE", "weapons", id, `weapons[${id}].price`, weapon.price, 0, 999999);
      this.validateEquipmentParameters("weapons", id, weapon.params);
      this.validateTraits("weapons", id, weapon.traits, `weapons[${id}].traits`);
    });
  }

  private validateArmors(): void {
    this.forEachRecord("armors", (armor, id) => {
      this.typeReference("armors", id, `armors[${id}].atypeId`, "armorTypes", armor.atypeId);
      this.typeReference("armors", id, `armors[${id}].etypeId`, "equipTypes", armor.etypeId);
      this.fixedRange("DB_SHOP_PRICE", "armors", id, `armors[${id}].price`, armor.price, 0, 999999);
      this.validateEquipmentParameters("armors", id, armor.params);
      this.validateTraits("armors", id, armor.traits, `armors[${id}].traits`);
    });
  }

  private validateEnemies(): void {
    this.forEachRecord("enemies", (enemy, id) => {
      this.fixedRange("DB_ENEMY_HUE", "enemies", id, `enemies[${id}].battlerHue`, enemy.battlerHue, 0, 360);
      this.fixedRange("DB_ENEMY_REWARD", "enemies", id, `enemies[${id}].exp`, enemy.exp, 0, 9999999);
      this.fixedRange("DB_ENEMY_REWARD", "enemies", id, `enemies[${id}].gold`, enemy.gold, 0, 9999999);
      this.validateEnemyParameters(enemy.params, id);
      forEachRecordValue(enemy.actions, (action, index) => {
        const path = `enemies[${id}].actions[${index}]`;
        this.recordReference(
          "enemies",
          id,
          `enemies[${id}].actions[${index}].skillId`,
          "skills",
          action.skillId,
        );
        this.validateEnemyActionCondition(action, id, path);
      });
      forEachRecordValue(enemy.dropItems, (drop, index) => {
        const path = `enemies[${id}].dropItems[${index}]`;
        this.fixedRange("DB_ENEMY_DROP_DENOMINATOR", "enemies", id, `${path}.denominator`, drop.denominator, 1, 1000);
        if (drop.kind === 0) {
          return;
        }
        const targets: Partial<Record<number, RmmvDatabaseTableKey>> = { 1: "items", 2: "weapons", 3: "armors" };
        const target = Number.isInteger(drop.kind) ? targets[Number(drop.kind)] : undefined;
        if (!target) {
          this.fixedRange("DB_REFERENCE_ID", "enemies", id, `${path}.kind`, drop.kind, 0, 3);
          return;
        }
        this.recordReference("enemies", id, `${path}.dataId`, target, drop.dataId);
      });
      this.validateTraits("enemies", id, enemy.traits, `enemies[${id}].traits`);
    });
  }

  private validateTroops(): void {
    this.forEachRecord("troops", (troop, id) => {
      const members = asArray(troop.members);
      if (members.length > 8) {
        this.add(
          "DB_TROOP_MEMBER_LIMIT",
          "troops",
          `troops[${id}].members`,
          `Troop ${id} contains ${members.length} members; RPG Maker MV supports at most 8. Existing data is readable but must not be extended.`,
          id,
          "warning",
        );
      }
      forEachRecordValue(members, (member, index) => {
        const memberPath = `troops[${id}].members[${index}]`;
        this.recordReference(
          "troops",
          id,
          `${memberPath}.enemyId`,
          "enemies",
          member.enemyId,
        );
        this.fixedRange("DB_TROOP_MEMBER_POSITION", "troops", id, `${memberPath}.x`, member.x, 0, 816);
        this.fixedRange("DB_TROOP_MEMBER_POSITION", "troops", id, `${memberPath}.y`, member.y, 0, 624);
      });
      forEachRecordValue(troop.pages, (page, pageIndex) => {
        this.fixedRange(
          "DB_TROOP_PAGE_SPAN",
          "troops",
          id,
          `troops[${id}].pages[${pageIndex}].span`,
          page.span,
          0,
          2,
        );
        const conditions = isRecord(page.conditions) ? page.conditions : null;
        const prefix = `troops[${id}].pages[${pageIndex}].conditions`;
        if (conditions?.turnValid === true) {
          this.nonnegativeInteger("troops", id, `${prefix}.turnA`, conditions.turnA, "DB_TROOP_PAGE_CONDITION");
          this.nonnegativeInteger("troops", id, `${prefix}.turnB`, conditions.turnB, "DB_TROOP_PAGE_CONDITION");
        }
        if (conditions?.actorValid === true) {
          this.recordReference("troops", id, `${prefix}.actorId`, "actors", conditions.actorId);
          this.fixedRange("DB_TROOP_PAGE_CONDITION", "troops", id, `${prefix}.actorHp`, conditions.actorHp, 0, 100);
        }
        if (conditions?.switchValid === true) {
          this.switchReference("troops", id, `${prefix}.switchId`, conditions.switchId);
        }
        if (conditions?.enemyValid === true) {
          this.fixedRange("DB_TROOP_PAGE_CONDITION", "troops", id, `${prefix}.enemyHp`, conditions.enemyHp, 0, 100);
          this.fixedRange(
            "DB_REFERENCE_ID",
            "troops",
            id,
            `${prefix}.enemyIndex`,
            conditions.enemyIndex,
            0,
            Math.max(0, members.length - 1),
          );
        }
        this.validateEventCommandReferences(
          "troops",
          id,
          page.list,
          `troops[${id}].pages[${pageIndex}].list`,
        );
      });
    });
  }

  private validateStates(): void {
    this.forEachRecord("states", (state, id) => {
      this.fixedRange("DB_STATE_RESTRICTION", "states", id, `states[${id}].restriction`, state.restriction, 0, 4);
      this.fixedRange("DB_STATE_PRIORITY", "states", id, `states[${id}].priority`, state.priority, 0, 100);
      this.fixedRange("DB_STATE_MOTION", "states", id, `states[${id}].motion`, state.motion, 0, 3);
      this.fixedRange("DB_STATE_OVERLAY", "states", id, `states[${id}].overlay`, state.overlay, 0, 10);
      this.fixedRange(
        "DB_STATE_AUTO_REMOVAL",
        "states",
        id,
        `states[${id}].autoRemovalTiming`,
        state.autoRemovalTiming,
        0,
        2,
      );
      this.fixedRange("DB_STATE_TURNS", "states", id, `states[${id}].minTurns`, state.minTurns, 0, 9999);
      this.fixedRange("DB_STATE_TURNS", "states", id, `states[${id}].maxTurns`, state.maxTurns, 0, 9999);
      const minimumTurns = asInteger(state.minTurns);
      const maximumTurns = asInteger(state.maxTurns);
      if (minimumTurns !== null && maximumTurns !== null && minimumTurns > maximumTurns) {
        this.add(
          "DB_STATE_TURN_ORDER",
          "states",
          `states[${id}].minTurns`,
          "Minimum removal turns must not exceed maximum removal turns.",
          id,
        );
      }
      this.fixedRange(
        "DB_STATE_DAMAGE_REMOVAL",
        "states",
        id,
        `states[${id}].chanceByDamage`,
        state.chanceByDamage,
        0,
        100,
      );
      this.fixedRange(
        "DB_STATE_WALK_REMOVAL",
        "states",
        id,
        `states[${id}].stepsToRemove`,
        state.stepsToRemove,
        0,
        9999,
      );
      this.validateTraits("states", id, state.traits, `states[${id}].traits`);
    });
  }

  private validateAnimations(): void {
    this.forEachRecord("animations", (animation, id) => {
      this.fixedRange("DB_ANIMATION_POSITION", "animations", id, `animations[${id}].position`, animation.position, 0, 3);
      this.fixedRange("DB_ANIMATION_HUE", "animations", id, `animations[${id}].animation1Hue`, animation.animation1Hue, 0, 360);
      this.fixedRange("DB_ANIMATION_HUE", "animations", id, `animations[${id}].animation2Hue`, animation.animation2Hue, 0, 360);

      const frames = asArray(animation.frames);
      if (frames.length > 200) {
        this.add(
          "DB_ANIMATION_FRAME_LIMIT",
          "animations",
          `animations[${id}].frames`,
          `Animation ${id} contains ${frames.length} frames; RPG Maker MV supports at most 200. Existing data is readable but must not be extended.`,
          id,
          "warning",
        );
      }
      frames.forEach((frame, frameIndex) => {
        const framePath = `animations[${id}].frames[${frameIndex}]`;
        if (!Array.isArray(frame)) {
          this.add("DB_ANIMATION_FRAME_SHAPE", "animations", framePath, "Animation frame must be an array.", id);
          return;
        }
        if (frame.length > 16) {
          this.add(
            "DB_ANIMATION_CELL_LIMIT",
            "animations",
            framePath,
            `Animation frame ${frameIndex + 1} contains ${frame.length} cells; RPG Maker MV supports at most 16. Existing data is readable but must not be extended.`,
            id,
            "warning",
          );
        }
        frame.forEach((cell, cellIndex) => this.validateAnimationCell(cell, id, `${framePath}[${cellIndex}]`));
      });

      forEachRecordValue(animation.timings, (timing, timingIndex) => {
        const timingPath = `animations[${id}].timings[${timingIndex}]`;
        if (frames.length > 0) {
          this.fixedRange("DB_ANIMATION_TIMING_FRAME", "animations", id, `${timingPath}.frame`, timing.frame, 0, frames.length - 1);
        } else {
          this.fixedRange("DB_ANIMATION_TIMING_FRAME", "animations", id, `${timingPath}.frame`, timing.frame, 0, 0);
        }
        this.fixedRange("DB_ANIMATION_FLASH_SCOPE", "animations", id, `${timingPath}.flashScope`, timing.flashScope, 0, 3);
        this.fixedRange("DB_ANIMATION_FLASH_DURATION", "animations", id, `${timingPath}.flashDuration`, timing.flashDuration, 1, 200);
        const flashColor = asArray(timing.flashColor);
        this.fixedArrayLength("animations", id, `${timingPath}.flashColor`, timing.flashColor, 4);
        for (let colorIndex = 0; colorIndex < 4; colorIndex += 1) {
          this.fixedRange(
            "DB_ANIMATION_FLASH_COLOR",
            "animations",
            id,
            `${timingPath}.flashColor[${colorIndex}]`,
            flashColor[colorIndex],
            0,
            255,
          );
        }
        if (isRecord(timing.se)) this.validateAudio(timing.se, "animations", id, `${timingPath}.se`);
      });
    });
  }

  private validateTilesets(): void {
    this.forEachRecord("tilesets", (tileset, id) => {
      this.fixedRange("DB_TILESET_MODE", "tilesets", id, `tilesets[${id}].mode`, tileset.mode, 0, 1);
      this.fixedArrayLength("tilesets", id, `tilesets[${id}].tilesetNames`, tileset.tilesetNames, 9);
      const flags = asArray(tileset.flags);
      flags.forEach((flag, index) => {
        this.fixedRange("DB_TILESET_FLAG", "tilesets", id, `tilesets[${id}].flags[${index}]`, flag, 0, 0xffff);
      });
    });
  }

  private validateCommonEvents(): void {
    this.forEachRecord("commonEvents", (commonEvent, id) => {
      this.fixedRange(
        "DB_REFERENCE_ID",
        "commonEvents",
        id,
        `commonEvents[${id}].trigger`,
        commonEvent.trigger,
        0,
        2,
      );
      if (commonEvent.trigger === 1 || commonEvent.trigger === 2) {
        this.switchReference("commonEvents", id, `commonEvents[${id}].switchId`, commonEvent.switchId);
      }
      this.validateEventCommandReferences(
        "commonEvents",
        id,
        commonEvent.list,
        `commonEvents[${id}].list`,
      );
    });
  }

  private validateSystem(): void {
    const system = this.system();
    if (!system) return;
    forEachValue(system.partyMembers, (actorId, index) => {
      this.recordReference("system", undefined, `system.partyMembers[${index}]`, "actors", actorId);
    });
    const testBattlers = asArray(system.testBattlers);
    if (testBattlers.length > 4) {
      this.add(
        "DB_TEST_BATTLER_LIMIT",
        "system",
        "system.testBattlers",
        `System contains ${testBattlers.length} test battlers; RPG Maker MV Battle Test supports at most 4. Existing data is readable but must not be extended.`,
        undefined,
        "warning",
      );
    }
    forEachRecordValue(testBattlers, (battler, index) => {
      this.recordReference("system", undefined, `system.testBattlers[${index}].actorId`, "actors", battler.actorId);
      this.fixedRange(
        "DB_TEST_BATTLER_LEVEL",
        "system",
        undefined,
        `system.testBattlers[${index}].level`,
        battler.level,
        1,
        99,
      );
      this.validateEquipment(
        "system",
        undefined,
        battler.equips,
        `system.testBattlers[${index}].equips`,
        asInteger(battler.actorId),
      );
    });
    this.recordReference("system", undefined, "system.testTroopId", "troops", system.testTroopId, [0]);
    this.mapReference("system.startMapId", system.startMapId);
    this.mapReference("system.editMapId", system.editMapId);
    for (const vehicleName of ["boat", "ship", "airship"] as const) {
      const vehicle = isRecord(system[vehicleName]) ? system[vehicleName] : null;
      if (vehicle) {
        this.mapReference(`system.${vehicleName}.startMapId`, vehicle.startMapId);
        this.fixedRange("DB_SYSTEM_IMAGE_INDEX", "system", undefined, `system.${vehicleName}.characterIndex`, vehicle.characterIndex, 0, 7);
        this.nonnegativeInteger("system", undefined, `system.${vehicleName}.startX`, vehicle.startX, "DB_SYSTEM_NUMBER");
        this.nonnegativeInteger("system", undefined, `system.${vehicleName}.startY`, vehicle.startY, "DB_SYSTEM_NUMBER");
      }
    }
    forEachValue(system.magicSkills, (skillTypeId, index) => {
      this.typeReference("system", undefined, `system.magicSkills[${index}]`, "skillTypes", skillTypeId);
    });
    this.fixedRange("DB_SYSTEM_HUE", "system", undefined, "system.battlerHue", system.battlerHue, 0, 360);
    this.nonnegativeInteger("system", undefined, "system.versionId", system.versionId, "DB_SYSTEM_NUMBER");
    this.nonnegativeInteger("system", undefined, "system.startX", system.startX, "DB_SYSTEM_NUMBER");
    this.nonnegativeInteger("system", undefined, "system.startY", system.startY, "DB_SYSTEM_NUMBER");
    for (const audioField of ["titleBgm", "battleBgm", "victoryMe", "defeatMe", "gameoverMe"] as const) {
      const audio = system[audioField];
      if (isRecord(audio)) this.validateAudio(audio, "system", undefined, `system.${audioField}`);
    }
    for (const vehicleName of ["boat", "ship", "airship"] as const) {
      const vehicle = system[vehicleName];
      if (isRecord(vehicle) && isRecord(vehicle.bgm)) {
        this.validateAudio(vehicle.bgm, "system", undefined, `system.${vehicleName}.bgm`);
      }
    }
    forEachRecordValue(system.sounds, (sound, index) => {
      this.validateAudio(sound, "system", undefined, `system.sounds[${index}]`);
    });
    this.fixedArrayLength("system", undefined, "system.sounds", system.sounds, 24);
    this.fixedArrayLength("system", undefined, "system.menuCommands", system.menuCommands, 6);
    forEachRecordValue(system.attackMotions, (motion, index) => {
      this.fixedRange("DB_SYSTEM_ATTACK_MOTION", "system", undefined, `system.attackMotions[${index}].type`, motion.type, 0, 2);
      this.fixedRange(
        "DB_SYSTEM_WEAPON_IMAGE",
        "system",
        undefined,
        `system.attackMotions[${index}].weaponImageId`,
        motion.weaponImageId,
        0,
        30,
      );
    });
    const tone = asArray(system.windowTone);
    this.fixedArrayLength("system", undefined, "system.windowTone", system.windowTone, 4);
    for (let index = 0; index < 4; index += 1) {
      this.fixedRange(
        "DB_SYSTEM_WINDOW_TONE",
        "system",
        undefined,
        `system.windowTone[${index}]`,
        tone[index],
        index === 3 ? 0 : -255,
        255,
      );
    }
  }

  private validateMaps(): void {
    for (const mapDocument of this.#maps) {
      const mapId = asInteger(mapDocument.mapId);
      if (mapId === null || mapId <= 0) {
        this.add("DB_REFERENCE_ID", "maps", "maps", "Map id must be a positive integer.");
        continue;
      }
      if (!isRecord(mapDocument.value)) {
        this.add("DB_ENTRY_SHAPE", "maps", `maps[${mapId}]`, "Map document must be an object.", mapId);
        continue;
      }
      const map = mapDocument.value;
      this.recordReference("maps", mapId, `maps[${mapId}].tilesetId`, "tilesets", map.tilesetId);
      forEachRecordValue(map.encounterList, (encounter, encounterIndex) => {
        this.recordReference(
          "maps",
          mapId,
          `maps[${mapId}].encounterList[${encounterIndex}].troopId`,
          "troops",
          encounter.troopId,
        );
      });

      const events = asArray(map.events);
      for (let eventId = 1; eventId < events.length; eventId += 1) {
        const event = events[eventId];
        if (!isRecord(event)) continue;
        if (event.id !== eventId) {
          this.add(
            "DB_ENTRY_ID_MISMATCH",
            "maps",
            `maps[${mapId}].events[${eventId}].id`,
            `Map event id must match its stable array slot ${eventId}.`,
            mapId,
          );
        }
        forEachRecordValue(event.pages, (page, pageIndex) => {
          const pagePrefix = `maps[${mapId}].events[${eventId}].pages[${pageIndex}]`;
          const conditions = isRecord(page.conditions) ? page.conditions : null;
          if (conditions?.actorValid === true) {
            this.recordReference("maps", mapId, `${pagePrefix}.conditions.actorId`, "actors", conditions.actorId);
          }
          if (conditions?.itemValid === true) {
            this.recordReference("maps", mapId, `${pagePrefix}.conditions.itemId`, "items", conditions.itemId);
          }
          if (conditions?.switch1Valid === true) {
            this.switchReference("maps", mapId, `${pagePrefix}.conditions.switch1Id`, conditions.switch1Id);
          }
          if (conditions?.switch2Valid === true) {
            this.switchReference("maps", mapId, `${pagePrefix}.conditions.switch2Id`, conditions.switch2Id);
          }
          if (conditions?.variableValid === true) {
            this.systemListReference("maps", mapId, `${pagePrefix}.conditions.variableId`, "variables", conditions.variableId);
          }
          this.validateEventCommandReferences("maps", mapId, page.list, `${pagePrefix}.list`);
        });
      }
    }
  }

  private validateEventCommandReferences(
    sourceTable: RmmvDatabaseIssueTable,
    sourceId: number | undefined,
    value: unknown,
    path: string,
  ): void {
    let references: RmmvEventCommandReference[];
    try {
      references = collectEventCommandReferences(value, path);
    } catch (error) {
      this.add(
        "DB_EVENT_COMMAND_STRUCTURE",
        sourceTable,
        path,
        error instanceof Error ? error.message : String(error),
        sourceId,
      );
      return;
    }
    for (const reference of references) {
      this.validateEventCommandReference(sourceTable, sourceId, reference);
    }
  }

  private validateEventCommandReference(
    sourceTable: RmmvDatabaseIssueTable,
    sourceId: number | undefined,
    reference: RmmvEventCommandReference,
  ): void {
    const arrayTargets = new Set<RmmvEventReferenceTarget>([
      "actors",
      "classes",
      "skills",
      "items",
      "weapons",
      "armors",
      "enemies",
      "troops",
      "states",
      "animations",
      "tilesets",
      "commonEvents",
    ]);
    if (arrayTargets.has(reference.target)) {
      this.recordReference(
        sourceTable,
        sourceId,
        reference.path,
        reference.target as RmmvDatabaseTableKey,
        reference.value,
        reference.specialValues,
      );
      return;
    }
    if (reference.target === "switches" || reference.target === "variables") {
      this.systemListReference(
        sourceTable,
        sourceId,
        reference.path,
        reference.target,
        reference.value,
        reference.endValue,
        reference.endPath,
      );
      return;
    }
    if (reference.target === "maps") {
      this.mapReferenceFor(sourceTable, sourceId, reference.path, reference.value);
      return;
    }
    if (reference.target === "equipTypes") {
      this.typeReference(sourceTable, sourceId, reference.path, "equipTypes", reference.value);
    }
  }

  private validateDamage(
    table: "skills" | "items",
    id: number,
    value: unknown,
    path: string,
  ): void {
    if (value === undefined) return;
    if (!isRecord(value)) {
      this.add("DB_ENTRY_SHAPE", table, path, "Damage must be an object.", id);
      return;
    }
    this.typeReference(table, id, `${path}.elementId`, "elements", value.elementId, [0, -1]);
    this.fixedRange("DB_DAMAGE_TYPE", table, id, `${path}.type`, value.type, 0, 6);
    this.fixedRange("DB_DAMAGE_VARIANCE", table, id, `${path}.variance`, value.variance, 0, 100);
    if (value.formula === undefined) return;
    if (typeof value.formula !== "string") {
      this.add("DB_FORMULA_SYNTAX", table, `${path}.formula`, "Damage formula must be a JavaScript string.", id);
      return;
    }
    try {
      new Script(value.formula, { filename: `${table}-${id}-damage-formula.js` });
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
      this.add("DB_FORMULA_SYNTAX", table, `${path}.formula`, `Damage formula is not valid JavaScript: ${detail}`, id);
    }
  }

  private validateTraits(
    table: RmmvDatabaseTableKey,
    id: number,
    value: unknown,
    path: string,
  ): void {
    forEachRecordValue(value, (trait, index) => {
      const itemPath = `${path}[${index}]`;
      const code = asInteger(trait.code);
      if (code === null) {
        this.add("DB_TRAIT_CODE", table, `${itemPath}.code`, "Trait code must be an integer.", id);
        return;
      }
      if (code === 0) return;
      if (!STANDARD_TRAIT_CODES.has(code)) {
        this.add(
          "DB_PLUGIN_TRAIT_CODE",
          table,
          `${itemPath}.code`,
          `Trait code ${code} is not a standard RPG Maker MV trait and is preserved without plugin-semantic validation.`,
          id,
          "warning",
        );
        return;
      }
      if (code === 11 || code === 31) {
        this.typeReference(table, id, `${itemPath}.dataId`, "elements", trait.dataId);
      } else if (code === 13 || code === 14 || code === 32) {
        this.recordReference(table, id, `${itemPath}.dataId`, "states", trait.dataId);
      } else if (code === 41 || code === 42) {
        this.typeReference(table, id, `${itemPath}.dataId`, "skillTypes", trait.dataId);
      } else if (code === 43 || code === 44) {
        this.recordReference(table, id, `${itemPath}.dataId`, "skills", trait.dataId);
      } else if (code === 51) {
        this.typeReference(table, id, `${itemPath}.dataId`, "weaponTypes", trait.dataId);
      } else if (code === 52) {
        this.typeReference(table, id, `${itemPath}.dataId`, "armorTypes", trait.dataId);
      } else if (code === 53 || code === 54) {
        this.typeReference(table, id, `${itemPath}.dataId`, "equipTypes", trait.dataId);
      } else {
        const ranges: Partial<Record<number, readonly [number, number]>> = {
          12: [0, 7],
          21: [0, 7],
          22: [0, 9],
          23: [0, 9],
          33: [0, 0],
          34: [0, 0],
          55: [1, 1],
          61: [0, 0],
          62: [0, 3],
          63: [0, 2],
          64: [0, 5],
        };
        const range = ranges[code];
        if (range) {
          this.fixedRange("DB_TRAIT_DATA_ID", table, id, `${itemPath}.dataId`, trait.dataId, range[0], range[1]);
        }
      }
      if ([11, 12, 13, 21, 23, 32].includes(code)) {
        this.finiteRange("DB_TRAIT_VALUE", table, id, `${itemPath}.value`, trait.value, 0, 10);
      } else if (code === 22) {
        this.finiteRange("DB_TRAIT_VALUE", table, id, `${itemPath}.value`, trait.value, -10, 10);
      } else if (code === 33) {
        this.fixedRange("DB_TRAIT_VALUE", table, id, `${itemPath}.value`, trait.value, -1000, 1000);
      } else if (code === 34) {
        this.fixedRange("DB_TRAIT_VALUE", table, id, `${itemPath}.value`, trait.value, 0, 9);
      } else if (code === 61) {
        this.finiteRange("DB_TRAIT_VALUE", table, id, `${itemPath}.value`, trait.value, 0, 1);
      }
    });
  }

  private validateEffects(
    table: "skills" | "items",
    id: number,
    value: unknown,
    path: string,
  ): void {
    forEachRecordValue(value, (effect, index) => {
      const itemPath = `${path}[${index}]`;
      const code = asInteger(effect.code);
      if (code === null) {
        this.add("DB_EFFECT_CODE", table, `${itemPath}.code`, "Effect code must be an integer.", id);
        return;
      }
      if (code === 0) return;
      if (!STANDARD_EFFECT_CODES.has(code)) {
        this.add(
          "DB_PLUGIN_EFFECT_CODE",
          table,
          `${itemPath}.code`,
          `Effect code ${code} is not a standard RPG Maker MV effect and is preserved without plugin-semantic validation.`,
          id,
          "warning",
        );
        return;
      }
      if (code === 21) {
        this.recordReference(table, id, `${itemPath}.dataId`, "states", effect.dataId, [0]);
      } else if (code === 22) {
        this.recordReference(table, id, `${itemPath}.dataId`, "states", effect.dataId);
      } else if (code === 43) {
        this.recordReference(table, id, `${itemPath}.dataId`, "skills", effect.dataId);
      } else if (code === 44) {
        this.recordReference(table, id, `${itemPath}.dataId`, "commonEvents", effect.dataId);
      } else {
        const ranges: Partial<Record<number, readonly [number, number]>> = {
          11: [0, 0],
          12: [0, 0],
          13: [0, 0],
          31: [0, 7],
          32: [0, 7],
          33: [0, 7],
          34: [0, 7],
          41: [0, 0],
          42: [0, 7],
        };
        const range = ranges[code];
        if (range) {
          this.fixedRange("DB_EFFECT_DATA_ID", table, id, `${itemPath}.dataId`, effect.dataId, range[0], range[1]);
        }
      }
      if (code === 11) {
        this.finiteRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, -1, 1);
        this.fixedRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value2`, effect.value2, -999999, 999999);
      } else if (code === 12) {
        this.finiteRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, -1, 1);
        this.fixedRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value2`, effect.value2, -9999, 9999);
      } else if (code === 13) {
        this.fixedRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, 0, 100);
      } else if (code === 21) {
        this.finiteRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, 0, 10);
      } else if (code === 22) {
        this.finiteRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, 0, 1);
      } else if (code === 31 || code === 32) {
        this.fixedRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, 1, 1000);
      } else if (code === 42) {
        this.fixedRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, 1, 1000);
      }
      if (![11, 12].includes(code)) {
        this.fixedRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value2`, effect.value2, 0, 0);
      }
      if ([33, 34, 41, 43, 44].includes(code)) {
        this.fixedRange("DB_EFFECT_VALUE", table, id, `${itemPath}.value1`, effect.value1, 0, 0);
      }
    });
  }

  private validateEquipment(
    sourceTable: RmmvDatabaseTableKey,
    sourceId: number | undefined,
    value: unknown,
    path: string,
    actorId: number | null,
  ): void {
    if (!Array.isArray(value)) return;
    const slotTypeIds = standardEquipSlotTypeIds(this.system()?.equipTypes, actorId !== null && this.actorHasDualWield(actorId));
    value.forEach((equipmentId, index) => {
      const equipmentPath = `${path}[${index}]`;
      const slotTypeId = slotTypeIds[index];
      if (slotTypeId === undefined) {
        if (equipmentId !== 0 && equipmentId !== null && equipmentId !== undefined) {
          this.add(
            "DB_PLUGIN_EQUIPMENT_SLOT",
            sourceTable,
            equipmentPath,
            "Equipment beyond the standard System.equipTypes slots is preserved but its plugin semantics are not validated.",
            sourceId,
            "warning",
          );
        }
        return;
      }
      const target: RmmvDatabaseTableKey = slotTypeId === MV_WEAPON_EQUIP_TYPE_ID ? "weapons" : "armors";
      this.recordReference(sourceTable, sourceId, equipmentPath, target, equipmentId, [0]);
      const equipmentRecord = asInteger(equipmentId) === null ? null : this.record(target, Number(equipmentId));
      if (equipmentRecord && asInteger(equipmentRecord.etypeId) !== slotTypeId) {
        this.add(
          "DB_EQUIPMENT_SLOT_TYPE",
          sourceTable,
          equipmentPath,
          `Equipment type ${String(equipmentRecord.etypeId)} does not match slot type ${slotTypeId}.`,
          sourceId,
        );
      }
    });
  }

  private validateUsableItemNumbers(
    table: "skills" | "items",
    id: number,
    entry: Record<string, unknown>,
  ): void {
    this.fixedRange("DB_USABLE_SCOPE", table, id, `${table}[${id}].scope`, entry.scope, 0, 11);
    this.fixedRange("DB_USABLE_OCCASION", table, id, `${table}[${id}].occasion`, entry.occasion, 0, 3);
    this.fixedRange("DB_USABLE_SPEED", table, id, `${table}[${id}].speed`, entry.speed, -2000, 2000);
    this.fixedRange("DB_USABLE_SUCCESS", table, id, `${table}[${id}].successRate`, entry.successRate, 0, 100);
    this.fixedRange("DB_USABLE_REPEATS", table, id, `${table}[${id}].repeats`, entry.repeats, 1, 9);
    this.fixedRange("DB_USABLE_HIT_TYPE", table, id, `${table}[${id}].hitType`, entry.hitType, 0, 2);
    this.fixedRange("DB_USABLE_TP_GAIN", table, id, `${table}[${id}].tpGain`, entry.tpGain, 0, 100);
  }

  private validateClassParameterCurves(value: unknown, classId: number): void {
    const rows = asArray(value);
    this.fixedArrayLength("classes", classId, `classes[${classId}].params`, value, 8);
    for (let paramIndex = 0; paramIndex < 8; paramIndex += 1) {
      const row = rows[paramIndex];
      if (!Array.isArray(row)) {
        this.add(
          "DB_CLASS_PARAM_CURVE_SHAPE",
          "classes",
          `classes[${classId}].params[${paramIndex}]`,
          "Each standard class parameter curve must be an array indexed from level 1 through 99.",
          classId,
        );
        continue;
      }
      this.fixedArrayLength("classes", classId, `classes[${classId}].params[${paramIndex}]`, row, 100);
      const minimum = paramIndex === 1 ? 0 : 1;
      const maximum = paramIndex <= 1 ? 9999 : 999;
      for (let level = 1; level <= 99; level += 1) {
        this.fixedRange(
          "DB_CLASS_PARAM_VALUE",
          "classes",
          classId,
          `classes[${classId}].params[${paramIndex}][${level}]`,
          row[level],
          minimum,
          maximum,
        );
      }
    }
    if (rows.length > 8) {
      this.add(
        "DB_PLUGIN_CLASS_PARAM_CURVE",
        "classes",
        `classes[${classId}].params`,
        "Parameter curves beyond the eight standard RPG Maker MV parameters are preserved but their plugin semantics are not validated.",
        classId,
        "warning",
      );
    }
  }

  private validateEquipmentParameters(
    table: "weapons" | "armors",
    id: number,
    value: unknown,
  ): void {
    const params = asArray(value);
    this.fixedArrayLength(table, id, `${table}[${id}].params`, value, 8);
    for (let paramIndex = 0; paramIndex < 8; paramIndex += 1) {
      const limit = paramIndex <= 1 ? 5000 : 500;
      this.fixedRange(
        "DB_EQUIPMENT_PARAM_VALUE",
        table,
        id,
        `${table}[${id}].params[${paramIndex}]`,
        params[paramIndex],
        -limit,
        limit,
      );
    }
  }

  private validateEnemyParameters(value: unknown, enemyId: number): void {
    const params = asArray(value);
    this.fixedArrayLength("enemies", enemyId, `enemies[${enemyId}].params`, value, 8);
    const ranges: readonly (readonly [number, number])[] = [
      [1, 999999],
      [0, 9999],
      [1, 999],
      [1, 999],
      [1, 999],
      [1, 999],
      [1, 999],
      [1, 999],
    ];
    ranges.forEach(([minimum, maximum], paramIndex) => {
      this.fixedRange(
        "DB_ENEMY_PARAM_VALUE",
        "enemies",
        enemyId,
        `enemies[${enemyId}].params[${paramIndex}]`,
        params[paramIndex],
        minimum,
        maximum,
      );
    });
  }

  private validateAnimationCell(value: unknown, animationId: number, path: string): void {
    if (!Array.isArray(value) || value.length !== 8) {
      this.add("DB_ANIMATION_CELL_SHAPE", "animations", path, "Animation cell must contain the eight standard MV values.", animationId);
      return;
    }
    const pattern = asInteger(value[0]);
    if (pattern === null || pattern < -1 || pattern > 199) {
      this.add("DB_ANIMATION_CELL_PATTERN", "animations", `${path}[0]`, "Pattern must be an integer from -1 through 199.", animationId);
      return;
    }
    if (pattern === -1) return;
    this.fixedRange("DB_ANIMATION_CELL_X", "animations", animationId, `${path}[1]`, value[1], -408, 408);
    this.fixedRange("DB_ANIMATION_CELL_Y", "animations", animationId, `${path}[2]`, value[2], -312, 312);
    this.fixedRange("DB_ANIMATION_CELL_SCALE", "animations", animationId, `${path}[3]`, value[3], 20, 800);
    this.fixedRange("DB_ANIMATION_CELL_ROTATION", "animations", animationId, `${path}[4]`, value[4], -360, 360);
    this.fixedRange("DB_ANIMATION_CELL_MIRROR", "animations", animationId, `${path}[5]`, value[5], 0, 1);
    this.fixedRange("DB_ANIMATION_CELL_OPACITY", "animations", animationId, `${path}[6]`, value[6], 0, 255);
    this.fixedRange("DB_ANIMATION_CELL_BLEND", "animations", animationId, `${path}[7]`, value[7], 0, 3);
  }

  private validateAudio(
    value: Record<string, unknown>,
    table: RmmvDatabaseIssueTable,
    id: number | undefined,
    path: string,
  ): void {
    this.fixedRange("DB_AUDIO_VOLUME", table, id, `${path}.volume`, value.volume, 0, 100);
    this.fixedRange("DB_AUDIO_PITCH", table, id, `${path}.pitch`, value.pitch, 50, 150);
    this.fixedRange("DB_AUDIO_PAN", table, id, `${path}.pan`, value.pan, -100, 100);
  }

  private actorHasDualWield(actorId: number): boolean {
    const actor = this.record("actors", actorId);
    if (!actor) return false;
    const classId = asInteger(actor.classId);
    const classEntry = classId === null ? null : this.record("classes", classId);
    return hasStandardDualWield(actor, classEntry);
  }

  private validateEnemyActionCondition(action: Record<string, unknown>, enemyId: number, path: string): void {
    this.fixedRange("DB_ENEMY_ACTION_RATING", "enemies", enemyId, `${path}.rating`, action.rating, 1, 9);
    const conditionType = asInteger(action.conditionType);
    if (conditionType === null) {
      this.add("DB_ENEMY_ACTION_CONDITION", "enemies", `${path}.conditionType`, "Enemy action condition type must be an integer.", enemyId);
      return;
    }
    if (conditionType < 0 || conditionType > 6) {
      this.add(
        "DB_PLUGIN_ENEMY_ACTION_CONDITION",
        "enemies",
        `${path}.conditionType`,
        `Condition type ${conditionType} is not a standard RPG Maker MV condition and is preserved without plugin-semantic validation.`,
        enemyId,
        "warning",
      );
      return;
    }
    if (conditionType === 1) {
      this.nonnegativeInteger("enemies", enemyId, `${path}.conditionParam1`, action.conditionParam1);
      this.nonnegativeInteger("enemies", enemyId, `${path}.conditionParam2`, action.conditionParam2);
    } else if (conditionType === 2 || conditionType === 3) {
      const minimum = asFiniteNumber(action.conditionParam1);
      const maximum = asFiniteNumber(action.conditionParam2);
      if (minimum === null || minimum < 0 || minimum > 1) {
        this.add("DB_ENEMY_ACTION_CONDITION", "enemies", `${path}.conditionParam1`, "HP/MP condition minimum must be from 0 through 1.", enemyId);
      }
      if (maximum === null || maximum < 0 || maximum > 1) {
        this.add("DB_ENEMY_ACTION_CONDITION", "enemies", `${path}.conditionParam2`, "HP/MP condition maximum must be from 0 through 1.", enemyId);
      }
      if (minimum !== null && maximum !== null && minimum > maximum) {
        this.add("DB_ENEMY_ACTION_CONDITION", "enemies", `${path}.conditionParam1`, "HP/MP condition minimum must not exceed its maximum.", enemyId);
      }
    } else if (conditionType === 4) {
      this.recordReference("enemies", enemyId, `${path}.conditionParam1`, "states", action.conditionParam1);
    } else if (conditionType === 5) {
      this.fixedRange("DB_ENEMY_ACTION_CONDITION", "enemies", enemyId, `${path}.conditionParam1`, action.conditionParam1, 1, 99);
    } else if (conditionType === 6) {
      this.switchReference("enemies", enemyId, `${path}.conditionParam1`, action.conditionParam1);
    }
  }

  private nonnegativeInteger(
    table: RmmvDatabaseIssueTable,
    id: number | undefined,
    path: string,
    value: unknown,
    code = "DB_ENEMY_ACTION_CONDITION",
  ): void {
    if (value === undefined) return;
    const integer = asInteger(value);
    if (integer === null || integer < 0) {
      this.add(code, table, path, "Value must be a non-negative integer.", id);
    }
  }

  private recordReference(
    sourceTable: RmmvDatabaseIssueTable,
    sourceId: number | undefined,
    path: string,
    targetTable: RmmvDatabaseTableKey,
    value: unknown,
    specialValues: readonly number[] = [],
  ): void {
    if (value === undefined) return;
    const targetId = asInteger(value);
    if (targetId === null) {
      this.add("DB_REFERENCE_ID", sourceTable, path, `Reference to ${targetTable} must be an integer.`, sourceId);
      return;
    }
    if (specialValues.includes(targetId)) return;
    if (targetId <= 0 || !this.record(targetTable, targetId)) {
      this.add(
        "DB_REFERENCE_MISSING",
        sourceTable,
        path,
        `Referenced ${targetTable} id ${targetId} does not exist at its stable slot.`,
        sourceId,
      );
    }
  }

  private typeReference(
    sourceTable: RmmvDatabaseIssueTable,
    sourceId: number | undefined,
    path: string,
    typeField: "elements" | "skillTypes" | "weaponTypes" | "armorTypes" | "equipTypes",
    value: unknown,
    specialValues: readonly number[] = [],
  ): void {
    if (value === undefined) return;
    const targetId = asInteger(value);
    if (targetId === null) {
      this.add("DB_REFERENCE_ID", sourceTable, path, `Reference to ${typeField} must be an integer.`, sourceId);
      return;
    }
    if (specialValues.includes(targetId)) return;
    const values = this.typeArray(typeField);
    if (targetId <= 0 || targetId >= values.length) {
      this.add(
        "DB_REFERENCE_MISSING",
        sourceTable,
        path,
        `Referenced ${typeField} id ${targetId} is outside the current fixed-id list.`,
        sourceId,
      );
    }
  }

  private switchReference(
    sourceTable: RmmvDatabaseIssueTable,
    sourceId: number | undefined,
    path: string,
    value: unknown,
  ): void {
    this.systemListReference(sourceTable, sourceId, path, "switches", value);
  }

  private mapReference(path: string, value: unknown): void {
    this.mapReferenceFor("system", undefined, path, value, [0]);
  }

  private systemListReference(
    sourceTable: RmmvDatabaseIssueTable,
    sourceId: number | undefined,
    path: string,
    field: "switches" | "variables",
    value: unknown,
    endValue?: unknown,
    endPath?: string,
  ): void {
    if (value === undefined) return;
    const values = asArray(this.system()?.[field]);
    const startId = asInteger(value);
    const endId = endValue === undefined ? startId : asInteger(endValue);
    if (startId === null || startId <= 0 || startId >= values.length) {
      this.add(
        "DB_REFERENCE_MISSING",
        sourceTable,
        path,
        `Referenced ${field} id ${String(value)} is outside System.${field}.`,
        sourceId,
      );
    }
    if (endValue !== undefined && (endId === null || endId <= 0 || endId >= values.length)) {
      this.add(
        "DB_REFERENCE_MISSING",
        sourceTable,
        endPath ?? path,
        `Referenced ${field} id ${String(endValue)} is outside System.${field}.`,
        sourceId,
      );
    }
    if (startId !== null && endId !== null && endValue !== undefined && startId > endId) {
      this.add(
        "DB_REFERENCE_RANGE",
        sourceTable,
        path,
        `${field} reference range must start at or before its end.`,
        sourceId,
      );
    }
  }

  private mapReferenceFor(
    sourceTable: RmmvDatabaseIssueTable,
    sourceId: number | undefined,
    path: string,
    value: unknown,
    specialValues: readonly number[] = [],
  ): void {
    if (value === undefined || this.#mapIds === null) return;
    const mapId = asInteger(value);
    if (mapId !== null && specialValues.includes(mapId)) return;
    if (mapId === null || mapId <= 0 || !this.#mapIds.has(mapId)) {
      this.add(
        "DB_REFERENCE_MISSING",
        sourceTable,
        path,
        `Referenced map id ${String(value)} does not exist.`,
        sourceId,
      );
    }
  }

  private fixedRange(
    code: string,
    table: RmmvDatabaseIssueTable,
    id: number | undefined,
    path: string,
    value: unknown,
    minimum: number,
    maximum: number,
  ): void {
    if (value === undefined) return;
    const dataId = asInteger(value);
    if (dataId === null || dataId < minimum || dataId > maximum) {
      this.add(code, table, path, `Value must be an integer from ${minimum} through ${maximum}.`, id);
    }
  }

  private fixedArrayLength(
    table: RmmvDatabaseIssueTable,
    id: number | undefined,
    path: string,
    value: unknown,
    expectedLength: number,
  ): void {
    if (!Array.isArray(value) || value.length === expectedLength) return;
    this.add(
      "DB_FIXED_ARRAY_LENGTH",
      table,
      path,
      `Array must contain exactly ${expectedLength} values; received ${value.length}.`,
      id,
    );
  }

  private finiteRange(
    code: string,
    table: RmmvDatabaseIssueTable,
    id: number | undefined,
    path: string,
    value: unknown,
    minimum: number,
    maximum: number,
  ): void {
    if (value === undefined) return;
    const number = asFiniteNumber(value);
    if (number === null || number < minimum || number > maximum) {
      this.add(code, table, path, `Value must be a number from ${minimum} through ${maximum}.`, id);
    }
  }

  private forEachRecord(
    table: RmmvDatabaseTableKey,
    visit: (record: Record<string, unknown>, id: number) => void,
  ): void {
    const values = asArray(this.snapshot[table]);
    for (let id = 1; id < values.length; id += 1) {
      const record = values[id];
      if (isRecord(record) && record.id === id) visit(record, id);
    }
  }

  private record(table: RmmvDatabaseTableKey, id: number): Record<string, unknown> | null {
    const value = asArray(this.snapshot[table])[id];
    return isRecord(value) && value.id === id ? value : null;
  }

  private typeArray(field: string): unknown[] {
    const source = this.system() ?? (isRecord(this.snapshot.types) ? this.snapshot.types : null);
    return source ? asArray(source[field]) : [];
  }

  private system(): Record<string, unknown> | null {
    return isRecord(this.snapshot.system) ? this.snapshot.system : null;
  }

  private add(
    code: string,
    table: RmmvDatabaseIssueTable,
    path: string,
    message: string,
    id?: number,
    severity: RmmvDatabaseIssueSeverity = "error",
  ): void {
    this.#issues.push({ code, severity, source: { table, ...(id === undefined ? {} : { id }), path }, message });
  }
}

function completeResult(
  issues: RmmvDatabaseSemanticIssue[],
  limitations: string[],
): RmmvDatabaseSemanticValidationResult {
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    pluginSemanticsValidated: false,
    limitations: [...limitations],
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asInteger(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function prospectiveIssues(
  before: readonly RmmvDatabaseSemanticIssue[],
  after: readonly RmmvDatabaseSemanticIssue[],
  beforeSnapshot: RmmvDatabaseSnapshot,
  afterSnapshot: RmmvDatabaseSnapshot,
  beforeMaps: readonly RmmvDatabaseMapDocument[],
  afterMaps: readonly RmmvDatabaseMapDocument[],
): RmmvDatabaseSemanticIssue[] {
  const existingErrors = new Map<string, unknown[]>();
  for (const issue of before) {
    if (issue.severity !== "error") continue;
    const identity = semanticIssueIdentity(issue);
    const values = existingErrors.get(identity) ?? [];
    values.push(semanticIssueValue(beforeSnapshot, beforeMaps, issue));
    existingErrors.set(identity, values);
  }

  return after.filter((issue) => {
    if (issue.severity !== "error") return true;
    const identity = semanticIssueIdentity(issue);
    const existingValues = existingErrors.get(identity);
    if (!existingValues?.length) return true;
    const afterValue = semanticIssueValue(afterSnapshot, afterMaps, issue);
    const matchingIndex = existingValues.findIndex((beforeValue) => isDeepStrictEqual(beforeValue, afterValue));
    if (matchingIndex < 0) return true;
    existingValues.splice(matchingIndex, 1);
    return false;
  });
}

function semanticIssueIdentity(issue: RmmvDatabaseSemanticIssue): string {
  return JSON.stringify([
    issue.code,
    issue.severity,
    issue.source.table,
    issue.source.id ?? null,
    issue.source.path,
    issue.message,
  ]);
}

const ISSUE_VALUE_UNAVAILABLE = Symbol("issue-value-unavailable");

function semanticIssueValue(
  snapshot: RmmvDatabaseSnapshot,
  maps: readonly RmmvDatabaseMapDocument[],
  issue: RmmvDatabaseSemanticIssue,
): unknown {
  const { table, id, path } = issue.source;
  if (table === "maps") {
    if (id === undefined) return maps;
    const document = maps.find((entry) => entry.mapId === id);
    if (!document) return ISSUE_VALUE_UNAVAILABLE;
    return readIssuePath(document.value, path, `maps[${id}]`);
  }
  return readIssuePath(snapshot[table], path, table);
}

function readIssuePath(root: unknown, path: string, prefix: string): unknown {
  if (path === prefix) return root;
  if (!path.startsWith(prefix)) return ISSUE_VALUE_UNAVAILABLE;
  let remaining = path.slice(prefix.length);
  let current = root;
  while (remaining.length > 0) {
    const property = /^\.([A-Za-z_$][A-Za-z0-9_$]*)/.exec(remaining);
    if (property) {
      if (!isRecord(current)) return ISSUE_VALUE_UNAVAILABLE;
      current = current[property[1]];
      remaining = remaining.slice(property[0].length);
      continue;
    }
    const index = /^\[(\d+)\]/.exec(remaining);
    if (index) {
      if (!Array.isArray(current)) return ISSUE_VALUE_UNAVAILABLE;
      current = current[Number(index[1])];
      remaining = remaining.slice(index[0].length);
      continue;
    }
    return ISSUE_VALUE_UNAVAILABLE;
  }
  return current;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function forEachRecordValue(
  value: unknown,
  visit: (record: Record<string, unknown>, index: number) => void,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (isRecord(item)) visit(item, index);
  });
}

function forEachValue(value: unknown, visit: (item: unknown, index: number) => void): void {
  if (!Array.isArray(value)) return;
  value.forEach(visit);
}

function validateCollectionGrowth(
  before: RmmvDatabaseSnapshot,
  after: RmmvDatabaseSnapshot,
  issues: RmmvDatabaseSemanticIssue[],
): void {
  const beforeTroops = asArray(before.troops);
  const afterTroops = asArray(after.troops);
  for (let id = 1; id < afterTroops.length; id += 1) {
    const beforeTroop = beforeTroops[id];
    const afterTroop = afterTroops[id];
    const beforeMembers = isRecord(beforeTroop) ? asArray(beforeTroop.members).length : 0;
    const afterMembers = isRecord(afterTroop) ? asArray(afterTroop.members).length : 0;
    if (afterMembers > 8 && afterMembers > beforeMembers) {
      issues.push({
        code: "DB_TROOP_MEMBER_LIMIT",
        severity: "error",
        source: { table: "troops", id, path: `troops[${id}].members` },
        message: `Troop member count cannot grow from ${beforeMembers} to ${afterMembers}; RPG Maker MV supports at most 8.`,
      });
    }
  }

  const beforeSystem = isRecord(before.system) ? before.system : null;
  const afterSystem = isRecord(after.system) ? after.system : null;
  const beforeBattlers = asArray(beforeSystem?.testBattlers).length;
  const afterBattlers = asArray(afterSystem?.testBattlers).length;
  if (afterBattlers > 4 && afterBattlers > beforeBattlers) {
    issues.push({
      code: "DB_TEST_BATTLER_LIMIT",
      severity: "error",
      source: { table: "system", path: "system.testBattlers" },
      message: `Test battler count cannot grow from ${beforeBattlers} to ${afterBattlers}; RPG Maker MV supports at most 4.`,
    });
  }

  const beforeAnimations = asArray(before.animations);
  const afterAnimations = asArray(after.animations);
  for (let id = 1; id < afterAnimations.length; id += 1) {
    const beforeAnimation = beforeAnimations[id];
    const afterAnimation = afterAnimations[id];
    const beforeFrames = isRecord(beforeAnimation) ? asArray(beforeAnimation.frames) : [];
    const afterFrames = isRecord(afterAnimation) ? asArray(afterAnimation.frames) : [];
    if (afterFrames.length > 200 && afterFrames.length > beforeFrames.length) {
      issues.push({
        code: "DB_ANIMATION_FRAME_LIMIT",
        severity: "error",
        source: { table: "animations", id, path: `animations[${id}].frames` },
        message: `Animation frame count cannot grow from ${beforeFrames.length} to ${afterFrames.length}; RPG Maker MV supports at most 200.`,
      });
    }
    for (let frameIndex = 0; frameIndex < afterFrames.length; frameIndex += 1) {
      const beforeFrame = beforeFrames[frameIndex];
      const afterFrame = afterFrames[frameIndex];
      const beforeCells = Array.isArray(beforeFrame) ? beforeFrame.length : 0;
      const afterCells = Array.isArray(afterFrame) ? afterFrame.length : 0;
      if (afterCells > 16 && afterCells > beforeCells) {
        issues.push({
          code: "DB_ANIMATION_CELL_LIMIT",
          severity: "error",
          source: { table: "animations", id, path: `animations[${id}].frames[${frameIndex}]` },
          message: `Animation cell count cannot grow from ${beforeCells} to ${afterCells}; RPG Maker MV supports at most 16 cells per frame.`,
        });
      }
    }
  }
}
