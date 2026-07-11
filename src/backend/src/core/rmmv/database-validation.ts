import { Script } from "node:vm";

import {
  getRmmvDatabaseSchemaByKey,
  listRmmvDatabaseSchemas,
  type RmmvDatabaseTableKey,
} from "./database-schema.ts";

export type RmmvDatabaseSnapshot = Partial<Record<RmmvDatabaseTableKey, unknown>>;

export type RmmvDatabaseIssueSeverity = "error" | "warning";

export interface RmmvDatabaseIssueSource {
  table: RmmvDatabaseTableKey;
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

  return completeResult(issues, result.limitations);
}

class SnapshotValidator {
  readonly #issues: RmmvDatabaseSemanticIssue[] = [];
  readonly #limitations = [PLUGIN_LIMITATION];
  readonly #mapIds: ReadonlySet<number> | null;

  constructor(
    readonly snapshot: RmmvDatabaseSnapshot,
    options: RmmvDatabaseValidationOptions,
  ) {
    this.#mapIds = options.mapIds ? new Set(options.mapIds) : null;
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
      this.typeReference("skills", id, `skills[${id}].stypeId`, "skillTypes", skill.stypeId);
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
        this.recordReference(
          "enemies",
          id,
          `enemies[${id}].actions[${index}].skillId`,
          "skills",
          action.skillId,
        );
      });
      forEachRecordValue(enemy.dropItems, (drop, index) => {
        const path = `enemies[${id}].dropItems[${index}]`;
        if (drop.kind === 0) {
          this.fixedRange("DB_REFERENCE_ID", "enemies", id, `${path}.dataId`, drop.dataId, 0, 0);
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
        if (!conditions) return;
        const prefix = `troops[${id}].pages[${pageIndex}].conditions`;
        if (conditions.actorValid === true) {
          this.recordReference("troops", id, `${prefix}.actorId`, "actors", conditions.actorId);
        }
        if (conditions.switchValid === true) {
          this.switchReference("troops", id, `${prefix}.switchId`, conditions.switchId);
        }
        if (conditions.enemyValid === true) {
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
    });
  }

  private validateSystem(): void {
    const system = this.system();
    if (!system) return;
    forEachValue(system.partyMembers, (actorId, index) => {
      this.recordReference("system", undefined, `system.partyMembers[${index}]`, "actors", actorId);
    });
    forEachRecordValue(system.testBattlers, (battler, index) => {
      this.recordReference("system", undefined, `system.testBattlers[${index}].actorId`, "actors", battler.actorId);
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
    const dualWield = actorId !== null && this.actorHasDualWield(actorId);
    value.forEach((equipmentId, index) => {
      const target: RmmvDatabaseTableKey = index === 0 || (index === 1 && dualWield) ? "weapons" : "armors";
      this.recordReference(sourceTable, sourceId, `${path}[${index}]`, target, equipmentId, [0]);
    });
  }

  private actorHasDualWield(actorId: number): boolean {
    const actor = this.record("actors", actorId);
    if (!actor) return false;
    if (hasTrait(actor.traits, 55, 1)) return true;
    const classId = asInteger(actor.classId);
    const classEntry = classId === null ? null : this.record("classes", classId);
    return Boolean(classEntry && hasTrait(classEntry.traits, 55, 1));
  }

  private recordReference(
    sourceTable: RmmvDatabaseTableKey,
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
    sourceTable: RmmvDatabaseTableKey,
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
    sourceTable: RmmvDatabaseTableKey,
    sourceId: number | undefined,
    path: string,
    value: unknown,
  ): void {
    if (value === undefined) return;
    const switchId = asInteger(value);
    const switches = asArray(this.system()?.switches);
    if (switchId === null || switchId <= 0 || switchId >= switches.length) {
      this.add("DB_REFERENCE_MISSING", sourceTable, path, `Referenced switch id ${String(value)} is outside System.switches.`, sourceId);
    }
  }

  private mapReference(path: string, value: unknown): void {
    if (value === undefined || this.#mapIds === null) return;
    const mapId = asInteger(value);
    if (mapId === 0) return;
    if (mapId === null || mapId < 0 || !this.#mapIds.has(mapId)) {
      this.add("DB_REFERENCE_MISSING", "system", path, `Referenced map id ${String(value)} does not exist.`);
    }
  }

  private fixedRange(
    code: string,
    table: RmmvDatabaseTableKey,
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
    table: RmmvDatabaseTableKey,
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

function hasTrait(value: unknown, code: number, dataId: number): boolean {
  return Array.isArray(value) && value.some((trait) =>
    isRecord(trait) && trait.code === code && trait.dataId === dataId
  );
}
