import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupMapPreviewIpcHandlers,
  mapPreviewFrameIpcPayload,
  MAP_PREVIEW_IPC_CHANNELS,
  registerMapPreviewIpcHandlers,
} from './map-preview-ipc-bindings.ts';

test('preserves the effective map revision when forwarding preview frames', () => {
  const data = new Uint8Array([1, 2, 3]);
  const payload = mapPreviewFrameIpcPayload({
    sessionId: 'preview-session',
    operationId: 3,
    mapId: 2,
    sequence: 4,
    generation: 2,
    kind: 'full',
    mime: 'image/png',
    mapPixelWidth: 960,
    mapPixelHeight: 720,
    x: 0,
    y: 0,
    width: 960,
    height: 720,
    outputWidth: 960,
    outputHeight: 720,
    mapRevision: 'map-revision-a',
    data,
  });

  assert.equal(payload.mapRevision, 'map-revision-a');
  assert.equal(payload.operationId, 3);
  assert.equal(payload.mapId, 2);
  assert.strictEqual(payload.data, data);
});

test('routes validated map preview commands to the isolated runtime service', async () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const removed: string[] = [];
  const calls: unknown[] = [];
  const ipc = {
    handle(channel: string, listener: (...args: any[]) => unknown) { handlers.set(channel, listener); },
    removeHandler(channel: string) { removed.push(channel); },
  };
  const result = { session: { sessionId: 'preview-session', status: 'running' } } as any;
  registerMapPreviewIpcHandlers(ipc, {
    async start(project, mapId, overrides) { calls.push(['start', project, mapId, overrides]); return result; },
    current() { return result; },
    async stop() { calls.push(['stop']); return result; },
    async suspend() { calls.push(['suspend']); return result; },
    async resume(request) { calls.push(['resume', request]); return result; },
    selectMap(mapId, overrides) { calls.push(['select-map', mapId, overrides]); return result; },
    panCamera(deltaX, deltaY) { calls.push(['pan', deltaX, deltaY]); return result; },
    setSwitch(id, value) { calls.push(['switch', id, value]); return result; },
    setVariable(id, value) { calls.push(['variable', id, value]); return result; },
    setSelfSwitch(mapId, eventId, letter, value) { calls.push(['self-switch', mapId, eventId, letter, value]); return result; },
    evaluate(requestId, code) { calls.push(['evaluate', requestId, code]); return result; },
    resetOverrides() { calls.push(['reset']); return result; },
    replaceOverrides(overrides) { calls.push(['replace', overrides]); return result; },
    ackFrame(sequence) { calls.push(['ack', sequence]); return result; },
    handleRuntimeEvent(event) { calls.push(['runtime-event', event]); return result; },
    setView(view) { calls.push(['view', view]); return result; },
  }, {
    getLastProject: () => 'projects/sample',
    resolveProject: (project) => `resolved/${project}`,
  });

  await handlers.get('mapPreview:start')?.({}, { mapId: 2, overrides: { switches: { '7': true }, variables: { '8': 'text' }, selfSwitches: { '2,3,A': true } } });
  await handlers.get('mapPreview:suspend')?.({});
  await handlers.get('mapPreview:resume')?.({}, { mapId: 2, mapRevision: 'a'.repeat(64), forceReload: true, overrides: { switches: { '7': true }, variables: {}, selfSwitches: {} } });
  handlers.get('mapPreview:selectMap')?.({}, { mapId: 3, overrides: { switches: {}, variables: {}, selfSwitches: {} } });
  handlers.get('mapPreview:panCamera')?.({}, { deltaX: 12.5, deltaY: -4 });
  handlers.get('mapPreview:setSwitch')?.({}, { id: 7, value: true });
  handlers.get('mapPreview:setVariable')?.({}, { id: 8, value: 42 });
  handlers.get('mapPreview:setSelfSwitch')?.({}, { mapId: 2, eventId: 3, letter: 'A', value: true });
  handlers.get('mapPreview:evaluate')?.({}, { requestId: 'request-1', code: '$gameMap.mapId()' });
  handlers.get('mapPreview:resetOverrides')?.({});
  handlers.get('mapPreview:replaceOverrides')?.({}, { switches: { '9': false }, variables: { '10': -2 }, selfSwitches: {} });
  handlers.get('mapPreview:ackFrame')?.({}, { sequence: 4 });
  handlers.get('mapPreview:runtimeEvent')?.({}, {
    kind: 'rpg-agent-map-preview',
    sessionId: 'preview-session',
    channelToken: 'channel-token',
    operationId: 2,
    mapId: 3,
    mapRevision: 'revision',
    phase: 'fps',
    fps: 60,
  });
  handlers.get('mapPreview:setView')?.({}, { x: 10, y: 20, width: 816, height: 624, scale: 1.5 });

  assert.deepEqual(calls, [
    ['start', 'resolved/projects/sample', 2, { switches: { '7': true }, variables: { '8': 'text' }, selfSwitches: { '2,3,A': true } }],
    ['suspend'],
    ['resume', { project: 'resolved/projects/sample', mapId: 2, mapRevision: 'a'.repeat(64), forceReload: true, overrides: { switches: { '7': true }, variables: {}, selfSwitches: {} } }],
    ['select-map', 3, { switches: {}, variables: {}, selfSwitches: {} }],
    ['pan', 12.5, -4],
    ['switch', 7, true],
    ['variable', 8, 42],
    ['self-switch', 2, 3, 'A', true],
    ['evaluate', 'request-1', '$gameMap.mapId()'],
    ['reset'],
    ['replace', { switches: { '9': false }, variables: { '10': -2 }, selfSwitches: {} }],
    ['ack', 4],
    ['runtime-event', {
      kind: 'rpg-agent-map-preview',
      sessionId: 'preview-session',
      channelToken: 'channel-token',
      operationId: 2,
      mapId: 3,
      mapRevision: 'revision',
      phase: 'fps',
      fps: 60,
    }],
    ['view', { x: 10, y: 20, width: 816, height: 624, scale: 1.5 }],
  ]);
  assert.throws(() => handlers.get('mapPreview:setVariable')?.({}, { id: 1, value: Number.NaN }), /finite number/);
  await assert.rejects(
    async () => handlers.get('mapPreview:resume')?.({}, { mapId: 1, forceReload: 'yes' }),
    /forceReload must be boolean/,
  );
  await assert.rejects(
    async () => handlers.get('mapPreview:start')?.({}, { mapId: 1, extra: true }),
    /does not accept field/,
  );
  assert.throws(
    () => handlers.get('mapPreview:replaceOverrides')?.({}, { switches: { invalid: true }, variables: {}, selfSwitches: {} }),
    /positive integer/,
  );
  assert.throws(
    () => handlers.get('mapPreview:setSelfSwitch')?.({}, { mapId: 2, eventId: 3, letter: 'E', value: true }),
    /must be A, B, C, or D/,
  );
  cleanupMapPreviewIpcHandlers(ipc);
  assert.deepEqual(removed, [...MAP_PREVIEW_IPC_CHANNELS]);
});
