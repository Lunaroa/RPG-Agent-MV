import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type {
  ProjectManagedEntry,
  ProjectManagedEntryInspection,
  ProjectManagedEntryRevertResult,
  ProjectManagedEntryResetResult,
  ProjectManagedFieldDiff,
} from '../../../../contract/types.ts';
import {
  createDefaultRmmvDatabaseEntry,
  getRmmvDatabaseSchema,
  type RmmvDatabaseTableSchema,
} from '../rmmv/database-schema.ts';
import { exists, readJson } from '../rmmv/json.ts';
import { dataRelativePath, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { scanProjectWithReader } from '../rmmv/project-scanner.ts';
import {
  dryRunRmmvDatabaseChanges,
  preflightRmmvDatabaseProjectApply,
  type RmmvArrayDatabaseTableKey,
  type RmmvDatabaseChange,
  validateEffectiveRmmvDatabaseState,
} from '../rmmv/database-changes.ts';
import { getCommonEvent, updateCommonEvent } from './common-event-service.ts';
import {
  projectManagedCreateDatabaseOnly,
  projectManagedDatabaseKindInvalid,
  projectManagedEntryIdImmutable,
  projectManagedEntryIdInvalid,
  projectManagedEntryInvalid,
  projectManagedEntryInvalidWithIssues,
  projectManagedEntryLimitReached,
  projectManagedEntryMissing,
  projectManagedFileMissing,
  projectManagedFixedDocumentCannotCreate,
  projectManagedFixedDocumentIdRequired,
  projectManagedGroupInvalid,
  projectManagedGroupMustBeArray,
  projectManagedListInvalid,
  projectManagedOperationOwnedCannotRevert,
  projectManagedSystemSharedGroupImmutable,
  projectManagedTypeListInvalid,
} from './projectManagementServiceLocalization.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  writeStagedProjectJson,
} from './staging-service.ts';

const TYPE_LIST_KEYS = ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes'] as const;

export function buildProjectManagementScan(workflowRoot: string, project: string) {
  const layout = resolveRmmvLayout(project);
  return scanProjectWithReader(project, (fileName) => {
    const relative = dataRelativePath(layout, fileName);
    const file = getProjectFileForRead(workflowRoot, project, relative);
    if (!file || !exists(file)) return undefined;
    return readJson(file);
  }, { includeUnnamedEntries: true });
}

export function getProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number },
): ProjectManagedEntry {
  if (request.kind === 'commonEvent') {
    return withEntryInspection(workflowRoot, project, request, getCommonEvent(workflowRoot, project, request));
  }
  const relativePath = relativePathFor(project, request);
  const data = readData(workflowRoot, project, relativePath);
  const id = validId(request.id);
  if (request.kind === 'switch' || request.kind === 'variable') {
    const key = request.kind === 'switch' ? 'switches' : 'variables';
    const list = (data as Record<string, unknown>)[key];
    if (!Array.isArray(list)) throw new Error(projectManagedListInvalid(key));
    return withEntryInspection(workflowRoot, project, request, {
      ...request,
      id,
      relativePath,
      value: { id, name: String(list[id] || '') },
    });
  }
  const schema = schemaForManagedEntry(request);
  if (!schema.isArrayTable) {
    if (Number(request.id) !== 0) throw new Error(projectManagedFixedDocumentIdRequired(schema.group));
    return withEntryInspection(workflowRoot, project, request, {
      ...request,
      id: 0,
      relativePath,
      value: readDocumentEntry(schema, data),
      schema: schemaPayload(schema),
    });
  }
  if (!Array.isArray(data) || !data[id]) throw new Error(projectManagedEntryMissing());
  return withEntryInspection(workflowRoot, project, request, {
    ...request,
    id,
    relativePath,
    value: data[id],
    schema: schemaPayload(schema),
  });
}

export function preflightProjectManagedStagingApply(workflowRoot: string, project: string) {
  return preflightRmmvDatabaseProjectApply(workflowRoot, project);
}

