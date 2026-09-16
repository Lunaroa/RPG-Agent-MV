import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type {
  ProjectManagedEntry,
  ProjectManagedEntryResetResult,
  ProjectManagedDatabaseResizeResult,
} from '../../../../contract/types.ts';
import {
  EXTENDED_TILESET_FIRST_TILE_ID,
  buildExtendedTilesetDescriptors,
  normalizeExtendedTilesetTypes,
  validateExtendedTilesetImageDimensions,
} from '../../../../contract/extended-tileset.ts';
import {
  createDefaultRmmvDatabaseEntry,
  getRmmvDatabaseSchema,
  rmmvDatabaseCoreFieldsForEngine,
  rpgMakerDatabaseEntryLimit,
  type RmmvDatabaseTableSchema,
} from '../rmmv/database-schema.ts';
import { validateRmmvDatabaseEntryTransition } from '../rmmv/database-entry-transition.ts';
import { exists, readJson } from '../rmmv/json.ts';
import { dataRelativePath, inspectRmmvProject, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { scanProjectWithReader } from '../rmmv/project-scanner.ts';
import {
  dryRunRmmvDatabaseChanges,
  type RmmvArrayDatabaseTableKey,
  type RmmvDatabaseChange,
} from '../rmmv/database-changes.ts';
import { getCommonEvent, updateCommonEvent } from './common-event-service.ts';
import {
  projectManagedCreateDatabaseOnly,
  projectManagedCapacityReached,
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
  projectManagedMaximumInvalid,
  projectManagedMaximumOccupied,
  projectManagedNamedListIdOutOfRange,
  projectManagedSystemSharedGroupImmutable,
  projectManagedTypeListInvalid,
} from './projectManagementServiceLocalization.ts';
import {
  readProjectFileVersion,
  resolveProjectFileForRead,
  writeProjectJson,
} from './project-file-service.ts';

const TYPE_LIST_KEYS = ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes'] as const;

export function buildProjectManagementScan(workflowRoot: string, project: string) {
  const layout = resolveRmmvLayout(project);
  return scanProjectWithReader(project, (fileName) => {
    const relative = dataRelativePath(layout, fileName);
    const file = resolveProjectFileForRead(project, relative);
    if (!file || !exists(file)) return undefined;
    return readJson(file);
  }, { includeUnnamedEntries: true, readIssueMode: 'collect' });
}

export function getProjectManagedEntry(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; id: number },
): ProjectManagedEntry {
  if (request.kind === 'commonEvent') {
    return getCommonEvent(workflowRoot, project, request);
  }
  const relativePath = relativePathFor(project, request);
  const data = readData(workflowRoot, project, relativePath);
  const id = validId(request.id);
  if (request.kind === 'switch' || request.kind === 'variable') {
    const key = request.kind === 'switch' ? 'switches' : 'variables';
    const list = (data as Record<string, unknown>)[key];
    if (!Array.isArray(list)) throw new Error(projectManagedListInvalid(key));
    return {
      ...request,
      id,
      relativePath,
      value: { id, name: String(list[id] || '') },
    };
  }
  const schema = schemaForManagedEntry(request);
  const engine = inspectRmmvProject(project).engine;
  if (!schema.isArrayTable) {
    if (Number(request.id) !== 0) throw new Error(projectManagedFixedDocumentIdRequired(schema.group));
    return {
      ...request,
      id: 0,
      relativePath,
      value: readDocumentEntry(schema, data),
      schema: schemaPayload(schema, engine),
    };
  }
  if (!Array.isArray(data) || !data[id]) throw new Error(projectManagedEntryMissing());
  return {
    ...request,
    id,
    relativePath,
    value: data[id],
    schema: schemaPayload(schema, engine),
  };
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
  const sourceHash = readProjectFileVersion(project, current.relativePath).sha256;
  const data = readData(workflowRoot, project, current.relativePath);
  if (request.kind === 'switch' || request.kind === 'variable') {
    const key = request.kind === 'switch' ? 'switches' : 'variables';
    const group = request.kind === 'switch' ? 'Switches' : 'Variables';
    const name = String((request.value as Record<string, unknown>)?.name || '');
    const list = (data as Record<string, unknown>)[key];
    if (!Array.isArray(list)) throw new Error(projectManagedListInvalid(key));
    const maximum = Math.max(0, list.length - 1);
    if (current.id <= 0 || current.id > maximum) {
      throw new Error(projectManagedNamedListIdOutOfRange(group, current.id, maximum));
    }
    list[current.id] = name;
  } else {
    if (!request.value || typeof request.value !== 'object' || Array.isArray(request.value)) throw new Error(projectManagedEntryInvalid());
    const schema = schemaForManagedEntry(request);
    const manifest = inspectRmmvProject(project);
    const engine = manifest.engine;
    const next = mergeRecord(isRecord(current.value) ? current.value : {}, request.value as Record<string, unknown>);
    if (schema.isArrayTable && Number(next.id) !== current.id) throw new Error(projectManagedEntryIdImmutable());
    if (schema.group === 'Tilesets') {
      normalizeExtendedTilesetTransition(workflowRoot, project, current.id, current.value, next, manifest.tileSize);
    }
    if (!schema.isArrayTable) {
      assertDocumentMutationAllowed(workflowRoot, project, schema, current.value, next);
    }
    const validation = validateRmmvDatabaseEntryTransition(schema, current.value, next, engine);
    if (!validation.ok) {
      throw new Error(projectManagedEntryInvalidWithIssues(validation.issues.map(issue => `${issue.path} ${issue.message}`).join('; ')));
    }
    if (schema.isArrayTable) {
      (data as unknown[])[current.id] = next;
    } else {
      writeDocumentEntry(schema, data, next);
    }
  }
  writeProjectJson(workflowRoot, project, current.relativePath, data, sourceHash);
  return getProjectManagedEntry(workflowRoot, project, request);
}

