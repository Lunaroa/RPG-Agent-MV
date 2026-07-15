import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  applyStagedOperation,
  discardStagedOperation,
  getProjectFileForRead,
  getProjectStagingStatus,
  projectHash,
  stageDatabaseStagingOperationDrafts,
  type StagingOperation,
} from "../desktop/staging-service.ts";
import { applyRmmvDatabasePatch, type RmmvDatabaseFieldDiff, type RmmvJsonPatchOperation } from "./database-patch.ts";
import { readEffectiveRmmvDatabaseTable } from "./database-read.ts";
import {
  createDefaultRmmvDatabaseEntry,
  getRmmvDatabaseSchemaByKey,
  type RmmvDatabaseTableKey,
} from "./database-schema.ts";
import {
  validateRmmvDatabaseTransition,
  validateRmmvDatabaseSnapshot,
  type RmmvDatabaseMapDocument,
  type RmmvDatabaseSemanticValidationResult,
  type RmmvDatabaseSnapshot,
} from "./database-validation.ts";
import { dataRelativePath, resolveRmmvLayout } from "./rmmv-layout.ts";

export type RmmvArrayDatabaseTableKey = Exclude<RmmvDatabaseTableKey, "system" | "types" | "terms">;
export type RmmvTypeListField = "elements" | "skillTypes" | "weaponTypes" | "armorTypes" | "equipTypes";

export type RmmvDatabaseChange =
  | {
    op: "create";
    table: RmmvArrayDatabaseTableKey;
    id?: number;
    patches?: readonly RmmvJsonPatchOperation[];
  }
  | {
    op: "patch";
    table: RmmvDatabaseTableKey;
    id: number;
    patches: readonly RmmvJsonPatchOperation[];
  }
  | {
    op: "reset";
    table: RmmvArrayDatabaseTableKey;
    id: number;
  }
  | {
    op: "type.rename";
    field: RmmvTypeListField;
    id: number;
    name: string;
  }
  | {
    op: "type.append";
    field: RmmvTypeListField;
    name: string;
  }
  | {
    op: "type.removeTail";
    field: RmmvTypeListField;
    id: number;
  };

export type ResolvedRmmvDatabaseChange =
  | (Extract<RmmvDatabaseChange, { op: "create" }> & { id: number })
  | Exclude<RmmvDatabaseChange, { op: "create" } | { op: "type.append" }>
  | (Extract<RmmvDatabaseChange, { op: "type.append" }> & { id: number });

