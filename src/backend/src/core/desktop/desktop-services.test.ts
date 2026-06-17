import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { EventContractDao } from '../db/dao/event-contract-dao.ts';
import { MapSelectionDao } from '../db/dao/map-selection-dao.ts';
import { StagingManifestDao } from '../db/dao/staging-manifest-dao.ts';
import { StoryProjectDao } from '../db/dao/story-project-dao.ts';
import { closeDatabase, getConfiguredDatabasePath } from '../db/pool.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import { resolveAssetRequest } from './asset-service.ts';
import { buildEditorProjectCatalog } from './editor-catalog-service.ts';
import { createEvent, createPlacementEvent, duplicateEvent, removeEvent, updateEvent } from './event-service.ts';
import { getMapLibrarySelection, listMapLibrary, validateMapLibraryPackage, writeMapLibrarySelection } from './library-service.ts';
import { clearLocalAssetsCache } from './local-assets-service.ts';
import {
  buildMapIndex,
  buildMapPayload,
  buildTilesetIndex,
  importMapDraftFromLibrary,
  importMapPackageFromLibrary,
  postMapTiles,
  setStartPositionDraft,
  setSystemPositionDraft,
  updateMapPropertiesDraft,
} from './map-service.ts';
import {
  applyProjectStaging,
  applyStagedMap,
  deleteStagedProjectFile,
  discardProjectStaging,
  discardStagedMap,
  getMapFileForRead,
  getProjectFileForRead,
  getProjectStagingStatus,
  projectHash,
  writeStagedProjectBuffer,
  writeStagedProjectJson,
} from './staging-service.ts';
import { registerExternalProject } from './project-service.ts';
import { initializeOriginalStoryProject } from './story-page-sync-service.ts';

interface Fixture {
  root: string;
  project: string;
  mapFile: string;
}

function pickPosition(value: { startMapId?: unknown; startX?: unknown; startY?: unknown } | null | undefined) {
  return {
    startMapId: Number(value?.startMapId ?? 0),
    startX: Number(value?.startX ?? 0),
    startY: Number(value?.startY ?? 0),
  };
}

