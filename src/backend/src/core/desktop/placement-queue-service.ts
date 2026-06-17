import fs from 'node:fs';
import path from 'node:path';

import { ConsoleSettingsDao } from '../db/dao/console-settings-dao.ts';
import { readJson } from '../rmmv/json.ts';
import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { loadRegistry } from '../workflow/event/event-registry.ts';
import { getMapFileForRead, projectHash } from './staging-service.ts';

export interface PlacementQueueEvent {
  contractId: string;
  eventName: string;
  sceneId?: string;
  targetMapId: number | null;
  placementHint?: string;
  summary?: string;
  trigger?: string;
  status?: string;
  placedEventId?: number | null;
  x?: number | null;
  y?: number | null;
}

export interface PlacementQueueSession {
  askId: string;
  sessionId: string;
  events: PlacementQueueEvent[];
  updatedAt: string;
}

interface MapEventLite {
  id?: number;
  name?: string;
  note?: string;
  x?: number;
  y?: number;
}

function queueSettingsKey(resolvedProject: string): string {
  return `eventPlacementQueue:${projectHash(resolvedProject)}`;
}

function runtimeRoot(workflowRoot: string): string {
  return path.join(workflowRoot, 'runtime');
}

function isPlacedStatus(status?: string | null): boolean {
  return status === 'placed' || status === 'verified';
}

function isQueueEventPending(event: PlacementQueueEvent): boolean {
  return !isPlacedStatus(event.status);
}

function storyNoteTokens(contractId: string, sceneId?: string | null): string[] {
  const tokens = [`AIWF:story:${contractId}`, `AIWF:event-contract:${contractId}`];
  const sid = String(sceneId || '').trim();
  if (sid && sid !== contractId) tokens.push(`AIWF:story:${sid}`);
  return tokens;
}

function readSavedSession(resolvedProject: string): PlacementQueueSession | null {
  const raw = ConsoleSettingsDao.get(queueSettingsKey(resolvedProject));
  if (!raw || typeof raw !== 'object') return null;
  const session = raw as Partial<PlacementQueueSession>;
  if (!Array.isArray(session.events) || !session.events.length) return null;
  return {
    askId: String(session.askId || `recovery-placement-${Date.now()}`),
    sessionId: String(session.sessionId || 'recovery'),
    events: session.events.map(normalizeQueueEvent),
    updatedAt: String(session.updatedAt || new Date().toISOString()),
  };
}

function normalizeQueueEvent(event: Partial<PlacementQueueEvent>): PlacementQueueEvent {
  return {
    contractId: String(event.contractId || ''),
    eventName: String(event.eventName || event.contractId || ''),
    sceneId: event.sceneId ? String(event.sceneId) : undefined,
    targetMapId: Number.isInteger(event.targetMapId) ? Number(event.targetMapId) : null,
    placementHint: event.placementHint ? String(event.placementHint) : undefined,
    summary: event.summary ? String(event.summary) : undefined,
    trigger: event.trigger ? String(event.trigger) : undefined,
    status: event.status ? String(event.status) : undefined,
    placedEventId: event.placedEventId == null ? null : Number(event.placedEventId) || null,
    x: Number.isInteger(event.x) ? Number(event.x) : null,
    y: Number.isInteger(event.y) ? Number(event.y) : null,
  };
}

function findMapEventForContract(
  workflowRoot: string,
  resolvedProject: string,
  contractId: string,
  sceneId?: string | null,
  preferredMapId?: number | null,
): MapEventLite | null {
  const dataDir = resolveDataDir(resolvedProject);
  const mapInfosPath = path.join(dataDir, 'MapInfos.json');
  if (!fs.existsSync(mapInfosPath)) return null;
  const mapInfos = readJson(mapInfosPath) as Array<{ id?: number } | null>;
  const tokens = storyNoteTokens(contractId, sceneId);
  const mapIds = mapInfos
    .map((info) => info?.id)
    .filter((mapId): mapId is number => Number.isInteger(mapId) && mapId! > 0);
  const orderedMapIds = preferredMapId && mapIds.includes(preferredMapId)
    ? [preferredMapId, ...mapIds.filter((id) => id !== preferredMapId)]
    : mapIds;

  for (const mapId of orderedMapIds) {
    const mapFile = getMapFileForRead(workflowRoot, resolvedProject, mapId)
      || path.join(dataDir, `Map${String(mapId).padStart(3, '0')}.json`);
    if (!fs.existsSync(mapFile)) continue;
    const map = readJson(mapFile) as { events?: Array<MapEventLite | null> };
    const matches = (map.events || []).filter(
      (event): event is MapEventLite => Boolean(
        event
        && typeof event.note === 'string'
        && tokens.some((token) => event.note!.includes(token)),
      ),
    );
    if (!matches.length) continue;
    return matches.find((event) => event.note!.includes('AIWF:unplaced')) || matches[0];
  }
  return null;
}

function contractNeedsPlacement(contract: {
  status?: string;
  placement?: { eventId?: number };
}): boolean {
  if ((contract.status || 'draft') !== 'draft') return false;
  const placement = contract.placement;
  return !placement || !Number.isInteger(placement.eventId);
}

