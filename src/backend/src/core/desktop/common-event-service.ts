import type { ProjectManagedEntry } from '../../../../contract/types.ts';
import {
  EVENT_COMMAND_BLOCK_HEAD_CODES,
  EVENT_COMMAND_CONTINUATION_CODES,
  validateEventCommandBasic,
  type RawEventCommand,
} from '../rmmv/event-command-registry.ts';
import { readJson } from '../rmmv/json.ts';
import { dataRelativePath as layoutDataRelativePath, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
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
  kind: 'mapEventCommand' | 'commonEventCommand' | 'databaseEffect' | 'system';
  source: string;
  mapId?: number;
  eventId?: number;
  pageIndex?: number;
  commandIndex?: number;
  commonEventId?: number;
  databaseFile?: string;
  databaseId?: number;
  effectIndex?: number;
  systemKey?: string;
}

const COMMON_EVENT_FILE = 'CommonEvents.json';
const SYSTEM_FILE = 'System.json';
const COMMON_EVENT_CALL_CODE = 117;
const COMMON_EVENT_EFFECT_CODE = 44;
const SYSTEM_COMMON_EVENT_KEYS = ['startCommonEvent'];
const EFFECT_DATABASE_FILES = [
  'Skills.json',
  'Items.json',
  'Weapons.json',
  'Armors.json',
  'States.json',
  'Enemies.json',
] as const;

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
  if (!isCommonEventRecord(value)) throw new Error(`公共事件不存在：${id}`);
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
  if (isCommonEventRecord(commonEvents[id])) throw new Error(`公共事件 ${id} 已存在`);
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
  if (!isCommonEventRecord(commonEvents[id])) throw new Error(`公共事件不存在：${id}`);
  if (!request.value || typeof request.value !== 'object' || Array.isArray(request.value)) {
    throw new Error('公共事件数据无效');
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
  if (isCommonEventRecord(commonEvents[targetId])) throw new Error(`公共事件 ${targetId} 已存在`);
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
  if (!isCommonEventRecord(commonEvents[id])) throw new Error(`公共事件不存在：${id}`);
  const references = findCommonEventUsages(workflowRoot, project, id);
  if (references.length && request.force !== true) {
    const detail = references.slice(0, 5).map((ref) => ref.source).join('; ');
    throw new Error(`公共事件 ${id} 仍被引用，拒绝删除：${detail}`);
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
  const refs: CommonEventUsageReference[] = [];
  const commonEvents = readCommonEvents(workflowRoot, project);
  for (const event of commonEvents) {
    if (!isCommonEventRecord(event)) continue;
    if (Number(event.id) === id) continue;
    scanCommandList(event.list, id, (commandIndex) => refs.push({
      kind: 'commonEventCommand',
      source: `CommonEvents:${event.id} command ${commandIndex}`,
      commonEventId: event.id,
      commandIndex,
    }));
  }

  for (const map of mapInfos(workflowRoot, project)) {
    const mapFile = dataRelativePath(project, `Map${String(map.id).padStart(3, '0')}.json`);
    const value = readProjectJson(workflowRoot, project, mapFile, null);
    const events = Array.isArray((value as { events?: unknown[] } | null)?.events)
      ? (value as { events: unknown[] }).events
      : [];
    for (const rawEvent of events) {
      if (!rawEvent || typeof rawEvent !== 'object') continue;
      const event = rawEvent as { id?: unknown; pages?: unknown[] };
      const eventId = Number(event.id);
      if (!Number.isInteger(eventId) || eventId <= 0) continue;
      const pages = Array.isArray(event.pages) ? event.pages : [];
      pages.forEach((page, pageIndex) => {
        const list = Array.isArray((page as { list?: unknown[] })?.list) ? (page as { list: unknown[] }).list : [];
        scanCommandList(list, id, (commandIndex) => refs.push({
          kind: 'mapEventCommand',
          source: `Map${String(map.id).padStart(3, '0')} event ${eventId} page ${pageIndex + 1} command ${commandIndex}`,
          mapId: map.id,
          eventId,
          pageIndex,
          commandIndex,
        }));
      });
    }
  }

  for (const fileName of EFFECT_DATABASE_FILES) {
    const relative = dataRelativePath(project, fileName);
    const table = readProjectJson(workflowRoot, project, relative, null);
    if (!Array.isArray(table)) continue;
    table.forEach((record, databaseId) => {
      const effects = Array.isArray((record as { effects?: unknown[] } | null)?.effects)
        ? (record as { effects: unknown[] }).effects
        : [];
      effects.forEach((effect, effectIndex) => {
        if (!effect || typeof effect !== 'object') return;
        const value = effect as { code?: unknown; dataId?: unknown };
        if (Number(value.code) !== COMMON_EVENT_EFFECT_CODE || Number(value.dataId) !== id) return;
        refs.push({
          kind: 'databaseEffect',
          source: `${fileName} #${databaseId} effect ${effectIndex}`,
          databaseFile: fileName,
          databaseId,
          effectIndex,
        });
      });
    });
  }

  const system = readProjectJson(workflowRoot, project, dataRelativePath(project, SYSTEM_FILE), {}) as Record<string, unknown>;
  for (const key of SYSTEM_COMMON_EVENT_KEYS) {
    if (Number(system[key]) === id) {
      refs.push({ kind: 'system', source: `System.${key}`, systemKey: key });
    }
  }
  return refs;
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
  const list = normalizeCommandList(value.list);
  return {
    ...clone(value),
    id,
    name,
    trigger,
    switchId,
    list,
  };
}

function normalizeCommandList(value: unknown): RawEventCommand[] {
  const list = Array.isArray(value) ? clone(value) : [{ code: 0, indent: 0, parameters: [] }];
  if (!list.length) list.push({ code: 0, indent: 0, parameters: [] });
  if (!isRawCommand(list[list.length - 1]) || Number((list[list.length - 1] as RawEventCommand).code) !== 0) {
    list.push({ code: 0, indent: 0, parameters: [] });
  }
  validateCommandStream(list, 'commonEvent.list');
  return list as RawEventCommand[];
}

function validateTrigger(value: number): number {
  if (![0, 1, 2].includes(value)) throw new Error('公共事件触发类型必须是 0/1/2');
  return value;
}

function validateTriggerSwitch(workflowRoot: string, project: string, trigger: number, switchId: number): number {
  if (trigger === 0) {
    if (switchId !== 0) throw new Error('公共事件触发为无时 switchId 必须为 0');
    return 0;
  }
  if (!Number.isInteger(switchId) || switchId <= 0) throw new Error('自动/并行公共事件必须设置有效开关');
  const system = readProjectJson(workflowRoot, project, dataRelativePath(project, SYSTEM_FILE), {}) as { switches?: unknown[] };
  const switches = Array.isArray(system.switches) ? system.switches : [];
  if (switchId >= switches.length) {
    throw new Error(`公共事件条件开关 ${switchId} 超出 System.switches 范围`);
  }
  return switchId;
}

function validateCommandStream(list: unknown[], label: string): void {
  if (!Array.isArray(list)) throw new Error(`${label} 必须是事件指令数组`);
  let previousIndent = 0;
  const openHeads: { code: number; indent: number; atIndex: number }[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const command = list[index];
    validateEventCommandBasic(command, `${label}[${index}]`);
    const current = command as RawEventCommand;
    if (current.indent > previousIndent + 1) {
      throw new Error(`${label}[${index}] 缩进跳级`);
    }
    if (EVENT_COMMAND_CONTINUATION_CODES.has(current.code)) {
      const matchedHead = openHeads.some((head) => head.indent === current.indent);
      if (!matchedHead && current.indent !== 0 && openHeads.length === 0) {
        throw new Error(`${label}[${index}] 结构续行 ${current.code} 没有对应块头`);
      }
    }
    if (EVENT_COMMAND_BLOCK_HEAD_CODES.has(current.code)) {
      openHeads.push({ code: current.code, indent: current.indent, atIndex: index });
    }
    while (openHeads.length && openHeads[openHeads.length - 1].indent >= current.indent && index > openHeads[openHeads.length - 1].atIndex) {
      if (openHeads[openHeads.length - 1].indent > current.indent) openHeads.pop();
      else break;
    }
    previousIndent = current.indent;
  }
  const last = list[list.length - 1] as RawEventCommand;
  if (last.code !== 0 || last.indent !== 0) throw new Error(`${label} 必须以 indent 0 的 code 0 结束`);
}

function scanCommandList(list: unknown[], commonEventId: number, onMatch: (commandIndex: number) => void): void {
  if (!Array.isArray(list)) return;
  list.forEach((command, commandIndex) => {
    if (!command || typeof command !== 'object') return;
    const raw = command as { code?: unknown; parameters?: unknown[] };
    if (Number(raw.code) !== COMMON_EVENT_CALL_CODE || !Array.isArray(raw.parameters)) return;
    if (Number(raw.parameters[0]) === commonEventId) onMatch(commandIndex);
  });
}

function readCommonEvents(workflowRoot: string, project: string): unknown[] {
  const value = readProjectJson(workflowRoot, project, dataRelativePath(project, COMMON_EVENT_FILE), []);
  if (!Array.isArray(value)) throw new Error('CommonEvents.json 必须是数组');
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

function mapInfos(workflowRoot: string, project: string): Array<{ id: number }> {
  const value = readProjectJson(workflowRoot, project, dataRelativePath(project, 'MapInfos.json'), []);
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({ id: Number((entry as { id?: unknown } | null)?.id) }))
    .filter((entry) => Number.isInteger(entry.id) && entry.id > 0);
}

function nextCommonEventId(list: unknown[]): number {
  for (let index = 1; index < list.length; index += 1) {
    if (!isCommonEventRecord(list[index])) return index;
  }
  return Math.max(1, list.length);
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
  if (!Number.isInteger(id) || id <= 0) throw new Error('公共事件 ID 无效');
  return id;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