describe('desktop map services', { concurrency: false }, () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = createFixture();
    await bootstrapDatabase(fixture.root, {
      dbPath: path.join(fixture.root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
    });
    initializeOriginalStoryProject(fixture.project);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test('builds the shared map contract and resolves only allowed project assets', () => {
    const tree = buildMapIndex(fixture.root, fixture.project);
    const tilesets = buildTilesetIndex(fixture.root, fixture.project);
    const payload = buildMapPayload(fixture.root, fixture.project, 1);

    assert.equal(tree.maps[0].name, 'Start');
    assert.equal(tilesets.tilesets[0].tilesetNames[0], 'Outside_A1');
    assert.equal(payload.info.name, 'Start');
    assert.equal(payload.map.width, 2);
    assert.match(payload.tileset!.imageUrls[0]!, /^rmmv-asset:\/\/project\//);
    assert.equal(resolveAssetRequest(fixture.root, payload.tileset!.imageUrls[0]!), path.join(fixture.project, 'www', 'img', 'tilesets', 'Outside_A1.png'));
    assert.throws(() => resolveAssetRequest(fixture.root, 'rmmv-asset://project/bm90LXRoZS1wcm9qZWN0/../secret.txt'));
  });

  test('resolves assets for registered external projects outside projects/', () => {
    const externalProject = path.join(fixture.root, 'external', 'RegisteredGame');
    const dataDir = path.join(externalProject, 'www', 'data');
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'External', parentId: 0, order: 1, expanded: true }]);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] }]);
    writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
    writeJson(path.join(dataDir, 'Map001.json'), { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
    fs.mkdirSync(path.join(externalProject, 'www', 'img', 'tilesets'), { recursive: true });
    fs.writeFileSync(path.join(externalProject, 'www', 'img', 'tilesets', 'Outside_A1.png'), Buffer.from('png'));

    registerExternalProject(fixture.root, externalProject);
    const payload = buildMapPayload(fixture.root, externalProject, 1);

    assert.equal(payload.info.name, 'External');
    assert.match(payload.tileset!.imageUrls[0]!, /^rmmv-asset:\/\/project\//);
    assert.equal(
      resolveAssetRequest(fixture.root, payload.tileset!.imageUrls[0]!),
      path.join(externalProject, 'www', 'img', 'tilesets', 'Outside_A1.png'),
    );

    const unregisteredProject = path.join(fixture.root, 'external', 'UnregisteredGame');
    const unregisteredToken = Buffer.from(unregisteredProject, 'utf8').toString('base64url');
    assert.throws(() => resolveAssetRequest(fixture.root, `rmmv-asset://project/${unregisteredToken}/img/tilesets/Outside_A1.png`));
  });

  test('opens and edits original data/img layout tilesets without www', () => {
    const project = path.join(fixture.root, 'projects', 'DataLayout');
    const dataDir = path.join(project, 'data');
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Data Map', parentId: 0, order: 1, expanded: true }]);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] }]);
    writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
    writeJson(path.join(dataDir, 'Map001.json'), { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
    fs.mkdirSync(path.join(project, 'img', 'tilesets'), { recursive: true });
    fs.writeFileSync(path.join(project, 'img', 'tilesets', 'Outside_A1.png'), Buffer.from('png'));

    const tree = buildMapIndex(fixture.root, project);
    const tilesets = buildTilesetIndex(fixture.root, project);
    const payload = buildMapPayload(fixture.root, project, 1);

    assert.equal(tree.maps[0].name, 'Data Map');
    assert.equal(tilesets.tilesets[0].tilesetNames[0], 'Outside_A1');
    assert.equal(resolveAssetRequest(fixture.root, payload.tileset!.imageUrls[0]!), path.join(project, 'img', 'tilesets', 'Outside_A1.png'));

    postMapTiles(fixture.root, project, 1, [{ x: 0, y: 0, layer: 0, tileId: 7 }]);
    const stagedMap = readMapForTest(fixture.root, project, 1) as any;
    assert.equal(stagedMap.data[0], 7);
    assert.equal((readJson(path.join(dataDir, 'Map001.json')) as any).data[0], 0);
  });

  test('fails fast when a referenced tileset image is missing', () => {
    const project = path.join(fixture.root, 'projects', 'MissingTilesetImage');
    const dataDir = path.join(project, 'data');
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Broken', parentId: 0, order: 1, expanded: true }]);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Missing_A1'], flags: [] }]);
    writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
    writeJson(path.join(dataDir, 'Map001.json'), { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });

    assert.throws(
      () => buildMapPayload(fixture.root, project, 1),
      /Missing_A1\.png/,
    );
  });

  test('builds an editor catalog from staged database and asset overrides', () => {
    writeStagedProjectJson(fixture.root, fixture.project, 'www/data/System.json', { switches: [null, 'Door', 'Night'], variables: [null, 'Progress'] });
    writeStagedProjectBuffer(fixture.root, fixture.project, 'www/img/characters/Hero.png', Buffer.from('hero'));
    writeStagedProjectBuffer(fixture.root, fixture.project, 'www/img/faces/Hero.png', Buffer.from('face'));
    writeStagedProjectBuffer(fixture.root, fixture.project, 'www/audio/bgm/Theme.ogg', Buffer.from('bgm'));
    writeStagedProjectBuffer(fixture.root, fixture.project, 'www/img/pictures/Portrait.png', Buffer.from('picture'));
    writeStagedProjectBuffer(fixture.root, fixture.project, 'www/audio/se/Open1.ogg', Buffer.from('se'));
    deleteStagedProjectFile(fixture.root, fixture.project, 'www/img/characters/Removed.png');

    const catalog = buildEditorProjectCatalog(fixture.root, fixture.project);
    assert.deepEqual(catalog.switches, [{ id: 1, name: 'Door' }, { id: 2, name: 'Night' }]);
    assert.equal(catalog.maps[0].name, 'Start');
    assert.equal(catalog.assets.characters[0].name, 'Hero');
    assert.equal(catalog.assets.characters.some((asset) => asset.name === 'Removed'), false);
    assert.equal(catalog.assets.faces[0].name, 'Hero');
    assert.equal(catalog.assets.bgm[0].name, 'Theme');
    assert.equal(catalog.assets.pictures[0].name, 'Portrait');
    assert.equal(catalog.assets.se[0].name, 'Open1');
    const stagedHero = resolveAssetRequest(fixture.root, catalog.assets.characters[0].url);
    assert.ok(stagedHero.startsWith(path.join(fixture.root, 'runtime', 'agent-console-staging')));
    assert.equal(fs.readFileSync(stagedHero).toString(), 'hero');
  });

  test('keeps tile edits in draft until apply and discards without touching source', () => {
    postMapTiles(fixture.root, fixture.project, 1, [{ x: 0, y: 0, layer: 0, tileId: 7 }]);
    assert.equal((readJson(fixture.mapFile) as any).data[0], 0);
    assert.equal((readMapForTest(fixture.root, fixture.project, 1) as any).data[0], 7);
    const stagingBackupRoot = path.join(fixture.root, 'runtime', 'agent-console-staging', projectHash(fixture.project));
    assert.equal(fs.existsSync(path.join(stagingBackupRoot, 'manifest.json')), false);
    assert.ok(StagingManifestDao.getLatestByProject(projectHash(fixture.project)));
    assert.equal(discardStagedMap(fixture.root, fixture.project, 1).discarded, true);
    assert.equal((readJson(fixture.mapFile) as any).data[0], 0);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);

    postMapTiles(fixture.root, fixture.project, 1, [{ x: 0, y: 0, layer: 0, tileId: 8 }]);
    assert.equal((readJson(fixture.mapFile) as any).data[0], 0);
    assert.equal((readMapForTest(fixture.root, fixture.project, 1) as any).data[0], 8);
    assert.equal(applyStagedMap(fixture.root, fixture.project, 1).applied, true);
    assert.equal((readJson(fixture.mapFile) as any).data[0], 8);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
    assert.equal(fs.existsSync(path.join(fixture.root, 'runtime', 'agent-console-staging')) && getProjectStagingStatus(fixture.root, fixture.project).files.length, 0);
  });

  test('edits tile, shadow and region layers explicitly without cross-layer pollution', () => {
    postMapTiles(fixture.root, fixture.project, 1, [
      { kind: 'tile', x: 0, y: 0, layer: 0, tileId: 7 },
      { kind: 'shadow', x: 1, y: 0, layer: 4, shadowBits: 9 },
      { kind: 'region', x: 0, y: 1, layer: 5, regionId: 42 },
    ]);

    const source = readJson(fixture.mapFile) as any;
    const staged = readMapForTest(fixture.root, fixture.project, 1) as any;
    const layerSize = staged.width * staged.height;
    assert.equal(source.data[0], 0);
    assert.equal(source.data[4 * layerSize + 1], 0);
    assert.equal(source.data[5 * layerSize + 2], 0);
    assert.equal(staged.data[0], 7);
    assert.equal(staged.data[4 * layerSize + 1], 9);
    assert.equal(staged.data[5 * layerSize + 2], 42);
    assert.equal(staged.data[1], 0);
    assert.equal(staged.data[2], 0);
    assert.equal(staged.data[layerSize], 0);

    assert.equal(applyStagedMap(fixture.root, fixture.project, 1).applied, true);
    const applied = readJson(fixture.mapFile) as any;
    assert.equal(applied.data[0], 7);
    assert.equal(applied.data[4 * layerSize + 1], 9);
    assert.equal(applied.data[5 * layerSize + 2], 42);
  });

  test('writes MV waterfall and wall autotiles without touching metadata layers', () => {
    postMapTiles(fixture.root, fixture.project, 1, [
      { kind: 'autotile', x: 0, y: 0, layer: 0, autotileKind: 5 },
      { kind: 'autotile', x: 1, y: 0, layer: 1, autotileKind: 48 },
      { kind: 'autotile', x: 0, y: 1, layer: 2, autotileKind: 88 },
    ]);

    const staged = readMapForTest(fixture.root, fixture.project, 1) as any;
    const layerSize = staged.width * staged.height;
    assert.equal(staged.data[0], 2048 + 5 * 48 + 2);
    assert.equal(staged.data[layerSize + 1], 2048 + 48 * 48 + 9);
    assert.equal(staged.data[2 * layerSize + 2], 2048 + 88 * 48 + 6);
    assert.equal(staged.data[4 * layerSize], 0);
    assert.equal(staged.data[5 * layerSize], 0);
    assert.equal((readJson(fixture.mapFile) as any).data.every((value: number) => value === 0), true);
  });

  test('rejects invalid tile, shadow, region and out-of-range autotile edits before writing source', () => {
    assert.throws(
      () => postMapTiles(fixture.root, fixture.project, 1, [{ x: 0, y: 0, layer: 4, tileId: 15 }]),
      /use kind:"shadow"/,
    );
    assert.throws(
      () => postMapTiles(fixture.root, fixture.project, 1, [{ kind: 'shadow', x: 0, y: 0, layer: 4, shadowBits: 16 }]),
      /shadowBits must be <= 15/,
    );
    assert.throws(
      () => postMapTiles(fixture.root, fixture.project, 1, [{ kind: 'region', x: 0, y: 0, layer: 5, regionId: 256 }]),
      /regionId must be <= 255/,
    );
    assert.throws(
      () => postMapTiles(fixture.root, fixture.project, 1, [{ x: 0, y: 0, layer: 6, tileId: 1 }]),
      /layer must be < 4/,
    );
    assert.throws(
      () => postMapTiles(fixture.root, fixture.project, 1, [{ kind: 'autotile', x: 0, y: 0, layer: 0, autotileKind: 128 }]),
      /outside RPG Maker MV A1-A4 range/,
    );
    assert.equal((readJson(fixture.mapFile) as any).data.every((value: number) => value === 0), true);
  });

  test('updates complete RMMV map properties through project staging', () => {
    updateMapPropertiesDraft(fixture.root, fixture.project, 1, {
      name: 'Renamed',
      displayName: 'Village Entrance',
      width: 2,
      height: 2,
      tilesetId: 1,
      parentId: 0,
      scrollType: 3,
      specifyBattleback: true,
      battleback1Name: 'Grassland',
      battleback2Name: 'Clouds',
      autoplayBgm: true,
      bgm: { name: 'Field1', volume: 80, pitch: 95, pan: -10 },
      autoplayBgs: true,
      bgs: { name: 'River', volume: 55, pitch: 105, pan: 12 },
      disableDashing: true,
      parallaxName: 'Sky',
      parallaxLoopX: true,
      parallaxLoopY: true,
      parallaxSx: 4,
      parallaxSy: -3,
      parallaxShow: true,
      encounterList: [{ troopId: 2, weight: 7, regionSet: [1, 2] }],
      encounterStep: 45,
      note: '<weather:rain>',
    });

    const sourceMap = readJson(fixture.mapFile) as any;
    const sourceInfos = readJson(path.join(fixture.project, 'www', 'data', 'MapInfos.json')) as any[];
    const stagedMap = readMapForTest(fixture.root, fixture.project, 1) as any;
    const stagedInfos = readProjectJsonForTest(fixture.root, fixture.project, 'www/data/MapInfos.json') as any[];

    assert.equal(sourceInfos[1].name, 'Start');
    assert.equal(sourceMap.displayName, undefined);
    assert.equal(stagedInfos[1].name, 'Renamed');
    assert.equal(stagedMap.displayName, 'Village Entrance');
    assert.equal(stagedMap.scrollType, 3);
    assert.equal(stagedMap.specifyBattleback, true);
    assert.equal(stagedMap.battleback1Name, 'Grassland');
    assert.equal(stagedMap.battleback2Name, 'Clouds');
    assert.equal(stagedMap.autoplayBgm, true);
    assert.deepEqual(stagedMap.bgm, { name: 'Field1', volume: 80, pitch: 95, pan: -10 });
    assert.equal(stagedMap.autoplayBgs, true);
    assert.deepEqual(stagedMap.bgs, { name: 'River', volume: 55, pitch: 105, pan: 12 });
    assert.equal(stagedMap.disableDashing, true);
    assert.equal(stagedMap.parallaxName, 'Sky');
    assert.equal(stagedMap.parallaxLoopX, true);
    assert.equal(stagedMap.parallaxLoopY, true);
    assert.equal(stagedMap.parallaxSx, 4);
    assert.equal(stagedMap.parallaxSy, -3);
    assert.equal(stagedMap.parallaxShow, true);
    assert.deepEqual(stagedMap.encounterList, [{ troopId: 2, weight: 7, regionSet: [1, 2] }]);
    assert.equal(stagedMap.encounterStep, 45);
    assert.equal(stagedMap.note, '<weather:rain>');

    assert.equal(applyProjectStaging(fixture.root, fixture.project).applied, true);
    const appliedMap = readJson(fixture.mapFile) as any;
    const appliedInfos = readJson(path.join(fixture.project, 'www', 'data', 'MapInfos.json')) as any[];
    assert.equal(appliedInfos[1].name, 'Renamed');
    assert.equal(appliedMap.displayName, 'Village Entrance');
    assert.deepEqual(appliedMap.bgm, { name: 'Field1', volume: 80, pitch: 95, pan: -10 });
    assert.deepEqual(appliedMap.encounterList, [{ troopId: 2, weight: 7, regionSet: [1, 2] }]);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
  });

  test('sets the player start position through project staging', () => {
    const result = setStartPositionDraft(fixture.root, fixture.project, 1, 1, 1);
    const system = readProjectJsonForTest(fixture.root, fixture.project, 'www/data/System.json') as any;
    const sourceSystem = readJson(path.join(fixture.project, 'www', 'data', 'System.json')) as any;

    assert.equal(result.target, 'player');
    assert.equal(result.relativePath, 'www/data/System.json');
    assert.equal(system.startMapId, 1);
    assert.equal(system.startX, 1);
    assert.equal(system.startY, 1);
    assert.equal(sourceSystem.startX, 0);
    assert.equal(sourceSystem.startY, 0);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, true);
    assert.equal(applyProjectStaging(fixture.root, fixture.project).applied, true);
    const appliedSystem = readJson(path.join(fixture.project, 'www', 'data', 'System.json')) as any;
    assert.equal(appliedSystem.startMapId, 1);
    assert.equal(appliedSystem.startX, 1);
    assert.equal(appliedSystem.startY, 1);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
    assert.throws(() => setStartPositionDraft(fixture.root, fixture.project, 1, 2, 0), /x=2\)/);
  });

  test('sets boat, ship and airship positions through project staging', () => {
    setSystemPositionDraft(fixture.root, fixture.project, 'boat', 1, 1, 0);
    setSystemPositionDraft(fixture.root, fixture.project, 'ship', 1, 0, 1);
    setSystemPositionDraft(fixture.root, fixture.project, 'airship', 1, 1, 1);

    const stagedSystem = readProjectJsonForTest(fixture.root, fixture.project, 'www/data/System.json') as any;
    const sourceSystem = readJson(path.join(fixture.project, 'www', 'data', 'System.json')) as any;
    assert.deepEqual(
      {
        boat: pickPosition(stagedSystem.boat),
        ship: pickPosition(stagedSystem.ship),
        airship: pickPosition(stagedSystem.airship),
      },
      {
        boat: { startMapId: 1, startX: 1, startY: 0 },
        ship: { startMapId: 1, startX: 0, startY: 1 },
        airship: { startMapId: 1, startX: 1, startY: 1 },
      },
    );
    assert.deepEqual(pickPosition(sourceSystem.boat), { startMapId: 0, startX: 0, startY: 0 });
    assert.deepEqual(pickPosition(sourceSystem.ship), { startMapId: 0, startX: 0, startY: 0 });
    assert.deepEqual(pickPosition(sourceSystem.airship), { startMapId: 0, startX: 0, startY: 0 });

    assert.equal(applyProjectStaging(fixture.root, fixture.project).applied, true);
    const appliedSystem = readJson(path.join(fixture.project, 'www', 'data', 'System.json')) as any;
    assert.deepEqual(pickPosition(appliedSystem.boat), { startMapId: 1, startX: 1, startY: 0 });
    assert.deepEqual(pickPosition(appliedSystem.ship), { startMapId: 1, startX: 0, startY: 1 });
    assert.deepEqual(pickPosition(appliedSystem.airship), { startMapId: 1, startX: 1, startY: 1 });
    assert.equal(appliedSystem.boat.characterName, 'Vehicle');
    assert.throws(() => setSystemPositionDraft(fixture.root, fixture.project, 'boat', 1, 2, 0), /x=2\)/);
  });

  test('blocks per-map actions when a draft also changes shared files', () => {
    updateMapPropertiesDraft(fixture.root, fixture.project, 1, { name: 'Renamed' });
    assert.throws(() => discardStagedMap(fixture.root, fixture.project, 1));
    assert.equal(discardProjectStaging(fixture.root, fixture.project).discarded, true);
    assert.equal((readJson(path.join(fixture.project, 'www', 'data', 'MapInfos.json')) as any[])[1].name, 'Start');
  });

  test('keeps event edits in draft and tracks staging', () => {
    const report = createEvent(fixture.root, fixture.project, 1, { name: 'Chest', x: 1, y: 1 });
    assert.equal(report.op, 'create');
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events;
    assert.equal(events[report.eventId].name, 'Chest');
    assert.equal((readJson(fixture.mapFile) as any).events[report.eventId], undefined);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, true);
  });

  test('keeps event coordinate updates in the draft file', () => {
    const created = createEvent(fixture.root, fixture.project, 1, { name: 'Chest', x: 1, y: 1 });
    const report = updateEvent(fixture.root, fixture.project, 1, created.eventId, { x: 0, y: 1 });
    const live = buildMapPayload(fixture.root, fixture.project, 1);

    assert.equal(report.op, 'update');
    assert.equal((readJson(fixture.mapFile) as any).events[created.eventId], undefined);
    assert.equal((live.map.events[created.eventId] as any).x, 0);
    assert.equal((live.map.events[created.eventId] as any).y, 1);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, true);
  });

  test('rejects event coordinate updates outside map bounds', () => {
    const created = createEvent(fixture.root, fixture.project, 1, { name: 'Chest', x: 1, y: 1 });

    assert.throws(
      () => updateEvent(fixture.root, fixture.project, 1, created.eventId, { x: 2, y: 0 }),
      /outside map 2x2/,
    );
  });

  test('package import restores source MapInfos parent hierarchy', () => {
    const local = createPackageFixture();
    const result = importMapPackageFromLibrary(
      local.root,
      local.project,
      ['pkg-map-1', 'pkg-map-2'],
      0,
      { includeEvents: false },
    );
    assert.equal(result.failed.length, 0);
    assert.equal(result.mapIds.length, 2);
    assert.equal(result.usedSourceHierarchy, true);
    const tree = buildMapIndex(local.root, local.project);
    const map2 = tree.maps.find((m) => m.id === result.mapIds[1]);
    const map1Id = result.mapIds[0];
    assert.ok(map2);
    assert.equal(map2!.parentId, map1Id);
  });

  test('validateMapLibraryPackage reports missing map files', () => {
    const local = createFixture();
    const validation = validateMapLibraryPackage(local.root, ['demo-map', 'missing-id']);
    assert.equal(validation.ok, false);
    assert.ok(validation.issues.some((issue) => issue.assetId === 'missing-id'));
  });

  test('library import omits source map events by default and can include them', () => {
    const local = createFixture();
    const libraryMapPath = path.join(
      local.root,
      'data/assets/map-visual-library/assets/demo/maps/Map001.json',
    );
    const sourceEvent = {
      id: 1,
      name: 'Library NPC',
      x: 0,
      y: 0,
      pages: [{ conditions: {}, image: {}, moveType: 0, moveSpeed: 3, moveFrequency: 3, moveRoute: { list: [], repeat: true, skippable: false, wait: false }, walkAnime: true, stepAnime: false, directionFix: false, through: false, priorityType: 1, trigger: 0, list: [{ code: 0, indent: 0, parameters: [] }] }],
    };
    writeJson(libraryMapPath, {
      width: 2,
      height: 2,
      tilesetId: 2,
      parallaxName: 'Sky',
      data: Array(24).fill(0),
      events: [null, sourceEvent],
    });

    const withoutEvents = importMapDraftFromLibrary(local.root, local.project, 'demo-map', { parentId: 0 });
    const stripped = readMapForTest(local.root, local.project, withoutEvents.mapId) as any;
    assert.equal(stripped.events.filter(Boolean).length, 0);

    const withEvents = importMapDraftFromLibrary(local.root, local.project, 'demo-map', {
      parentId: 0,
      includeEvents: true,
    });
    const kept = readMapForTest(local.root, local.project, withEvents.mapId) as any;
    assert.equal(kept.events.filter(Boolean).length, 1);
    assert.equal(kept.events[1].name, 'Library NPC');
  });

  test('lists library screenshots, persists selection projection and imports into project staging', () => {
    const library = listMapLibrary(fixture.root);
    assert.equal(library.entries.length, 1);
    assert.match(library.entries[0].screenshotUrl, /^rmmv-asset:\/\/library\//);
    assert.match(resolveAssetRequest(fixture.root, library.entries[0].screenshotUrl), /full\.png$/);

    const selection = writeMapLibrarySelection(fixture.root, { assetId: 'demo-map', workflowAction: 'import' });
    assert.equal(getMapLibrarySelection()!.assetId, 'demo-map');
    assert.equal(MapSelectionDao.getLatest('default')!.selection.assetId, 'demo-map');
    assert.equal(fs.existsSync(path.join(fixture.root, 'runtime', 'map-selection', 'map-selection.json')), false);
    assert.equal(selection.assetId, 'demo-map');

    const imported = importMapDraftFromLibrary(fixture.root, fixture.project, 'demo-map', { parentId: 0 });
    assert.equal(imported.mapId, 2);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'data', 'Map002.json')), false);
    const importedMap = readMapForTest(fixture.root, fixture.project, 2) as any;
    const tilesetsAfter = readProjectJsonForTest(fixture.root, fixture.project, 'www/data/Tilesets.json') as any[];
    const importedTileset = tilesetsAfter[importedMap.tilesetId];
    const namespacedTile = String(importedTileset.tilesetNames.find((name: string) => name && name.includes('Imported_A1')));
    assert.ok(namespacedTile.includes('__Imported_A1'));
    const namespacedTileFile = `${namespacedTile}.png`;
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'img', 'tilesets', namespacedTileFile)), false);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'img', 'parallaxes', 'Sky.png')), false);
    const stagedTile = readProjectFileForTest(fixture.root, fixture.project, `www/img/tilesets/${namespacedTileFile}`);
    assert.ok(stagedTile.startsWith(path.join(fixture.root, 'runtime', 'agent-console-staging')));
    assert.equal(fs.readFileSync(stagedTile).toString(), 'tileset png');
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, true);
    assert.equal(applyProjectStaging(fixture.root, fixture.project).applied, true);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'data', 'Map002.json')), true);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'img', 'tilesets', namespacedTileFile)), true);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
  });

  test('discard removes a newly imported map draft without touching source', () => {
    const imported = importMapDraftFromLibrary(fixture.root, fixture.project, 'demo-map', { parentId: 0 });
    const importedMap = readMapForTest(fixture.root, fixture.project, imported.mapId) as any;
    const tilesetsAfter = readProjectJsonForTest(fixture.root, fixture.project, 'www/data/Tilesets.json') as any[];
    const namespacedTile = String(tilesetsAfter[importedMap.tilesetId].tilesetNames.find((name: string) => name));
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'data', 'Map002.json')), false);
    assert.ok(getProjectFileForRead(fixture.root, fixture.project, 'www/data/Map002.json'));
    assert.ok(getProjectFileForRead(fixture.root, fixture.project, `www/img/tilesets/${namespacedTile}.png`));
    assert.equal(discardProjectStaging(fixture.root, fixture.project).discarded, true);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'data', 'Map002.json')), false);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'img', 'tilesets', `${namespacedTile}.png`)), false);
    assert.equal(getProjectFileForRead(fixture.root, fixture.project, 'www/data/Map002.json'), null);
  });

  test('library import namespaces tileset PNG when project already has same RTP filename', () => {
    const local = createFixture();
    const projectTile = path.join(local.project, 'www', 'img', 'tilesets', 'Outside_A1.png');
    fs.writeFileSync(projectTile, Buffer.from('project-A'));
    const sourceProject = path.join(local.root, 'library-source');
    const sourceTile = path.join(sourceProject, 'img', 'tilesets', 'Outside_A1.png');
    fs.writeFileSync(sourceTile, Buffer.from('source-B'));
    writeJson(path.join(sourceProject, 'data', 'Tilesets.json'), [
      null,
      { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [1] },
      { id: 2, name: 'DLC Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [2] },
    ]);
    const libraryMap = path.join(
      local.root,
      'data/assets/map-visual-library/assets/demo/maps/Map001.json',
    );
    writeJson(libraryMap, { width: 2, height: 2, tilesetId: 2, data: Array(24).fill(0), events: [null] });
    setupLocalAssetsManifest(local.root, 'demo', sourceProject, ['Outside_A1']);

    const imported = importMapDraftFromLibrary(local.root, local.project, 'demo-map', { parentId: 0 });
    const map = readMapForTest(local.root, local.project, imported.mapId) as any;
    const tilesets = readProjectJsonForTest(local.root, local.project, 'www/data/Tilesets.json') as any[];
    const tileset = tilesets[map.tilesetId];
    const namespaced = tileset.tilesetNames.find((name: string) => String(name).includes('Outside_A1'));
    assert.ok(namespaced);
    assert.equal(fs.readFileSync(projectTile).toString(), 'project-A');
    assert.equal(fs.existsSync(path.join(local.project, 'www', 'img', 'tilesets', `${namespaced}.png`)), false);
    assert.equal(fs.readFileSync(readProjectFileForTest(local.root, local.project, `www/img/tilesets/${namespaced}.png`)).toString(), 'source-B');
  });

  test('library import uses the remapped tileset id and ignores a stale tilesetId from the caller', () => {
    const local = createFixture();
    // Tilesets.json already uses id 2; import should allocate the next free id (e.g. 3).
    writeJson(path.join(local.project, 'www', 'data', 'Tilesets.json'), [
      null,
      { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] },
      { id: 2, name: 'Unrelated', mode: 1, tilesetNames: ['Unrelated_A1'], flags: [] },
    ]);
    // Caller passes stale tilesetId=2 via defaultImportProperties.
    // Import must ignore it and must not bind the map to Unrelated.
    const imported = importMapDraftFromLibrary(local.root, local.project, 'demo-map', { parentId: 0, tilesetId: 2 });
    const map = readMapForTest(local.root, local.project, imported.mapId) as any;
    const tilesets = readProjectJsonForTest(local.root, local.project, 'www/data/Tilesets.json') as any[];
    assert.notEqual(map.tilesetId, 2);
    assert.equal(tilesets[map.tilesetId].name, 'Imported');
  });

  test('library import throws when source Tilesets.json is unreadable instead of falling back', () => {
    const local = createFixture();
    const missingSource = path.join(local.root, 'missing-source');
    const libraryRoot = path.join(local.root, 'data', 'assets', 'map-visual-library');
    const mapRel = 'data/assets/map-visual-library/assets/bad/maps/Map001.json';
    writeJson(path.join(local.root, mapRel), { width: 2, height: 2, tilesetId: 2, data: Array(24).fill(0), events: [null] });
    fs.mkdirSync(path.dirname(path.join(local.root, mapRel)), { recursive: true });
    writeJson(path.join(libraryRoot, 'index.json'), {
      entries: [{
        assetId: 'bad-map',
        title: 'Bad',
        engine: 'RPG Maker MV',
        map: { width: 2, height: 2, tilesetId: 2, tilesetName: 'Imported' },
        tags: [],
        license: { usable: true },
        knownIssues: [],
        dependencies: {},
        importBatch: { sourceProject: missingSource },
        source: { name: 'bad', originalProjectPath: missingSource },
        mapFiles: [mapRel],
        screenshots: [],
      }],
    });
    assert.throws(
      () => importMapDraftFromLibrary(local.root, local.project, 'bad-map', { parentId: 0 }),
      /bad-map/,
    );
    assert.equal(fs.existsSync(path.join(local.project, 'www', 'data', 'Map002.json')), false);
  });

  test('package import creates distinct tilesets for two source tileset ids', () => {
    const local = createDualTilesetPackageFixture();
    const result = importMapPackageFromLibrary(
      local.root,
      local.project,
      ['pkg-a', 'pkg-b'],
      0,
      { includeEvents: false },
    );
    assert.equal(result.failed.length, 0);
    const mapA = readMapForTest(local.root, local.project, result.mapIds[0]) as any;
    const mapB = readMapForTest(local.root, local.project, result.mapIds[1]) as any;
    assert.notEqual(mapA.tilesetId, mapB.tilesetId);
    const tilesets = readProjectJsonForTest(local.root, local.project, 'www/data/Tilesets.json') as any[];
    assert.equal(tilesets[mapA.tilesetId].flags[0], 11);
    assert.equal(tilesets[mapB.tilesetId].flags[0], 22);
  });

  test('event creation strips internal AIWF markers but keeps author comments', () => {
    createEvent(fixture.root, fixture.project, 1, {
      name: 'CleanEvent',
      x: 0,
      y: 0,
      note: 'Author note\nAIWF:story:legacy.only\nAIWF:unplaced',
      pages: [{
        list: [
          { code: 108, indent: 0, parameters: ['AIWF:page:legacy'] },
          { code: 108, indent: 0, parameters: ['NPC comment line'] },
          { code: 0, indent: 0, parameters: [] },
        ],
      }],
    });

    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    const created = events.find((ev: any) => ev.name === 'CleanEvent');
    assert.ok(created);
    assert.equal(created.note, 'Author note');
    assert.equal(String(created.note || '').includes('AIWF:'), false);
    const comments = created.pages[0].list
      .filter((c: any) => c.code === 108 || c.code === 408)
      .map((c: any) => String(c.parameters?.[0] || ''));
    assert.deepEqual(comments, ['NPC comment line']);
  });

  test('placement succeeds when controlled editing is not enabled', () => {
    StoryProjectDao.delete(path.basename(path.resolve(fixture.project)));
    const report = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'NoProfile',
      x: 1,
      y: 1,
      contractId: 'no.profile.shell',
    }) as { shellOnly?: boolean; eventId?: number };
    assert.equal(report.shellOnly, true);
    assert.ok(Number.isInteger(report.eventId) && (report.eventId as number) > 0);
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    const placed = events.find((ev: any) => ev.id === report.eventId);
    assert.equal(placed.x, 1);
    assert.equal(placed.y, 1);
  });

  test('remove succeeds when controlled editing is not enabled', () => {
    StoryProjectDao.delete(path.basename(path.resolve(fixture.project)));
    const placed = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'ToDelete',
      x: 1,
      y: 0,
      contractId: 'delete.me.shell',
    }) as { eventId?: number };
    assert.ok(placed.eventId);
    removeEvent(fixture.root, fixture.project, 1, placed.eventId as number);
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    assert.equal(events.some((ev: any) => ev.id === placed.eventId), false);
  });

  test('update position succeeds when controlled editing is not enabled', () => {
    StoryProjectDao.delete(path.basename(path.resolve(fixture.project)));
    const placed = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'ToMove',
      x: 1,
      y: 1,
      contractId: 'move.me.shell',
    }) as { eventId?: number };
    assert.ok(placed.eventId);
    updateEvent(fixture.root, fixture.project, 1, placed.eventId as number, { x: 0, y: 1 });
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    const moved = events.find((ev: any) => ev.id === placed.eventId);
    assert.equal(moved.x, 0);
    assert.equal(moved.y, 1);
  });

  test('agent remove succeeds when controlled editing is not enabled', () => {
    StoryProjectDao.delete(path.basename(path.resolve(fixture.project)));
    const placed = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'AgentGate',
      x: 1,
      y: 1,
      contractId: 'agent.gate.shell',
    }) as { eventId?: number };
    assert.ok(placed.eventId);
    removeEvent(fixture.root, fixture.project, 1, placed.eventId as number, {
      actorType: 'agent',
      actorId: 'rmmv-mcp',
    });
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    assert.equal(events.some((ev: any) => ev.id === placed.eventId), false);
  });

  test('create succeeds when controlled editing is not enabled', () => {
    StoryProjectDao.delete(path.basename(path.resolve(fixture.project)));
    const report = createEvent(fixture.root, fixture.project, 1, { name: 'NoProfileCreate', x: 1, y: 1 });
    assert.equal(report.op, 'create');
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    assert.equal(events.some((ev: any) => ev.name === 'NoProfileCreate'), true);
  });

  test('duplicate succeeds when controlled editing is not enabled', () => {
    StoryProjectDao.delete(path.basename(path.resolve(fixture.project)));
    const created = createEvent(fixture.root, fixture.project, 1, { name: 'Source', x: 0, y: 0 });
    const report = duplicateEvent(fixture.root, fixture.project, 1, created.eventId);
    assert.equal(report.op, 'duplicate');
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    assert.equal(events.length, 2);
    assert.ok(events.some((ev: any) => ev.name === 'Source Copy'));
  });

  test('placement creates a clean shell when contractId is missing from event-registry', () => {
    const report = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'Orphan',
      x: 1,
      y: 1,
      note: 'Author note\nAIWF:event-contract:orphan.only',
      contractId: 'orphan.only',
    }) as { shellOnly?: boolean; eventId?: number };

    assert.equal(report.shellOnly, true);
    assert.ok(Number.isInteger(report.eventId) && (report.eventId as number) > 0);
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    const placed = events.find((ev: any) => ev.id === report.eventId);
    assert.equal(placed.x, 1);
    assert.equal(placed.y, 1);
    assert.equal(placed.note, 'Author note');
    assert.equal(String(placed.note || '').includes('AIWF:'), false);
  });

  test('placement creates a shell event when no implementation exists', () => {
    const report = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'Ghost',
      x: 1,
      y: 1,
      note: 'AIWF:event-contract:no.impl',
      contractId: 'no.impl',
    }) as { shellOnly?: boolean; eventId?: number };
    assert.equal(report.shellOnly, true);
    assert.ok(Number.isInteger(report.eventId) && (report.eventId as number) > 0);
    // Shell placement when registry contract has no implementation pages.
    const events = (readMapForTest(fixture.root, fixture.project, 1) as any).events.filter(Boolean);
    assert.equal(events.length, 1);
    assert.equal(events[0].x, 1);
    assert.equal(events[0].y, 1);
    assert.equal(String(events[0].note || '').includes('AIWF:'), false);
  });

  test('placement compiles contract from registry when only commands[] exists', () => {
    EventContractDao.create('demo.registry.commands', 'Project', {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'demo.registry.commands',
      purpose: 'Registry-only commands placement test.',
      rmmvTarget: {
        operation: 'add-map-event',
        mapId: 1,
        eventName: 'EV_RegistryCmd',
        trigger: 'action-button',
      },
      implementation: {
        commands: [{ kind: 'text', text: 'Hi' }],
      },
    }, 'draft');
    const report = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'RegistryPlaque',
      x: 1,
      y: 0,
      contractId: 'demo.registry.commands',
    }) as { usedContractPatch?: boolean; eventId?: number };
    assert.equal(report.usedContractPatch, true);
    assert.ok(report.eventId);
    const events = (readMapForTest(fixture.root, fixture.project, 1) as { events: Array<{ id?: number; note?: string; pages?: { list: { code: number }[] }[] } | null> }).events.filter(Boolean);
    const created = events.find((ev) => ev?.id === report.eventId);
    assert.ok(created);
    assert.equal(String(created?.note || '').includes('AIWF:'), false);
    assert.ok(created?.pages?.[0]?.list?.some((c) => c.code === 101));
    const stored = EventContractDao.get('demo.registry.commands')!;
    assert.equal(stored.status, 'placed');
    const target = stored.contract.rmmvTarget as { eventId?: number; x?: number; y?: number };
    assert.equal(target.eventId, report.eventId);
    assert.equal(target.x, 1);
    assert.equal(target.y, 0);
  });

  test('placement compiles abstract pages passed in payload', () => {
    EventContractDao.create('demo.payload.pages', 'Project', {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'demo.payload.pages',
      purpose: 'Placement payload pages test.',
      rmmvTarget: { operation: 'add-map-event', mapId: 1, eventName: 'PayloadPlaque' },
      implementation: { commands: [{ kind: 'text', text: 'Hi payload' }] },
    }, 'draft');
    const report = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'PayloadPlaque',
      x: 0,
      y: 1,
      contractId: 'demo.payload.pages',
      pages: [{ commands: [{ kind: 'text', text: 'Hi payload' }], trigger: 'action-button' }],
    }) as { usedContractPatch?: boolean };
    assert.equal(report.usedContractPatch, true);
    const events = (readMapForTest(fixture.root, fixture.project, 1) as { events: Array<{ note?: string } | null> }).events.filter(Boolean);
    assert.equal(events.some((ev) => String(ev?.note || '').includes('AIWF:')), false);
  });

  test('placement compiles EV_GreeterIntro-style change-items with operation add', () => {
    EventContractDao.create('test.town.greeter.intro', 'Project', {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'test.town.greeter.intro',
      purpose: 'Greeter gives a map item and opens switch 1001.',
      rmmvTarget: {
        operation: 'add-map-event',
        mapId: 1,
        eventName: 'EV_GreeterIntro',
        trigger: 'action-button',
      },
      implementation: {
        pages: [{
          trigger: 'action-button',
          commands: [
            { kind: 'text', text: 'Hello.' },
            { kind: 'change-items', itemId: 1, operation: 'add', value: 1 },
            { kind: 'switch', id: 1001, value: true },
          ],
        }],
      },
    }, 'draft');
    const report = createPlacementEvent(fixture.root, fixture.project, 1, {
      name: 'EV_GreeterIntro',
      x: 1,
      y: 0,
      contractId: 'test.town.greeter.intro',
      pages: [{
        trigger: 'action-button',
        commands: [
          { kind: 'text', text: 'Hello.' },
          { kind: 'change-items', itemId: 1, operation: 'add', value: 1 },
          { kind: 'switch', id: 1001, value: true },
        ],
      }],
    }) as { usedContractPatch?: boolean; eventId?: number };
    assert.equal(report.usedContractPatch, true);
    assert.ok(report.eventId);
    const events = (readMapForTest(fixture.root, fixture.project, 1) as {
      events: Array<{ note?: string; pages?: { list: { code: number; parameters: unknown[] }[] }[] } | null>;
    }).events.filter(Boolean);
    const created = events.find((ev) => ev?.pages?.[0]?.list?.some((c) => c.code === 126));
    assert.ok(created);
    assert.equal(String(created?.note || '').includes('AIWF:'), false);
    const list = created?.pages?.[0]?.list || [];
    assert.ok(list.some((c) => c.code === 126 && Array.isArray(c.parameters) && c.parameters[1] === 0));
    assert.ok(list.some((c) => c.code === 121));
  });

  test('uses the workflow-local database path', () => {
    assert.equal(getConfiguredDatabasePath(), path.join(fixture.root, 'data', 'test-rmmv.db'));
  });

});

