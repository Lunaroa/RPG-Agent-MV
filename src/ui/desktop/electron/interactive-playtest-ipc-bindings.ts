import type { InteractivePlaytestResult } from '../../../contract/types.ts';
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
    options: { sessionId?: string; confirmedStagingHash?: string },
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
    return toIpcPayload(await service.start(project, {
      ...(sessionId ? { sessionId } : {}),
      ...(confirmedStagingHash ? { confirmedStagingHash } : {}),
    }));
  });
  ipc.handle('playtest:current', () => toIpcPayload(service.current()));
  ipc.handle('playtest:stop', async () => toIpcPayload(await service.stop()));
  ipc.handle('playtest:reveal', (_event, runId: string) => {
    dependencies.revealEvidence(String(runId || '').trim());
    return { ok: true };
  });
}

export function cleanupInteractivePlaytestIpcHandlers(ipc: IpcMainLike): void {
  for (const channel of INTERACTIVE_PLAYTEST_IPC_CHANNELS) ipc.removeHandler(channel);
}
