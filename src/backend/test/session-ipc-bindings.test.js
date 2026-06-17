import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  cleanupSessionIpcHandlers,
  registerSessionIpcHandlers,
  SESSION_IPC_CHANNELS,
} from '../../ui/desktop/electron/session-ipc-bindings.ts';

describe('session IPC bindings', () => {
  test('registers runtime channels and replays buffered events to the subscribing renderer', async () => {
    const handlers = new Map();
    const sent = [];
    const subscriptions = [];
    const createInputs = [];
    const previewInputs = [];
    const derivedStateCalls = [];
    const ipc = {
      handle(channel, listener) { handlers.set(channel, listener); },
      removeHandler(channel) { handlers.delete(channel); },
    };
    const runtime = {
      getBootstrap() { return { profiles: {} }; },
      list() { return []; },
      get(id) { return id === 'created' ? { id } : null; },
      history() { return []; },
      async create(input) {
        createInputs.push(input);
        return { id: 'created', status: 'starting' };
      },
      async preview(input) {
        previewInputs.push(input);
        return {};
      },
      stop(id) { return { id, status: 'stopped' }; },
      delete() { return true; },
      saveChatLog() { return true; },
      submitAskResult() { return { ok: true }; },
      getPlan(sessionId) {
        derivedStateCalls.push(['getPlan', sessionId]);
        return { sessionId, mode: 'idle', title: '计划', planMarkdown: '' };
      },
      listSubagents(sessionId) {
        derivedStateCalls.push(['listSubagents', sessionId]);
        return { sessionId, items: [] };
      },
      stopSubagent(sessionId, taskId) {
        derivedStateCalls.push(['stopSubagent', sessionId, taskId]);
        return { ok: true, requestId: 'req-1' };
      },
      subscribe(sessionId, subscriber, lastSequence) {
        subscriptions.push([sessionId, subscriber.id, lastSequence]);
        subscriber.write({ type: 'status', status: 'starting', sequence: 1 });
        return [{ sequence: 1 }];
      },
      unsubscribe(sessionId, subscriberId) { subscriptions.push(['unsubscribe', sessionId, subscriberId]); },
    };
    const event = {
      sender: {
        id: 17,
        isDestroyed: () => false,
        send: (channel, payload) => sent.push([channel, payload]),
      },
    };

    const revealed = [];
    registerSessionIpcHandlers(ipc, runtime, {
      async revealArtifacts(sessionId) {
        revealed.push(sessionId);
        return { success: true };
      },
    });
    assert.deepEqual([...handlers.keys()].sort(), [...SESSION_IPC_CHANNELS].sort());
    assert.deepEqual(await handlers.get('sessions:create')(event, {
      intent: 'normal',
      completeConversationHistory: true,
    }), { id: 'created', status: 'starting' });
    await handlers.get('sessions:preview')(event, {
      intent: 'normal',
      completeConversationHistory: true,
    });
    assert.deepEqual(createInputs, [{ intent: 'normal' }]);
    assert.deepEqual(previewInputs, [{ intent: 'normal' }]);
    assert.deepEqual(await handlers.get('sessions:subscribe')(event, 'created', 0), { sessionId: 'created', replayed: 1 });
    assert.equal(sent[0][0], 'sessions:event');
    assert.equal(sent[0][1].event.status, 'starting');
    assert.equal((await handlers.get('sessions:getPlan')(event, 'created')).mode, 'idle');
    assert.deepEqual(await handlers.get('sessions:listSubagents')(event, 'created'), { sessionId: 'created', items: [] });
    assert.deepEqual(await handlers.get('sessions:stopSubagent')(event, 'created', 'agent-1'), { ok: true, requestId: 'req-1' });
    assert.deepEqual(derivedStateCalls, [
      ['getPlan', 'created'],
      ['listSubagents', 'created'],
      ['stopSubagent', 'created', 'agent-1'],
    ]);
    assert.deepEqual(await handlers.get('sessions:revealArtifacts')(event, 'created'), { success: true });
    assert.deepEqual(revealed, ['created']);
    assert.throws(() => handlers.get('sessions:revealArtifacts')(event, 'missing'), /session not found/);
    assert.deepEqual(revealed, ['created']);

    await handlers.get('sessions:unsubscribe')(event, 'created');
    assert.deepEqual(subscriptions.at(-1), ['unsubscribe', 'created', '17']);
    cleanupSessionIpcHandlers(ipc);
    assert.equal(handlers.size, 0);
  });
});