function readMapForTest(root: string, project: string, mapId: number): unknown {
  return readJson(getMapFileForRead(root, project, mapId));
}

function readProjectJsonForTest(root: string, project: string, relativePath: string): unknown {
  return readJson(readProjectFileForTest(root, project, relativePath));
}

function readProjectFileForTest(root: string, project: string, relativePath: string): string {
  const file = getProjectFileForRead(root, project, relativePath);
  assert.ok(file, `expected project file for ${relativePath}`);
  return file;
}

function createDualTilesetPackageFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-desktop-dual-tileset-'));
  const project = path.join(root, 'projects', 'Project');
  const dataDir = path.join(project, 'www', 'data');
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] }]);
  writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
  fs.mkdirSync(path.join(project, 'www', 'img', 'tilesets'), { recursive: true });

  const sourceProject = path.join(root, 'library-source');
  writeJson(path.join(sourceProject, 'data', 'Tilesets.json'), [
    null,
    { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] },
    { id: 6, name: 'Snow', mode: 1, tilesetNames: ['Snow_A1'], flags: [11] },
    { id: 7, name: 'Dungeon', mode: 1, tilesetNames: ['Dungeon_A1'], flags: [22] },
  ]);
  fs.mkdirSync(path.join(sourceProject, 'img', 'tilesets'), { recursive: true });
  fs.writeFileSync(path.join(sourceProject, 'img', 'tilesets', 'Snow_A1.png'), Buffer.from('snow'));
  fs.writeFileSync(path.join(sourceProject, 'img', 'tilesets', 'Dungeon_A1.png'), Buffer.from('dungeon'));

  const libraryRoot = path.join(root, 'data', 'assets', 'map-visual-library');
  const mapARel = 'data/assets/map-visual-library/assets/dual/maps/Map001.json';
  const mapBRel = 'data/assets/map-visual-library/assets/dual/maps/Map002.json';
  writeJson(path.join(root, mapARel), { width: 2, height: 2, tilesetId: 6, data: Array(24).fill(0), events: [null] });
  writeJson(path.join(root, mapBRel), { width: 2, height: 2, tilesetId: 7, data: Array(24).fill(0), events: [null] });
  const shotA = 'data/assets/map-visual-library/assets/dual/screenshots/a.png';
  const shotB = 'data/assets/map-visual-library/assets/dual/screenshots/b.png';
  fs.mkdirSync(path.dirname(path.join(root, shotA)), { recursive: true });
  fs.writeFileSync(path.join(root, shotA), Buffer.from('png'));
  fs.writeFileSync(path.join(root, shotB), Buffer.from('png'));

  const depSnow = path.join(sourceProject, 'img', 'tilesets', 'Snow_A1.png');
  const depDungeon = path.join(sourceProject, 'img', 'tilesets', 'Dungeon_A1.png');
  writeJson(path.join(libraryRoot, 'index.json'), {
    entries: [
      {
        assetId: 'pkg-a',
        title: 'Snow Map',
        engine: 'RPG Maker MV',
        map: { mapId: 1, width: 2, height: 2, tilesetId: 6, tilesetName: 'Snow' },
        tags: [],
        license: { usable: true },
        knownIssues: [],
        dependencies: { tilesetImages: [{ originalPath: depSnow }] },
        importBatch: { sourceProject, sourceSlug: 'dual-pack' },
        source: { name: 'dual', originalProjectPath: sourceProject },
        mapFiles: [mapARel],
        screenshots: [shotA],
      },
      {
        assetId: 'pkg-b',
        title: 'Dungeon Map',
        engine: 'RPG Maker MV',
        map: { mapId: 2, width: 2, height: 2, tilesetId: 7, tilesetName: 'Dungeon' },
        tags: [],
        license: { usable: true },
        knownIssues: [],
        dependencies: { tilesetImages: [{ originalPath: depDungeon }] },
        importBatch: { sourceProject, sourceSlug: 'dual-pack' },
        source: { name: 'dual', originalProjectPath: sourceProject },
        mapFiles: [mapBRel],
        screenshots: [shotB],
      },
    ],
  });
  setupLocalAssetsManifest(root, 'dual-pack', sourceProject, ['Snow_A1', 'Dungeon_A1']);
  return { root, project, mapFile: path.join(dataDir, 'Map001.json') };
}

function createPackageFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-desktop-package-'));
  const project = path.join(root, 'projects', 'Project');
  const dataDir = path.join(project, 'www', 'data');
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] }]);
  writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
  fs.mkdirSync(path.join(project, 'www', 'img', 'tilesets'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'img', 'tilesets', 'Outside_A1.png'), Buffer.from('png'));

  const sourceProject = path.join(root, 'library-source');
  writeJson(path.join(sourceProject, 'data', 'MapInfos.json'), [
    null,
    { id: 1, name: 'World', parentId: 0, order: 1, expanded: true },
    { id: 2, name: 'Town', parentId: 1, order: 2, expanded: true },
  ]);
  writeJson(path.join(sourceProject, 'data', 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] }]);
  fs.mkdirSync(path.join(sourceProject, 'img', 'tilesets'), { recursive: true });
  fs.writeFileSync(path.join(sourceProject, 'img', 'tilesets', 'Outside_A1.png'), Buffer.from('png'));

  const libraryRoot = path.join(root, 'data', 'assets', 'map-visual-library');
  const map1Rel = 'data/assets/map-visual-library/assets/pkg/maps/Map001.json';
  const map2Rel = 'data/assets/map-visual-library/assets/pkg/maps/Map002.json';
  writeJson(path.join(root, map1Rel), { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
  writeJson(path.join(root, map2Rel), { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
  const shot1 = 'data/assets/map-visual-library/assets/pkg/screenshots/1.png';
  const shot2 = 'data/assets/map-visual-library/assets/pkg/screenshots/2.png';
  fs.mkdirSync(path.dirname(path.join(root, shot1)), { recursive: true });
  fs.writeFileSync(path.join(root, shot1), Buffer.from('png'));
  fs.writeFileSync(path.join(root, shot2), Buffer.from('png'));

  writeJson(path.join(libraryRoot, 'index.json'), {
    entries: [
      {
        assetId: 'pkg-map-1',
        title: 'World',
        engine: 'RPG Maker MV',
        map: { mapId: 1, width: 2, height: 2, tilesetId: 1, tilesetName: 'Outside' },
        tags: [],
        license: { usable: true },
        knownIssues: [],
        dependencies: { tilesetImages: [{ originalPath: path.join(sourceProject, 'img', 'tilesets', 'Outside_A1.png') }] },
        importBatch: { sourceProject, sourceSlug: 'pkg-sample' },
        source: { name: 'pkg', originalProjectPath: sourceProject },
        mapFiles: [map1Rel],
        screenshots: [shot1],
      },
      {
        assetId: 'pkg-map-2',
        title: 'Town',
        engine: 'RPG Maker MV',
        map: { mapId: 2, width: 2, height: 2, tilesetId: 1, tilesetName: 'Outside' },
        tags: [],
        license: { usable: true },
        knownIssues: [],
        dependencies: { tilesetImages: [{ originalPath: path.join(sourceProject, 'img', 'tilesets', 'Outside_A1.png') }] },
        importBatch: { sourceProject, sourceSlug: 'pkg-sample' },
        source: { name: 'pkg', originalProjectPath: sourceProject },
        mapFiles: [map2Rel],
        screenshots: [shot2],
      },
    ],
  });
  setupLocalAssetsManifest(root, 'pkg-sample', sourceProject, ['Outside_A1']);
  return { root, project, mapFile: path.join(dataDir, 'Map001.json') };
}

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-desktop-services-'));
  const project = path.join(root, 'projects', 'Project');
  const dataDir = path.join(project, 'www', 'data');
  const mapFile = path.join(dataDir, 'Map001.json');
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] }]);
  writeJson(path.join(dataDir, 'System.json'), {
    switches: [null, 'Door'],
    variables: [null, 'Progress'],
    startMapId: 1,
    startX: 0,
    startY: 0,
    boat: { characterName: 'Vehicle', characterIndex: 0, startMapId: 0, startX: 0, startY: 0 },
    ship: { characterName: 'Vehicle', characterIndex: 1, startMapId: 0, startX: 0, startY: 0 },
    airship: { characterName: 'Vehicle', characterIndex: 2, startMapId: 0, startX: 0, startY: 0 },
  });
  writeJson(path.join(dataDir, 'Actors.json'), [null, { id: 1, name: 'Hero' }]);
  writeJson(path.join(dataDir, 'Items.json'), [null, { id: 1, name: 'Potion' }]);
  writeJson(path.join(dataDir, 'CommonEvents.json'), [null, { id: 1, name: 'Intro' }]);
  writeJson(path.join(dataDir, 'Animations.json'), [null, { id: 1, name: 'Spark' }]);
  writeJson(mapFile, { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
  fs.mkdirSync(path.join(project, 'www', 'img', 'tilesets'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'img', 'tilesets', 'Outside_A1.png'), Buffer.from('png'));
  fs.mkdirSync(path.join(project, 'www', 'img', 'characters'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'img', 'characters', 'Removed.png'), Buffer.from('png'));
  fs.mkdirSync(path.join(project, 'www', 'js'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'index.html'), '<!doctype html><script src="js/rpg_core.js"></script>');
  for (const file of ['rpg_core.js', 'rpg_managers.js', 'rpg_objects.js', 'rpg_scenes.js', 'rpg_sprites.js', 'rpg_windows.js', 'main.js']) {
    fs.writeFileSync(path.join(project, 'www', 'js', file), file === 'rpg_core.js' ? 'window.Utils = {};' : '');
  }
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins.js'), 'var $plugins = [];');

  const libraryRoot = path.join(root, 'data', 'assets', 'map-visual-library');
  const sourceProject = path.join(root, 'library-source');
  const sourceTilesetImage = path.join(sourceProject, 'img', 'tilesets', 'Imported_A1.png');
  const sourceParallax = path.join(sourceProject, 'img', 'parallaxes', 'Sky.png');
  writeJson(path.join(sourceProject, 'data', 'Tilesets.json'), [null, null, { id: 2, name: 'Imported', mode: 1, tilesetNames: ['Imported_A1'], flags: [] }]);
  fs.mkdirSync(path.dirname(sourceTilesetImage), { recursive: true });
  fs.mkdirSync(path.dirname(sourceParallax), { recursive: true });
  fs.writeFileSync(sourceTilesetImage, Buffer.from('tileset png'));
  fs.writeFileSync(sourceParallax, Buffer.from('parallax png'));
  const libraryMapRelative = 'data/assets/map-visual-library/assets/demo/maps/Map001.json';
  const screenshotRelative = 'data/assets/map-visual-library/assets/demo/screenshots/full.png';
  writeJson(path.join(root, libraryMapRelative), { width: 2, height: 2, tilesetId: 2, parallaxName: 'Sky', data: Array(24).fill(0), events: [null] });
  fs.mkdirSync(path.dirname(path.join(root, screenshotRelative)), { recursive: true });
  fs.writeFileSync(path.join(root, screenshotRelative), Buffer.from('png'));
  writeJson(path.join(libraryRoot, 'index.json'), {
    entries: [{
      assetId: 'demo-map',
      title: 'Demo Map',
      engine: 'RPG Maker MV',
      map: { width: 2, height: 2, tilesetId: 2, tilesetName: 'Imported' },
      tags: ['outside'],
      license: { usable: true },
      knownIssues: [],
      dependencies: {
        tilesetImages: [{ originalPath: sourceTilesetImage }],
        parallaxes: [{ originalPath: sourceParallax }],
      },
      importBatch: { sourceProject, sourceSlug: 'demo' },
      source: { name: 'fixture', originalProjectPath: sourceProject },
      mapFiles: [libraryMapRelative],
      screenshots: [screenshotRelative],
    }],
  });
  setupLocalAssetsManifest(root, 'demo', sourceProject, ['Imported_A1'], ['Sky']);
  return { root, project, mapFile };
}

// Mirror RPG-Agent-MV/data/assets/manifest.json layout for fixture local-assets manifest.
function setupLocalAssetsManifest(
  root: string,
  slug: string,
  sourceProject: string,
  tilesetBasenames: string[],
  parallaxBasenames: string[] = [],
): void {
  const localRoot = path.join(root, 'data', 'assets');
  const localSource = path.join(localRoot, 'sources', slug);
  fs.mkdirSync(path.join(localSource, 'data'), { recursive: true });
  fs.mkdirSync(path.join(localSource, 'img', 'tilesets'), { recursive: true });
  if (parallaxBasenames.length) {
    fs.mkdirSync(path.join(localSource, 'img', 'parallaxes'), { recursive: true });
  }
  fs.copyFileSync(
    path.join(sourceProject, 'data', 'Tilesets.json'),
    path.join(localSource, 'data', 'Tilesets.json'),
  );
  const mapInfosSrc = path.join(sourceProject, 'data', 'MapInfos.json');
  if (fs.existsSync(mapInfosSrc)) {
    fs.copyFileSync(mapInfosSrc, path.join(localSource, 'data', 'MapInfos.json'));
  }

  const tilesetImages: Record<string, string> = {};
  for (const name of tilesetBasenames) {
    const rel = `sources/${slug}/img/tilesets/${name}.png`;
    const dest = path.join(localRoot, rel);
    fs.copyFileSync(path.join(sourceProject, 'img', 'tilesets', `${name}.png`), dest);
    tilesetImages[name] = rel;
  }

  const parallaxes: Record<string, string> = {};
  for (const name of parallaxBasenames) {
    const rel = `sources/${slug}/img/parallaxes/${name}.png`;
    const dest = path.join(localRoot, rel);
    fs.copyFileSync(path.join(sourceProject, 'img', 'parallaxes', `${name}.png`), dest);
    parallaxes[name] = rel;
  }

  const manifestPath = path.join(localRoot, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? (readJson(manifestPath) as { version: number; sources: Record<string, unknown>; pathMapping: Record<string, string> })
    : { version: 1, sources: {}, pathMapping: {} };
  manifest.sources[slug] = {
    originalPath: sourceProject,
    tilesetImages,
    parallaxes,
  };
  writeJson(manifestPath, manifest);
  clearLocalAssetsCache();
}
