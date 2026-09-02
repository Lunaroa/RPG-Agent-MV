import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { getProjectFileForRead, getProjectStagingStatus } from './staging-service.ts';
import { ensureManagedUnlimitedTileLayers } from './plugin-management-service.ts';
import { UNLIMITED_TILE_LAYERS_PLUGIN_NAME } from './unlimited-tile-layers-runtime-plugin.ts';

describe('managed unlimited tile layers runtime', { concurrency: false }, () => {
  let root = '';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-unlimited-tile-layers-'));
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'runtime-test.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const engine of ['MV', 'MZ'] as const) {
    test(`stages the ${engine} plugin and plugins.js as one transaction, idempotently`, () => {
      const project = createProject(root, engine);
      const prefix = engine === 'MV' ? 'www/' : '';
      const result = ensureManagedUnlimitedTileLayers(root, project);
      assert.equal(result.engine, engine === 'MV' ? 'rpg-maker-mv' : 'rpg-maker-mz');
      assert.deepEqual(
        getProjectStagingStatus(root, project).files.map((file) => file.relativePath).sort(),
        [`${prefix}js/plugins.js`, `${prefix}js/plugins/${UNLIMITED_TILE_LAYERS_PLUGIN_NAME}.js`].sort(),
      );
      const plugin = fs.readFileSync(getProjectFileForRead(root, project, result.pluginRelativePath)!, 'utf8');
      assert.match(plugin, new RegExp(`@target ${engine}`));

      const again = ensureManagedUnlimitedTileLayers(root, project);
      assert.equal(again.backupRelativePath, null);
      assert.equal(
        getProjectStagingStatus(root, project).files.length,
        2,
        'a managed install must not stage additional mutations',
      );
    });
  }

  test('requires explicit backup-and-replace for an unknown same-name plugin', () => {
    const project = createProject(root, 'MV');
    const pluginPath = path.join(project, 'www', 'js', 'plugins', `${UNLIMITED_TILE_LAYERS_PLUGIN_NAME}.js`);
    fs.writeFileSync(pluginPath, '/* user modified */', 'utf8');
    assert.throws(() => ensureManagedUnlimitedTileLayers(root, project), /MANAGED_PLUGIN_CONFLICT/);
    const result = ensureManagedUnlimitedTileLayers(root, project, { backupAndReplaceModified: true });
    assert.equal(result.backupRelativePath, `www/js/plugins/${UNLIMITED_TILE_LAYERS_PLUGIN_NAME}.rpg-agent-backup.js`);
    assert.equal(
      fs.readFileSync(getProjectFileForRead(root, project, result.backupRelativePath!)!, 'utf8'),
      '/* user modified */',
    );
  });

  test('fails fast for damaged plugin configuration', () => {
    const project = createProject(root, 'MV');
    fs.writeFileSync(path.join(project, 'www', 'js', 'plugins.js'), 'var $plugins = broken;', 'utf8');
    assert.throws(() => ensureManagedUnlimitedTileLayers(root, project), /plugins\.js|parse/i);
  });

  test('rejects duplicate configured entries for the managed plugin', () => {
    const project = createProject(root, 'MV');
    const entry = JSON.stringify({ name: UNLIMITED_TILE_LAYERS_PLUGIN_NAME, status: true, parameters: {} });
    fs.writeFileSync(path.join(project, 'www', 'js', 'plugins.js'), `var $plugins =\n[${entry},${entry}];\n`, 'utf8');
    assert.throws(() => ensureManagedUnlimitedTileLayers(root, project), /UNLIMITED_TILE_LAYERS_PLUGIN_DUPLICATE/);
  });
});

function createProject(root: string, engine: 'MV' | 'MZ'): string {
  const project = path.join(root, 'projects', engine.toLowerCase());
  const resourceRoot = engine === 'MV' ? path.join(project, 'www') : project;
  const dataDir = path.join(resourceRoot, 'data');
  const jsDir = path.join(resourceRoot, 'js');
  fs.mkdirSync(path.join(jsDir, 'plugins'), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(project, engine === 'MV' ? 'Game.rpgproject' : 'game.rmmzproject'), engine === 'MV' ? 'RPGMV 1.6.2' : 'RPGMZ 1.10.0', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'System.json'), JSON.stringify({
    gameTitle: 'Sample',
    switches: [null],
    variables: [null],
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, uiAreaWidth: 816, screenHeight: 624, uiAreaHeight: 624 },
  }), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Sample' }]), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({ width: 1, height: 1, tilesetId: 1, data: Array(6).fill(0), events: [null] }), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'Tilesets.json'), JSON.stringify([null, { id: 1, tilesetNames: Array(9).fill(''), flags: [] }]), 'utf8');
  fs.writeFileSync(path.join(jsDir, 'plugins.js'), 'var $plugins =\n[];\n', 'utf8');
  for (const relative of ['index.html', 'package.json']) {
    fs.writeFileSync(path.join(resourceRoot, relative), relative === 'package.json' ? '{}' : '', 'utf8');
  }
  if (engine === 'MZ') {
    for (const relative of [
      'js/rmmz_managers.js', 'js/rmmz_objects.js', 'js/rmmz_scenes.js',
      'js/rmmz_sprites.js', 'js/rmmz_windows.js', 'js/main.js',
    ]) {
      fs.writeFileSync(path.join(project, ...relative.split('/')), '', 'utf8');
    }
    fs.writeFileSync(
      path.join(project, 'js', 'rmmz_core.js'),
      'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n',
      'utf8',
    );
  } else {
    for (const relative of ['js/rpg_core.js', 'js/rpg_managers.js', 'js/rpg_objects.js', 'js/rpg_scenes.js', 'js/rpg_sprites.js', 'js/rpg_windows.js', 'js/main.js']) {
      fs.writeFileSync(path.join(resourceRoot, ...relative.split('/')), '', 'utf8');
    }
  }
  return project;
}
