import path from 'node:path';

import { normalizeCommands } from '../rmmv/event-page-compiler.ts';
import { readJson } from '../rmmv/json.ts';
import { applyPatchToProject } from '../rmmv/patcher.ts';
import { createMapEvent, updateMapEvent } from '../workflow/map/map-event-edit.ts';
import { loadRegistry, updateContractPlacement } from '../workflow/event/event-registry.ts';
import { eventContentFingerprint } from '../workflow/event/event-fingerprint.ts';
import { eventPlacementRegistryMissing } from './eventPlacementServiceLocalization.ts';
import { withStagedMapMutation, type StagedMapMutationTarget } from './staging-service.ts';

export interface CreatePlacementEventPayload {
  name: string;
  x: number;
  y: number;
  note?: string;
  /** Scene or contract ID used to locate the registry implementation. */
  contractId?: string;
  /** Optional sceneId kept as semantic input; new writes do not persist RMMV note markers. */
  sceneId?: string;
  /** MV-format pages or abstract contract pages with commands[] compiled through the patcher. */
  pages?: Array<Record<string, unknown>>;
}

function hasAbstractPages(pages?: Array<Record<string, unknown>>): boolean {
  if (!Array.isArray(pages) || !pages.length) return false;
  const first = pages[0];
  return Boolean(first && typeof first === 'object' && Array.isArray((first as { commands?: unknown }).commands));
}

/** Normalizes a contract implementation into abstract pages the patcher can compile. */
export function normalizeContractImplementation(
  impl: Record<string, unknown> | null | undefined,
  defaultTrigger?: string,
): Array<Record<string, unknown>> | null {
  if (!impl || typeof impl !== 'object') return null;
  const pages = impl.pages as Array<Record<string, unknown>> | undefined;
  if (hasAbstractPages(pages)) return pages!;
  const commands = impl.commands;
  if (Array.isArray(commands) && commands.length) {
    const page: Record<string, unknown> = { commands };
    if (defaultTrigger) page.trigger = defaultTrigger;
    return [page];
  }
  return null;
}

/** Resolves the scene ID from contractId; AIWF markers are no longer read from or written to RMMV note. */
function extractSceneId(payload: CreatePlacementEventPayload): string | null {
  const fromContract = String(payload.contractId || '').trim();
  return fromContract || null;
}

function storyNoteTokens(contractId: string, sceneId?: string | null): string[] {
  const tokens = [`AIWF:story:${contractId}`, `AIWF:event-contract:${contractId}`];
  const sid = String(sceneId || '').trim();
  if (sid && sid !== contractId) tokens.push(`AIWF:story:${sid}`);
  return tokens;
}

interface MapEventLite { id: number; note?: string }

/** Legacy compatibility: find older full-command events that still carry AIWF note markers. */
function findStoryEvent(
  mapFile: string,
  contractId: string,
  sceneId?: string | null,
): { id: number; note: string } | null {
  const map = readJson(mapFile) as { events?: Array<MapEventLite | null> };
  const events = Array.isArray(map.events) ? map.events : [];
  const tokens = storyNoteTokens(contractId, sceneId);
  const matches = events.filter(
    (ev): ev is { id: number; note: string } => Boolean(
      ev && typeof ev.note === 'string' && tokens.some((token) => ev.note!.includes(token)),
    ),
  );
  if (!matches.length) return null;
  return matches.find((ev) => ev.note.includes('AIWF:unplaced')) || matches[0];
}

function stripInternalAiMarkers(note: string): string {
  return note
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('AIWF:'))
    .join('\n');
}

/** Keeps only explicit user/contract note text for newly placed events. */
export function buildPlacementNote(_contractId: string, extraNote?: string): string {
  const lines: string[] = [];
  for (const line of String(extraNote || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('AIWF:')) continue;
    if (trimmed && !lines.includes(trimmed)) lines.push(trimmed);
  }
  return lines.join('\n');
}

