import type {
  InteractiveBattleTestBattler,
  InteractivePlaytestMode,
  InteractivePlaytestResult,
} from '../../../contract/types.ts';
import { toIpcPayload } from './ipc-serialize.ts';

export const INTERACTIVE_PLAYTEST_IPC_CHANNELS = [
  'playtest:start',
  'playtest:current',
  'playtest:stop',
  'playtest:reveal',
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
    },
  ): Promise<InteractivePlaytestResult>;
  current(): InteractivePlaytestResult;
  stop(): Promise<InteractivePlaytestResult>;
}

export interface InteractivePlaytestIpcDependencies {
  getLastProject(): string;
  resolveProject(project: string): string;
  resolveSession(project: string, requestedSessionId?: string): string | undefined;
  revealEvidence(runId: string): void;
}

export function registerInteractivePlaytestIpcHandlers(
  ipc: IpcMainLike,
  service: InteractivePlaytestServiceLike,
  dependencies: InteractivePlaytestIpcDependencies,
): void {
  ipc.handle('playtest:start', async (_event, request?: Record<string, unknown>) => {
    const body = request && typeof request === 'object' ? request : {};
    assertKnownStartFields(body);
    const mode = body.mode === 'project' || body.mode === 'battle_test' ? body.mode : null;
    if (!mode) throw new Error('playtest:start mode must be project or battle_test.');
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
    } else {
      if (confirmedStagingHash) throw new Error('battle_test does not accept confirmedStagingHash.');
      options.troopId = positiveInteger(body.troopId, 'battle_test troopId');
      options.battlers = parseBattlers(body.battlers);
      options.battleback1Name = stringField(body.battleback1Name, 'battleback1Name');
      options.battleback2Name = stringField(body.battleback2Name, 'battleback2Name');
    }
    return toIpcPayload(await service.start(project, options));
  });
  ipc.handle('playtest:current', () => toIpcPayload(service.current()));
  ipc.handle('playtest:stop', async () => toIpcPayload(await service.stop()));
  ipc.handle('playtest:reveal', (_event, runId: string) => {
    dependencies.revealEvidence(String(runId || '').trim());
    return { ok: true };
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
]);

function assertKnownStartFields(body: Record<string, unknown>): void {
  const unknown = Object.keys(body).filter((key) => !START_FIELDS.has(key));
  if (unknown.length) throw new Error(`playtest:start does not accept field(s): ${unknown.join(', ')}`);
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
