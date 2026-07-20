import type {
  InteractiveBattleTestBattler,
  InteractiveParticleAnimationPreview,
  InteractivePlaytestMode,
  InteractivePlaytestResult,
  InteractivePlaytestRuntimeInfo,
  InteractivePlaytestRuntimeSelectionRequired,
  InteractivePlaytestRuntimeSelectionResult,
} from '../../../contract/types.ts';
import { toIpcPayload } from './ipc-serialize.ts';

export const INTERACTIVE_PLAYTEST_IPC_CHANNELS = [
  'playtest:start',
  'playtest:current',
  'playtest:stop',
  'playtest:reveal',
  'playtest:runtimeInfo',
  'playtest:selectRuntime',
] as const;

interface IpcMainLike {
  handle(channel: string, listener: (...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

interface InteractivePlaytestServiceLike {
  start(
    project: string,
    options: {
      mode: InteractivePlaytestMode;
      sessionId?: string;
      confirmedStagingHash?: string;
      troopId?: number;
      battlers?: InteractiveBattleTestBattler[];
      battleback1Name?: string;
      battleback2Name?: string;
      animationPreview?: InteractiveParticleAnimationPreview;
    },
  ): Promise<InteractivePlaytestResult>;
  current(): InteractivePlaytestResult;
  runtimeInfo(project: string): InteractivePlaytestRuntimeInfo;
  stop(): Promise<InteractivePlaytestResult>;
}

export interface InteractivePlaytestIpcDependencies {
  beforeStart?(): void | Promise<void>;
  getLastProject(): string;
  resolveProject(project: string): string;
  resolveSession(project: string, requestedSessionId?: string): string | undefined;
  revealEvidence(runId: string): void;
  selectRuntime(
    event: unknown,
    request: InteractivePlaytestRuntimeSelectionRequired,
  ): Promise<InteractivePlaytestRuntimeSelectionResult>;
}

export function registerInteractivePlaytestIpcHandlers(
  ipc: IpcMainLike,
  service: InteractivePlaytestServiceLike,
  dependencies: InteractivePlaytestIpcDependencies,
): void {
  ipc.handle('playtest:start', async (event, request?: Record<string, unknown>) => {
    await dependencies.beforeStart?.();
    const body = request && typeof request === 'object' ? request : {};
    assertKnownStartFields(body);
    const mode = body.mode === 'project' || body.mode === 'battle_test' || body.mode === 'particle_preview' ? body.mode : null;
    if (!mode) throw new Error('playtest:start mode must be project, battle_test, or particle_preview.');
    assertModeFields(body, mode);
    const requestedProject = typeof body.project === 'string' && body.project.trim()
      ? body.project.trim()
      : dependencies.getLastProject().trim();
    if (!requestedProject) throw new Error('Select an RMMV project before starting playtest.');
    const project = dependencies.resolveProject(requestedProject);
    const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const sessionId = dependencies.resolveSession(project, requestedSessionId);
    const confirmedStagingHash = typeof body.confirmedStagingHash === 'string'
      ? body.confirmedStagingHash.trim()
      : undefined;
    const options: Parameters<InteractivePlaytestServiceLike['start']>[1] = {
      mode,
      ...(sessionId ? { sessionId } : {}),
    };
    if (mode === 'project') {
      if (confirmedStagingHash) options.confirmedStagingHash = confirmedStagingHash;
    } else if (mode === 'battle_test') {
      if (confirmedStagingHash) throw new Error('battle_test does not accept confirmedStagingHash.');
      options.troopId = positiveInteger(body.troopId, 'battle_test troopId');
      options.battlers = parseBattlers(body.battlers);
      options.battleback1Name = stringField(body.battleback1Name, 'battleback1Name');
      options.battleback2Name = stringField(body.battleback2Name, 'battleback2Name');
    } else {
      if (confirmedStagingHash) throw new Error('particle_preview does not accept confirmedStagingHash.');
      if (!body.animationPreview || typeof body.animationPreview !== 'object' || Array.isArray(body.animationPreview)) {
        throw new Error('particle_preview animationPreview must be an object.');
      }
      options.animationPreview = body.animationPreview as unknown as InteractiveParticleAnimationPreview;
    }
    return toIpcPayload(await service.start(project, options));
  });
  ipc.handle('playtest:current', () => toIpcPayload(service.current()));
  ipc.handle('playtest:runtimeInfo', (_event, request?: Record<string, unknown>) => {
    const body = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
    const unknown = Object.keys(body).filter((key) => key !== 'project');
    if (unknown.length) throw new Error(`playtest:runtimeInfo does not accept field(s): ${unknown.join(', ')}`);
    const requestedProject = typeof body.project === 'string' && body.project.trim()
      ? body.project.trim()
      : dependencies.getLastProject().trim();
    if (!requestedProject) throw new Error('Select an RMMV project before inspecting its playtest runtime.');
    return toIpcPayload(service.runtimeInfo(dependencies.resolveProject(requestedProject)));
  });
  ipc.handle('playtest:stop', async () => toIpcPayload(await service.stop()));
  ipc.handle('playtest:reveal', (_event, runId: string) => {
    dependencies.revealEvidence(String(runId || '').trim());
    return { ok: true };
  });
  ipc.handle('playtest:selectRuntime', async (event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('playtest:selectRuntime request must be an object.');
    }
    const body = request as Record<string, unknown>;
    if (body.engine !== 'rpg-maker-mv' && body.engine !== 'rpg-maker-mz') {
      throw new Error('playtest:selectRuntime engine must be rpg-maker-mv or rpg-maker-mz.');
    }
    if (body.reason !== 'missing' && body.reason !== 'invalid' && body.reason !== 'change') {
      throw new Error('playtest:selectRuntime reason must be missing, invalid, or change.');
    }
    return await dependencies.selectRuntime(event, {
      engine: body.engine,
      reason: body.reason,
    });
  });
}

const START_FIELDS = new Set([
  'project',
  'mode',
  'sessionId',
  'confirmedStagingHash',
  'troopId',
  'battlers',
  'battleback1Name',
  'battleback2Name',
  'animationPreview',
]);

function assertKnownStartFields(body: Record<string, unknown>): void {
  const unknown = Object.keys(body).filter((key) => !START_FIELDS.has(key));
  if (unknown.length) throw new Error(`playtest:start does not accept field(s): ${unknown.join(', ')}`);
}

function assertModeFields(body: Record<string, unknown>, mode: InteractivePlaytestMode): void {
  const present = (field: string) => body[field] !== undefined;
  const battleFields = ['troopId', 'battlers', 'battleback1Name', 'battleback2Name'];
  if (mode !== 'project' && present('confirmedStagingHash')) {
    throw new Error(`${mode} does not accept confirmedStagingHash.`);
  }
  if (mode !== 'battle_test') {
    const invalid = battleFields.filter(present);
    if (invalid.length) throw new Error(`${mode} does not accept Battle Test field(s): ${invalid.join(', ')}.`);
  }
  if (mode !== 'particle_preview' && present('animationPreview')) {
    throw new Error(`${mode} does not accept animationPreview.`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function parseBattlers(value: unknown): Array<{ actorId: number; level: number; equips: number[] }> {
  if (!Array.isArray(value)) throw new Error('battle_test battlers must be an array.');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`battle_test battler ${index + 1} must be an object.`);
    const battler = entry as Record<string, unknown>;
    if (!Array.isArray(battler.equips)) throw new Error(`battle_test battler ${index + 1} equips must be an array.`);
    return {
      actorId: positiveInteger(battler.actorId, `battle_test battler ${index + 1} actorId`),
      level: positiveInteger(battler.level, `battle_test battler ${index + 1} level`),
      equips: battler.equips.map((entryId, equipIndex) => {
        const number = Number(entryId);
        if (!Number.isInteger(number) || number < 0) throw new Error(`battle_test battler ${index + 1} equip ${equipIndex + 1} must be a nonnegative integer.`);
        return number;
      }),
    };
  });
}

export function cleanupInteractivePlaytestIpcHandlers(ipc: IpcMainLike): void {
  for (const channel of INTERACTIVE_PLAYTEST_IPC_CHANNELS) ipc.removeHandler(channel);
}
