import path from 'node:path';

import type { ProjectManagedEntry } from '../../../../contract/types.ts';
import {
  createDefaultRmmvDatabaseEntry,
  getRmmvDatabaseSchema,
  type RmmvDatabaseTableSchema,
} from '../rmmv/database-schema.ts';
import { exists, readJson } from '../rmmv/json.ts';
import { dataRelativePath, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { scanProjectWithReader } from '../rmmv/project-scanner.ts';
import { getCommonEvent, updateCommonEvent } from './common-event-service.ts';
import {
  projectManagedCreateDatabaseOnly,
  projectManagedDatabaseKindInvalid,
  projectManagedEntryIdImmutable,
  projectManagedEntryIdInvalid,
  projectManagedEntryInvalid,
  projectManagedEntryInvalidWithIssues,
  projectManagedEntryMissing,
  projectManagedFileMissing,
  projectManagedFixedDocumentCannotCreate,
  projectManagedFixedDocumentIdRequired,
  projectManagedGroupInvalid,
  projectManagedGroupMustBeArray,
  projectManagedListInvalid,
} from './projectManagementServiceLocalization.ts';
import { getProjectFileForRead, writeStagedProjectJson } from './staging-service.ts';

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
  if (request.kind === 'commonEvent') return getCommonEvent(workflowRoot, project, request);
  const relativePath = relativePathFor(project, request);
  const data = readData(workflowRoot, project, relativePath);
  const id = validId(request.id);
  if (request.kind === 'switch' || request.kind === 'variable') {
    const key = request.kind === 'switch' ? 'switches' : 'variables';
    const list = (data as Record<string, unknown>)[key];
    if (!Array.isArray(list)) throw new Error(projectManagedListInvalid(key));
    return { ...request, id, relativePath, value: { id, name: String(list[id] || '') } };
  }
  const schema = schemaForManagedEntry(request);
  if (!schema.isArrayTable) {
    if (Number(request.id) !== 0) throw new Error(projectManagedFixedDocumentIdRequired(schema.group));
    return { ...request, id: 0, relativePath, value: readDocumentEntry(schema, data), schema: schemaPayload(schema) };
  }
  if (!Array.isArray(data) || !data[id]) throw new Error(projectManagedEntryMissing());
  return { ...request, id, relativePath, value: data[id], schema: schemaPayload(schema) };
}

export function updateProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number; value: unknown },
): ProjectManagedEntry {
  if (request.kind === 'commonEvent') return updateCommonEvent(workflowRoot, project, request).entry;
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
  const id = nextFreeId(data);
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

export function getDefaultProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number },
): ProjectManagedEntry {
  if (request.kind !== 'database') throw new Error(projectManagedCreateDatabaseOnly());
  const schema = schemaForManagedEntry(request);
  if (!schema.isArrayTable) throw new Error(projectManagedFixedDocumentCannotCreate(schema.group));
  const id = validId(request.id);
  const relativePath = relativePathFor(project, request);
  const data = readData(workflowRoot, project, relativePath);
  if (!Array.isArray(data)) throw new Error(projectManagedGroupMustBeArray(schema.group));
  const next = createDefaultRmmvDatabaseEntry(schema.group, id);
  const validation = schema.validate(next);
  if (!validation.ok) {
    throw new Error(projectManagedEntryInvalidWithIssues(validation.issues.map(issue => `${issue.path} ${issue.message}`).join('; ')));
  }
  data[id] = next;
  writeStagedProjectJson(workflowRoot, project, relativePath, data);
  return getProjectManagedEntry(workflowRoot, project, { kind: 'database', group: schema.group, id });
}

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

function nextFreeId(data: unknown[]): number {
  for (let id = 1; id < data.length; id += 1) {
    if (!data[id]) return id;
  }
  return Math.max(1, data.length);
}

function schemaPayload(schema: RmmvDatabaseTableSchema): NonNullable<ProjectManagedEntry['schema']> {
  return {
    group: schema.group,
    key: schema.key,
    fileName: schema.fileName,
    isArrayTable: schema.isArrayTable,
    coreFields: schema.coreFields.map((field) => ({ ...field })),
    references: schema.references.map((field) => ({ ...field })),
  };
}
