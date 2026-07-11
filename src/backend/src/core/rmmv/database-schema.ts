import { validateEventCommandList } from "./event-command-registry.ts";

export const STANDARD_RMMV_DATABASE_GROUPS = [
  "Actors",
  "Classes",
  "Skills",
  "Items",
  "Weapons",
  "Armors",
  "Enemies",
  "Troops",
  "States",
  "Animations",
  "Tilesets",
  "CommonEvents",
  "System",
  "Types",
  "Terms",
] as const;

export type RmmvDatabaseGroup = typeof STANDARD_RMMV_DATABASE_GROUPS[number];

export type RmmvDatabaseTableKey =
  | "actors"
  | "classes"
  | "skills"
  | "items"
  | "weapons"
  | "armors"
  | "enemies"
  | "troops"
  | "states"
  | "animations"
  | "tilesets"
  | "commonEvents"
  | "system"
  | "types"
  | "terms";

export type RmmvDatabaseFieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "unknown";

export interface RmmvDatabaseFieldSchema {
  path: string;
  kind: RmmvDatabaseFieldKind | RmmvDatabaseFieldKind[];
  required?: boolean;
  note?: string;
}

export interface RmmvDatabaseReferenceField {
  path: string;
  target: string;
  note?: string;
}

export interface RmmvDatabaseValidationIssue {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface RmmvDatabaseValidationResult {
  ok: boolean;
  issues: RmmvDatabaseValidationIssue[];
}

export interface RmmvDatabaseTableSchema {
  group: RmmvDatabaseGroup;
  key: RmmvDatabaseTableKey;
  fileName: string;
  isArrayTable: boolean;
  maxEntries: number | null;
  coreFields: readonly RmmvDatabaseFieldSchema[];
  references: readonly RmmvDatabaseReferenceField[];
  createDefaultEntry(id?: number): Record<string, unknown>;
  validate(value: unknown): RmmvDatabaseValidationResult;
}

interface RmmvDatabaseTableDefinition {
  group: RmmvDatabaseGroup;
  key: RmmvDatabaseTableKey;
  fileName: string;
  isArrayTable: boolean;
  coreFields: readonly RmmvDatabaseFieldSchema[];
  references: readonly RmmvDatabaseReferenceField[];
  createDefaultEntry(id?: number): Record<string, unknown>;
}

const ENTRY_COMMAND_LIST = [{ code: 0, indent: 0, parameters: [] }];

const DATABASE_ENTRY_LIMITS: Readonly<Record<RmmvDatabaseGroup, number | null>> = {
  Actors: 1000,
  Classes: 1000,
  Skills: 2000,
  Items: 2000,
  Weapons: 2000,
  Armors: 2000,
  Enemies: 2000,
  Troops: 2000,
  States: 1000,
  Animations: 1000,
  Tilesets: 1000,
  CommonEvents: 1000,
  System: null,
  Types: null,
  Terms: null,
};

const DATABASE_DEFINITIONS: readonly RmmvDatabaseTableDefinition[] = [
  arrayTable("Actors", "actors", "Actors.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("classId"),
    integerField("initialLevel"),
    integerField("maxLevel"),
    stringField("nickname"),
    stringField("profile"),
    stringField("note"),
    stringField("characterName"),
    integerField("characterIndex"),
    stringField("faceName"),
    integerField("faceIndex"),
    stringField("battlerName"),
    arrayField("equips", "RMMV stores initial equipment ids by equip slot."),
    arrayField("traits"),
  ], [
    ref("classId", "Classes"),
    ref("equips", "Weapons/Armors", "Slot semantics depend on System.equipTypes."),
    ref("traits", "System/Types and database records", "Trait dataId target depends on trait code."),
    ref("characterName", "img/characters"),
    ref("faceName", "img/faces"),
    ref("battlerName", "img/sv_actors"),
  ], defaultActor),
  arrayTable("Classes", "classes", "Classes.json", [
    requiredInteger("id"),
    requiredString("name"),
    stringField("note"),
    arrayField("expParams"),
    arrayField("params", "Eight parameter curves, each indexed by level."),
    arrayField("learnings"),
    arrayField("traits"),
  ], [
    ref("learnings[].skillId", "Skills"),
    ref("traits", "System/Types and database records", "Trait dataId target depends on trait code."),
  ], defaultClass),
  arrayTable("Skills", "skills", "Skills.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("iconIndex"),
    stringField("description"),
    stringField("note"),
    integerField("stypeId"),
    integerField("mpCost"),
    integerField("tpCost"),
    integerField("tpGain"),
    integerField("scope"),
    integerField("occasion"),
    integerField("speed"),
    integerField("successRate"),
    integerField("repeats"),
    integerField("hitType"),
    integerField("animationId"),
    integerField("requiredWtypeId1"),
    integerField("requiredWtypeId2"),
    objectField("damage"),
    arrayField("effects"),
    stringField("message1"),
    stringField("message2"),
  ], [
    ref("stypeId", "Types.skillTypes"),
    ref("requiredWtypeId1", "Types.weaponTypes"),
    ref("requiredWtypeId2", "Types.weaponTypes"),
    ref("animationId", "Animations"),
    ref("damage.elementId", "Types.elements"),
    ref("effects", "States/CommonEvents/System", "Effect dataId target depends on effect code."),
  ], defaultSkill),
  arrayTable("Items", "items", "Items.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("iconIndex"),
    stringField("description"),
    stringField("note"),
    integerField("itypeId"),
    integerField("price"),
    booleanField("consumable"),
    integerField("scope"),
    integerField("occasion"),
    integerField("speed"),
    integerField("successRate"),
    integerField("repeats"),
    integerField("hitType"),
    integerField("animationId"),
    integerField("tpGain"),
    objectField("damage"),
    arrayField("effects"),
  ], [
    ref("animationId", "Animations"),
    ref("damage.elementId", "Types.elements"),
    ref("effects", "States/CommonEvents/System", "Effect dataId target depends on effect code."),
  ], defaultItem),
  arrayTable("Weapons", "weapons", "Weapons.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("iconIndex"),
    stringField("description"),
    stringField("note"),
    integerField("price"),
    integerField("animationId"),
    integerField("wtypeId"),
    integerField("etypeId"),
    arrayField("params"),
    arrayField("traits"),
  ], [
    ref("animationId", "Animations"),
    ref("wtypeId", "Types.weaponTypes"),
    ref("etypeId", "Types.equipTypes"),
    ref("traits", "System/Types and database records", "Trait dataId target depends on trait code."),
  ], defaultWeapon),
  arrayTable("Armors", "armors", "Armors.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("iconIndex"),
    stringField("description"),
    stringField("note"),
    integerField("price"),
    integerField("atypeId"),
    integerField("etypeId"),
    arrayField("params"),
    arrayField("traits"),
  ], [
    ref("atypeId", "Types.armorTypes"),
    ref("etypeId", "Types.equipTypes"),
    ref("traits", "System/Types and database records", "Trait dataId target depends on trait code."),
  ], defaultArmor),
  arrayTable("Enemies", "enemies", "Enemies.json", [
    requiredInteger("id"),
    requiredString("name"),
    stringField("note"),
    stringField("battlerName"),
    integerField("battlerHue"),
    integerField("exp"),
    integerField("gold"),
    arrayField("params"),
    arrayField("traits"),
    arrayField("actions"),
    arrayField("dropItems"),
  ], [
    ref("battlerName", "img/enemies"),
    ref("actions[].skillId", "Skills"),
    ref("dropItems", "Items/Weapons/Armors", "Drop item target depends on drop kind."),
    ref("traits", "System/Types and database records", "Trait dataId target depends on trait code."),
  ], defaultEnemy),
  arrayTable("Troops", "troops", "Troops.json", [
    requiredInteger("id"),
    requiredString("name"),
    arrayField("members"),
    arrayField("pages"),
  ], [
    ref("members[].enemyId", "Enemies"),
    ref("pages[].list", "Switches/Variables/Actors/Enemies/CommonEvents/Assets", "Battle event commands carry heterogeneous references."),
  ], defaultTroop),
  arrayTable("States", "states", "States.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("iconIndex"),
    integerField("restriction"),
    integerField("priority"),
    integerField("motion"),
    integerField("overlay"),
    integerField("autoRemovalTiming"),
    integerField("minTurns"),
    integerField("maxTurns"),
    booleanField("removeAtBattleEnd"),
    booleanField("removeByRestriction"),
    booleanField("removeByDamage"),
    integerField("chanceByDamage"),
    booleanField("removeByWalking"),
    integerField("stepsToRemove"),
    stringField("message1"),
    stringField("message2"),
    stringField("message3"),
    stringField("message4"),
    stringField("note"),
    arrayField("traits"),
  ], [
    ref("traits", "System/Types and database records", "Trait dataId target depends on trait code."),
  ], defaultState),
  arrayTable("Animations", "animations", "Animations.json", [
    requiredInteger("id"),
    requiredString("name"),
    stringField("animation1Name"),
    integerField("animation1Hue"),
    stringField("animation2Name"),
    integerField("animation2Hue"),
    integerField("position"),
    arrayField("frames"),
    arrayField("timings"),
  ], [
    ref("animation1Name", "img/animations"),
    ref("animation2Name", "img/animations"),
    ref("timings[].se.name", "audio/se"),
  ], defaultAnimation),
  arrayTable("Tilesets", "tilesets", "Tilesets.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("mode"),
    stringField("note"),
    arrayField("tilesetNames"),
    arrayField("flags"),
  ], [
    ref("tilesetNames", "img/tilesets"),
    ref("flags", "tile passability and terrain flags"),
  ], defaultTileset),
  arrayTable("CommonEvents", "commonEvents", "CommonEvents.json", [
    requiredInteger("id"),
    requiredString("name"),
    integerField("trigger"),
    integerField("switchId"),
    arrayField("list"),
  ], [
    ref("switchId", "System.switches"),
    ref("list", "Switches/Variables/Actors/CommonEvents/Assets", "Event commands carry heterogeneous references."),
  ], defaultCommonEvent),
  documentTable("System", "system", "System.json", [
    requiredString("gameTitle"),
    stringField("currencyUnit"),
    stringField("locale"),
    integerField("versionId"),
    integerField("editMapId"),
    arrayField("switches"),
    arrayField("variables"),
    arrayField("elements"),
    arrayField("skillTypes"),
    arrayField("weaponTypes"),
    arrayField("armorTypes"),
    arrayField("equipTypes"),
    arrayField("partyMembers"),
    arrayField("testBattlers"),
    arrayField("attackMotions"),
    arrayField("magicSkills"),
    integerField("testTroopId"),
    integerField("startMapId"),
    integerField("startX"),
    integerField("startY"),
    objectField("boat"),
    objectField("ship"),
    objectField("airship"),
    objectField("titleBgm"),
    objectField("battleBgm"),
    objectField("victoryMe"),
    objectField("defeatMe"),
    objectField("gameoverMe"),
    stringField("title1Name"),
    stringField("title2Name"),
    stringField("battleback1Name"),
    stringField("battleback2Name"),
    stringField("battlerName"),
    integerField("battlerHue"),
    arrayField("sounds"),
    objectField("terms"),
    arrayField("menuCommands"),
    arrayField("windowTone"),
    booleanField("optDisplayTp"),
    booleanField("optDrawTitle"),
    booleanField("optExtraExp"),
    booleanField("optFloorDeath"),
    booleanField("optFollowers"),
    booleanField("optSideView"),
    booleanField("optSlipDeath"),
    booleanField("optTransparent"),
  ], [
    ref("startMapId", "MapInfos"),
    ref("boat.startMapId", "MapInfos"),
    ref("ship.startMapId", "MapInfos"),
    ref("airship.startMapId", "MapInfos"),
    ref("partyMembers", "Actors"),
    ref("testBattlers[].actorId", "Actors"),
    ref("testBattlers[].equips", "Weapons/Armors", "Equipment target depends on the actor's standard equip slots."),
    ref("testTroopId", "Troops"),
    ref("magicSkills", "Types.skillTypes"),
    ref("attackMotions", "Types.weaponTypes", "Attack motions are indexed by fixed weapon type id."),
    ref("title1Name", "img/titles1"),
    ref("title2Name", "img/titles2"),
    ref("battleback1Name", "img/battlebacks1"),
    ref("battleback2Name", "img/battlebacks2"),
    ref("titleBgm.name", "audio/bgm"),
    ref("battleBgm.name", "audio/bgm"),
    ref("boat.bgm.name", "audio/bgm"),
    ref("ship.bgm.name", "audio/bgm"),
    ref("airship.bgm.name", "audio/bgm"),
    ref("victoryMe.name", "audio/me"),
    ref("defeatMe.name", "audio/me"),
    ref("gameoverMe.name", "audio/me"),
    ref("sounds[].name", "audio/se"),
    ref("battlerName", "img/enemies"),
  ], defaultSystem),
  documentTable("Types", "types", "System.json", [
    arrayField("elements"),
    arrayField("skillTypes"),
    arrayField("weaponTypes"),
    arrayField("armorTypes"),
    arrayField("equipTypes"),
  ], [], defaultTypes),
  documentTable("Terms", "terms", "System.json", [
    arrayField("basic"),
    arrayField("params"),
    arrayField("commands"),
    objectField("messages"),
  ], [], defaultTerms),
];