function normalizeExtendedTilesetTransition(
  workflowRoot: string,
  project: string,
  tilesetId: number,
  currentValue: unknown,
  next: Record<string, unknown>,
  tileSize: number,
): void {
  const current = isRecord(currentValue) ? currentValue : {};
  const currentNames = Array.isArray(current.tilesetNames) ? current.tilesetNames.map(String) : [];
  const nextNames = Array.isArray(next.tilesetNames) ? next.tilesetNames.map(String) : [];
  const currentTypes = normalizeExtendedTilesetTypes(currentNames, current.rpgAgentExtendedTilesetTypes);
  const nextTypes = normalizeExtendedTilesetTypes(nextNames, next.rpgAgentExtendedTilesetTypes);
  const sharedCount = Math.min(currentTypes.length, nextTypes.length);
  for (let index = 0; index < sharedCount; index += 1) {
    if (currentTypes[index] !== nextTypes[index]) {
      throw new Error(`Extended tileset sheet ${index + 1} type is immutable; remove the last unused sheet and add it again.`);
    }
  }
  if (nextTypes.length < currentTypes.length - 1) {
    throw new Error('Only the last extended tileset sheet can be removed, one sheet at a time.');
  }

  const nextDescriptors = buildExtendedTilesetDescriptors(nextNames, nextTypes);
  validateExtendedTilesetResources(workflowRoot, project, nextDescriptors, tileSize);
  const nextEnd = nextDescriptors.length
    ? nextDescriptors[nextDescriptors.length - 1].firstTileId + nextDescriptors[nextDescriptors.length - 1].capacity
    : EXTENDED_TILESET_FIRST_TILE_ID;
  const currentDescriptors = buildExtendedTilesetDescriptors(currentNames, currentTypes);
  const currentEnd = currentDescriptors.length
    ? currentDescriptors[currentDescriptors.length - 1].firstTileId + currentDescriptors[currentDescriptors.length - 1].capacity
    : EXTENDED_TILESET_FIRST_TILE_ID;
  const migrationNeedsValidation = currentTypes.length > 0 && !Array.isArray(current.rpgAgentExtendedTilesetTypes);
  const removesSheet = nextTypes.length < currentTypes.length;
  if (migrationNeedsValidation || removesSheet) {
    const minimumTileId = removesSheet ? nextEnd : currentEnd;
    const maps = findTilesetReferencesAtOrAbove(workflowRoot, project, tilesetId, minimumTileId);
    if (maps.length) {
      const action = removesSheet ? 'remove the last extended tileset sheet' : 'migrate legacy extended tileset data';
      throw new Error(`Cannot ${action}; out-of-range tile ids are used by: ${maps.join(', ')}.`);
    }
  }

  next.tilesetNames = nextNames;
  next.rpgAgentExtendedTilesetTypes = nextTypes;
  if (removesSheet && Array.isArray(next.flags) && next.flags.length > nextEnd) {
    next.flags = next.flags.slice(0, nextEnd);
  }
}

