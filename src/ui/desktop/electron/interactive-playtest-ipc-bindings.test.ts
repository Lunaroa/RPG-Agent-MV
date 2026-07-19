import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  cleanupInteractivePlaytestIpcHandlers,
  INTERACTIVE_PLAYTEST_IPC_CHANNELS,
  registerInteractivePlaytestIpcHandlers,
} from './interactive-playtest-ipc-bindings.ts';

describe('interactive playtest IPC bindings', () => {
  test('registers the public channels and preserves start confirmation options', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    const ipc = {
      handle(channel: string, listener: (...args: any[]) => unknown) { handlers.set(channel, listener); },
      removeHandler(channel: string) { handlers.delete(channel); },
    };
    const service = {
      async start(project: string, options: Record<string, unknown>) {
        calls.push(['start', project, options]);
        return { confirmationRequired: false };
      },
      current() {
        calls.push(['current']);
        return { confirmationRequired: false };
      },
      runtimeInfo(project: string) {
        calls.push(['runtimeInfo', project]);
        return { engine: 'rpg-maker-mv' as const, source: 'official-install' as const, executable: 'runtime/Game.exe', configurable: true, status: 'ready' as const };
      },
      async stop() {
        calls.push(['stop']);
        return { confirmationRequired: false };
      },
    };
    registerInteractivePlaytestIpcHandlers(ipc, service, {
      getLastProject: () => 'projects/sample',
      resolveProject: (project) => `resolved:${project}`,
      resolveSession: (_project, requested) => requested || 'session-latest',
      revealEvidence: (runId) => calls.push(['reveal', runId]),
      selectRuntime: async (_event, request) => {
        calls.push(['selectRuntime', request]);
        return { canceled: false, engine: request.engine, configured: true };
      },
    });

    assert.deepEqual([...handlers.keys()].sort(), [...INTERACTIVE_PLAYTEST_IPC_CHANNELS].sort());
    await handlers.get('playtest:start')?.(null, {
      project: 'projects/sample',
      mode: 'project',
      sessionId: 'session-current',
      confirmedStagingHash: 'summary-hash',
    });
    await handlers.get('playtest:current')?.(null);
    await handlers.get('playtest:runtimeInfo')?.(null, { project: 'projects/sample' });
    await handlers.get('playtest:stop')?.(null);
    await handlers.get('playtest:reveal')?.(null, 'run-1');
    await handlers.get('playtest:selectRuntime')?.(null, { engine: 'rpg-maker-mv', reason: 'missing' });
    await handlers.get('playtest:selectRuntime')?.(null, { engine: 'rpg-maker-mz', reason: 'change' });

    assert.deepEqual(calls, [
      ['start', 'resolved:projects/sample', {
        mode: 'project',
        sessionId: 'session-current',
        confirmedStagingHash: 'summary-hash',
      }],
      ['current'],
      ['runtimeInfo', 'resolved:projects/sample'],
      ['stop'],
      ['reveal', 'run-1'],
      ['selectRuntime', { engine: 'rpg-maker-mv', reason: 'missing' }],
      ['selectRuntime', { engine: 'rpg-maker-mz', reason: 'change' }],
    ]);

    cleanupInteractivePlaytestIpcHandlers(ipc);
    assert.equal(handlers.size, 0);
  });

  test('requires engine and selection reason for the runtime picker', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const service = {
      start: async () => ({ confirmationRequired: false }),
      current: () => ({ confirmationRequired: false }),
      runtimeInfo: () => ({ engine: 'rpg-maker-mv' as const, source: 'unavailable' as const, executable: null, configurable: true, status: 'missing' as const }),
      stop: async () => ({ confirmationRequired: false }),
    };
    registerInteractivePlaytestIpcHandlers({
      handle(channel, listener) { handlers.set(channel, listener); },
      removeHandler(channel) { handlers.delete(channel); },
    }, service, {
      getLastProject: () => '',
      resolveProject: (project) => project,
      resolveSession: () => undefined,
      revealEvidence: () => undefined,
      selectRuntime: async (_event, request) => ({ canceled: true, engine: request.engine, configured: false }),
    });

    await assert.rejects(
      () => handlers.get('playtest:selectRuntime')?.(null, 'rpg-maker-mz') as Promise<unknown>,
      /request must be an object/i,
    );
    await assert.rejects(
      () => handlers.get('playtest:selectRuntime')?.(null, { engine: 'rpg-maker-mz', reason: 'other' }) as Promise<unknown>,
      /reason must be missing, invalid, or change/i,
    );
  });

  test('passes only structured Battle Test configuration and rejects arbitrary launch arguments', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    const service = {
      async start(project: string, options: Record<string, unknown>) {
        calls.push([project, options]);
        return { confirmationRequired: false };
      },
      current: () => ({ confirmationRequired: false }),
      runtimeInfo: () => ({ engine: 'rpg-maker-mv' as const, source: 'unavailable' as const, executable: null, configurable: true, status: 'missing' as const }),
      stop: async () => ({ confirmationRequired: false }),
    };
    registerInteractivePlaytestIpcHandlers({
      handle(channel, listener) { handlers.set(channel, listener); },
      removeHandler(channel) { handlers.delete(channel); },
    }, service, {
      getLastProject: () => '',
      resolveProject: (project) => project,
      resolveSession: () => undefined,
      revealEvidence: () => undefined,
      selectRuntime: async (_event, request) => ({ canceled: true, engine: request.engine, configured: false }),
    });

    await handlers.get('playtest:start')?.(null, {
      project: 'projects/sample',
      mode: 'battle_test',
      troopId: 3,
      battlers: [{ actorId: 1, level: 12, equips: [1, 0] }],
      battleback1Name: 'Field',
      battleback2Name: 'Forest',
    });
    assert.deepEqual(calls, [[
      'projects/sample',
      {
        mode: 'battle_test',
        troopId: 3,
        battlers: [{ actorId: 1, level: 12, equips: [1, 0] }],
        battleback1Name: 'Field',
        battleback2Name: 'Forest',
      },
    ]]);
    await assert.rejects(
      () => handlers.get('playtest:start')?.(null, {
        project: 'projects/sample',
        mode: 'battle_test',
        args: ['--arbitrary'],
      }) as Promise<unknown>,
      /does not accept field.*args/i,
    );
  });

  test('passes a structured particle preview only in particle preview mode', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    const service = {
      async start(project: string, options: Record<string, unknown>) {
        calls.push([project, options]);
        return { confirmationRequired: false };
      },
      current: () => ({ confirmationRequired: false }),
      runtimeInfo: () => ({ engine: 'rpg-maker-mz' as const, source: 'unavailable' as const, executable: null, configurable: true, status: 'missing' as const }),
      stop: async () => ({ confirmationRequired: false }),
    };
    registerInteractivePlaytestIpcHandlers({
      handle(channel, listener) { handlers.set(channel, listener); },
      removeHandler(channel) { handlers.delete(channel); },
    }, service, {
      getLastProject: () => '',
      resolveProject: (project) => project,
      resolveSession: () => undefined,
      revealEvidence: () => undefined,
      selectRuntime: async (_event, request) => ({ canceled: true, engine: request.engine, configured: false }),
    });
    const animationPreview = {
      displayType: 0,
      effectName: 'fx/Spark',
      scale: 100,
      speed: 100,
      offsetX: 0,
      offsetY: 0,
      rotation: { x: 0, y: 0, z: 0 },
      alignBottom: false,
      flashTimings: [],
      soundTimings: [],
    };

    await handlers.get('playtest:start')?.(null, {
      project: 'projects/sample',
      mode: 'particle_preview',
      animationPreview,
    });
    assert.deepEqual(calls, [[
      'projects/sample',
      { mode: 'particle_preview', animationPreview },
    ]]);
    await assert.rejects(
      () => handlers.get('playtest:start')?.(null, {
        project: 'projects/sample',
        mode: 'project',
        animationPreview,
      }) as Promise<unknown>,
      /project does not accept animationPreview/i,
    );
    await assert.rejects(
      () => handlers.get('playtest:start')?.(null, {
        project: 'projects/sample',
        mode: 'particle_preview',
        animationPreview,
        troopId: 1,
      }) as Promise<unknown>,
      /does not accept Battle Test field/i,
    );
  });
});