export const RMMV_DATABASE_SCHEMAS: ReadonlyMap<RmmvDatabaseGroup, RmmvDatabaseTableSchema> = new Map(
  DATABASE_DEFINITIONS.map((definition) => [definition.group, withValidator(definition)]),
);

const RMMV_DATABASE_SCHEMAS_BY_KEY: ReadonlyMap<RmmvDatabaseTableKey, RmmvDatabaseTableSchema> = new Map(
  [...RMMV_DATABASE_SCHEMAS.values()].map((schema) => [schema.key, schema]),
);

const SCHEMA_LOOKUP: ReadonlyMap<string, RmmvDatabaseTableSchema> = buildSchemaLookup();

export function listRmmvDatabaseSchemas(): RmmvDatabaseTableSchema[] {
  return [...RMMV_DATABASE_SCHEMAS.values()];
}

export function listRmmvDatabaseTableKeys(): RmmvDatabaseTableKey[] {
  return [...RMMV_DATABASE_SCHEMAS_BY_KEY.keys()];
}

export function getRmmvDatabaseSchema(groupOrKey: string): RmmvDatabaseTableSchema {
  const schema = SCHEMA_LOOKUP.get(String(groupOrKey || "").trim().toLowerCase());
  if (!schema) {
    throw new Error(
      `Unknown RMMV database group "${groupOrKey}". Allowed groups: ${STANDARD_RMMV_DATABASE_GROUPS.join(", ")}`,
    );
  }
  return schema;
}