/** Reads a map event and computes the content fingerprint used as the placement baseline. */
function fingerprintMapEvent(mapFile: string, eventId: number): string | undefined {
  try {
    const map = readJson(mapFile) as { events?: Array<Record<string, unknown> | null> };
    const event = (map.events || []).find((e) => e && (e as { id?: number }).id === eventId);
    return event ? eventContentFingerprint(event as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Canonicalizes abstract page commands before placement compilation. */
export function normalizeAbstractPages(pages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return pages.map((page) => {
    if (!page || typeof page !== 'object' || !Array.isArray((page as { commands?: unknown }).commands)) return page;
    const { commands } = normalizeCommands((page as { commands: unknown }).commands);
    return { ...page, commands };
  });
}

function resolveRegistryPages(
  workflowRoot: string,
  project: string,
  contractId: string,
): Array<Record<string, unknown>> | null {
  const registry = loadRegistry(project, { runtimeRoot: path.join(workflowRoot, 'runtime') });
  const contract = registry.contracts.find((c) => c.id === contractId);
  if (!contract?.implementation || typeof contract.implementation !== 'object') return null;
  const trigger = (contract.rmmvTarget as { trigger?: string } | undefined)?.trigger;
  const pages = normalizeContractImplementation(contract.implementation as Record<string, unknown>, trigger);
  return pages ? normalizeAbstractPages(pages) : null;
}

function placeViaContractPatch(
  staged: StagedMapMutationTarget,
  mapId: number,
  payload: CreatePlacementEventPayload,
  pages: Array<Record<string, unknown>>,
) {
  const contractId = String(payload.contractId || '').trim() || extractSceneId(payload) || '';
  const note = contractId
    ? buildPlacementNote(contractId, payload.note)
    : stripInternalAiMarkers(String(payload.note || ''));
  const spec = {
    engine: 'rpg-maker-mv' as const,
    operations: [{
      op: 'add-map-event',
      mapId,
      name: payload.name,
      x: payload.x,
      y: payload.y,
      note,
      pages,
    }],
  };
  const patchReport = applyPatchToProject(staged.project, spec);
  const opReport = patchReport.operations[patchReport.operations.length - 1] as { eventId?: number };
  const eventId = Number(opReport?.eventId);
  return {
    op: 'create',
    mapId,
    eventId,
    event: null,
    usedContractPatch: true,
  };
}

export function createPlacementEvent(
  workflowRoot: string,
  project: string,
  mapId: number,
  payload: CreatePlacementEventPayload,
) {
  const staged = withStagedMapMutation(
    workflowRoot,
    project,
    mapId,
    (target) => createPlacementEventInStagedMap(target, workflowRoot, project, mapId, payload),
  );
  return { ...staged.result, staging: staged.staging };
}

function createPlacementEventInStagedMap(
  staged: StagedMapMutationTarget,
  workflowRoot: string,
  project: string,
  mapId: number,
  payload: CreatePlacementEventPayload,
) {
  const contractId = String(payload.contractId || '').trim() || extractSceneId(payload) || '';
  const sceneId = String(payload.sceneId || '').trim() || null;

  // Legacy path: place older full-command events with AIWF note markers and strip internal markers.
  if (contractId) {
    const existing = findStoryEvent(staged.mapFile, contractId, sceneId);
    if (existing) {
      const note = stripInternalAiMarkers(existing.note);
      const report = updateMapEvent({
        project: staged.project,
        mapId,
        eventId: existing.id,
        event: { x: payload.x, y: payload.y, note },
      });
      const contentHash = fingerprintMapEvent(staged.mapFile, existing.id);
      markPlacementInRegistry(workflowRoot, project, contractId, mapId, existing.id, payload.x, payload.y, contentHash);
      return {
        ...report,
        op: 'place',
        reusedExisting: true,
      };
    }
  }

  // Main path: compile payload or registry abstract pages into the placed event.
  let pages: Array<Record<string, unknown>> | null = hasAbstractPages(payload.pages)
    ? (payload.pages as Array<Record<string, unknown>>)
    : null;
  if (!pages && contractId) {
    pages = resolveRegistryPages(workflowRoot, project, contractId);
  }
  if (pages && hasAbstractPages(pages)) {
    const report = placeViaContractPatch(staged, mapId, payload, normalizeAbstractPages(pages));
    if (contractId && Number.isInteger(report.eventId)) {
      const contentHash = fingerprintMapEvent(staged.mapFile, report.eventId);
      markPlacementInRegistry(workflowRoot, project, contractId, mapId, report.eventId, payload.x, payload.y, contentHash);
    }
    return report;
  }

  // Shell path: when a contract has no implementation yet, place an empty editor-style event.
  const note = contractId
    ? buildPlacementNote(contractId, payload.note)
    : stripInternalAiMarkers(String(payload.note || ''));
  const report = createMapEvent({
    project: staged.project,
    mapId,
    event: { name: payload.name || contractId || `EV`, x: payload.x, y: payload.y, note },
  });
  const eventId = report.eventId;
  if (contractId && Number.isInteger(eventId)) {
    const contentHash = fingerprintMapEvent(staged.mapFile, eventId);
    // Shell placements may not exist in the JSON registry yet; skip write-back until register fills implementation.
    tryMarkPlacementInRegistry(workflowRoot, project, contractId, mapId, eventId, payload.x, payload.y, contentHash);
  }
  return {
    ...report,
    op: 'create',
    eventId,
    usedContractPatch: false,
    shellOnly: true,
  };
}

/** Silent variant used by shell placement when a contract is not in the JSON registry yet. */
function tryMarkPlacementInRegistry(
  workflowRoot: string,
  project: string,
  contractId: string,
  mapId: number,
  eventId: number,
  x: number,
  y: number,
  contentHash?: string,
) {
  if (!contractId) return;
  const result = updateContractPlacement(project, contractId, {
    mapId, eventId, x, y, contentHash,
  }, { runtimeRoot: path.join(workflowRoot, 'runtime') });
  if (result.status === 'not-found') return;
}

function markPlacementInRegistry(
  workflowRoot: string,
  project: string,
  contractId: string,
  mapId: number,
  eventId: number,
  x: number,
  y: number,
  contentHash?: string,
) {
  if (!contractId) return;
  const result = updateContractPlacement(project, contractId, {
    mapId,
    eventId,
    x,
    y,
    contentHash,
  }, { runtimeRoot: path.join(workflowRoot, 'runtime') });
  if (result.status === 'not-found') {
    throw new Error(eventPlacementRegistryMissing(contractId));
  }
}
