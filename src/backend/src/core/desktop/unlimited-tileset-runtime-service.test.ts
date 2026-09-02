import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { getProjectFileForRead, getProjectStagingStatus } from './staging-service.ts';
import {
  inspectManagedUnlimitedTilesets,
  setManagedUnlimitedTilesetsEnabled,
} from './plugin-management-service.ts';
import { postMapTiles } from './map-service.ts';
import { buildUnlimitedTilesetsRuntimePlugin } from './unlimited-tileset-runtime-plugin.ts';

describe('managed unlimited tilesets runtime', { concurrency: false }, () => {
  let root = '';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-unlimited-tilesets-'));
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
    test(`stages the ${engine} plugin and plugins.js as one transaction`, () => {
      const project = createProject(root, engine);
      const result = setManagedUnlimitedTilesetsEnabled(root, project, true);
      const staging = getProjectStagingStatus(root, project);
      assert.equal(result.engine, engine === 'MV' ? 'rpg-maker-mv' : 'rpg-maker-mz');
      assert.deepEqual(
        staging.files.map((file) => file.relativePath).sort(),
        [`${engine === 'MV' ? 'www/' : ''}js/plugins.js`, `${engine === 'MV' ? 'www/' : ''}js/plugins/RPGAgentUnlimitedTilesets.js`].sort(),
      );
      assert.equal(inspectManagedUnlimitedTilesets(root, project).valid, true);
      const plugin = fs.readFileSync(getProjectFileForRead(root, project, result.pluginRelativePath)!, 'utf8');
      assert.match(plugin, new RegExp(`@target ${engine}`));
      assert.match(plugin, /A1.*A2.*A3.*A4.*A5.*normal/s);
    });
  }

  test('requires explicit backup-and-replace for an unknown same-name plugin', () => {
    const project = createProject(root, 'MV');
    const pluginPath = path.join(project, 'www', 'js', 'plugins', 'RPGAgentUnlimitedTilesets.js');
    fs.writeFileSync(pluginPath, '/* user modified */', 'utf8');
    assert.throws(() => setManagedUnlimitedTilesetsEnabled(root, project, true), /MANAGED_PLUGIN_CONFLICT/);
    const result = setManagedUnlimitedTilesetsEnabled(root, project, true, { backupAndReplaceModified: true });
    assert.equal(result.backupRelativePath, 'www/js/plugins/RPGAgentUnlimitedTilesets.rpg-agent-backup.js');
    assert.equal(
      fs.readFileSync(getProjectFileForRead(root, project, result.backupRelativePath!)!, 'utf8'),
      '/* user modified */',
    );
  });

  test('fails fast for damaged plugin configuration and unverified engine interfaces', () => {
    const damaged = createProject(root, 'MV');
    fs.writeFileSync(path.join(damaged, 'www', 'js', 'plugins.js'), 'var $plugins = broken;', 'utf8');
    assert.throws(() => setManagedUnlimitedTilesetsEnabled(root, damaged, true), /plugins\.js|parse/i);

    const unsupported = createProject(root, 'MV');
    fs.writeFileSync(path.join(unsupported, 'www', 'js', 'rpg_core.js'), 'Tilemap.prototype._drawTile = function() {};', 'utf8');
    assert.throws(
      () => setManagedUnlimitedTilesetsEnabled(root, unsupported, true),
      /UNLIMITED_TILESETS_RUNTIME_INTERFACE_UNSUPPORTED/,
    );
  });

  test('blocks disable while sheets or map references remain and removes only managed content', () => {
    const project = createProject(root, 'MV');
    const enabled = setManagedUnlimitedTilesetsEnabled(root, project, true);
    const dataDir = path.join(project, 'www', 'data');
    fs.writeFileSync(path.join(dataDir, 'Tilesets.json'), JSON.stringify([null, {
      id: 1, tilesetNames: [...Array(9).fill(''), 'Extra'], flags: [], rpgAgentExtendedTilesetTypes: ['normal'],
    }]), 'utf8');
    assert.throws(() => setManagedUnlimitedTilesetsEnabled(root, project, false), /UNLIMITED_TILESETS_DATA_PRESENT/);

    fs.writeFileSync(path.join(dataDir, 'Tilesets.json'), JSON.stringify([null, { id: 1, tilesetNames: Array(9).fill(''), flags: [] }]), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({ width: 1, height: 1, tilesetId: 1, data: [8192, 0, 0, 0, 0, 0], events: [null] }), 'utf8');
    assert.throws(() => setManagedUnlimitedTilesetsEnabled(root, project, false), /UNLIMITED_TILESETS_REFERENCES_PRESENT/);

    fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({ width: 1, height: 1, tilesetId: 1, data: Array(6).fill(0), events: [null] }), 'utf8');
    setManagedUnlimitedTilesetsEnabled(root, project, false);
    assert.equal(getProjectFileForRead(root, project, enabled.pluginRelativePath), null);
    assert.doesNotMatch(fs.readFileSync(getProjectFileForRead(root, project, 'www/js/plugins.js')!, 'utf8'), /RPGAgentUnlimitedTilesets/);
  });

  test('requires a valid managed runtime and complete sheet data for extended autotile paint requests', () => {
    const project = createProject(root, 'MV');
    const dataDir = path.join(project, 'www', 'data');
    fs.writeFileSync(path.join(dataDir, 'Tilesets.json'), JSON.stringify([null, {
      id: 1,
      tilesetNames: [...Array(9).fill(''), 'MissingGround'],
      flags: Array(8192 + 1536).fill(0),
      rpgAgentExtendedTilesetTypes: ['A2'],
    }]), 'utf8');
    const edit = {
      kind: 'autotile' as const,
      x: 0,
      y: 0,
      layer: 'auto' as const,
      autotileKind: 0,
      tilesetSlot: 9,
      extendedTilesetType: 'A2' as const,
    };

    assert.throws(() => postMapTiles(root, project, 1, [edit]), /UNLIMITED_TILESETS_RUNTIME_INVALID/);
    setManagedUnlimitedTilesetsEnabled(root, project, true);
    assert.throws(() => postMapTiles(root, project, 1, [edit]), /image is missing/i);
  });

  for (const engine of ['rpg-maker-mv', 'rpg-maker-mz'] as const) {
    test(`${engine} adapter samples all sheet types with stock-compatible autotile rules`, () => {
      const fixture = executeRuntimeAdapter(engine);
      const firstIds = { A1: 8192, A2: 8960, A3: 10496, A4: 12032, A5: 14336, normal: 14464 };
      assert.equal(fixture.context.Tilemap.isTileA1(firstIds.A1), true);
      assert.equal(fixture.context.Tilemap.isTileA2(firstIds.A2), true);
      assert.equal(fixture.context.Tilemap.isTileA3(firstIds.A3), true);
      assert.equal(fixture.context.Tilemap.isTileA4(firstIds.A4), true);
      assert.equal(fixture.context.Tilemap.isTileA5(firstIds.A5), true);
      assert.equal(fixture.context.Tilemap.isAutotile(firstIds.normal), false);

      fixture.tilemap.animationFrame = 3;
      assert.equal(fixture.draw(firstIds.A1)[0]?.sx, 96, 'A1 water uses the 0-1-2-1 frame sequence');
      fixture.tilemap.animationFrame = 2;
      assert.equal(fixture.draw(firstIds.A1 + 5 * 48)[0]?.sy, 96, 'A1 waterfall advances through three vertical frames');
      assert.equal(fixture.draw(firstIds.A2)[0]?.sx, 0, 'A2 uses the floor quarter table');
      const tableEdge = fixture.drawTableEdge(firstIds.A2);
      assert.equal(tableEdge.length, 2);
      assert.deepEqual(tableEdge[0], { slot: 10, sx: 0, sy: 12, sw: 24, sh: 12 });
      assert.equal(fixture.draw(firstIds.A3)[0]?.sx, 48, 'A3 uses the wall quarter table');
      assert.equal(fixture.draw(firstIds.A4 + 8 * 48)[0]?.sx, 48, 'A4 wall rows use the wall quarter table');
      assert.deepEqual(fixture.draw(firstIds.A5)[0], { slot: 13, sx: 0, sy: 0, sw: 48, sh: 48 });
      assert.deepEqual(fixture.draw(firstIds.normal)[0], { slot: 14, sx: 0, sy: 0, sw: 48, sh: 48 });

      const firstEvent = new fixture.context.Sprite_Character();
      firstEvent._tileId = firstIds.normal;
      firstEvent.updateTileFrame();
      assert.equal(firstEvent.bitmap.records[0].name, 'Sheet14');
      fixture.tilesetNames[14] = 'OtherSheet14';
      const secondEvent = new fixture.context.Sprite_Character();
      secondEvent._tileId = firstIds.normal;
      secondEvent.updateTileFrame();
      assert.equal(secondEvent.bitmap.records[0].name, 'OtherSheet14');
    });
  }
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
      'index.html', 'package.json', 'js/rmmz_managers.js', 'js/rmmz_objects.js',
      'js/rmmz_scenes.js', 'js/rmmz_sprites.js', 'js/rmmz_windows.js', 'js/main.js',
    ]) {
      const file = path.join(project, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, relative === 'package.json' ? '{}' : '', 'utf8');
    }
    fs.writeFileSync(path.join(project, 'js', 'rmmz_core.js'), runtimeCoreFixture('MZ'), 'utf8');
    fs.writeFileSync(path.join(project, 'js', 'rmmz_sprites.js'), 'Sprite_Character.prototype.updateTileFrame = function() {};\n', 'utf8');
  } else {
    fs.writeFileSync(path.join(resourceRoot, 'js', 'rpg_core.js'), runtimeCoreFixture('MV'), 'utf8');
    fs.writeFileSync(path.join(resourceRoot, 'js', 'rpg_sprites.js'), 'Sprite_Character.prototype.updateTileFrame = function() {};\n', 'utf8');
  }
  return project;
}