export function getRmmvDatabaseSchemaByKey(key: RmmvDatabaseTableKey): RmmvDatabaseTableSchema {
  const schema = RMMV_DATABASE_SCHEMAS_BY_KEY.get(key);
  if (!schema) {
    throw new Error(
      `Unknown RMMV database table "${key}". Allowed tables: ${listRmmvDatabaseTableKeys().join(", ")}`,
    );
  }
  return schema;
}

export function isRmmvDatabaseGroup(groupOrKey: string): boolean {
  return SCHEMA_LOOKUP.has(String(groupOrKey || "").trim().toLowerCase());
}

export function createDefaultRmmvDatabaseEntry(groupOrKey: string, id?: number): Record<string, unknown> {
  return getRmmvDatabaseSchema(groupOrKey).createDefaultEntry(id);
}

export function validateRmmvDatabaseEntry(groupOrKey: string, value: unknown): RmmvDatabaseValidationResult {
  return getRmmvDatabaseSchema(groupOrKey).validate(value);
}

function arrayTable(
  group: RmmvDatabaseGroup,
  key: RmmvDatabaseTableKey,
  fileName: string,
  coreFields: readonly RmmvDatabaseFieldSchema[],
  references: readonly RmmvDatabaseReferenceField[],
  createDefaultEntry: (id?: number) => Record<string, unknown>,
): RmmvDatabaseTableDefinition {
  return { group, key, fileName, isArrayTable: true, coreFields, references, createDefaultEntry };
}

