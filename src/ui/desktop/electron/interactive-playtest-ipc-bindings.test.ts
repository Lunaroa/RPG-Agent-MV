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
    });

    assert.deepEqual([...handlers.keys()].sort(), [...INTERACTIVE_PLAYTEST_IPC_CHANNELS].sort());
    await handlers.get('playtest:start')?.(null, {
      project: 'projects/sample',
      sessionId: 'session-current',
      confirmedStagingHash: 'summary-hash',
    });
    await handlers.get('playtest:current')?.(null);
    await handlers.get('playtest:stop')?.(null);
    await handlers.get('playtest:reveal')?.(null, 'run-1');

    assert.deepEqual(calls, [
      ['start', 'resolved:projects/sample', {
        sessionId: 'session-current',
        confirmedStagingHash: 'summary-hash',
      }],
      ['current'],
      ['stop'],
      ['reveal', 'run-1'],
    ]);

    cleanupInteractivePlaytestIpcHandlers(ipc);
    assert.equal(handlers.size, 0);
  });
});
