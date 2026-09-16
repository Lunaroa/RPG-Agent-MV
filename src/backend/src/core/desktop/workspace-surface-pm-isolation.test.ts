import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, beforeEach, afterEach } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { withProjectMapMutation, writeProjectJson } from './project-file-service.ts';
import { validateWorkspaceSurfaceVersion } from './workspace-surface-version-service.ts';

describe('projectManagement surface isolation from map edits', () => {
  let root: string;
  let project: string;
  let dataDir: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-pm-isolation-'));
    project = path.join(root, 'projects', 'sample');
    dataDir = path.join(project, 'www', 'data');
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Sample' }]);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null]);
    writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
    writeJson(path.join(dataDir, 'Actors.json'), [null, { id: 1, name: 'Harold' }]);
    writeJson(path.join(dataDir, 'Map001.json'), { width: 20, height: 15, events: [null] });
    writeJson(path.join(dataDir, 'CommonEvents.json'), []);
    fs.mkdirSync(path.join(project, 'www', 'img', 'characters'), { recursive: true });
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'isolation.db'), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a pure map edit does not invalidate the projectManagement surface', () => {
    const before = validateWorkspaceSurfaceVersion(root, project, { surface: 'projectManagement' });
    withProjectMapMutation(root, project, 1, ({ mapFile }) => {
      const draft = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as { width: number };
      fs.writeFileSync(mapFile, JSON.stringify({ ...draft, width: draft.width + 1 }), 'utf8');
    });
    const after = validateWorkspaceSurfaceVersion(root, project, {
      surface: 'projectManagement',
      loadedVersion: before.version,
    });
    assert.equal(after.unchanged, true);
  });

  test('a saved database edit still invalidates the projectManagement surface', () => {
    const before = validateWorkspaceSurfaceVersion(root, project, { surface: 'projectManagement' });
    writeProjectJson(root, project, 'www/data/Actors.json', [null, { id: 1, name: 'Theo' }]);
    const after = validateWorkspaceSurfaceVersion(root, project, {
      surface: 'projectManagement',
      loadedVersion: before.version,
    });
    assert.equal(after.unchanged, false);
  });
});