function buildEventFromRegistryContract(
  workflowRoot: string,
  resolvedProject: string,
  contract: {
    id: string;
    purpose?: string;
    summary?: string;
    sceneId?: string;
    status?: string;
    rmmvTarget?: {
      mapId?: number;
      eventName?: string;
      trigger?: string;
    };
    placement?: {
      mapId?: number;
      eventId?: number;
      x?: number;
      y?: number;
    };
  },
): PlacementQueueEvent | null {
  if (!contractNeedsPlacement(contract)) return null;
  const target = contract.rmmvTarget || {};
  const placement = contract.placement;
  const targetMapId = Number.isInteger(placement?.mapId)
    ? Number(placement!.mapId)
    : Number.isInteger(target.mapId)
      ? Number(target.mapId)
      : null;
  const event: PlacementQueueEvent = {
    contractId: contract.id,
    eventName: target.eventName || contract.id,
    sceneId: contract.sceneId,
    targetMapId,
    summary: contract.summary || contract.purpose,
    trigger: target.trigger,
    status: 'draft',
  };
  const mapEvent = findMapEventForContract(
    workflowRoot,
    resolvedProject,
    contract.id,
    contract.sceneId,
    targetMapId,
  );
  if (mapEvent && Number.isInteger(mapEvent.id)) {
    event.placedEventId = mapEvent.id;
    event.x = Number.isInteger(mapEvent.x) ? mapEvent.x! : null;
    event.y = Number.isInteger(mapEvent.y) ? mapEvent.y! : null;
    if (typeof mapEvent.note === 'string' && mapEvent.note.includes('AIWF:unplaced')) {
      event.status = 'draft';
    } else if (Number.isInteger(mapEvent.x) && Number.isInteger(mapEvent.y) && (mapEvent.x !== 0 || mapEvent.y !== 0)) {
      event.status = 'placed';
    }
  }
  return event;
}

function buildPendingFromRegistry(workflowRoot: string, resolvedProject: string): PlacementQueueEvent[] {
  const registry = loadRegistry(resolvedProject, { runtimeRoot: runtimeRoot(workflowRoot) });
  return registry.contracts
    .map((contract) => buildEventFromRegistryContract(workflowRoot, resolvedProject, contract))
    .filter((event): event is PlacementQueueEvent => Boolean(event?.contractId));
}

function mergeQueueEvents(saved: PlacementQueueEvent[], rebuilt: PlacementQueueEvent[]): PlacementQueueEvent[] {
  const byId = new Map<string, PlacementQueueEvent>();
  for (const event of rebuilt) byId.set(event.contractId, event);
  for (const event of saved) {
    const base = byId.get(event.contractId);
    byId.set(event.contractId, base ? { ...base, ...event, contractId: event.contractId } : event);
  }
  return [...byId.values()].filter((event) => event.contractId);
}

function reconcileQueueEvent(
  workflowRoot: string,
  resolvedProject: string,
  event: PlacementQueueEvent,
): PlacementQueueEvent | null {
  const registry = loadRegistry(resolvedProject, { runtimeRoot: runtimeRoot(workflowRoot) });
  const contract = registry.contracts.find((item) => item.id === event.contractId);
  if (contract && (contract.status === 'rejected' || contract.status === 'abandoned')) {
    return null;
  }
  if (contract && !contractNeedsPlacement(contract)) {
    const placement = contract.placement;
    if (!placement || !Number.isInteger(placement.eventId)) return null;
    return {
      ...event,
      status: contract.status === 'verified' ? 'verified' : 'placed',
      targetMapId: placement.mapId ?? event.targetMapId,
      placedEventId: placement.eventId ?? event.placedEventId ?? null,
      x: Number.isInteger(placement.x) ? placement.x : event.x ?? null,
      y: Number.isInteger(placement.y) ? placement.y : event.y ?? null,
    };
  }
  const rebuilt = contract
    ? buildEventFromRegistryContract(workflowRoot, resolvedProject, contract)
    : null;
  const merged = rebuilt ? { ...rebuilt, ...event, contractId: event.contractId } : event;
  if (!contract) {
    return isPlacedStatus(merged.status) ? null : merged;
  }
  return merged;
}

function sessionHasPending(events: PlacementQueueEvent[]): boolean {
  return events.some((event) => isQueueEventPending(event));
}

export function savePlacementQueueSession(
  resolvedProject: string,
  session: Pick<PlacementQueueSession, 'askId' | 'sessionId' | 'events'>,
): PlacementQueueSession | null {
  const events = (session.events || []).map(normalizeQueueEvent).filter((event) => event.contractId);
  if (!events.length || !sessionHasPending(events)) {
    clearPlacementQueueSession(resolvedProject);
    return null;
  }
  const payload: PlacementQueueSession = {
    askId: String(session.askId || `recovery-placement-${Date.now()}`),
    sessionId: String(session.sessionId || 'recovery'),
    events,
    updatedAt: new Date().toISOString(),
  };
  ConsoleSettingsDao.set(queueSettingsKey(resolvedProject), payload);
  return payload;
}

export function clearPlacementQueueSession(resolvedProject: string): void {
  ConsoleSettingsDao.delete(queueSettingsKey(resolvedProject));
}

export function getPlacementQueueSession(
  workflowRoot: string,
  resolvedProject: string,
): PlacementQueueSession | null {
  const saved = readSavedSession(resolvedProject);
  const rebuilt = buildPendingFromRegistry(workflowRoot, resolvedProject);
  const merged = mergeQueueEvents(saved?.events || [], rebuilt)
    .map((event) => reconcileQueueEvent(workflowRoot, resolvedProject, event))
    .filter((event): event is PlacementQueueEvent => Boolean(event));
  const pendingEvents = merged.filter((event) => isQueueEventPending(event));
  if (!pendingEvents.length) {
    if (saved) clearPlacementQueueSession(resolvedProject);
    return null;
  }
  const session: PlacementQueueSession = {
    askId: saved?.askId || `recovery-placement-${Date.now()}`,
    sessionId: saved?.sessionId || 'recovery',
    events: merged,
    updatedAt: new Date().toISOString(),
  };
  savePlacementQueueSession(resolvedProject, session);
  return session;
}
