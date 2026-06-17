import {
  createMapEvent,
  deleteMapEvent,
  duplicateMapEvent,
  updateMapEvent,
} from '../workflow/map/map-event-edit.ts';
import { createPlacementEvent as createPlacementEventImpl } from './event-placement-service.ts';
import { ensureStagedMap, markStagedMapUpdated } from './staging-service.ts';
import type { CreatePlacementEventPayload } from './event-placement-service.ts';
import {
  assertStoryProjectInitialized,
  syncAfterManagedMutation,
  withProjectMapRollback,
  type StorySyncActor,
} from './story-page-sync-service.ts';
import {
  DESKTOP_EVENT_EDITOR_ACTOR,
  requiresControlledEditing,
  requiresStorySync,
  type EditingOperation,
} from './controlled-editing-policy.ts';

function runEventMutation<T>(
  project: string,
  mapIds: number[],
  actor: StorySyncActor,
  operation: EditingOperation,
  mutation: () => T,
): T {
  if (requiresStorySync(actor, operation)) {
    return syncAfterManagedMutation(project, mapIds, mutation, actor);
  }
  if (requiresControlledEditing(actor, operation)) {
    assertStoryProjectInitialized(project);
  }
  return withProjectMapRollback(project, mapIds, mutation);
}

export function createEvent(
  workflowRoot: string,
  project: string,
  mapId: number,
  event: Record<string, unknown>,
  actor: StorySyncActor = DESKTOP_EVENT_EDITOR_ACTOR,
) {
  return runEventMutation(project, [mapId], actor, 'create', () => {
    const staged = ensureStagedMap(workflowRoot, project, mapId);
    return withStaging(createMapEvent({ project: staged.project, mapId, event }), workflowRoot, project, mapId);
  });
}

export function createPlacementEvent(
  workflowRoot: string,
  project: string,
  mapId: number,
  payload: CreatePlacementEventPayload,
) {
  return runEventMutation(project, [mapId], DESKTOP_EVENT_EDITOR_ACTOR, 'placement', () =>
    createPlacementEventImpl(workflowRoot, project, mapId, payload));
}

export function updateEvent(
  workflowRoot: string,
  project: string,
  mapId: number,
  eventId: number,
  event: Record<string, unknown>,
  actor: StorySyncActor = DESKTOP_EVENT_EDITOR_ACTOR,
) {
  return runEventMutation(project, [mapId], actor, 'update', () => {
    const staged = ensureStagedMap(workflowRoot, project, mapId);
    return withStaging(
      updateMapEvent({ project: staged.project, mapId, eventId, event }),
      workflowRoot,
      project,
      mapId,
    );
  });
}

export function removeEvent(
  workflowRoot: string,
  project: string,
  mapId: number,
  eventId: number,
  actor: StorySyncActor = DESKTOP_EVENT_EDITOR_ACTOR,
) {
  return runEventMutation(project, [mapId], actor, 'remove', () => {
    const staged = ensureStagedMap(workflowRoot, project, mapId);
    return withStaging(
      deleteMapEvent({ project: staged.project, mapId, eventId }),
      workflowRoot,
      project,
      mapId,
    );
  });
}

export function duplicateEvent(
  workflowRoot: string,
  project: string,
  mapId: number,
  eventId: number,
  actor: StorySyncActor = DESKTOP_EVENT_EDITOR_ACTOR,
) {
  return runEventMutation(project, [mapId], actor, 'duplicate', () => {
    const staged = ensureStagedMap(workflowRoot, project, mapId);
    return withStaging(duplicateMapEvent({ project: staged.project, mapId, eventId }), workflowRoot, project, mapId);
  });
}

function withStaging<T extends object>(report: T, workflowRoot: string, project: string, mapId: number) {
  return { ...report, staging: markStagedMapUpdated(workflowRoot, project, mapId) };
}
