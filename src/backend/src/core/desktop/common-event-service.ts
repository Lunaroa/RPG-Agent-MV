import type { ProjectManagedEntry } from '../../../../contract/types.ts';
import {
  validateEventCommandList,
  type RawEventCommand,
} from '../rmmv/event-command-registry.ts';
import {
  findEffectiveCommonEventReferences,
  type CommonEventReference,
} from '../rmmv/common-event-references.ts';
import { readJson } from '../rmmv/json.ts';
import { dataRelativePath as layoutDataRelativePath, inspectRmmvProject, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import {
  commonEventAlreadyExists,
  commonEventInvalidData,
  commonEventInvalidId,
  commonEventLimitReached,
  commonEventInvalidTrigger,
  commonEventMissing,
  commonEventNoTriggerSwitchMustBeZero,
  commonEventReferenced,
  commonEventSwitchOutOfRange,
  commonEventSwitchRequired,
  commonEventsJsonMustBeArray,
} from './commonEventServiceLocalization.ts';
import { getProjectFileForRead, writeStagedProjectJson } from './staging-service.ts';

interface RmmvCommonEvent {
  id: number;
  name: string;
  trigger: number;
  switchId: number;
  list: RawEventCommand[];
  [key: string]: unknown;
}

export interface CommonEventSummary {
  id: number;
  name: string;
  trigger: number;
  switchId: number;
}

export interface CommonEventListResult {
  project: string;
  relativePath: string;
  commonEvents: CommonEventSummary[];
}

export interface CommonEventMutationResult {
  entry: ProjectManagedEntry;
  staging: unknown;
}

export interface CommonEventUsageReference {
  kind: 'mapEventCommand' | 'commonEventCommand' | 'troopEventCommand' | 'databaseEffect' | 'system';
  source: string;
  mapId?: number;
  eventId?: number;
  pageIndex?: number;
  commandIndex?: number;
  commonEventId?: number;
  troopId?: number;
  databaseFile?: string;
  databaseId?: number;
  effectIndex?: number;
  systemKey?: string;
}

const COMMON_EVENT_FILE = 'CommonEvents.json';
const SYSTEM_FILE = 'System.json';
const COMMON_EVENT_MAX_ID = 1000;

export function listCommonEvents(workflowRoot: string, project: string): CommonEventListResult {
  const relativePath = dataRelativePath(project, COMMON_EVENT_FILE);
  const list = readCommonEvents(workflowRoot, project);
  return {
    project,
    relativePath,
    commonEvents: list
      .map((event, index) => ({ event, index }))
      .filter(({ event, index }) => index > 0 && isCommonEventRecord(event))
      .map(({ event, index }) => ({
        id: Number((event as RmmvCommonEvent).id || index),
        name: String((event as RmmvCommonEvent).name || ''),
        trigger: Number((event as RmmvCommonEvent).trigger || 0),
        switchId: Number((event as RmmvCommonEvent).switchId || 0),
      })),
  };
}

export function getCommonEvent(
  workflowRoot: string,
  project: string,
  request: { id: number },
): ProjectManagedEntry {
  const id = validId(request.id);
  const relativePath = dataRelativePath(project, COMMON_EVENT_FILE);
  const list = readCommonEvents(workflowRoot, project);
  const value = list[id];
  if (!isCommonEventRecord(value)) throw new Error(commonEventMissing(id));
  return { kind: 'commonEvent', id, relativePath, value: clone(value) };
}

export function createCommonEvent(
  workflowRoot: string,
  project: string,
  request: { id?: number; name?: string; trigger?: number; switchId?: number; list?: unknown[] },
): CommonEventMutationResult {
  const relativePath = dataRelativePath(project, COMMON_EVENT_FILE);
  const commonEvents = readCommonEvents(workflowRoot, project);
  const id = request.id === undefined ? nextCommonEventId(commonEvents) : validId(request.id);
  assertCommonEventIdWithinLimit(id);
  if (isCommonEventRecord(commonEvents[id])) throw new Error(commonEventAlreadyExists(id));
  ensureArrayIndex(commonEvents, id);
  commonEvents[id] = normalizeCommonEvent(workflowRoot, project, {
    id,
    name: String(request.name || 'New Common Event'),
    trigger: Number(request.trigger || 0),
    switchId: request.switchId === undefined ? 0 : Number(request.switchId),
    list: request.list,
  });
  const staging = writeStagedProjectJson(workflowRoot, project, relativePath, commonEvents);
  return { entry: getCommonEvent(workflowRoot, project, { id }), staging };
}

export function updateCommonEvent(
  workflowRoot: string,
  project: string,
  request: { id: number; value: unknown },
): CommonEventMutationResult {
  const id = validId(request.id);
  const relativePath = dataRelativePath(project, COMMON_EVENT_FILE);
  const commonEvents = readCommonEvents(workflowRoot, project);
  if (!isCommonEventRecord(commonEvents[id])) throw new Error(commonEventMissing(id));
  if (!request.value || typeof request.value !== 'object' || Array.isArray(request.value)) {
    throw new Error(commonEventInvalidData());
  }
  commonEvents[id] = normalizeCommonEvent(workflowRoot, project, { ...(request.value as Record<string, unknown>), id });
  const staging = writeStagedProjectJson(workflowRoot, project, relativePath, commonEvents);
  return { entry: getCommonEvent(workflowRoot, project, { id }), staging };
}

export function renameCommonEvent(
  workflowRoot: string,
  project: string,
  request: { id: number; name: string },
): CommonEventMutationResult {
  const current = getCommonEvent(workflowRoot, project, request).value as RmmvCommonEvent;
  return updateCommonEvent(workflowRoot, project, {
    id: current.id,
    value: { ...current, name: String(request.name || '') },
  });
}

export function changeCommonEventTrigger(
  workflowRoot: string,
  project: string,
  request: { id: number; trigger: number; switchId?: number },
): CommonEventMutationResult {
  const current = getCommonEvent(workflowRoot, project, request).value as RmmvCommonEvent;
  return updateCommonEvent(workflowRoot, project, {
    id: current.id,
    value: {
      ...current,
      trigger: Number(request.trigger),
      switchId: request.switchId === undefined ? current.switchId : Number(request.switchId),
    },
  });
}

export function editCommonEventCommandList(
  workflowRoot: string,
  project: string,
  request: { id: number; list: unknown[] },
): CommonEventMutationResult {
  const current = getCommonEvent(workflowRoot, project, request).value as RmmvCommonEvent;
  return updateCommonEvent(workflowRoot, project, {
    id: current.id,
    value: { ...current, list: request.list },
  });
}

export function duplicateCommonEvent(
  workflowRoot: string,
  project: string,
  request: { id: number; targetId?: number; name?: string },
): CommonEventMutationResult {
  const source = getCommonEvent(workflowRoot, project, request).value as RmmvCommonEvent;
  const commonEvents = readCommonEvents(workflowRoot, project);
  const targetId = request.targetId === undefined ? nextCommonEventId(commonEvents) : validId(request.targetId);
  assertCommonEventIdWithinLimit(targetId);
  if (isCommonEventRecord(commonEvents[targetId])) throw new Error(commonEventAlreadyExists(targetId));
  ensureArrayIndex(commonEvents, targetId);
  commonEvents[targetId] = normalizeCommonEvent(workflowRoot, project, {
    ...clone(source),
    id: targetId,
    name: request.name || `${source.name || `Common Event ${source.id}`} Copy`,
  });
  const relativePath = dataRelativePath(project, COMMON_EVENT_FILE);
  const staging = writeStagedProjectJson(workflowRoot, project, relativePath, commonEvents);
  return { entry: getCommonEvent(workflowRoot, project, { id: targetId }), staging };
}

export function deleteCommonEvent(
  workflowRoot: string,
  project: string,
  request: { id: number; force?: boolean },
): { deleted: true; id: number; relativePath: string; staging: unknown } {
  const id = validId(request.id);
  const relativePath = dataRelativePath(project, COMMON_EVENT_FILE);
  const commonEvents = readCommonEvents(workflowRoot, project);
  if (!isCommonEventRecord(commonEvents[id])) throw new Error(commonEventMissing(id));
  const references = findCommonEventUsages(workflowRoot, project, id);
  if (references.length && request.force !== true) {
    const detail = references.slice(0, 5).map((ref) => ref.source).join('; ');
    throw new Error(commonEventReferenced(id, detail));
  }
  commonEvents[id] = null;
  const staging = writeStagedProjectJson(workflowRoot, project, relativePath, commonEvents);
  return { deleted: true, id, relativePath, staging };
}

export function findCommonEventUsages(
  workflowRoot: string,
  project: string,
  commonEventId: number,
): CommonEventUsageReference[] {
  const id = validId(commonEventId);
  return findEffectiveCommonEventReferences(workflowRoot, project, id).referencedBy.map(toUsageReference);
}

function toUsageReference(reference: CommonEventReference): CommonEventUsageReference {
  if (reference.kind === 'mapEvent') {
    return {
      kind: 'mapEventCommand',
      source: `Map${String(reference.mapId).padStart(3, '0')} event ${reference.eventId} page ${Number(reference.pageIndex) + 1} command ${reference.commandIndex}`,
      mapId: reference.mapId,
      eventId: reference.eventId,
      pageIndex: reference.pageIndex,
      commandIndex: reference.commandIndex,
    };
  }
  if (reference.kind === 'commonEvent') {
    return {
      kind: 'commonEventCommand',
      source: `CommonEvents:${reference.commonEventId} command ${reference.commandIndex}`,
      commonEventId: reference.commonEventId,
      commandIndex: reference.commandIndex,
    };
  }
  if (reference.kind === 'troopEvent') {
    return {
      kind: 'troopEventCommand',
      source: `Troops:${reference.troopId} page ${Number(reference.pageIndex) + 1} command ${reference.commandIndex}`,
      troopId: reference.troopId,
      pageIndex: reference.pageIndex,
      commandIndex: reference.commandIndex,
    };
  }
  if (reference.kind === 'databaseEffect') {
    return {
      kind: 'databaseEffect',
      source: `${reference.databaseFile} #${reference.databaseId} effect ${reference.effectIndex}`,
      databaseFile: reference.databaseFile,
      databaseId: reference.databaseId,
      effectIndex: reference.effectIndex,
    };
  }
  return {
    kind: 'system',
    source: `System.${reference.systemKey}`,
    systemKey: reference.systemKey,
  };
}

function normalizeCommonEvent(
  workflowRoot: string,
  project: string,
  value: Record<string, unknown>,
): RmmvCommonEvent {
  const id = validId(Number(value.id));
  const name = String(value.name || '');
  const trigger = validateTrigger(Number(value.trigger ?? 0));
  const switchId = validateTriggerSwitch(workflowRoot, project, trigger, Number(value.switchId ?? 0));
  const list = normalizeCommandList(project, value.list);
  return {
    ...clone(value),
    id,
    name,
    trigger,
    switchId,
    list,
  };
}

function normalizeCommandList(project: string, value: unknown): RawEventCommand[] {
  const list = Array.isArray(value) ? clone(value) : [{ code: 0, indent: 0, parameters: [] }];
  if (!list.length) list.push({ code: 0, indent: 0, parameters: [] });
  if (!isRawCommand(list[list.length - 1]) || Number((list[list.length - 1] as RawEventCommand).code) !== 0) {
    list.push({ code: 0, indent: 0, parameters: [] });
  }
  validateEventCommandList(list, 'commonEvent.list', inspectRmmvProject(project).engine);
  return list as RawEventCommand[];
}

function validateTrigger(value: number): number {
  if (![0, 1, 2].includes(value)) throw new Error(commonEventInvalidTrigger());
  return value;
}

function validateTriggerSwitch(workflowRoot: string, project: string, trigger: number, switchId: number): number {
  if (trigger === 0) {
    if (switchId !== 0) throw new Error(commonEventNoTriggerSwitchMustBeZero());
    return 0;
  }
  if (!Number.isInteger(switchId) || switchId <= 0) throw new Error(commonEventSwitchRequired());
  const system = readProjectJson(workflowRoot, project, dataRelativePath(project, SYSTEM_FILE), {}) as { switches?: unknown[] };
  const switches = Array.isArray(system.switches) ? system.switches : [];
  if (switchId >= switches.length) {
    throw new Error(commonEventSwitchOutOfRange(switchId));
  }
  return switchId;
}

function readCommonEvents(workflowRoot: string, project: string): unknown[] {
  const value = readProjectJson(workflowRoot, project, dataRelativePath(project, COMMON_EVENT_FILE), []);
  if (!Array.isArray(value)) throw new Error(commonEventsJsonMustBeArray());
  return clone(value);
}

function readProjectJson(workflowRoot: string, project: string, relativePath: string, fallback: unknown): unknown {
  const file = getProjectFileForRead(workflowRoot, project, relativePath);
  if (!file) return fallback;
  return readJson(file);
}

function dataRelativePath(project: string, fileName: string): string {
  return layoutDataRelativePath(resolveRmmvLayout(project), fileName);
}

function nextCommonEventId(list: unknown[]): number {
  for (let index = 1; index <= COMMON_EVENT_MAX_ID; index += 1) {
    if (!isCommonEventRecord(list[index])) return index;
  }
  throw new Error(commonEventLimitReached());
}

function assertCommonEventIdWithinLimit(id: number): void {
  if (id > COMMON_EVENT_MAX_ID) throw new Error(commonEventLimitReached());
}

function ensureArrayIndex(list: unknown[], id: number): void {
  while (list.length <= id) list.push(null);
}

function isCommonEventRecord(value: unknown): value is RmmvCommonEvent {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRawCommand(value: unknown): value is RawEventCommand {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger((value as RawEventCommand).code)
    && Number.isInteger((value as RawEventCommand).indent)
    && Array.isArray((value as RawEventCommand).parameters);
}

function validId(value: number): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(commonEventInvalidId());
  return id;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