function documentTable(
  group: RmmvDatabaseGroup,
  key: RmmvDatabaseTableKey,
  fileName: string,
  coreFields: readonly RmmvDatabaseFieldSchema[],
  references: readonly RmmvDatabaseReferenceField[],
  createDefaultEntry: (id?: number) => Record<string, unknown>,
): RmmvDatabaseTableDefinition {
  return { group, key, fileName, isArrayTable: false, coreFields, references, createDefaultEntry };
}

function withValidator(definition: RmmvDatabaseTableDefinition): RmmvDatabaseTableSchema {
  return {
    ...definition,
    maxEntries: DATABASE_ENTRY_LIMITS[definition.group],
    validate(value: unknown): RmmvDatabaseValidationResult {
      return validateRecord(definition, value);
    },
  };
}

function buildSchemaLookup(): ReadonlyMap<string, RmmvDatabaseTableSchema> {
  const lookup = new Map<string, RmmvDatabaseTableSchema>();
  for (const schema of RMMV_DATABASE_SCHEMAS.values()) {
    addLookup(lookup, schema.group.toLowerCase(), schema);
    addLookup(lookup, schema.key.toLowerCase(), schema);
    addLookup(lookup, schema.fileName.replace(/\.json$/i, "").toLowerCase(), schema);
  }
  return lookup;
}

