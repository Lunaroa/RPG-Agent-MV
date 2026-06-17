import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pruneRuntimeLegacyArtifacts } from './runtime-cleanup.ts';
import { pruneExpiredSessionDirectories } from './session-retention.ts';

function touch(filePath: string, mtime: Date): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'x');
  fs.utimesSync(filePath, mtime, mtime);
}

test('pruneRuntimeLegacyArtifacts removes legacy JSON paths but keeps api-profiles and sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-runtime-cleanup-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'rmmv.db'), 'sqlite');

  touch(path.join(root, 'runtime', 'console-settings.json'), new Date());
  touch(path.join(root, 'runtime', 'providers', 'providers.json'), new Date());
  touch(path.join(root, 'runtime', 'map-selection', 'map-selection.json'), new Date());
  touch(path.join(root, 'runtime', 'sessions.json'), new Date());
  touch(path.join(root, 'runtime', 'rmmv.db.bak'), new Date());
  touch(path.join(root, 'config', 'api-profiles', 'profiles.yaml'), new Date());
  touch(path.join(root, 'config', 'provider-presets', 'preset.json'), new Date());
  touch(path.join(root, 'runtime', 'agent-console-staging', 'manifest.json'), new Date());
  touch(path.join(root, 'runtime', 'secrets', 'credentials.json'), new Date());

  const now = new Date('2026-06-05T12:00:00.000Z');
  writeSession(root, 'recent', {
    id: 'recent',
    createdAt: '2026-06-01T00:00:00.000Z',
    finishedAt: '2026-06-01T01:00:00.000Z',
  });
  writeSession(root, 'old-finished', {
    id: 'old-finished',
    createdAt: '2026-04-01T00:00:00.000Z',
    finishedAt: '2026-04-02T00:00:00.000Z',
  });

  const cleanup = pruneRuntimeLegacyArtifacts(root, { now });
  const removed = new Set(cleanup.removed);

  assert.ok(removed.has('runtime/console-settings.json'));
  assert.ok(removed.has('runtime/providers/providers.json'));
  assert.ok(removed.has('runtime/map-selection'));
  assert.ok(removed.has('runtime/sessions.json'));
  assert.ok(removed.has('runtime/rmmv.db.bak'));
  assert.ok(fs.existsSync(path.join(root, 'config', 'api-profiles', 'profiles.yaml')));
  assert.ok(fs.existsSync(path.join(root, 'config', 'provider-presets', 'preset.json')));
  assert.ok(fs.existsSync(path.join(root, 'runtime', 'agent-console-staging', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(root, 'runtime', 'secrets', 'credentials.json')));

  const sessionPrune = pruneExpiredSessionDirectories(root, { retentionDays: 30, now });
  assert.deepEqual(new Set(sessionPrune.removed), new Set(['old-finished']));
  assert.ok(fs.existsSync(path.join(root, 'runtime', 'sessions', 'recent')));
});

test('pruneRuntimeLegacyArtifacts skips runtime rmmv.db when data/rmmv.db is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-runtime-cleanup-db-'));
  const legacyDb = path.join(root, 'runtime', 'rmmv.db');
  fs.mkdirSync(path.dirname(legacyDb), { recursive: true });
  fs.writeFileSync(legacyDb, 'legacy');

  const result = pruneRuntimeLegacyArtifacts(root);
  assert.ok(fs.existsSync(legacyDb));
  assert.ok(result.skipped.includes('runtime/rmmv.db'));
});

function writeSession(
  root: string,
  id: string,
  meta: Record<string, unknown>,
): void {
  const outDir = path.join(root, 'runtime', 'sessions', id, 'agent-console');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'session-meta.json'), JSON.stringify(meta, null, 2));
}
