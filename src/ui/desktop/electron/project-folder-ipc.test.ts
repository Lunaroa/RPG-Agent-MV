import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapIpcHandlers } from './map-ipc-bindings.ts';

test('opens only the project path resolved by the registered project service', async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const opened: string[] = [];
  registerMapIpcHandlers({
    handle(channel, listener) { handlers.set(channel, listener); },
    removeHandler() {},
  }, 'workflow-root', {
    project: {
      resolveProjectPath(_root: string, value?: string) { return `registered/${value}`; },
      listProjects() { return [{ path: 'sample' }]; },
    },
  }, {
    withProductLanguage: (_language, callback) => callback(),
    openProjectDirectory: async (projectPath) => { opened.push(projectPath); },
  });

  const result = await handlers.get('projects:openFolder')?.({}, 'sample');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(opened, ['registered/sample']);
  await assert.rejects(async () => handlers.get('projects:openFolder')?.({}, 'other'), /not registered/);
});