export function updateProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number; value: unknown },
): ProjectManagedEntry {
  if (request.kind === 'commonEvent') {
    updateCommonEvent(workflowRoot, project, request);
    return getProjectManagedEntry(workflowRoot, project, request);
  }
  const current = getProjectManagedEntry(workflowRoot, project, request);
  const data = readData(workflowRoot, project, current.relativePath);
  if (request.kind === 'switch' || request.kind === 'variable') {
    const key = request.kind === 'switch' ? 'switches' : 'variables';
    const name = String((request.value as Record<string, unknown>)?.name || '');
    const list = (data as Record<string, unknown>)[key];
    if (!Array.isArray(list)) throw new Error(projectManagedListInvalid(key));
    list[current.id] = name;
  } else {
    if (!request.value || typeof request.value !== 'object' || Array.isArray(request.value)) throw new Error(projectManagedEntryInvalid());
    const schema = schemaForManagedEntry(request);
    const next = structuredClone(request.value as Record<string, unknown>);
    if (schema.isArrayTable && Number(next.id) !== current.id) throw new Error(projectManagedEntryIdImmutable());
    if (!schema.isArrayTable) {
      assertDocumentMutationAllowed(workflowRoot, project, schema, current.value, next);
    }
    const validation = schema.validate(next);
    if (!validation.ok) {
      throw new Error(projectManagedEntryInvalidWithIssues(validation.issues.map(issue => `${issue.path} ${issue.message}`).join('; ')));
    }
    if (schema.isArrayTable) {
      (data as unknown[])[current.id] = next;
    } else {
      writeDocumentEntry(schema, data, next);
    }
  }
  writeStagedProjectJson(workflowRoot, project, current.relativePath, data);
  return getProjectManagedEntry(workflowRoot, project, request);
}

export function createProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; value?: unknown },
): ProjectManagedEntry {
  if (request.kind !== 'database') throw new Error(projectManagedCreateDatabaseOnly());
  const schema = schemaForManagedEntry(request);
  if (!schema.isArrayTable) throw new Error(projectManagedFixedDocumentCannotCreate(schema.group));
  const relativePath = relativePathFor(project, request);
  const data = readData(workflowRoot, project, relativePath);
  if (!Array.isArray(data)) throw new Error(projectManagedGroupMustBeArray(schema.group));
  const id = nextFreeId(data, schema.maxEntries, schema.group);
  const base = createDefaultRmmvDatabaseEntry(schema.group, id);
  const next = request.value && typeof request.value === 'object' && !Array.isArray(request.value)
    ? { ...base, ...(request.value as Record<string, unknown>), id }
    : base;
  const validation = schema.validate(next);
  if (!validation.ok) {
    throw new Error(projectManagedEntryInvalidWithIssues(validation.issues.map(issue => `${issue.path} ${issue.message}`).join('; ')));
  }
  data[id] = next;
  writeStagedProjectJson(workflowRoot, project, relativePath, data);
  return getProjectManagedEntry(workflowRoot, project, { kind: 'database', group: schema.group, id });
}

export function revertProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number },
): ProjectManagedEntryRevertResult {
  const id = validId(request.id);
  const relativePath = relativePathFor(project, request);
  const status = getProjectStagingStatus(workflowRoot, project);
  const stagedFile = status.files.find((entry) => entry.relativePath === relativePath);
  if (!stagedFile) {
    return {
      reverted: true,
      entry: getProjectManagedEntry(workflowRoot, project, request),
      staging: status,
    };
  }
  if (stagedFile.operationId) throw new Error(projectManagedOperationOwnedCannotRevert());

  const effectiveData = readData(workflowRoot, project, relativePath);
  const sourceData = readSourceData(project, relativePath);
  let sourceEntryExists = true;

  if (request.kind === 'switch' || request.kind === 'variable') {
    if (!isRecord(effectiveData) || !isRecord(sourceData)) throw new Error(projectManagedEntryInvalid());
    const key = request.kind === 'switch' ? 'switches' : 'variables';
    const effectiveList = effectiveData[key];
    const sourceList = sourceData[key];
    if (!Array.isArray(effectiveList) || !Array.isArray(sourceList)) throw new Error(projectManagedListInvalid(key));
    effectiveList[id] = sourceList[id] ?? '';
  } else {
    const schema = schemaForManagedEntry(request);
    if (schema.isArrayTable) {
      if (!Array.isArray(effectiveData) || !Array.isArray(sourceData)) {
        throw new Error(projectManagedGroupMustBeArray(schema.group));
      }
      sourceEntryExists = Boolean(sourceData[id]);
      effectiveData[id] = sourceEntryExists ? structuredClone(sourceData[id]) : null;
      if (!sourceEntryExists) trimRestoredArrayTail(effectiveData, sourceData.length);
    } else {
      restoreDocumentGroup(schema, effectiveData, sourceData);
    }
  }

  writeStagedProjectJson(workflowRoot, project, relativePath, effectiveData);
  const nextStatus = getProjectStagingStatus(workflowRoot, project);
  return {
    reverted: true,
    ...(sourceEntryExists ? { entry: getProjectManagedEntry(workflowRoot, project, request) } : {}),
    staging: nextStatus,
  };
}

