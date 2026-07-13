import { Script } from "node:vm";

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

export interface RmmvDatabaseMapDocument {
  mapId: number;
  value: unknown;
}

const ARRAY_TABLE_KEYS = listRmmvDatabaseSchemas()
  .filter((schema) => schema.isArrayTable)
  .map((schema) => schema.key);

const PLUGIN_LIMITATION = "Unknown plugin fields and note-tag semantics are preserved but are not validated.";

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
  options: RmmvDatabaseValidationOptions = {},
): RmmvDatabaseSemanticValidationResult {
  const result = validateRmmvDatabaseSnapshot(after, options);
  const issues = [...result.issues];

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
      this.validateTraits("actors", id, actor.traits, `actors[${id}].traits`);
      this.validateEquipment("actors", id, actor.equips, `actors[${id}].equips`, id);
    });
  }

  private validateClasses(): void {
    this.forEachRecord("classes", (classEntry, id) => {
      forEachRecordValue(classEntry.learnings, (learning, index) => {
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
      this.validateDamage("skills", id, skill.damage, `skills[${id}].damage`);
      this.validateEffects("skills", id, skill.effects, `skills[${id}].effects`);
    });
  }

  private validateItems(): void {
    this.forEachRecord("items", (item, id) => {
      this.fixedRange("DB_REFERENCE_ID", "items", id, `items[${id}].itypeId`, item.itypeId, 1, 2);
      this.recordReference("items", id, `items[${id}].animationId`, "animations", item.animationId, [0, -1]);
      this.validateDamage("items", id, item.damage, `items[${id}].damage`);
      this.validateEffects("items", id, item.effects, `items[${id}].effects`);
    });
  }

  private validateWeapons(): void {
    this.forEachRecord("weapons", (weapon, id) => {
      this.typeReference("weapons", id, `weapons[${id}].wtypeId`, "weaponTypes", weapon.wtypeId);
      this.typeReference("weapons", id, `weapons[${id}].etypeId`, "equipTypes", weapon.etypeId);
      this.recordReference("weapons", id, `weapons[${id}].animationId`, "animations", weapon.animationId, [0]);
      this.validateTraits("weapons", id, weapon.traits, `weapons[${id}].traits`);
    });
  }

  private validateArmors(): void {
    this.forEachRecord("armors", (armor, id) => {
      this.typeReference("armors", id, `armors[${id}].atypeId`, "armorTypes", armor.atypeId);
      this.typeReference("armors", id, `armors[${id}].etypeId`, "equipTypes", armor.etypeId);
      this.validateTraits("armors", id, armor.traits, `armors[${id}].traits`);
    });
  }

  private validateEnemies(): void {
    this.forEachRecord("enemies", (enemy, id) => {
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
        this.recordReference(
          "troops",
          id,
          `troops[${id}].members[${index}].enemyId`,
          "enemies",
          member.enemyId,
        );
      });
      forEachRecordValue(troop.pages, (page, pageIndex) => {
        const conditions = isRecord(page.conditions) ? page.conditions : null;
        const prefix = `troops[${id}].pages[${pageIndex}].conditions`;
        if (conditions?.actorValid === true) {
          this.recordReference("troops", id, `${prefix}.actorId`, "actors", conditions.actorId);
        }
        if (conditions?.switchValid === true) {
          this.switchReference("troops", id, `${prefix}.switchId`, conditions.switchId);
        }
        if (conditions?.enemyValid === true) {
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
      this.validateTraits("states", id, state.traits, `states[${id}].traits`);
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
      if (vehicle) this.mapReference(`system.${vehicleName}.startMapId`, vehicle.startMapId);
    }
    forEachValue(system.magicSkills, (skillTypeId, index) => {
      this.typeReference("system", undefined, `system.magicSkills[${index}]`, "skillTypes", skillTypeId);
    });
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
          55: [0, 1],
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
  ): void {
    const integer = asInteger(value);
    if (integer === null || integer < 0) {
      this.add("DB_ENEMY_ACTION_CONDITION", table, path, "Value must be a non-negative integer.", id);
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
    const dataId = asInteger(value);
    if (dataId === null || dataId < minimum || dataId > maximum) {
      this.add(code, table, path, `Value must be an integer from ${minimum} through ${maximum}.`, id);
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
    const beforeMembers = isRecord(beforeTroops[id]) ? asArray(beforeTroops[id].members).length : 0;
    const afterMembers = isRecord(afterTroops[id]) ? asArray(afterTroops[id].members).length : 0;
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
}
