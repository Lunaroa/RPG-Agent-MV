import type { StorySyncActor } from './story-page-sync-service.ts';
import type { RmmvHandlerInput } from '../rmmv/rmmv-handler-types.ts';

function normalizePatchAction(action: unknown): string {
  const raw = String(action || '');
  return raw.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
}

/** Desktop map/event editor IPC actor — default for event-service when caller omits actor. */
export const DESKTOP_EVENT_EDITOR_ACTOR: StorySyncActor = {
  actorType: 'user',
  actorId: 'desktop-event-editor',
};

export type EditingActor = 'desktopEditor' | 'agent';

export type EditingOperation =
  | 'placement'
  | 'create'
  | 'duplicate'
  | 'update'
  | 'remove'
  | 'patchDryRun'
  | 'patchApply'
  | 'patchApplyEventCommandOps';

export interface ControlledEditingCell {
  /** Requires story project profile (assertStoryProjectInitialized). */
  controlled: boolean;
  /** Uses syncAfterManagedMutation instead of withProjectMapRollback. */
  storySync: boolean;
}

export type ControlledEditingMatrix = Record<EditingActor, Record<EditingOperation, ControlledEditingCell>>;

const ROLLBACK_ONLY: ControlledEditingCell = { controlled: false, storySync: false };

/** Single SSOT for controlled editing gate + story sync behavior per actor and operation. */
export const CONTROLLED_EDITING_MATRIX: ControlledEditingMatrix = {
  desktopEditor: {
    placement: ROLLBACK_ONLY,
    create: ROLLBACK_ONLY,
    duplicate: ROLLBACK_ONLY,
    update: ROLLBACK_ONLY,
    remove: ROLLBACK_ONLY,
    patchDryRun: ROLLBACK_ONLY,
    patchApply: ROLLBACK_ONLY,
    patchApplyEventCommandOps: ROLLBACK_ONLY,
  },
  agent: {
    placement: ROLLBACK_ONLY,
    create: ROLLBACK_ONLY,
    duplicate: ROLLBACK_ONLY,
    update: ROLLBACK_ONLY,
    remove: ROLLBACK_ONLY,
    patchDryRun: ROLLBACK_ONLY,
    patchApply: ROLLBACK_ONLY,
    patchApplyEventCommandOps: ROLLBACK_ONLY,
  },
};

export function resolveEditingActor(actor: StorySyncActor): EditingActor {
  if (actor.actorType === 'user' && actor.actorId === DESKTOP_EVENT_EDITOR_ACTOR.actorId) {
    return 'desktopEditor';
  }
  if (actor.actorType === 'agent') {
    return 'agent';
  }
  return 'agent';
}

export function policyCell(actor: EditingActor, operation: EditingOperation): ControlledEditingCell {
  return CONTROLLED_EDITING_MATRIX[actor][operation];
}

export function requiresControlledEditing(actor: StorySyncActor | EditingActor, operation: EditingOperation): boolean {
  const editingActor = typeof actor === 'string' ? actor : resolveEditingActor(actor);
  return policyCell(editingActor, operation).controlled;
}

export function requiresStorySync(actor: StorySyncActor | EditingActor, operation: EditingOperation): boolean {
  const editingActor = typeof actor === 'string' ? actor : resolveEditingActor(actor);
  return policyCell(editingActor, operation).storySync;
}

export type PatchApplyMode = 'dryRun' | 'apply' | 'applyEventCommandOps';

export function resolvePatchApplyMode(input: {
  action?: string;
  dryRun?: boolean;
  applyEventCommandOps?: boolean;
}): PatchApplyMode {
  if (input.applyEventCommandOps) {
    return 'applyEventCommandOps';
  }
  const action = input.action ? normalizePatchAction(input.action) : '';
  if (action === 'dry-run' || action === 'dryrun' || input.dryRun) {
    return 'dryRun';
  }
  return 'apply';
}

/** Whether patch apply should route through applyAgentPagePatch (story-sync guard path). */
export function patchRequiresAgentGuard(input: RmmvHandlerInput): boolean {
  if (input.allowMapStructural) return false;
  const operation = patchControlledEditingOperation(input);
  return requiresStorySync('agent', operation);
}

export function patchControlledEditingOperation(input: RmmvHandlerInput): EditingOperation {
  const mode = resolvePatchApplyMode(input);
  if (mode === 'dryRun') return 'patchDryRun';
  if (mode === 'applyEventCommandOps') return 'patchApplyEventCommandOps';
  return 'patchApply';
}

/** Whether patch handler must assert story project before mutating. */
export function requiresControlledEditingForPatch(input: RmmvHandlerInput): boolean {
  const operation = patchControlledEditingOperation(input);
  return requiresControlledEditing('agent', operation);
}
