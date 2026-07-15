import {
  createDefaultRmmvDatabaseEntry,
  getRmmvDatabaseSchemaByKey,
  type RmmvDatabaseTableKey,
} from "./database-schema.ts";

export type RmmvJsonPatchOperation =
  | { op: "add" | "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

export interface RmmvDatabaseFieldDiff {
  op: RmmvJsonPatchOperation["op"];
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface RmmvDatabasePatchResult {
  value: Record<string, unknown>;
  diffs: RmmvDatabaseFieldDiff[];
}

type PatchNode = ScalarNode | ObjectNode | ArrayNode | DynamicNode;
interface ScalarNode { kind: "scalar" }
interface ObjectNode { kind: "object"; fields: Readonly<Record<string, PatchNode>> }
interface ArrayNode { kind: "array"; element: PatchNode; stableTail?: boolean; fixedLength?: boolean }
interface DynamicNode { kind: "dynamic" }

const scalar: ScalarNode = Object.freeze({ kind: "scalar" });
const dynamic: DynamicNode = Object.freeze({ kind: "dynamic" });
const array = (element: PatchNode, stableTail = false): ArrayNode => ({
  kind: "array",
  element,
  ...(stableTail ? { stableTail: true } : {}),
});
const fixedArray = (element: PatchNode): ArrayNode => ({ kind: "array", element, fixedLength: true });
const object = (fields: Record<string, PatchNode>): ObjectNode => ({ kind: "object", fields });

const trait = object({ code: scalar, dataId: scalar, value: scalar });
const effect = object({ code: scalar, dataId: scalar, value1: scalar, value2: scalar });
const audio = object({ name: scalar, pan: scalar, pitch: scalar, volume: scalar });
const eventCommand = object({ code: scalar, indent: scalar, parameters: array(dynamic) });
const eventList = array(eventCommand);
const vehicle = object({
  bgm: audio,
  characterIndex: scalar,
  characterName: scalar,
  startMapId: scalar,
  startX: scalar,
  startY: scalar,
});
const troopConditions = object({
  actorHp: scalar,
  actorId: scalar,
  actorValid: scalar,
  enemyHp: scalar,
  enemyIndex: scalar,
  enemyValid: scalar,
  switchId: scalar,
  switchValid: scalar,
  turnA: scalar,
  turnB: scalar,
  turnEnding: scalar,
  turnValid: scalar,
});
const battleEventPage = object({ conditions: troopConditions, list: eventList, span: scalar });

const TYPE_LIST_FIELDS = new Set(["elements", "skillTypes", "weaponTypes", "armorTypes", "equipTypes"]);
const DYNAMIC_STANDARD_KEYS = new Set([
  "name",
  "pan",
  "pitch",
  "volume",
  "list",
  "repeat",
  "skippable",
  "wait",
  "code",
  "parameters",
]);
const FORBIDDEN_PROPERTY_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const NESTED_FIELDS: Partial<Record<RmmvDatabaseTableKey, Record<string, PatchNode>>> = {
  actors: {
    equips: array(scalar),
    traits: array(trait),
  },
  classes: {
    expParams: fixedArray(scalar),
    params: fixedArray(fixedArray(scalar)),
    learnings: array(object({ level: scalar, note: scalar, skillId: scalar })),
    traits: array(trait),
  },
  skills: {
    damage: object({ type: scalar, elementId: scalar, formula: scalar, variance: scalar, critical: scalar }),
    effects: array(effect),
  },
  items: {
    damage: object({ type: scalar, elementId: scalar, formula: scalar, variance: scalar, critical: scalar }),
    effects: array(effect),
  },
  weapons: {
    params: fixedArray(scalar),
    traits: array(trait),
  },
  armors: {
    params: fixedArray(scalar),
    traits: array(trait),
  },
  enemies: {
    params: fixedArray(scalar),
    traits: array(trait),
    actions: array(object({
      conditionParam1: scalar,
      conditionParam2: scalar,
      conditionType: scalar,
      rating: scalar,
      skillId: scalar,
    })),
    dropItems: array(object({ kind: scalar, dataId: scalar, denominator: scalar })),
  },
  troops: {
    members: array(object({ enemyId: scalar, hidden: scalar, x: scalar, y: scalar })),
    pages: array(battleEventPage),
  },
  states: {
    traits: array(trait),
  },
  animations: {
    frames: array(array(fixedArray(scalar))),
    timings: array(object({
      flashColor: fixedArray(scalar),
      flashDuration: scalar,
      flashScope: scalar,
      frame: scalar,
      se: audio,
    })),
  },
  tilesets: {
    flags: array(scalar),
    tilesetNames: fixedArray(scalar),
  },
  commonEvents: {
    list: eventList,
  },
  system: {
    switches: array(scalar, true),
    variables: array(scalar, true),
    partyMembers: array(scalar),
    testBattlers: array(object({ actorId: scalar, equips: array(scalar), level: scalar })),
    boat: vehicle,
    ship: vehicle,
    airship: vehicle,
    titleBgm: audio,
    battleBgm: audio,
    victoryMe: audio,
    defeatMe: audio,
    gameoverMe: audio,
    sounds: fixedArray(audio),
    menuCommands: fixedArray(scalar),
    windowTone: fixedArray(scalar),
    attackMotions: array(object({ type: scalar, weaponImageId: scalar })),
    magicSkills: array(scalar),
  },
  terms: {
    basic: fixedArray(scalar),
    params: fixedArray(scalar),
    commands: fixedArray(scalar),
    messages: defaultTermMessagesSchema(),
  },
};

const SYSTEM_EXTRA_FIELDS: Readonly<Record<string, PatchNode>> = {
  attackMotions: NESTED_FIELDS.system!.attackMotions,
  battlerHue: scalar,
  battlerName: scalar,
  currencyUnit: scalar,
  locale: scalar,
  magicSkills: NESTED_FIELDS.system!.magicSkills,
};

export function applyRmmvDatabasePatch(
  table: RmmvDatabaseTableKey,
  source: Record<string, unknown>,
  operations: readonly RmmvJsonPatchOperation[],
): RmmvDatabasePatchResult {
  if (table === "types") {
    throw new Error("Types can only be changed through fixed-id type-list operations.");
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("Database patch must contain at least one operation.");
  }

  const rootSchema = databaseRootSchema(table);
  const value = structuredClone(source);
  const diffs: RmmvDatabaseFieldDiff[] = [];
  for (const operation of operations) {
    const segments = parsePointer(operation.path);
    if (segments.length === 0) throw new Error("Database patch cannot replace the whole database record.");
    if (segments[0] === "id") throw new Error("Database entry id is immutable.");
    if (table === "system" && (TYPE_LIST_FIELDS.has(segments[0]) || segments[0] === "terms")) {
      throw new Error("System type lists require fixed-id type-list operations; Terms must use the Terms group.");
    }
    applyOne(value, rootSchema, operation, segments, diffs);
  }
  return { value, diffs };
}

function applyOne(
  root: Record<string, unknown>,
  rootSchema: ObjectNode,
  operation: RmmvJsonPatchOperation,
  segments: string[],
  diffs: RmmvDatabaseFieldDiff[],
): void {
  let parent: unknown = root;
  let schema: PatchNode = rootSchema;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = descend(parent, schema, segment, operation.path);
    parent = next.value;
    schema = next.schema;
  }

  const finalSegment = segments[segments.length - 1];
  if (schema.kind === "object") {
    applyObjectField(parent, schema, finalSegment, operation, diffs);
    return;
  }
  if (schema.kind === "array") {
    applyArrayElement(parent, schema, finalSegment, operation, diffs);
    return;
  }
  if (schema.kind === "dynamic") {
    applyDynamicValue(parent, finalSegment, operation, diffs);
    return;
  }
  throw new Error(`Database patch path is not declared as a container: ${operation.path}`);
}

function descend(
  current: unknown,
  schema: PatchNode,
  segment: string,
  path: string,
): { value: unknown; schema: PatchNode } {
  assertSafeProperty(segment);
  if (schema.kind === "object") {
    if (!isRecord(current)) throw new Error(`Database patch path is not an object: ${path}`);
    const childSchema = schema.fields[segment];
    if (!childSchema) throw new Error(`Database patch path is not declared by the RMMV schema: ${path}`);
    if (!Object.hasOwn(current, segment)) throw new Error(`Database patch path does not exist: ${path}`);
    return { value: current[segment], schema: childSchema };
  }
  if (schema.kind === "array") {
    if (!Array.isArray(current)) throw new Error(`Database patch path is not an array: ${path}`);
    const index = existingArrayIndex(segment, current.length, path);
    return { value: current[index], schema: schema.element };
  }
  if (schema.kind === "dynamic") {
    if (Array.isArray(current)) {
      const index = existingArrayIndex(segment, current.length, path);
      return { value: current[index], schema: dynamic };
    }
    if (isRecord(current)) {
      if (!DYNAMIC_STANDARD_KEYS.has(segment)) {
        throw new Error(`Database patch path is not declared by the RMMV schema: ${path}`);
      }
      if (!Object.hasOwn(current, segment)) throw new Error(`Database patch path does not exist: ${path}`);
      return { value: current[segment], schema: dynamic };
    }
  }
  throw new Error(`Database patch path cannot descend through a scalar value: ${path}`);
}

function applyObjectField(
  parent: unknown,
  schema: ObjectNode,
  key: string,
  operation: RmmvJsonPatchOperation,
  diffs: RmmvDatabaseFieldDiff[],
): void {
  assertSafeProperty(key);
  if (!isRecord(parent)) throw new Error(`Database patch parent is not an object: ${operation.path}`);
  const childSchema = schema.fields[key];
  if (!childSchema) throw new Error(`Database patch path is not declared by the RMMV schema: ${operation.path}`);
  const exists = Object.hasOwn(parent, key);
  if (operation.op === "remove") {
    throw new Error(`Database patch cannot remove a declared object field: ${operation.path}`);
  }
  if (operation.op === "replace" && !exists) throw new Error(`Database patch replace path does not exist: ${operation.path}`);
  const before = exists ? structuredClone(parent[key]) : undefined;
  if (exists && isComplex(parent[key])) {
    throw new Error(`Database patch cannot replace an existing complex value: ${operation.path}`);
  }
  assertDeclaredValue(operation.value, childSchema, operation.path);
  parent[key] = structuredClone(operation.value);
  diffs.push({ op: operation.op, path: operation.path, ...(exists ? { before } : {}), after: structuredClone(operation.value) });
}

function applyArrayElement(
  parent: unknown,
  schema: ArrayNode,
  segment: string,
  operation: RmmvJsonPatchOperation,
  diffs: RmmvDatabaseFieldDiff[],
): void {
  if (!Array.isArray(parent)) throw new Error(`Database patch parent is not an array: ${operation.path}`);
  if (schema.fixedLength && operation.op !== "replace") {
    throw new Error(`Fixed-length database arrays do not allow insertion or removal: ${operation.path}`);
  }
  if (operation.op === "add") {
    const index = addArrayIndex(segment, parent.length, operation.path);
    if (schema.stableTail && index !== parent.length) {
      throw new Error(`Stable-id arrays only allow insertion at the tail: ${operation.path}`);
    }
    assertDeclaredValue(operation.value, schema.element, operation.path);
    parent.splice(index, 0, structuredClone(operation.value));
    diffs.push({ op: "add", path: operation.path, after: structuredClone(operation.value) });
    return;
  }

  const index = existingArrayIndex(segment, parent.length, operation.path);
  if (schema.stableTail && (index !== parent.length - 1 || index === 0) && operation.op === "remove") {
    throw new Error(`Stable-id arrays only allow removal from the nonzero tail: ${operation.path}`);
  }
  const before = structuredClone(parent[index]);
  if (operation.op === "remove") {
    parent.splice(index, 1);
    diffs.push({ op: "remove", path: operation.path, before });
    return;
  }
  if (isComplex(parent[index])) {
    throw new Error(`Database patch cannot replace an existing complex value: ${operation.path}`);
  }
  assertDeclaredValue(operation.value, schema.element, operation.path);
  parent[index] = structuredClone(operation.value);
  diffs.push({ op: "replace", path: operation.path, before, after: structuredClone(operation.value) });
}

function applyDynamicValue(
  parent: unknown,
  segment: string,
  operation: RmmvJsonPatchOperation,
  diffs: RmmvDatabaseFieldDiff[],
): void {
  if (Array.isArray(parent)) {
    applyArrayElement(parent, array(dynamic), segment, operation, diffs);
    return;
  }
  if (!isRecord(parent) || !DYNAMIC_STANDARD_KEYS.has(segment)) {
    throw new Error(`Database patch path is not declared by the RMMV schema: ${operation.path}`);
  }
  applyObjectField(parent, object(Object.fromEntries([...DYNAMIC_STANDARD_KEYS].map((key) => [key, dynamic]))), segment, operation, diffs);
}

function databaseRootSchema(table: RmmvDatabaseTableKey): ObjectNode {
  const schema = getRmmvDatabaseSchemaByKey(table);
  const nested = NESTED_FIELDS[table] ?? {};
  const fields: Record<string, PatchNode> = {};
  for (const field of schema.coreFields) {
    const root = field.path.split(".")[0];
    fields[root] = nested[root] ?? scalar;
  }
  if (table === "system") Object.assign(fields, SYSTEM_EXTRA_FIELDS);
  return object(fields);
}

function defaultTermMessagesSchema(): ObjectNode {
  const terms = createDefaultRmmvDatabaseEntry("Terms");
  const messages = isRecord(terms.messages) ? terms.messages : {};
  return object(Object.fromEntries(Object.keys(messages).map((key) => [key, scalar])));
}

function assertDeclaredValue(value: unknown, schema: PatchNode, path: string): void {
  if (schema.kind === "scalar") {
    if (isComplex(value)) throw new Error(`Database patch value is not a declared scalar: ${path}`);
    return;
  }
  if (schema.kind === "array") {
    if (!Array.isArray(value)) throw new Error(`Database patch value must be an array: ${path}`);
    value.forEach((item) => assertDeclaredValue(item, schema.element, path));
    return;
  }
  if (schema.kind === "object") {
    if (!isRecord(value)) throw new Error(`Database patch value must be an object: ${path}`);
    for (const [key, child] of Object.entries(value)) {
      assertSafeProperty(key);
      const childSchema = schema.fields[key];
      if (!childSchema) throw new Error(`Database patch value contains an undeclared field "${key}": ${path}`);
      assertDeclaredValue(child, childSchema, path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertDeclaredValue(item, dynamic, path));
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertSafeProperty(key);
      if (!DYNAMIC_STANDARD_KEYS.has(key)) {
        throw new Error(`Database patch value contains an undeclared field "${key}": ${path}`);
      }
      assertDeclaredValue(child, dynamic, path);
    }
  }
}

function parsePointer(pointer: string): string[] {
  if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))) {
    throw new Error(`Database patch path must be an RFC 6901 JSON Pointer: ${String(pointer)}`);
  }
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map((segment) => {
    if (/~(?:[^01]|$)/.test(segment)) throw new Error(`Database patch path has an invalid JSON Pointer escape: ${pointer}`);
    const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    assertSafeProperty(decoded);
    return decoded;
  });
}

function existingArrayIndex(segment: string, length: number, path: string): number {
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new Error(`Database patch array index is invalid: ${path}`);
  const index = Number(segment);
  if (index >= length) throw new Error(`Database patch array index is out of range: ${path}`);
  return index;
}

function addArrayIndex(segment: string, length: number, path: string): number {
  if (segment === "-") return length;
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new Error(`Database patch array index is invalid: ${path}`);
  const index = Number(segment);
  if (index > length) throw new Error(`Database patch array insertion index is out of range: ${path}`);
  return index;
}

function assertSafeProperty(value: string): void {
  if (FORBIDDEN_PROPERTY_KEYS.has(value)) throw new Error(`Database patch path contains a forbidden property: ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isComplex(value: unknown): boolean {
  return Boolean(value) && typeof value === "object";
}