function executeRuntimeAdapter(engine: 'rpg-maker-mv' | 'rpg-maker-mz') {
  const floor = Array.from({ length: 48 }, () => [[0, 0], [0, 0], [0, 0], [0, 0]]);
  const wall = Array.from({ length: 48 }, () => [[2, 0], [2, 0], [2, 0], [2, 0]]);
  const waterfall = Array.from({ length: 48 }, () => [[3, 0], [3, 0], [3, 0], [3, 0]]);
  class TilemapFixture {
    static FLOOR_AUTOTILE_TABLE = floor;
    static WALL_AUTOTILE_TABLE = wall;
    static WATERFALL_AUTOTILE_TABLE = waterfall;
    static isTileA1() { return false; }
    static isTileA2() { return false; }
    static isTileA3() { return false; }
    static isTileA4() { return false; }
    static isTileA5() { return false; }
    static isAutotile() { return false; }
    bitmaps = Array.from({ length: 15 }, (_, slot) => ({ slot }));
    flags: number[] = [];
    animationFrame = 0;
    _tileWidth = 48;
    _tileHeight = 48;
    tileWidth = 48;
    tileHeight = 48;
    _drawTile() {}
    _addTile() {}
    _drawTableEdge() {}
    _addTableEdge() {}
  }
  class BitmapFixture {
    records: unknown[] = [];
    blt(source: { slot?: number; name?: string }, sx: number, sy: number, sw: number, sh: number) {
      this.records.push({ slot: source.slot, name: source.name, sx, sy, sw, sh });
    }
  }
  class SpriteCharacterFixture {
    _tileId = 0;
    updateTileFrame() {}
    setFrame() {}
  }
  const tilesetNames = Array.from({ length: 15 }, (_, index) => `Sheet${index}`);
  const context: any = {
    Tilemap: TilemapFixture,
    Sprite_Character: SpriteCharacterFixture,
    Bitmap: BitmapFixture,
    Graphics: { frameCount: 0 },
    ImageManager: { loadTileset: (name: string) => ({ name, isReady: () => true, addLoadListener() {} }) },
    $gameMap: {
      tileset: () => ({
        tilesetNames,
        rpgAgentExtendedTilesetTypes: ['A1', 'A2', 'A3', 'A4', 'A5', 'normal'],
      }),
      tilesetFlags: () => [],
      tileWidth: () => 48,
      tileHeight: () => 48,
    },
  };
  vm.runInNewContext(buildUnlimitedTilesetsRuntimePlugin(engine), context);
  const tilemap = new context.Tilemap();
  return {
    context,
    tilemap,
    tilesetNames,
    draw(tileId: number): Array<{ slot: number; sx: number; sy: number; sw: number; sh: number }> {
      const records: Array<{ slot: number; sx: number; sy: number; sw: number; sh: number }> = [];
      if (engine === 'rpg-maker-mv') {
        const bitmap = { blt(source: { slot: number }, sx: number, sy: number, sw: number, sh: number) { records.push({ slot: source.slot, sx, sy, sw, sh }); } };
        tilemap._drawTile(bitmap, tileId, 0, 0);
      } else {
        const layer = { addRect(slot: number, sx: number, sy: number, _dx: number, _dy: number, sw: number, sh: number) { records.push({ slot, sx, sy, sw, sh }); } };
        tilemap._addTile(layer, tileId, 0, 0);
      }
      return records;
    },
    drawTableEdge(tileId: number): Array<{ slot: number; sx: number; sy: number; sw: number; sh: number }> {
      const records: Array<{ slot: number; sx: number; sy: number; sw: number; sh: number }> = [];
      if (engine === 'rpg-maker-mv') {
        const bitmap = { blt(source: { slot: number }, sx: number, sy: number, sw: number, sh: number) { records.push({ slot: source.slot, sx, sy, sw, sh }); } };
        tilemap._drawTableEdge(bitmap, tileId, 0, 0);
      } else {
        const layer = { addRect(slot: number, sx: number, sy: number, _dx: number, _dy: number, sw: number, sh: number) { records.push({ slot, sx, sy, sw, sh }); } };
        tilemap._addTableEdge(layer, tileId, 0, 0);
      }
      return records;
    },
  };
}

function runtimeCoreFixture(engine: 'MV' | 'MZ'): string {
  return [
    `Utils.RPGMAKER_NAME = "${engine}";`,
    `Utils.RPGMAKER_VERSION = "${engine === 'MZ' ? '1.10.0' : '1.6.2'}";`,
    `Tilemap.prototype.${engine === 'MZ' ? '_addTile' : '_drawTile'} = function() {};`,
    `Tilemap.prototype.${engine === 'MZ' ? '_addTableEdge' : '_drawTableEdge'} = function() {};`,
    'Tilemap.FLOOR_AUTOTILE_TABLE = [];',
    'Tilemap.WALL_AUTOTILE_TABLE = [];',
    'Tilemap.WATERFALL_AUTOTILE_TABLE = [];',
  ].join('\n');
}
