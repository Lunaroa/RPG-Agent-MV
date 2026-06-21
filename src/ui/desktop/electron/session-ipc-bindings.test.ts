import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { registerSessionIpcHandlers } from './session-ipc-bindings.ts';

describe('session IPC binding payload filter', () => {
  test('allows productLanguage while filtering internal fields for create and preview', async () => {
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
      saveChatLog() { return true; },
      submitAskResult() { return {}; },
      listTasks() { return []; },
      updateTask() { return {}; },
      getPlan() { return {}; },
      listSubagents() { return []; },
      stopSubagent() { return {}; },
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
      systemPrompt: 'should be stripped',
      completeConversationHistory: true,
      readOnlyTools: true,
    };

    await handlers.get('sessions:create')?.(event, payload);
    await handlers.get('sessions:preview')?.(event, payload);

    assert.deepEqual(createInputs, [{ intent: 'normal', productLanguage: 'en-US' }]);
    assert.deepEqual(previewInputs, [{ intent: 'normal', productLanguage: 'en-US' }]);

    for (const input of [...createInputs, ...previewInputs]) {
      assert.equal('systemPrompt' in input, false);
      assert.equal('completeConversationHistory' in input, false);
      assert.equal('readOnlyTools' in input, false);
    }
  });
});
