import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bootstrapDatabase } from './bootstrap.ts';
import { closeDatabase, getDatabase } from './pool.ts';

const bootstrapOptions = { skipWorkspaceLegacyCleanup: true, skipRuntimeLegacyCleanup: true };
const projectHash = 'abcdef1234567890';

async function createLegacyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-staging-upgrade-'));
  try {
    await bootstrapDatabase(root, bootstrapOptions);
    const db = getDatabase();
    db.exec(`
      DELETE FROM migrations WHERE version = 14;
      CREATE TABLE staging_manifests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        manifest TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_staging_manifests_project ON staging_manifests(project_id);
    `);
    const project = path.join(root, 'project');
    const source = path.join(project, 'data', 'System.json');
    const draft = path.join(root, 'runtime', 'agent-console-staging', projectHash, 'draft', 'data', 'System.json');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'original', 'utf8');
    return {
      root,
      project,
      source,
      draft,
      db,
      insertManifest: (files: Record<string, unknown>, maps: Record<string, unknown> = {}, operations: Record<string, unknown> = {}) => {
        const manifest = { version: 4, project, projectHash, files, maps, operations };
        db.prepare('INSERT INTO staging_manifests (project_id, manifest) VALUES (?, ?)')
          .run(projectHash, JSON.stringify(manifest));
      },
      cleanup: () => {
        closeDatabase();
        assert.equal(path.dirname(root), os.tmpdir());
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    closeDatabase();
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test('upgrade stops before removing a 0.7.1 pending file and allows a retry after review', async () => {
  const fixture = await createLegacyFixture();
  try {
    fs.mkdirSync(path.dirname(fixture.draft), { recursive: true });
    fs.writeFileSync(fixture.draft, 'pending edit', 'utf8');
    fixture.insertManifest({
      'data/System.json': {
        relativePath: 'data/System.json',
        sourceExisted: true,
        baseHash: 'base-hash',
        baseMtimeMs: null,
        draftHash: 'draft-hash',
        updatedAt: new Date().toISOString(),
      },
    });

    await assert.rejects(bootstrapDatabase(fixture.root, bootstrapOptions), /review and apply or discard/);
    assert.equal((fixture.db.prepare('SELECT MAX(version) AS version FROM migrations').get() as { version: number }).version, 13);
    assert.equal((fixture.db.prepare('SELECT COUNT(*) AS count FROM staging_manifests').get() as { count: number }).count, 1);
    assert.equal(fs.readFileSync(fixture.source, 'utf8'), 'original');
    assert.equal(fs.readFileSync(fixture.draft, 'utf8'), 'pending edit');

    fixture.db.exec('DELETE FROM staging_manifests');
    fs.rmSync(fixture.draft);
    await bootstrapDatabase(fixture.root, bootstrapOptions);
    assert.equal((fixture.db.prepare('SELECT MAX(version) AS version FROM migrations').get() as { version: number }).version, 14);
    assert.equal(fixture.db.prepare("SELECT name FROM sqlite_master WHERE name = 'staging_manifests'").get(), undefined);
  } finally {
    fixture.cleanup();
  }
});
test('upgrade preserves deletion-only staging and malformed manifests for manual recovery', async () => {
  const fixture = await createLegacyFixture();
  try {
    fixture.insertManifest({
      'data/System.json': { relativePath: 'data/System.json', delete: true },
    });
    fixture.db.prepare('INSERT INTO staging_manifests (project_id, manifest) VALUES (?, ?)')
      .run(projectHash, '{invalid json');

    await assert.rejects(bootstrapDatabase(fixture.root, bootstrapOptions), /2 legacy project staging manifest/);
    assert.equal((fixture.db.prepare('SELECT COUNT(*) AS count FROM staging_manifests').get() as { count: number }).count, 2);
    assert.equal(fs.readFileSync(fixture.source, 'utf8'), 'original');
  } finally {
    fixture.cleanup();
  }
});

test('upgrade removes only a strictly empty v4 manifest', async () => {
  const fixture = await createLegacyFixture();
  try {
    fixture.insertManifest({});
    await bootstrapDatabase(fixture.root, bootstrapOptions);
    assert.equal((fixture.db.prepare('SELECT MAX(version) AS version FROM migrations').get() as { version: number }).version, 14);
    assert.equal(fixture.db.prepare("SELECT name FROM sqlite_master WHERE name = 'staging_manifests'").get(), undefined);
  } finally {
    fixture.cleanup();
  }
});