function addLookup(
  lookup: Map<string, RmmvDatabaseTableSchema>,
  key: string,
  schema: RmmvDatabaseTableSchema,
): void {
  if (!lookup.has(key)) lookup.set(key, schema);
}

function requiredInteger(path: string): RmmvDatabaseFieldSchema {
  return { path, kind: "integer", required: true };
}

function requiredString(path: string): RmmvDatabaseFieldSchema {
  return { path, kind: "string", required: true };
}

function integerField(path: string): RmmvDatabaseFieldSchema {
  return { path, kind: "integer" };
}

function stringField(path: string): RmmvDatabaseFieldSchema {
  return { path, kind: "string" };
}

function booleanField(path: string): RmmvDatabaseFieldSchema {
  return { path, kind: "boolean" };
}

function arrayField(path: string, note?: string): RmmvDatabaseFieldSchema {
  return { path, kind: "array", note };
}

function objectField(path: string): RmmvDatabaseFieldSchema {
  return { path, kind: "object" };
}

function ref(path: string, target: string, note?: string): RmmvDatabaseReferenceField {
  return { path, target, note };
}

function validateRecord(
  definition: RmmvDatabaseTableDefinition,
  value: unknown,
): RmmvDatabaseValidationResult {
  const issues: RmmvDatabaseValidationIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      issues: [{
        path: "$",
        message: `${definition.group} entry must be an object`,
        expected: "object",
        actual: actualKind(value),
      }],
    };
  }

  const record = value as Record<string, unknown>;
  for (const field of definition.coreFields) {
    const actual = readPath(record, field.path);
    if (!actual.found) {
      if (field.required) {
        issues.push({
          path: field.path,
          message: `Missing required RMMV field: ${field.path}`,
          expected: kindLabel(field.kind),
          actual: "missing",
        });
      }
      continue;
    }
    if (!matchesKind(actual.value, field.kind)) {
      issues.push({
        path: field.path,
        message: `Invalid RMMV field type: ${field.path}`,
        expected: kindLabel(field.kind),
        actual: actualKind(actual.value),
      });
    }
  }

  if (definition.isArrayTable) {
    const id = record.id;
    if (!Number.isInteger(id) || Number(id) <= 0) {
      issues.push({
        path: "id",
        message: "Array table entries must keep a positive integer id",
        expected: "positive integer",
        actual: actualKind(id),
      });
    }
  }

  validateDatabaseSpecificFields(definition.group, record, issues);

  return { ok: issues.length === 0, issues };
}

function validateDatabaseSpecificFields(
  group: RmmvDatabaseGroup,
  record: Record<string, unknown>,
  issues: RmmvDatabaseValidationIssue[],
): void {
  if (group === "Troops") {
    const pages = record.pages;
    if (!Array.isArray(pages)) return;
    pages.forEach((page, index) => {
      if (!page || typeof page !== "object" || Array.isArray(page)) {
        issues.push({
          path: `pages[${index}]`,
          message: "Troop battle event page must be an object",
          expected: "object",
          actual: actualKind(page),
        });
        return;
      }
      validateRmmvCommandList((page as Record<string, unknown>).list, `pages[${index}].list`, issues);
    });
    return;
  }

  if (group === "CommonEvents") validateRmmvCommandList(record.list, "list", issues);
}