export interface RmmvDatabasePlanDiff {
  op: RmmvJsonPatchOperation["op"] | "create" | "reset" | "type.rename" | "type.append" | "type.removeTail";
  relativePath: string;
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface RmmvDatabasePlanFile {
  relativePath: string;
  groups: RmmvDatabaseTableKey[];
  sourceHash: string | null;
  effectiveHash: string;
  afterHash: string;
}

export interface RmmvDatabaseInputHash {
  relativePath: string;
  sourceHash: string | null;
  effectiveHash: string;
}

export interface RmmvDatabasePlan {
  version: 1;
  project: string;
  projectHash: string;
  resolvedChanges: ResolvedRmmvDatabaseChange[];
  files: RmmvDatabasePlanFile[];
  diffs: RmmvDatabasePlanDiff[];
  inputHashes: RmmvDatabaseInputHash[];
  validation: RmmvDatabaseSemanticValidationResult;
  planHash: string;
}

export interface RmmvDatabaseChangeRequest {
  changes: readonly RmmvDatabaseChange[];
}

export interface RmmvDatabaseStageRequest extends RmmvDatabaseChangeRequest {
  planHash: string;
  sessionId?: string;
}

interface LoadedPhysicalTable {
  table: RmmvArrayDatabaseTableKey | "system";
  relativePath: string;
  value: unknown;
  sourceHash: string | null;
  effectiveHash: string;
}

interface BuiltPlan {
  publicPlan: RmmvDatabasePlan;
  drafts: Array<{ relativePath: string; content: Buffer; expectedSourceHash: string | null }>;
}

export interface RmmvEffectiveDatabaseValidationState {
  snapshot: RmmvDatabaseSnapshot;
  maps: RmmvDatabaseMapDocument[];
}

interface LoadProjectInputOptions {
  sourceOnlyRelativePaths?: ReadonlySet<string>;
}

const ARRAY_TABLES: readonly RmmvArrayDatabaseTableKey[] = [
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
];
const PHYSICAL_TABLES: readonly (RmmvArrayDatabaseTableKey | "system")[] = [...ARRAY_TABLES, "system"];
const ARRAY_TABLE_SET = new Set<RmmvDatabaseTableKey>(ARRAY_TABLES);
const TYPE_LIST_FIELDS = new Set<RmmvTypeListField>([
  "elements",
  "skillTypes",
  "weaponTypes",
  "armorTypes",
  "equipTypes",
]);

export function dryRunRmmvDatabaseChanges(
  workflowRoot: string,
  project: string,
  request: RmmvDatabaseChangeRequest,
): RmmvDatabasePlan {
  return buildPlan(workflowRoot, project, request).publicPlan;
}

export function validateRmmvDatabaseChanges(
  workflowRoot: string,
  project: string,
  request: RmmvDatabaseChangeRequest,
): RmmvDatabaseSemanticValidationResult {
  return buildPlan(workflowRoot, project, request).publicPlan.validation;
}

export function validateEffectiveRmmvDatabaseState(
  workflowRoot: string,
  project: string,
): RmmvDatabaseSemanticValidationResult {
  const loaded = loadProjectInputs(workflowRoot, path.resolve(project));
  return validateRmmvDatabaseSnapshot(loaded.snapshot, { maps: loaded.maps });
}

export function captureEffectiveRmmvDatabaseValidationState(
  workflowRoot: string,
  project: string,
): RmmvEffectiveDatabaseValidationState {
  const loaded = loadProjectInputs(workflowRoot, path.resolve(project));
  return {
    snapshot: structuredClone(loaded.snapshot),
    maps: structuredClone(loaded.maps),
  };
}

export function validateEffectiveRmmvDatabaseTransition(
  workflowRoot: string,
  project: string,
  before: RmmvEffectiveDatabaseValidationState,
): RmmvDatabaseSemanticValidationResult {
  const after = loadProjectInputs(workflowRoot, path.resolve(project));
  return validateRmmvDatabaseTransition(before.snapshot, after.snapshot, {
    beforeMaps: before.maps,
    maps: after.maps,
  });
}

export function preflightRmmvDatabaseProjectApply(
  workflowRoot: string,
  projectRoot: string,
): RmmvDatabaseSemanticValidationResult {
  const project = path.resolve(projectRoot);
  const status = getProjectStagingStatus(workflowRoot, project);
  if (status.conflict) throw new Error("Database staging conflict blocks apply.");
  const operations = status.operations as StagingOperation[];
  const after = loadProjectInputs(workflowRoot, project);
  const actualHashes = new Map(after.inputHashes.map((entry) => [entry.relativePath, entry.effectiveHash]));

  for (const operation of operations) {
    const metadata = parseAndVerifyOperationMetadata(project, operation);
    for (const output of metadata.outputs) {
      if (actualHashes.get(output.relativePath) !== output.afterHash) {
        throw new Error(`Database operation draft drift blocks apply: ${output.relativePath}`);
      }
    }
  }

  const sourceOnlyRelativePaths = new Set(status.files.map((file) => file.relativePath));
  const before = loadProjectInputs(workflowRoot, project, { sourceOnlyRelativePaths });
  const validation = validateRmmvDatabaseTransition(before.snapshot, after.snapshot, {
    beforeMaps: before.maps,
    maps: after.maps,
  });
  assertSemanticValidationOk(validation);
  return validation;
}

export function stageRmmvDatabaseChanges(
  workflowRoot: string,
  project: string,
  request: RmmvDatabaseStageRequest,
) {
  if (!/^[a-f0-9]{64}$/i.test(String(request?.planHash || ""))) {
    throw new Error("Database stage planHash must be a SHA-256 hex digest.");
  }
  const built = buildPlan(workflowRoot, project, request);
  const plan = built.publicPlan;
  if (plan.planHash !== request.planHash.toLowerCase()) {
    throw new Error(`Database planHash is stale; run dryRun again before staging. Expected ${plan.planHash}.`);
  }
  if (!plan.validation.ok) {
    throw new Error(`Database plan has ${plan.validation.issues.filter((issue) => issue.severity === "error").length} validation error(s).`);
  }

  const operationId = `db:${crypto.randomUUID()}`;
  const operation = stageDatabaseStagingOperationDrafts(
    workflowRoot,
    project,
    {
      operationId,
      planHash: plan.planHash,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      files: plan.files.map((file) => file.relativePath),
      changes: {
        version: plan.version,
        resolvedChanges: plan.resolvedChanges,
        inputHashes: plan.inputHashes,
        outputHashes: plan.files.map((file) => ({ relativePath: file.relativePath, afterHash: file.afterHash })),
      },
    },
    built.drafts,
  );
  return {
    operationId: operation.operationId,
    planHash: operation.planHash,
    files: [...operation.files],
    resolvedChanges: plan.resolvedChanges,
    validation: plan.validation,
  };
}

export function discardRmmvDatabaseChanges(workflowRoot: string, project: string, operationId: string) {
  return discardStagedOperation(workflowRoot, project, operationId);
}

export function applyRmmvDatabaseChanges(workflowRoot: string, project: string, operationId: string) {
  return applyStagedOperation(workflowRoot, project, operationId, {
    validate: ({ operation }) => {
      validateStagedOperationState(workflowRoot, project, operation);
    },
  });
}

function validateStagedOperationState(
  workflowRoot: string,
  projectRoot: string,
  operation: { planHash: string; files: string[]; changes: unknown },
): void {
  const project = path.resolve(projectRoot);
  const { inputHashes, outputs } = parseAndVerifyOperationMetadata(project, operation);

  const after = loadProjectInputs(workflowRoot, project);
  const actual = new Map(after.inputHashes.map((entry) => [entry.relativePath, entry.effectiveHash]));
  const approvedInputs = new Map(inputHashes.map((entry) => [entry.relativePath, entry]));
  for (const output of outputs) {
    const approvedInput = approvedInputs.get(output.relativePath);
    if (!approvedInput) {
      throw new Error(`Database staging output is not part of the approved input set: ${output.relativePath}`);
    }
    if (actual.get(output.relativePath) !== output.afterHash) {
      throw new Error(`Database operation draft drift blocks apply: ${output.relativePath}`);
    }
  }

  const sourceOnlyRelativePaths = new Set(outputs.map((output) => output.relativePath));
  const before = loadProjectInputs(workflowRoot, project, { sourceOnlyRelativePaths });
  for (const output of outputs) {
    const approvedSourceHash = approvedInputs.get(output.relativePath)!.sourceHash;
    const currentSourceHash = before.inputHashes.find((entry) => entry.relativePath === output.relativePath)?.sourceHash;
    if (currentSourceHash !== approvedSourceHash) {
      throw new Error(`Database source drift blocks apply: ${output.relativePath}`);
    }
  }
  const validation = validateRmmvDatabaseTransition(before.snapshot, after.snapshot, {
    beforeMaps: before.maps,
    maps: after.maps,
  });
  assertSemanticValidationOk(validation);
}

function parseAndVerifyOperationMetadata(
  project: string,
  operation: Pick<StagingOperation, "planHash" | "files" | "changes">,
): { inputHashes: RmmvDatabaseInputHash[]; outputs: Array<{ relativePath: string; afterHash: string }> } {
  const metadata = requireRecord(operation.changes, "Database staging operation metadata");
  if (metadata.version !== 1 || !Array.isArray(metadata.resolvedChanges)) {
    throw new Error("Database staging operation metadata is invalid.");
  }
  const inputHashes = parseInputHashes(metadata.inputHashes);
  const outputs = parseOutputHashes(metadata.outputHashes);
  const outputFiles = new Set(outputs.map((output) => output.relativePath));
  if (
    outputFiles.size !== operation.files.length
    || operation.files.some((relativePath) => !outputFiles.has(relativePath))
  ) {
    throw new Error("Database staging operation output files do not match operation ownership.");
  }
  const recomputedPlanHash = hash(Buffer.from(canonicalJson({
    version: 1,
    projectHash: projectHash(project),
    resolvedChanges: metadata.resolvedChanges,
    inputHashes,
    outputs,
  }), "utf8"));
  if (recomputedPlanHash !== operation.planHash) {
    throw new Error("Database staging operation planHash no longer matches its metadata.");
  }
  return { inputHashes, outputs };
}

function assertSemanticValidationOk(validation: RmmvDatabaseSemanticValidationResult): void {
  if (validation.ok) return;
  const errors = validation.issues.filter((issue) => issue.severity === "error");
  const detail = errors.slice(0, 5).map((issue) => `${issue.source.path}: ${issue.message}`).join("; ");
  throw new Error(`Database staged state failed semantic revalidation (${errors.length} error(s)): ${detail}`);
}

function buildPlan(
  workflowRoot: string,
  projectRoot: string,
  request: RmmvDatabaseChangeRequest,
): BuiltPlan {
  const project = path.resolve(projectRoot);
  if (!Array.isArray(request?.changes) || request.changes.length === 0) {
    throw new Error("Database change batch must contain at least one change.");
  }

  const loaded = loadProjectInputs(workflowRoot, project);
  const before = loaded.snapshot;
  const after = structuredClone(before);
  const resolvedChanges: ResolvedRmmvDatabaseChange[] = [];
  const diffs: Array<Omit<RmmvDatabasePlanDiff, "relativePath"> & { physicalTable: RmmvArrayDatabaseTableKey | "system" }> = [];
  const affected = new Map<RmmvArrayDatabaseTableKey | "system", Set<RmmvDatabaseTableKey>>();

  request.changes.forEach((change, changeIndex) => {
    applyChange(after, change, changeIndex, resolvedChanges, diffs, affected);
  });

  const validation = validateRmmvDatabaseTransition(before, after, {
    beforeMaps: loaded.maps,
    maps: loaded.maps,
  });
  const files: RmmvDatabasePlanFile[] = [];
  const drafts: BuiltPlan["drafts"] = [];
  for (const physicalTable of [...affected.keys()].sort()) {
    const source = loaded.physical.get(physicalTable)!;
    const value = after[physicalTable];
    const content = serializeJson(value);
    const afterHash = hash(content);
    files.push({
      relativePath: source.relativePath,
      groups: [...affected.get(physicalTable)!].sort(),
      sourceHash: source.sourceHash,
      effectiveHash: source.effectiveHash,
      afterHash,
    });
    drafts.push({ relativePath: source.relativePath, content, expectedSourceHash: source.sourceHash });
  }
  if (files.length === 0) throw new Error("Database change batch did not affect any file.");

  const publicDiffs: RmmvDatabasePlanDiff[] = diffs.map(({ physicalTable, ...diff }) => ({
    ...diff,
    relativePath: loaded.physical.get(physicalTable)!.relativePath,
  }));
  const planHashPayload = {
    version: 1,
    projectHash: projectHash(project),
    resolvedChanges,
    inputHashes: loaded.inputHashes,
    outputs: files.map((file) => ({ relativePath: file.relativePath, afterHash: file.afterHash })),
  };
  const planHash = hash(Buffer.from(canonicalJson(planHashPayload), "utf8"));
  return {
    publicPlan: {
      version: 1,
      project,
      projectHash: planHashPayload.projectHash,
      resolvedChanges,
      files,
      diffs: publicDiffs,
      inputHashes: loaded.inputHashes,
      validation,
      planHash,
    },
    drafts,
  };
}

function applyChange(
  snapshot: RmmvDatabaseSnapshot,
  change: RmmvDatabaseChange,
  changeIndex: number,
  resolved: ResolvedRmmvDatabaseChange[],
  diffs: Array<Omit<RmmvDatabasePlanDiff, "relativePath"> & { physicalTable: RmmvArrayDatabaseTableKey | "system" }>,
  affected: Map<RmmvArrayDatabaseTableKey | "system", Set<RmmvDatabaseTableKey>>,
): void {
  if (!change || typeof change !== "object") throw new Error(`Database change ${changeIndex} must be an object.`);
  if (change.op === "create") {
    const table = requireArrayTable(change.table, changeIndex);
    const records = requireArray(snapshot[table], `${table} database`);
    const id = change.id === undefined ? smallestEmptySlot(records) : positiveId(change.id, `${table} create id`);
    const schema = getRmmvDatabaseSchemaByKey(table);
    if (schema.maxEntries !== null && id > schema.maxEntries) {
      throw new Error(`${schema.group} create id ${id} exceeds the RPG Maker MV limit of ${schema.maxEntries}.`);
    }
    if (isRecord(records[id])) throw new Error(`${schema.group} id ${id} is already occupied.`);
    while (records.length <= id) records.push(null);
    let entry = createDefaultRmmvDatabaseEntry(table, id);
    const patches = change.patches ?? [];
    let createPatchDiffs: RmmvDatabaseFieldDiff[] = [];
    if (!Array.isArray(patches)) throw new Error(`Database create patches must be an array at change ${changeIndex}.`);
    if (patches.length) {
      const patched = applyRmmvDatabasePatch(table, entry, patches);
      entry = patched.value;
      createPatchDiffs = patched.diffs;
    }
    records[id] = entry;
    resolved.push({ ...change, table, id, ...(patches.length ? { patches: [...patches] } : {}) });
    markAffected(affected, table, table);
    diffs.push({ physicalTable: table, op: "create", path: `/${table}/${id}`, before: null, after: structuredClone(entry) });
    appendPatchDiffs(diffs, table, table, id, createPatchDiffs);
    return;
  }

  if (change.op === "patch") {
    const table = requireTable(change.table, changeIndex);
    if (!Array.isArray(change.patches) || change.patches.length === 0) {
      throw new Error(`Database patch change ${changeIndex} must contain at least one patch operation.`);
    }
    if (ARRAY_TABLE_SET.has(table)) {
      const arrayTable = table as RmmvArrayDatabaseTableKey;
      const id = positiveId(change.id, `${table} patch id`);
      const records = requireArray(snapshot[arrayTable], `${table} database`);
      const entry = records[id];
      if (!isRecord(entry) || entry.id !== id) throw new Error(`${table} id ${id} does not exist at its stable slot.`);
      const patched = applyRmmvDatabasePatch(arrayTable, entry, change.patches);
      records[id] = patched.value;
      appendPatchDiffs(diffs, arrayTable, table, id, patched.diffs);
      markAffected(affected, arrayTable, table);
      resolved.push({ ...change, table, id, patches: [...change.patches] });
      return;
    }
    const id = documentId(change.id, table);
    const system = requireRecord(snapshot.system, "System database");
    if (table === "types") throw new Error("Types can only be changed through fixed-id type-list operations.");
    if (table === "terms") {
      const terms = requireRecord(system.terms, "System.terms");
      const patched = applyRmmvDatabasePatch("terms", terms, change.patches);
      system.terms = patched.value;
      appendPatchDiffs(diffs, "system", table, id, patched.diffs);
    } else {
      const patched = applyRmmvDatabasePatch("system", system, change.patches);
      snapshot.system = patched.value;
      appendPatchDiffs(diffs, "system", table, id, patched.diffs);
    }
    markAffected(affected, "system", table);
    resolved.push({ ...change, table, id, patches: [...change.patches] });
    return;
  }

  if (change.op === "reset") {
    const table = requireArrayTable(change.table, changeIndex);
    const id = positiveId(change.id, `${table} reset id`);
    const records = requireArray(snapshot[table], `${table} database`);
    const entry = records[id];
    if (!isRecord(entry) || entry.id !== id) throw new Error(`${table} id ${id} does not exist at its stable slot.`);
    records[id] = null;
    markAffected(affected, table, table);
    resolved.push({ ...change, table, id });
    diffs.push({ physicalTable: table, op: "reset", path: `/${table}/${id}`, before: structuredClone(entry), after: null });
    return;
  }

  applyTypeListChange(snapshot, change, changeIndex, resolved, diffs, affected);
}

function applyTypeListChange(
  snapshot: RmmvDatabaseSnapshot,
  change: Extract<RmmvDatabaseChange, { op: "type.rename" | "type.append" | "type.removeTail" }>,
  changeIndex: number,
  resolved: ResolvedRmmvDatabaseChange[],
  diffs: Array<Omit<RmmvDatabasePlanDiff, "relativePath"> & { physicalTable: RmmvArrayDatabaseTableKey | "system" }>,
  affected: Map<RmmvArrayDatabaseTableKey | "system", Set<RmmvDatabaseTableKey>>,
): void {
  if (!TYPE_LIST_FIELDS.has(change.field)) throw new Error(`Invalid type-list field at change ${changeIndex}: ${String(change.field)}`);
  const system = requireRecord(snapshot.system, "System database");
  const values = requireArray(system[change.field], `System.${change.field}`);
  if (values.length === 0) throw new Error(`System.${change.field} must keep reserved slot 0.`);
  if (change.op === "type.rename") {
    const id = positiveId(change.id, `${change.field} rename id`);
    if (id >= values.length) throw new Error(`${change.field} id ${id} does not exist.`);
    const name = stringValue(change.name, `${change.field} name`);
    const before = structuredClone(values[id]);
    values[id] = name;
    resolved.push({ ...change, id, name });
    diffs.push({ physicalTable: "system", op: "type.rename", path: `/types/${change.field}/${id}`, before, after: name });
  } else if (change.op === "type.append") {
    const name = stringValue(change.name, `${change.field} name`);
    const id = values.length;
    values.push(name);
    resolved.push({ ...change, id, name });
    diffs.push({ physicalTable: "system", op: "type.append", path: `/types/${change.field}/${id}`, after: name });
  } else {
    const id = positiveId(change.id, `${change.field} removeTail id`);
    if (id !== values.length - 1) throw new Error(`${change.field} can only remove its last id ${values.length - 1}.`);
    const before = structuredClone(values[id]);
    values.pop();
    resolved.push({ ...change, id });
    diffs.push({ physicalTable: "system", op: "type.removeTail", path: `/types/${change.field}/${id}`, before });
  }
  markAffected(affected, "system", "types");
}

function appendPatchDiffs(
  target: Array<Omit<RmmvDatabasePlanDiff, "relativePath"> & { physicalTable: RmmvArrayDatabaseTableKey | "system" }>,
  physicalTable: RmmvArrayDatabaseTableKey | "system",
  group: RmmvDatabaseTableKey,
  id: number,
  patches: RmmvDatabaseFieldDiff[],
): void {
  for (const patch of patches) {
    target.push({
      physicalTable,
      op: patch.op,
      path: `/${group}/${id}${patch.path}`,
      ...(Object.hasOwn(patch, "before") ? { before: structuredClone(patch.before) } : {}),
      ...(Object.hasOwn(patch, "after") ? { after: structuredClone(patch.after) } : {}),
    });
  }
}

function markAffected(
  affected: Map<RmmvArrayDatabaseTableKey | "system", Set<RmmvDatabaseTableKey>>,
  physicalTable: RmmvArrayDatabaseTableKey | "system",
  group: RmmvDatabaseTableKey,
): void {
  const groups = affected.get(physicalTable) ?? new Set<RmmvDatabaseTableKey>();
  groups.add(group);
  affected.set(physicalTable, groups);
}

function loadProjectInputs(
  workflowRoot: string,
  project: string,
  options: LoadProjectInputOptions = {},
): {
  snapshot: RmmvDatabaseSnapshot;
  maps: RmmvDatabaseMapDocument[];
  physical: Map<RmmvArrayDatabaseTableKey | "system", LoadedPhysicalTable>;
  inputHashes: RmmvDatabaseInputHash[];
} {
  const snapshot: RmmvDatabaseSnapshot = {};
  const physical = new Map<RmmvArrayDatabaseTableKey | "system", LoadedPhysicalTable>();
  const inputHashes: RmmvDatabaseInputHash[] = [];
  const layout = resolveRmmvLayout(project);
  for (const table of PHYSICAL_TABLES) {
    const schema = getRmmvDatabaseSchemaByKey(table);
    const relativePath = dataRelativePath(layout, schema.fileName);
    const sourceOnly = options.sourceOnlyRelativePaths?.has(relativePath) ?? false;
    const effective = sourceOnly
      ? readSourceDatabaseTable(project, relativePath)
      : readEffectiveRmmvDatabaseTable(workflowRoot, project, table);
    if (!effective) throw new Error(`Required RMMV database file is missing: ${schema.fileName}`);
    const sourceHash = sourceFileHash(project, relativePath);
    const loaded: LoadedPhysicalTable = {
      table,
      relativePath,
      value: effective.value,
      sourceHash,
      effectiveHash: effective.contentHash,
    };
    physical.set(table, loaded);
    snapshot[table] = structuredClone(effective.value);
    inputHashes.push({ relativePath, sourceHash, effectiveHash: effective.contentHash });
  }

  const mapInfosRelative = dataRelativePath(layout, "MapInfos.json");
  const mapInfos = readEffectiveJsonInput(
    workflowRoot,
    project,
    mapInfosRelative,
    options.sourceOnlyRelativePaths?.has(mapInfosRelative) ?? false,
  );
  if (!Array.isArray(mapInfos.value)) throw new Error(`${mapInfosRelative} must contain a JSON array.`);
  inputHashes.push(mapInfos.hashes);
  const maps: RmmvDatabaseMapDocument[] = [];
  for (const info of mapInfos.value) {
    if (!isRecord(info)) continue;
    const mapId = Number(info.id);
    if (!Number.isInteger(mapId) || mapId <= 0) throw new Error(`${mapInfosRelative} contains an invalid map id.`);
    const relativePath = dataRelativePath(layout, `Map${String(mapId).padStart(3, "0")}.json`);
    const loaded = readEffectiveJsonInput(
      workflowRoot,
      project,
      relativePath,
      options.sourceOnlyRelativePaths?.has(relativePath) ?? false,
    );
    maps.push({ mapId, value: loaded.value });
    inputHashes.push(loaded.hashes);
  }
  inputHashes.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { snapshot, maps, physical, inputHashes };
}

function readEffectiveJsonInput(
  workflowRoot: string,
  project: string,
  relativePath: string,
  sourceOnly = false,
): {
  value: unknown;
  hashes: RmmvDatabaseInputHash;
} {
  const effectiveFile = sourceOnly
    ? path.resolve(project, ...relativePath.split("/"))
    : getProjectFileForRead(workflowRoot, project, relativePath);
  if (!effectiveFile) throw new Error(`Required RMMV project file is missing: ${relativePath}`);
  const content = fs.readFileSync(effectiveFile);
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid RMMV JSON at ${relativePath}: ${detail}`, { cause: error });
  }
  return {
    value,
    hashes: {
      relativePath,
      sourceHash: sourceFileHash(project, relativePath),
      effectiveHash: hash(content),
    },
  };
}

function readSourceDatabaseTable(project: string, relativePath: string): { value: unknown; contentHash: string } | null {
  const file = path.resolve(project, ...relativePath.split("/"));
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file);
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid RMMV database JSON at ${relativePath}: ${detail}`, { cause: error });
  }
  return { value, contentHash: hash(content) };
}