export function validateExtendedTilesetResources(
  workflowRoot: string,
  project: string,
  descriptors: ReturnType<typeof buildExtendedTilesetDescriptors>,
  tileSize: number,
): void {
  const layout = resolveRmmvLayout(project);
  for (const descriptor of descriptors) {
    if (!descriptor.imageName) continue;
    const portableName = descriptor.imageName.replace(/\\/g, '/');
    const nameParts = portableName.split('/');
    if (path.posix.isAbsolute(portableName)
      || path.win32.isAbsolute(descriptor.imageName)
      || nameParts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) {
      throw new Error(`Extended tileset sheet ${descriptor.label} has an unsafe image name.`);
    }
    const relativePath = [layout.resourceRootRelative, 'img', 'tilesets', ...nameParts.slice(0, -1), `${nameParts.at(-1)}.png`]
      .filter(Boolean)
      .join('/');
    const file = resolveProjectFileForRead(project, relativePath)
      || path.join(layout.resourceRoot, 'img', 'tilesets', ...nameParts.slice(0, -1), `${nameParts.at(-1)}.png`);
    if (!exists(file)) {
      throw new Error(`Extended tileset sheet ${descriptor.label} image is missing: ${descriptor.imageName}.png.`);
    }
    const { width, height } = readPngDimensions(file, descriptor.label);
    validateExtendedTilesetImageDimensions(descriptor.type, width, height, tileSize);
  }
}