export function resetProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number },
): ProjectManagedEntryResetResult {
  if (request.kind !== 'database') throw new Error(projectManagedCreateDatabaseOnly());
  const schema = schemaForManagedEntry(request);
  if (!schema.isArrayTable) throw new Error(projectManagedFixedDocumentCannotCreate(schema.group));
  const id = validId(request.id);
  const relativePath = relativePathFor(project, request);
  const data = readData(workflowRoot, project, relativePath);
  if (!Array.isArray(data)) throw new Error(projectManagedGroupMustBeArray(schema.group));
  if (!data[id]) throw new Error(projectManagedEntryMissing());
  const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, {
    changes: [{ op: 'reset', table: schema.key as RmmvArrayDatabaseTableKey, id }],
  });
  if (!plan.validation.ok) {
    const errors = plan.validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.source.path} ${issue.message}`)
      .join('; ');
    throw new Error(projectManagedEntryInvalidWithIssues(errors));
  }
  data[id] = null;
  writeStagedProjectJson(workflowRoot, project, relativePath, data);
  return {
    reset: true,
    id,
    group: schema.group,
    staging: getProjectStagingStatus(workflowRoot, project),
  };
}

export const getDefaultProjectManagedEntry = resetProjectManagedEntry;

function relativePathFor(project: string, request: { kind: ProjectManagedEntry['kind']; group?: string }): string {
  const layout = resolveRmmvLayout(project);
  if (request.kind === 'switch' || request.kind === 'variable') return dataRelativePath(layout, 'System.json');
  const schema = schemaForManagedEntry(request);
  return dataRelativePath(layout, schema.fileName);
}

function schemaForManagedEntry(request: { kind: ProjectManagedEntry['kind']; group?: string }) {
  if (request.kind === 'commonEvent') return getRmmvDatabaseSchema('CommonEvents');
  if (request.kind !== 'database') throw new Error(projectManagedDatabaseKindInvalid());
  return getRmmvDatabaseSchema(String(request.group || ''));
}

function readData(workflowRoot: string, project: string, relativePath: string): unknown {
  const file = getProjectFileForRead(workflowRoot, project, relativePath);
  if (!file) throw new Error(projectManagedFileMissing(path.basename(relativePath)));
  return readJson(file);
}

function validId(value: number): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0) throw new Error(projectManagedEntryIdInvalid());
  return id;
}

function readDocumentEntry(schema: RmmvDatabaseTableSchema, data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(projectManagedGroupInvalid(schema.group));
  const record = data as Record<string, unknown>;
  if (schema.group === 'Types') return pick(record, ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes']);
  if (schema.group === 'Terms') {
    const terms = record.terms;
    return terms && typeof terms === 'object' && !Array.isArray(terms) ? structuredClone(terms as Record<string, unknown>) : {};
  }
  return structuredClone(record);
}

function writeDocumentEntry(schema: RmmvDatabaseTableSchema, data: unknown, value: Record<string, unknown>): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(projectManagedGroupInvalid(schema.group));
  const record = data as Record<string, unknown>;
  if (schema.group === 'Types') {
    for (const key of ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes']) record[key] = structuredClone(value[key]);
    return;
  }
  if (schema.group === 'Terms') {
    record.terms = structuredClone(value);
    return;
  }
  for (const key of Object.keys(record)) delete record[key];
  Object.assign(record, structuredClone(value));
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = structuredClone(source[key]);
  return out;
}

function withEntryInspection(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number },
  entry: ProjectManagedEntry,
): ProjectManagedEntry {
  const status = getProjectStagingStatus(workflowRoot, project);
  const stagedFile = status.files.find((candidate) => candidate.relativePath === entry.relativePath);
  if (!stagedFile) {
    return {
      ...entry,
      inspection: emptyInspection(),
    };
  }

  const sourceData = readSourceData(project, entry.relativePath);
  const sourceValue = managedValueFromData(request, sourceData);
  const before = inspectionValue(request, sourceValue);
  const after = inspectionValue(request, entry.value);
  const diffs = collectFieldDiffs(before, after);
  const validation = validateEffectiveRmmvDatabaseState(workflowRoot, project);
  const inspection: ProjectManagedEntryInspection = {
    staged: true,
    changed: diffs.length > 0,
    conflict: stagedFile.conflict,
    ...(stagedFile.operationId ? { operationId: stagedFile.operationId } : {}),
    diffs,
    issues: validation.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      table: issue.source.table,
      ...(issue.source.id === undefined ? {} : { id: issue.source.id }),
      path: issue.source.path,
      message: issue.message,
    })),
    limitations: [...validation.limitations],
  };
  return { ...entry, inspection };
}

function emptyInspection(): ProjectManagedEntryInspection {
  return {
    staged: false,
    changed: false,
    conflict: false,
    diffs: [],
    issues: [],
    limitations: [],
  };
}

function managedValueFromData(
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number },
  data: unknown,
): unknown {
  const id = validId(request.id);
  if (request.kind === 'switch' || request.kind === 'variable') {
    if (!isRecord(data)) return { id, name: '' };
    const key = request.kind === 'switch' ? 'switches' : 'variables';
    const list = data[key];
    return { id, name: Array.isArray(list) ? String(list[id] || '') : '' };
  }
  const schema = schemaForManagedEntry(request);
  if (schema.isArrayTable) return Array.isArray(data) ? structuredClone(data[id] ?? null) : null;
  return readDocumentEntry(schema, data);
}

function inspectionValue(
  request: { kind: ProjectManagedEntry['kind']; group?: string },
  value: unknown,
): unknown {
  if (request.kind !== 'database' || request.group !== 'System' || !isRecord(value)) return value;
  const schema = getRmmvDatabaseSchema('System');
  const keys = [...new Set(schema.coreFields
    .map((field) => field.path.split('.')[0])
    .filter((key) => key !== 'terms' && !TYPE_LIST_KEYS.includes(key as typeof TYPE_LIST_KEYS[number])))];
  return pick(value, keys);
}

function collectFieldDiffs(before: unknown, after: unknown, pathPrefix = ''): ProjectManagedFieldDiff[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    const beforeList = Array.isArray(before) ? before : [];
    const afterList = Array.isArray(after) ? after : [];
    const diffs: ProjectManagedFieldDiff[] = [];
    for (let index = 0; index < Math.max(beforeList.length, afterList.length); index += 1) {
      diffs.push(...collectFieldDiffs(beforeList[index], afterList[index], `${pathPrefix}/${index}`));
    }
    return diffs;
  }
  if (isRecord(before) || isRecord(after)) {
    const beforeRecord = isRecord(before) ? before : {};
    const afterRecord = isRecord(after) ? after : {};
    const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort();
    return keys.flatMap((key) => collectFieldDiffs(
      beforeRecord[key],
      afterRecord[key],
      `${pathPrefix}/${escapeJsonPointer(key)}`,
    ));
  }
  return [{
    path: pathPrefix || '/',
    ...(before === undefined ? {} : { before: structuredClone(before) }),
    ...(after === undefined ? {} : { after: structuredClone(after) }),
  }];
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function readSourceData(project: string, relativePath: string): unknown {
  const file = path.resolve(project, ...relativePath.split('/'));
  if (!exists(file)) throw new Error(projectManagedFileMissing(path.basename(relativePath)));
  return readJson(file);
}

function restoreDocumentGroup(
  schema: RmmvDatabaseTableSchema,
  effectiveData: unknown,
  sourceData: unknown,
): void {
  if (!isRecord(effectiveData) || !isRecord(sourceData)) throw new Error(projectManagedGroupInvalid(schema.group));
  if (schema.group === 'Types') {
    for (const key of TYPE_LIST_KEYS) restoreRecordKey(effectiveData, sourceData, key);
    return;
  }
  if (schema.group === 'Terms') {
    restoreRecordKey(effectiveData, sourceData, 'terms');
    return;
  }
  const keys = [...new Set(schema.coreFields
    .map((field) => field.path.split('.')[0])
    .filter((key) => key !== 'terms' && !TYPE_LIST_KEYS.includes(key as typeof TYPE_LIST_KEYS[number])))];
  for (const key of keys) restoreRecordKey(effectiveData, sourceData, key);
}

function restoreRecordKey(target: Record<string, unknown>, source: Record<string, unknown>, key: string): void {
  if (Object.hasOwn(source, key)) target[key] = structuredClone(source[key]);
  else delete target[key];
}

function assertDocumentMutationAllowed(
  workflowRoot: string,
  project: string,
  schema: RmmvDatabaseTableSchema,
  currentValue: unknown,
  nextValue: Record<string, unknown>,
): void {
  if (!isRecord(currentValue)) throw new Error(projectManagedEntryInvalid());
  if (schema.group === 'System') {
    const sharedChanged = TYPE_LIST_KEYS.some((key) => !isDeepStrictEqual(currentValue[key], nextValue[key]))
      || !isDeepStrictEqual(currentValue.terms, nextValue.terms);
    if (sharedChanged) throw new Error(projectManagedSystemSharedGroupImmutable());
    return;
  }
  if (schema.group !== 'Types') return;

  const changes: RmmvDatabaseChange[] = [];
  for (const field of TYPE_LIST_KEYS) {
    const before = requireTypeList(currentValue[field], field);
    const after = requireTypeList(nextValue[field], field);
    const sharedLength = Math.min(before.length, after.length);
    for (let id = 1; id < sharedLength; id += 1) {
      if (before[id] !== after[id]) changes.push({ op: 'type.rename', field, id, name: after[id] });
    }
    for (let id = before.length; id < after.length; id += 1) {
      changes.push({ op: 'type.append', field, name: after[id] });
    }
    for (let id = before.length - 1; id >= after.length; id -= 1) {
      changes.push({ op: 'type.removeTail', field, id });
    }
  }
  if (!changes.length) return;
  const plan = dryRunRmmvDatabaseChanges(workflowRoot, project, { changes });
  if (!plan.validation.ok) {
    const errors = plan.validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.source.path} ${issue.message}`)
      .join('; ');
    throw new Error(projectManagedEntryInvalidWithIssues(errors));
  }
}