function validateRmmvCommandList(
  value: unknown,
  pathPrefix: string,
  issues: RmmvDatabaseValidationIssue[],
): void {
  try {
    validateEventCommandList(value, pathPrefix);
  } catch (error) {
    issues.push({
      path: pathPrefix,
      message: (error as Error).message,
      expected: "structurally valid RMMV event command list",
      actual: actualKind(value),
    });
  }
}

function readPath(record: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  const normalized = path.replace(/\[\]/g, "");
  const segments = normalized.split(".").filter(Boolean);
  let cursor: unknown = record;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return { found: false };
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return { found: false };
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return { found: true, value: cursor };
}

function matchesKind(value: unknown, kind: RmmvDatabaseFieldKind | RmmvDatabaseFieldKind[]): boolean {
  const allowed = Array.isArray(kind) ? kind : [kind];
  return allowed.some((item) => {
    switch (item) {
      case "unknown":
        return true;
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "integer":
        return Number.isInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
  });
}

function kindLabel(kind: RmmvDatabaseFieldKind | RmmvDatabaseFieldKind[]): string {
  return Array.isArray(kind) ? kind.join(" | ") : kind;
}

function actualKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defaultDamage(): Record<string, unknown> {
  return { type: 0, elementId: 0, formula: "0", variance: 20, critical: false };
}

function defaultAudio(name = ""): Record<string, unknown> {
  return { name, pan: 0, pitch: 100, volume: 90 };
}

function defaultVehicle(): Record<string, unknown> {
  return {
    bgm: defaultAudio(),
    characterIndex: 0,
    characterName: "",
    startMapId: 0,
    startX: 0,
    startY: 0,
  };
}

function defaultParams(value = 0): number[] {
  return Array(8).fill(value);
}

function defaultClassParams(): number[][] {
  return Array.from({ length: 8 }, () => Array(100).fill(0));
}

function defaultEffect(): Record<string, unknown> {
  return { code: 0, dataId: 0, value1: 0, value2: 0 };
}

function defaultTrait(): Record<string, unknown> {
  return { code: 0, dataId: 0, value: 0 };
}

function defaultDropItem(): Record<string, unknown> {
  return { kind: 0, dataId: 0, denominator: 1 };
}

function defaultBattleEventPage(): Record<string, unknown> {
  return {
    conditions: {
      actorHp: 50,
      actorId: 1,
      actorValid: false,
      enemyHp: 50,
      enemyIndex: 0,
      enemyValid: false,
      switchId: 1,
      switchValid: false,
      turnA: 0,
      turnB: 0,
      turnEnding: false,
      turnValid: false,
    },
    list: clone(ENTRY_COMMAND_LIST),
    span: 0,
  };
}

function defaultActor(id = 1): Record<string, unknown> {
  return {
    id,
    battlerName: "",
    characterIndex: 0,
    characterName: "",
    classId: 1,
    equips: [1, 1, 2, 3, 0],
    faceIndex: 0,
    faceName: "",
    traits: [],
    initialLevel: 1,
    maxLevel: 99,
    name: "",
    nickname: "",
    note: "",
    profile: "",
  };
}

function defaultClass(id = 1): Record<string, unknown> {
  return {
    id,
    expParams: [30, 20, 30, 30],
    traits: [],
    learnings: [],
    name: "",
    note: "",
    params: defaultClassParams(),
  };
}

function defaultSkill(id = 1): Record<string, unknown> {
  return {
    id,
    animationId: 0,
    damage: defaultDamage(),
    description: "",
    effects: [defaultEffect()],
    hitType: 0,
    iconIndex: 0,
    message1: "",
    message2: "",
    mpCost: 0,
    name: "",
    note: "",
    occasion: 0,
    repeats: 1,
    requiredWtypeId1: 0,
    requiredWtypeId2: 0,
    scope: 0,
    speed: 0,
    stypeId: 1,
    successRate: 100,
    tpCost: 0,
    tpGain: 0,
  };
}

function defaultItem(id = 1): Record<string, unknown> {
  return {
    id,
    animationId: 0,
    consumable: true,
    damage: defaultDamage(),
    description: "",
    effects: [defaultEffect()],
    hitType: 0,
    iconIndex: 0,
    itypeId: 1,
    name: "",
    note: "",
    occasion: 0,
    price: 0,
    repeats: 1,
    scope: 0,
    speed: 0,
    successRate: 100,
    tpGain: 0,
  };
}

function defaultWeapon(id = 1): Record<string, unknown> {
  return {
    id,
    animationId: 0,
    description: "",
    etypeId: 1,
    traits: [defaultTrait()],
    iconIndex: 0,
    name: "",
    note: "",
    params: defaultParams(),
    price: 0,
    wtypeId: 1,
  };
}

function defaultArmor(id = 1): Record<string, unknown> {
  return {
    id,
    atypeId: 1,
    description: "",
    etypeId: 2,
    traits: [defaultTrait()],
    iconIndex: 0,
    name: "",
    note: "",
    params: defaultParams(),
    price: 0,
  };
}

function defaultEnemy(id = 1): Record<string, unknown> {
  return {
    id,
    actions: [],
    battlerHue: 0,
    battlerName: "",
    dropItems: [defaultDropItem(), defaultDropItem(), defaultDropItem()],
    exp: 0,
    gold: 0,
    name: "",
    note: "",
    params: defaultParams(),
    traits: [defaultTrait()],
  };
}

function defaultTroop(id = 1): Record<string, unknown> {
  return {
    id,
    members: [],
    name: "",
    pages: [defaultBattleEventPage()],
  };
}

function defaultState(id = 1): Record<string, unknown> {
  return {
    id,
    autoRemovalTiming: 0,
    chanceByDamage: 100,
    iconIndex: 0,
    maxTurns: 1,
    message1: "",
    message2: "",
    message3: "",
    message4: "",
    minTurns: 1,
    motion: 0,
    name: "",
    note: "",
    overlay: 0,
    priority: 50,
    removeAtBattleEnd: false,
    removeByDamage: false,
    removeByRestriction: false,
    removeByWalking: false,
    restriction: 0,
    stepsToRemove: 100,
    traits: [],
  };
}

function defaultAnimation(id = 1): Record<string, unknown> {
  return {
    id,
    animation1Hue: 0,
    animation1Name: "",
    animation2Hue: 0,
    animation2Name: "",
    frames: [],
    name: "",
    position: 1,
    timings: [],
  };
}

function defaultTileset(id = 1): Record<string, unknown> {
  return {
    id,
    flags: [],
    mode: 1,
    name: "",
    note: "",
    tilesetNames: ["", "", "", "", "", "", "", "", ""],
  };
}

function defaultCommonEvent(id = 1): Record<string, unknown> {
  return {
    id,
    list: clone(ENTRY_COMMAND_LIST),
    name: "",
    switchId: 1,
    trigger: 0,
  };
}

function defaultTypes(): Record<string, unknown> {
  return {
    elements: ["", "Physical"],
    skillTypes: ["", "Magic", "Special"],
    weaponTypes: ["", "Axe", "Claw", "Spear", "Sword", "Bow", "Dagger", "Hammer", "Staff", "Gun"],
    armorTypes: ["", "General Armor", "Magic Armor", "Light Armor", "Heavy Armor", "Small Shield", "Large Shield"],
    equipTypes: ["", "Weapon", "Shield", "Head", "Body", "Accessory"],
  };
}

function defaultTerms(): Record<string, unknown> {
  return {
    basic: ["Level", "Lv", "HP", "HP", "MP", "MP", "TP", "TP", "EXP", "EXP"],
    params: ["Max HP", "Max MP", "Attack", "Defense", "M.Attack", "M.Defense", "Agility", "Luck", "Hit", "Evasion"],
    commands: [
      "Fight",
      "Escape",
      "Attack",
      "Guard",
      "Item",
      "Skill",
      "Equip",
      "Status",
      "Formation",
      "Save",
      "Game End",
      "Options",
      "Weapon",
      "Armor",
      "Key Item",
      "Equip",
      "Optimize",
      "Clear",
      "New Game",
      "Continue",
      "To Title",
      "Cancel",
      "Buy",
      "Sell",
    ],
    messages: {
      actionFailure: "There was no effect on %1!",
      actorDamage: "%1 took %2 damage!",
      actorDrain: "%1 was drained of %2 %3!",
      actorGain: "%1 gained %2 %3!",
      actorLoss: "%1 lost %2 %3!",
      actorNoDamage: "%1 took no damage!",
      actorNoHit: "Miss! %1 took no damage!",
      actorRecovery: "%1 recovered %2 %3!",
      alwaysDash: "Always Dash",
      bgmVolume: "BGM Volume",
      bgsVolume: "BGS Volume",
      buffAdd: "%1's %2 went up!",
      buffRemove: "%1's %2 returned to normal!",
      commandRemember: "Command Remember",
      counterAttack: "%1 counterattacked!",
      criticalToActor: "A painful blow!!",
      criticalToEnemy: "An excellent hit!!",
      debuffAdd: "%1's %2 went down!",
      defeat: "%1 was defeated.",
      enemyDamage: "%1 took %2 damage!",
      enemyDrain: "%1 was drained of %2 %3!",
      enemyGain: "%1 gained %2 %3!",
      enemyLoss: "%1 lost %2 %3!",
      enemyNoDamage: "%1 took no damage!",
      enemyNoHit: "Miss! %1 took no damage!",
      enemyRecovery: "%1 recovered %2 %3!",
      escapeFailure: "However, it was unable to escape!",
      escapeStart: "%1 has started to escape!",
      evasion: "%1 evaded the attack!",
      expNext: "To Next %1",
      expTotal: "Current %1",
      file: "File",
      levelUp: "%1 is now %2 %3!",
      loadMessage: "Load which file?",
      magicEvasion: "%1 nullified the magic!",
      magicReflection: "%1 reflected the magic!",
      meVolume: "ME Volume",
      obtainExp: "%1 %2 received!",
      obtainGold: "%1\\G found!",
      obtainItem: "%1 found!",
      obtainSkill: "%1 learned!",
      partyName: "%1's Party",
      possession: "Possession",
      preemptive: "%1 got the upper hand!",
      saveMessage: "Save to which file?",
      seVolume: "SE Volume",
      substitute: "%1 protected %2!",
      surprise: "%1 was surprised!",
      useItem: "%1 uses %2!",
      victory: "%1 was victorious!",
    },
  };
}

function defaultSystem(): Record<string, unknown> {
  return {
    ...defaultTypes(),
    airship: defaultVehicle(),
    attackMotions: [
      { type: 0, weaponImageId: 0 },
      { type: 1, weaponImageId: 1 },
      { type: 2, weaponImageId: 2 },
    ],
    battleBgm: defaultAudio("Battle1"),
    battleback1Name: "",
    battleback2Name: "",
    battlerHue: 0,
    battlerName: "",
    boat: defaultVehicle(),
    currencyUnit: "G",
    defeatMe: defaultAudio("Defeat1"),
    editMapId: 1,
    gameTitle: "",
    gameoverMe: defaultAudio("Gameover1"),
    locale: "en_US",
    magicSkills: [1],
    menuCommands: [true, true, true, true, true, true],
    optDisplayTp: true,
    optDrawTitle: true,
    optExtraExp: false,
    optFloorDeath: false,
    optFollowers: true,
    optSideView: false,
    optSlipDeath: false,
    optTransparent: false,
    partyMembers: [1],
    ship: defaultVehicle(),
    sounds: Array.from({ length: 24 }, () => defaultAudio()),
    startMapId: 1,
    startX: 0,
    startY: 0,
    switches: [""],
    terms: defaultTerms(),
    testBattlers: [],
    testTroopId: 1,
    title1Name: "",
    title2Name: "",
    titleBgm: defaultAudio("Theme1"),
    variables: [""],
    versionId: 1,
    victoryMe: defaultAudio("Victory1"),
    windowTone: [0, 0, 0, 0],
  };
}