function readPngDimensions(file: string, label: string): { width: number; height: number } {
  const header = fs.readFileSync(file).subarray(0, 24);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (header.length < 24 || !header.subarray(0, 8).equals(signature) || header.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Extended tileset sheet ${label} must use a valid PNG image.`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function findTilesetReferencesAtOrAbove(
  workflowRoot: string,
  project: string,
  tilesetId: number,
  minimumTileId: number,
): string[] {
  const layout = resolveRmmvLayout(project);
  const infosFile = resolveProjectFileForRead(project, dataRelativePath(layout, 'MapInfos.json'));
  const infos = infosFile && exists(infosFile) ? readJson(infosFile) : [];
  if (!Array.isArray(infos)) return [];
  const referenced: string[] = [];
  for (const info of infos) {
    if (!isRecord(info)) continue;
    const mapId = Number(info.id);
    if (!Number.isInteger(mapId) || mapId <= 0) continue;
    const fileName = `Map${String(mapId).padStart(3, '0')}.json`;
    const mapFile = resolveProjectFileForRead(project, dataRelativePath(layout, fileName));
    if (!mapFile || !exists(mapFile)) continue;
    const map = readJson(mapFile);
    if (!isRecord(map) || Number(map.tilesetId) !== tilesetId) continue;
    const dataUsesRange = Array.isArray(map.data)
      && map.data.some((tileId) => Number.isSafeInteger(tileId) && Number(tileId) >= minimumTileId);
    const eventUsesRange = Array.isArray(map.events) && map.events.some((event) => {
      if (!isRecord(event) || !Array.isArray(event.pages)) return false;
      return event.pages.some((page) => isRecord(page)
        && isRecord(page.image)
        && Number.isSafeInteger(page.image.tileId)
        && Number(page.image.tileId) >= minimumTileId);
    });
    if (dataUsesRange || eventUsesRange) referenced.push(`Map${String(mapId).padStart(3, '0')} ${String(info.name || '')}`.trim());
  }
  return referenced;
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
  const sourceHash = readProjectFileVersion(project, relativePath).sha256;
  const data = readData(workflowRoot, project, relativePath);
  if (!Array.isArray(data)) throw new Error(projectManagedGroupMustBeArray(schema.group));
  const engine = inspectRmmvProject(project).engine;
  const id = nextFreeId(data, rpgMakerDatabaseEntryLimit(schema.group, engine), schema.group);
  const base = createDefaultRmmvDatabaseEntry(schema.group, id, engine);
  const next = request.value && typeof request.value === 'object' && !Array.isArray(request.value)
    ? { ...base, ...(request.value as Record<string, unknown>), id }
    : base;
  const validation = schema.validate(next, engine);
  if (!validation.ok) {
    throw new Error(projectManagedEntryInvalidWithIssues(validation.issues.map(issue => `${issue.path} ${issue.message}`).join('; ')));
  }
  data[id] = next;
  writeProjectJson(workflowRoot, project, relativePath, data, sourceHash);
  return getProjectManagedEntry(workflowRoot, project, { kind: 'database', group: schema.group, id });
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
  const sourceHash = readProjectFileVersion(project, relativePath).sha256;
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
  const write = writeProjectJson(workflowRoot, project, relativePath, data, sourceHash);
  return {
    reset: true,
    id,
    group: schema.group,
    write,
  };
}

export const getDefaultProjectManagedEntry = resetProjectManagedEntry;

export function resizeProjectManagedDatabase(
  workflowRoot: string,
  project: string,
  request: { kind: ProjectManagedEntry['kind']; group?: string; maximum: number },
): ProjectManagedDatabaseResizeResult {
  if (request.kind === 'switch' || request.kind === 'variable') {
    return resizeSystemNamedList(workflowRoot, project, request.kind, request.maximum);
  }
  if (request.kind !== 'database') throw new Error(projectManagedCreateDatabaseOnly());
  const schema = schemaForManagedEntry(request);
  const engine = inspectRmmvProject(project).engine;
  const entryLimit = rpgMakerDatabaseEntryLimit(schema.group, engine);
  if (!schema.isArrayTable || entryLimit === null) {
    throw new Error(projectManagedFixedDocumentCannotCreate(schema.group));
  }
  const maximum = Number(request.maximum);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > entryLimit) {
    throw new Error(projectManagedMaximumInvalid(schema.group, entryLimit));
  }
  const relativePath = relativePathFor(project, request);
  const sourceHash = readProjectFileVersion(project, relativePath).sha256;
  const data = readData(workflowRoot, project, relativePath);
  if (!Array.isArray(data)) throw new Error(projectManagedGroupMustBeArray(schema.group));
  const previousMaximum = Math.max(0, data.length - 1);
  if (maximum === previousMaximum) {
    return {
      resized: true,
      group: schema.group,
      previousMaximum,
      maximum,
    };
  }
  if (maximum < previousMaximum) {
    const occupiedIds: number[] = [];
    for (let id = maximum + 1; id < data.length; id += 1) {
      if (data[id] !== null && data[id] !== undefined) occupiedIds.push(id);
    }
    if (occupiedIds.length) throw new Error(projectManagedMaximumOccupied(schema.group, occupiedIds));
    data.length = maximum + 1;
  } else {
    while (data.length <= maximum) data.push(null);
  }
  const write = writeProjectJson(workflowRoot, project, relativePath, data, sourceHash);
  return {
    resized: true,
    group: schema.group,
    previousMaximum,
    maximum,
    write,
  };
}

const SYSTEM_NAMED_LIST_LIMIT = 5000;

function resizeSystemNamedList(
  workflowRoot: string,
  project: string,
  kind: 'switch' | 'variable',
  rawMaximum: number,
): ProjectManagedDatabaseResizeResult {
  const key = kind === 'switch' ? 'switches' : 'variables';
  const group = kind === 'switch' ? 'Switches' : 'Variables';
  const maximum = Number(rawMaximum);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > SYSTEM_NAMED_LIST_LIMIT) {
    throw new Error(projectManagedMaximumInvalid(group, SYSTEM_NAMED_LIST_LIMIT));
  }
  const relativePath = relativePathFor(project, { kind });
  const sourceHash = readProjectFileVersion(project, relativePath).sha256;
  const data = readData(workflowRoot, project, relativePath);
  if (!isRecord(data)) throw new Error(projectManagedGroupInvalid('System'));
  const list = data[key];
  if (!Array.isArray(list)) throw new Error(projectManagedListInvalid(key));
  if (list.length === 0) list.push(null);
  else list[0] = null;
  const previousMaximum = Math.max(0, list.length - 1);
  if (maximum === previousMaximum) {
    return {
      resized: true,
      group,
      previousMaximum,
      maximum,
    };
  }
  if (maximum < previousMaximum) {
    const occupiedIds: number[] = [];
    for (let id = maximum + 1; id < list.length; id += 1) {
      if (String(list[id] ?? '').trim()) occupiedIds.push(id);
    }
    if (occupiedIds.length) throw new Error(projectManagedMaximumOccupied(group, occupiedIds));
    list.length = maximum + 1;
  } else {
    while (list.length <= maximum) list.push('');
  }
  const write = writeProjectJson(workflowRoot, project, relativePath, data, sourceHash);
  return {
    resized: true,
    group,
    previousMaximum,
    maximum,
    write,
  };
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
  void workflowRoot;
  const file = resolveProjectFileForRead(project, relativePath);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nextFreeId(data: unknown[], maxEntries: number | null, group: string): number {
  const currentCapacity = Math.max(0, data.length - 1);
  const lastCandidate = maxEntries === null ? currentCapacity : Math.min(currentCapacity, maxEntries);
  for (let id = 1; id <= lastCandidate; id += 1) {
    if (!data[id]) return id;
  }
  if (maxEntries !== null && currentCapacity >= maxEntries) {
    throw new Error(projectManagedEntryLimitReached(group, maxEntries));
  }
  throw new Error(projectManagedCapacityReached(group, currentCapacity));
}

function schemaPayload(
  schema: RmmvDatabaseTableSchema,
  engine: 'rpg-maker-mv' | 'rpg-maker-mz',
): NonNullable<ProjectManagedEntry['schema']> {
  const engineFields = rmmvDatabaseCoreFieldsForEngine(schema, engine);
  const coreFields = schema.group === 'System'
    ? engineFields.filter((field) => (
      field.path !== 'terms'
      && !TYPE_LIST_KEYS.includes(field.path as typeof TYPE_LIST_KEYS[number])
    ))
    : engineFields;
  const contextualFields = engine === 'rpg-maker-mz'
    ? coreFields.filter((field) => field.path !== 'advanced')
    : coreFields;
  return {
    group: schema.group,
    key: schema.key,
    fileName: schema.fileName,
    isArrayTable: schema.isArrayTable,
    maxEntries: rpgMakerDatabaseEntryLimit(schema.group, engine),
    coreFields: contextualFields.map((field) => ({ ...field })),
    references: schema.references.map((field) => ({ ...field })),
  };
}

function mergeRecord(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key];
    result[key] = isRecord(previous) && isRecord(value)
      ? mergeRecord(previous, value)
      : structuredClone(value);
  }
  return result;
}