function requireTable(value: unknown, index: number): RmmvDatabaseTableKey {
  if (typeof value !== "string") throw new Error(`Database change ${index} table must be a string.`);
  return getRmmvDatabaseSchemaByKey(value as RmmvDatabaseTableKey).key;
}

function requireArrayTable(value: unknown, index: number): RmmvArrayDatabaseTableKey {
  const table = requireTable(value, index);
  if (!ARRAY_TABLE_SET.has(table)) throw new Error(`Database change ${index} requires an array table.`);
  return table as RmmvArrayDatabaseTableKey;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function positiveId(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer.`);
  return Number(value);
}

function documentId(value: unknown, table: RmmvDatabaseTableKey): 0 {
  if (value !== 0) throw new Error(`${table} patch id must be 0.`);
  return 0;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function smallestEmptySlot(records: unknown[]): number {
  for (let id = 1; id < records.length; id += 1) {
    if (records[id] === null || records[id] === undefined) return id;
  }
  return Math.max(1, records.length);
}

function sourceFileHash(project: string, relativePath: string): string | null {
  const file = path.resolve(project, ...relativePath.split("/"));
  return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null;
}

function parseInputHashes(value: unknown): RmmvDatabaseInputHash[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Database staging operation input hashes are missing.");
  }
  const result = value.map((entry, index) => {
    const record = requireRecord(entry, `Database input hash ${index}`);
    if (typeof record.relativePath !== "string" || !isSha256(record.effectiveHash)) {
      throw new Error(`Database input hash ${index} is invalid.`);
    }
    if (record.sourceHash !== null && !isSha256(record.sourceHash)) {
      throw new Error(`Database input source hash ${index} is invalid.`);
    }
    return {
      relativePath: record.relativePath,
      sourceHash: record.sourceHash as string | null,
      effectiveHash: record.effectiveHash as string,
    };
  });
  if (new Set(result.map((entry) => entry.relativePath)).size !== result.length) {
    throw new Error("Database staging operation input hashes contain duplicate files.");
  }
  return result;
}

function parseOutputHashes(value: unknown): Array<{ relativePath: string; afterHash: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Database staging operation output hashes are missing.");
  }
  const result = value.map((entry, index) => {
    const record = requireRecord(entry, `Database output hash ${index}`);
    if (typeof record.relativePath !== "string" || !isSha256(record.afterHash)) {
      throw new Error(`Database output hash ${index} is invalid.`);
    }
    return { relativePath: record.relativePath, afterHash: record.afterHash as string };
  });
  if (new Set(result.map((entry) => entry.relativePath)).size !== result.length) {
    throw new Error("Database staging operation output hashes contain duplicate files.");
  }
  return result;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function serializeJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