function requireTypeList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value[0] !== '' || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(projectManagedTypeListInvalid(field));
  }
  return value as string[];
}

function trimRestoredArrayTail(records: unknown[], sourceLength: number): void {
  while (records.length > sourceLength && (records.at(-1) === null || records.at(-1) === undefined)) {
    records.pop();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nextFreeId(data: unknown[], maxEntries: number | null, group: string): number {
  const lastCandidate = maxEntries ?? Math.max(1, data.length);
  for (let id = 1; id <= lastCandidate; id += 1) {
    if (!data[id]) return id;
  }
  if (maxEntries !== null) throw new Error(projectManagedEntryLimitReached(group, maxEntries));
  return Math.max(1, data.length);
}

function schemaPayload(schema: RmmvDatabaseTableSchema): NonNullable<ProjectManagedEntry['schema']> {
  const coreFields = schema.group === 'System'
    ? schema.coreFields.filter((field) => (
      field.path !== 'terms'
      && !TYPE_LIST_KEYS.includes(field.path as typeof TYPE_LIST_KEYS[number])
    ))
    : schema.coreFields;
  return {
    group: schema.group,
    key: schema.key,
    fileName: schema.fileName,
    isArrayTable: schema.isArrayTable,
    maxEntries: schema.maxEntries,
    coreFields: coreFields.map((field) => ({ ...field })),
    references: schema.references.map((field) => ({ ...field })),
  };
}
