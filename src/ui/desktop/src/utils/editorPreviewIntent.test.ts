import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapPreviewFrame, MapPreviewSession } from '../api/client';
import { previewFrameMatchesIntent, previewSessionMatchesIntent, type EditorPreviewIntent } from './editorPreviewIntent';

const intent: EditorPreviewIntent = { active: true, project: 'projects/sample', mapId: 2, mapRevision: 'revision-2' };

const session = {
  sessionId: 'session-1',
  operationId: 2,
  status: 'running',
  engine: 'rpg-maker-mz',
  mapId: 2,
  viewportWidth: 816,
  viewportHeight: 624,
  mapRevision: 'revision-2',
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies MapPreviewSession;

const frame = {
  sessionId: 'session-1',
  operationId: 2,
  mapId: 2,
  sequence: 1,
  generation: 1,
  mapRevision: 'revision-2',
  kind: 'full',
  mime: 'image/png',
  mapPixelWidth: 816,
  mapPixelHeight: 624,
  x: 0,
  y: 0,
  width: 816,
  height: 624,
  outputWidth: 816,
  outputHeight: 624,
  data: new Uint8Array(),
} satisfies MapPreviewFrame;

test('preview results only match the current active map and revision', () => {
  assert.equal(previewSessionMatchesIntent(session, intent), true);
  assert.equal(previewFrameMatchesIntent(frame, intent), true);
  assert.equal(previewSessionMatchesIntent({ ...session, mapId: 3 }, intent), false);
  assert.equal(previewFrameMatchesIntent({ ...frame, mapRevision: 'stale' }, intent), false);
  assert.equal(previewSessionMatchesIntent(session, { active: false, project: intent.project }), false);
});

test('a resource failure from another map does not match the active preview intent', () => {
  const failed = {
    ...session,
    status: 'failed',
    mapId: 4,
    mapRevision: 'revision-4',
    failureCode: 'map-render-failed',
  } satisfies MapPreviewSession;

  assert.equal(previewSessionMatchesIntent(failed, intent), false);
});
