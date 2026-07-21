import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { registerSessionIpcHandlers } from './session-ipc-bindings.ts';

describe('session IPC binding payload filter', () => {
  test('allows public image input while filtering internal fields for create and preview', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const createInputs: Array<Record<string, unknown>> = [];
    const previewInputs: Array<Record<string, unknown>> = [];

    const ipc = {
      handle(channel: string, listener: (...args: unknown[]) => unknown) {
        handlers.set(channel, listener);
      },
      removeHandler() {},
    };

    const runtime = {
      getBootstrap() { return {}; },
      list() { return []; },
      get() { return { id: 'session-id' }; },
      history() { return []; },
      async create(input: Record<string, unknown>) {
        createInputs.push(input);
        return {};
      },
      async preview(input: Record<string, unknown>) {
        previewInputs.push(input);
        return {};
      },
      stop() { return { id: 'session-id' }; },
      delete() { return true; },
      deleteMany() { return { deletedIds: [], protectedIds: [], missingIds: [], failedIds: [] }; },
      saveChatLog() { return true; },
      submitAskResult() { return {}; },
      listTasks() { return []; },
      updateTask() { return {}; },
      getPlan() { return {}; },
      listSubagents() { return []; },
      stopSubagent() { return {}; },
      listSlashCommands() { return []; },
      async getContextUsage() { return { ok: false, message: 'n/a', messageKey: 'slash.tokens.noSession' }; },
      async slashCommand() {
        return { ok: false, display: 'composer_hint', message: 'n/a' };
      },
      subscribe() { return [{ sequence: 0 }]; },
      unsubscribe() {},
    };

    const event = {
      sender: {
        id: 1,
        isDestroyed: () => false,
        send: () => {},
      },
    };

    registerSessionIpcHandlers(ipc, runtime);

    const payload = {
      intent: 'normal',
      productLanguage: 'en-US',
      imageAttachments: [{ filename: 'pasted-image.png', mime: 'image/png', sizeBytes: 8, dataBase64: 'data' }],
      requiresImageInput: true,
      systemPrompt: 'should be stripped',
      completeConversationHistory: true,
      readOnlyTools: true,
    };

    await handlers.get('sessions:create')?.(event, payload);
    await handlers.get('sessions:preview')?.(event, payload);

    const expected = {
      intent: 'normal',
      productLanguage: 'en-US',
      imageAttachments: payload.imageAttachments,
      requiresImageInput: true,
    };
    assert.deepEqual(createInputs, [expected]);
    assert.deepEqual(previewInputs, [expected]);

    for (const input of [...createInputs, ...previewInputs]) {
      assert.equal('systemPrompt' in input, false);
      assert.equal('completeConversationHistory' in input, false);
      assert.equal('readOnlyTools' in input, false);
    }
  });

  test('normalizes one batch delete request before invoking the runtime', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const requests: string[][] = [];
    const ipc = {
      handle(channel: string, listener: (...args: unknown[]) => unknown) { handlers.set(channel, listener); },
      removeHandler() {},
    };
    const runtime = {
      getBootstrap() { return {}; }, list() { return []; }, get() { return {}; }, history() { return []; },
      async create() { return {}; }, async preview() { return {}; }, stop() { return {}; }, delete() { return true; },
      deleteMany(ids: string[]) {
        requests.push(ids);
        return { deletedIds: ids, protectedIds: [], missingIds: [], failedIds: [] };
      },
      saveChatLog() { return true; }, submitAskResult() { return {}; }, listTasks() { return []; }, updateTask() { return {}; },
      getPlan() { return {}; }, listSubagents() { return []; }, stopSubagent() { return {}; }, listSlashCommands() { return []; },
      async getContextUsage() { return { ok: false, message: 'n/a', messageKey: 'slash.tokens.noSession' }; },
      async slashCommand() { return { ok: false, display: 'composer_hint', message: 'n/a' }; },
      subscribe() { return []; }, unsubscribe() {},
    };

    registerSessionIpcHandlers(ipc, runtime);
    const result = await handlers.get('sessions:deleteMany')?.({}, [' root ', 'turn', 'root']);

    assert.deepEqual(requests, [['root', 'turn']]);
    assert.deepEqual(result, { deletedIds: ['root', 'turn'], protectedIds: [], missingIds: [], failedIds: [] });
    await assert.rejects(async () => handlers.get('sessions:deleteMany')?.({}, []));
  });
});
