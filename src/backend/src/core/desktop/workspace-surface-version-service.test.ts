import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { writeStagedProjectJson } from './staging-service.ts';
import { validateWorkspaceSurfaceVersion } from './workspace-surface-version-service.ts';

describe('workspace surface metadata versions', () => {
  let root: string;
  let project: string;
  let dataDir: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-workspace-surface-'));
    project = path.join(root, 'projects', 'sample');
    dataDir = path.join(project, 'www', 'data');
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Sample Map' }]);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null]);
    writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
    writeJson(path.join(dataDir, 'Actors.json'), [null]);
    writeJson(path.join(dataDir, 'Map001.json'), { width: 20, height: 15, events: [null] });
    fs.mkdirSync(path.join(project, 'www', 'img', 'characters'), { recursive: true });
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('returns a stable typed version when metadata is unchanged', () => {
    const first = validateWorkspaceSurfaceVersion(root, project, { surface: 'editor', mapId: 1 });
    const second = validateWorkspaceSurfaceVersion(root, project, {
      surface: 'editor',
      mapId: 1,
      loadedVersion: first.version,
    });

    assert.equal(first.version.length, 24);
    assert.equal(second.unchanged, true);
    assert.equal(second.project, fs.realpathSync.native(project));
  });

  test('invalidates only surfaces whose dependency metadata changed', () => {
    const editor = validateWorkspaceSurfaceVersion(root, project, { surface: 'editor', mapId: 1 });
    const management = validateWorkspaceSurfaceVersion(root, project, { surface: 'projectManagement' });
    const actorsFile = path.join(dataDir, 'Actors.json');
    fs.appendFileSync(actorsFile, ' ', { encoding: 'utf8' });

    assert.equal(validateWorkspaceSurfaceVersion(root, project, {
      surface: 'editor', mapId: 1, loadedVersion: editor.version,
    }).unchanged, true);
    assert.equal(validateWorkspaceSurfaceVersion(root, project, {
      surface: 'projectManagement', loadedVersion: management.version,
    }).unchanged, false);
  });

  test('includes staged metadata without reading project JSON content', () => {
    const first = validateWorkspaceSurfaceVersion(root, project, { surface: 'mapOverview' });
    writeStagedProjectJson(root, project, 'www/data/Map001.json', { width: 21, height: 15, events: [null] });
    const second = validateWorkspaceSurfaceVersion(root, project, {
      surface: 'mapOverview',
      loadedVersion: first.version,
    });

    assert.equal(second.unchanged, false);
  });

  test('rejects unrestricted surface and map identifiers', () => {
    assert.throws(() => validateWorkspaceSurfaceVersion(root, project, {
      surface: 'unknown' as 'editor',
    }), /Unknown workspace surface/);
    assert.throws(() => validateWorkspaceSurfaceVersion(root, project, {
      surface: 'editor', mapId: -1,
    }), /positive integer/);
  });
});
