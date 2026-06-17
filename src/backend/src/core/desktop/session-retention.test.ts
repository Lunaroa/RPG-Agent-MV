import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pruneExpiredSessionDirectories } from './session-retention.ts';

function writeSession(
  root: string,
  id: string,
  meta: Record<string, unknown>,
): void {
  const outDir = path.join(root, 'runtime', 'sessions', id, 'agent-console');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'session-meta.json'), JSON.stringify(meta, null, 2));
}

test('pruneExpiredSessionDirectories removes old finished sessions and keeps recent ones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-session-retention-'));
  const now = new Date('2026-06-05T12:00:00.000Z');

  writeSession(root, 'old-finished', {
    id: 'old-finished',
    createdAt: '2026-04-01T00:00:00.000Z',
    finishedAt: '2026-04-02T00:00:00.000Z',
  });
  writeSession(root, 'recent', {
    id: 'recent',
    createdAt: '2026-06-01T00:00:00.000Z',
    finishedAt: '2026-06-01T01:00:00.000Z',
  });
  writeSession(root, 'old-created', {
    id: 'old-created',
    createdAt: '2026-04-10T00:00:00.000Z',
  });

  const result = pruneExpiredSessionDirectories(root, { retentionDays: 30, now });

  assert.equal(result.scanned, 3);
  assert.deepEqual(new Set(result.removed), new Set(['old-finished', 'old-created']));
  assert.deepEqual(result.skipped, ['recent']);
  assert.ok(!fs.existsSync(path.join(root, 'runtime', 'sessions', 'old-finished')));
  assert.ok(!fs.existsSync(path.join(root, 'runtime', 'sessions', 'old-created')));
  assert.ok(fs.existsSync(path.join(root, 'runtime', 'sessions', 'recent')));
});
