import fs from 'node:fs';
import path from 'node:path';

import type { MapPreviewStateCatalog, MapPreviewStateEntry } from '../../../../contract/types.ts';
import { collectRawEventCommandReferences, type RmmvEventCommandReference } from '../rmmv/event-command-references.ts';
import { readJson } from '../rmmv/json.ts';
import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { getMapFileForRead, getProjectFileForRead } from './staging-service.ts';

type JsonRecord = Record<string, unknown>;

export function buildMapPreviewStateCatalog(
  workflowRoot: string,
  project: string,
  mapId: number,
): MapPreviewStateCatalog {
  const map = readJson(getMapFileForRead(workflowRoot, project, mapId)) as JsonRecord;
  const dataDir = resolveDataDir(project);
  const system = readEffectiveProjectJson(workflowRoot, project, path.join(dataDir, 'System.json')) as JsonRecord;
  const commonEvents = readEffectiveProjectJson(workflowRoot, project, path.join(dataDir, 'CommonEvents.json')) as unknown[];
  const switchNames = stringArray(system.switches);
  const variableNames = stringArray(system.variables);
  const switchIds = new Set<number>();
  const variableIds = new Set<number>();
  const commonEventQueue: number[] = [];

  for (const event of array(map.events)) {
    if (!isRecord(event)) continue;
    for (const page of array(event.pages)) {
      if (!isRecord(page)) continue;
      collectPageConditions(page.conditions, switchIds, variableIds);
      collectCommandState(page.list, switchIds, variableIds, commonEventQueue);
    }
  }

  const visitedCommonEvents = new Set<number>();
  while (commonEventQueue.length) {
    const commonEventId = commonEventQueue.shift()!;
    if (visitedCommonEvents.has(commonEventId)) continue;
    visitedCommonEvents.add(commonEventId);
    const commonEvent = commonEvents[commonEventId];
    if (!isRecord(commonEvent)) continue;
    collectCommandState(commonEvent.list, switchIds, variableIds, commonEventQueue);
  }

  return {
    switches: catalogEntries(switchNames, switchIds),
    variables: catalogEntries(variableNames, variableIds),
  };
}

function collectPageConditions(value: unknown, switchIds: Set<number>, variableIds: Set<number>): void {
  if (!isRecord(value)) return;
  if (value.switch1Valid === true) addPositiveId(switchIds, value.switch1Id);
  if (value.switch2Valid === true) addPositiveId(switchIds, value.switch2Id);
  if (value.variableValid === true) addPositiveId(variableIds, value.variableId);
}

function collectCommandState(
  list: unknown,
  switchIds: Set<number>,
  variableIds: Set<number>,
  commonEventQueue: number[],
): void {
  const references = collectRawEventCommandReferences(list, 'mapPreview.eventCommands');
  for (const reference of references) {
    if (reference.target === 'switches') addReferenceRange(switchIds, reference);
    else if (reference.target === 'variables') addReferenceRange(variableIds, reference);
    else if (reference.target === 'commonEvents') {
      const id = positiveId(reference.value);
      if (id != null) commonEventQueue.push(id);
    }
  }
}

function addReferenceRange(target: Set<number>, reference: RmmvEventCommandReference): void {
  const start = positiveId(reference.value);
  if (start == null) return;
  const end = positiveId(reference.endValue) ?? start;
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  for (let id = lower; id <= upper; id += 1) target.add(id);
}

function catalogEntries(names: string[], reachableIds: Set<number>): MapPreviewStateEntry[] {
  return names
    .map((name, id) => ({ id, name, mapReachable: reachableIds.has(id) }))
    .filter((entry) => entry.id > 0 && (entry.mapReachable || entry.name.trim().length > 0))
    .sort((left, right) => Number(right.mapReachable) - Number(left.mapReachable) || left.id - right.id);
}

function readEffectiveProjectJson(workflowRoot: string, project: string, sourceFile: string): unknown {
  const relative = path.relative(project, sourceFile).replaceAll(path.sep, '/');
  const effective = getProjectFileForRead(workflowRoot, project, relative) || sourceFile;
  if (!fs.existsSync(effective)) return [];
  return readJson(effective);
}

function addPositiveId(target: Set<number>, value: unknown): void {
  const id = positiveId(value);
  if (id != null) target.add(id);
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry || '')) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
