import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import { getProjectFileForRead } from './staging-service.ts';
import {
  applyExternalMapImport,
  applyExternalMapReplace,
  inspectExternalProjectForImport,
  scanExternalMapImport,
  scanExternalMapReplace,
} from './external-map-import-service.ts';
import type { ExternalMapImportOptions, ExternalMapReplaceOptions } from '../../../../contract/types.ts';

const LANG = 'en-US' as const;
const FULL_EVENTS: ExternalMapImportOptions = { includeEvents: true, validateEventResources: true };
const REPLACE_KEEP: ExternalMapReplaceOptions = { overwriteEvents: false, validateEventResources: false };
const REPLACE_OVERWRITE: ExternalMapReplaceOptions = { overwriteEvents: true, validateEventResources: true };

describe('external map import service', { concurrency: false }, () => {
  let root: string;
  let target: string;
  let source: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-map-import-'));
    target = path.join(root, 'projects', 'Target');
    source = path.join(root, 'sources', 'Source');
    createTargetProject(target);
    createSourceProject(source);
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('lists external maps with hierarchy for a valid project', () => {
    const result = inspectExternalProjectForImport(source, LANG);
    assert.equal(result.blocked, undefined);
    assert.equal(result.engine, 'rpg-maker-mv');
    assert.deepEqual(result.maps.map((map) => map.id), [1, 2]);
    assert.equal(result.maps.find((map) => map.id === 2)?.parentId, 1);
  });

  test('blocks an encrypted source project instead of throwing', () => {
    const systemPath = path.join(source, 'www', 'data', 'System.json');
    writeJson(systemPath, { ...(readJson(systemPath) as object), hasEncryptedImages: true });
    const result = inspectExternalProjectForImport(source, LANG);
    assert.equal(result.blocked?.reason, 'encrypted');
    assert.throws(() => scanExternalMapImport(root, target, req([1]), LANG));
  });

  test('classifies resource status against the target project', () => {
    const scan = scanExternalMapImport(root, target, req([1]), LANG);
    const byKey = new Map(scan.resources.map((row) => [row.key, row]));

    // Portrait exists in the target with different bytes -> conflict, default add (rename).
    assert.equal(byKey.get('pictures:Portrait')?.status, 'conflict');
    assert.equal(byKey.get('pictures:Portrait')?.defaultAction, 'add');
    // Hero exists in the target with identical bytes -> same, default ignore.
    assert.equal(byKey.get('characters:Hero')?.status, 'same');
    assert.equal(byKey.get('characters:Hero')?.defaultAction, 'ignore');
    // The rest are new in the target.
    assert.equal(byKey.get('faces:HeroFace')?.status, 'missing');
    assert.equal(byKey.get('parallaxes:Sky')?.status, 'missing');
    assert.equal(byKey.get('se:Bell')?.status, 'missing');

    assert.equal(scan.tilesets.length, 1);
    assert.equal(scan.tilesets[0].sourceTilesetId, 1);
    assert.equal(scan.maps.length, 1);
    assert.equal(scan.maps[0].newMapId, 2);
  });

  test('drops event-derived references when events are excluded', () => {
    const scan = scanExternalMapImport(
      root,
      target,
      req([1], { includeEvents: false, validateEventResources: false }),
      LANG,
    );
    const keys = new Set(scan.resources.map((row) => row.key));
    assert.equal(keys.has('parallaxes:Sky'), true);
    assert.equal(keys.has('tilesets:World_A1'), true);
    assert.equal(keys.has('faces:HeroFace'), false);
    assert.equal(keys.has('characters:Hero'), false);
    assert.equal(keys.has('pictures:Portrait'), false);
  });

  test('applies a staged draft: new map id, conflict rename, tileset add, reference rewrite', () => {
    const scan = scanExternalMapImport(root, target, req([1]), LANG);
    const apply = applyExternalMapImport(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapIds: [1],
        anchorParentId: 0,
        options: FULL_EVENTS,
        resources: scan.resources.map((row) => ({ key: row.key, action: row.defaultAction })),
        tilesets: scan.tilesets.map((row) => ({ sourceTilesetId: row.sourceTilesetId, action: 'add' as const })),
      },
      LANG,
    );
    assert.deepEqual(apply.mapIds, [2]);

    const map = readStaged(root, target, 'www/data/Map002.json') as Record<string, any>;
    assert.equal(map.tilesetId, 2); // freshly added tileset id
    const events = map.events as any[];
    const picture = events[1].pages[0].list.find((command: any) => command.code === 231);
    assert.equal(picture.parameters[1], 'Portrait_2'); // conflict rename propagated into the command
    assert.equal(events[1].pages[0].image.characterName, 'Hero'); // identical asset kept, not renamed

    assert.equal(fs.readFileSync(stagedPath(root, target, 'www/img/pictures/Portrait_2.png'), 'utf8'), 'portrait-source');
    assert.ok(getProjectFileForRead(root, target, 'www/img/faces/HeroFace.png'));

    const tilesets = readStaged(root, target, 'www/data/Tilesets.json') as any[];
    assert.equal(tilesets[2].tilesetNames[0], 'World_A1');

    const mapInfos = readStaged(root, target, 'www/data/MapInfos.json') as any[];
    assert.equal(mapInfos[2].name, 'Field');
    assert.equal(mapInfos[2].parentId, 0);
  });

  test('overwrite reuses the existing asset path instead of adding a copy', () => {
    const scan = scanExternalMapImport(root, target, req([1]), LANG);
    applyExternalMapImport(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapIds: [1],
        anchorParentId: 0,
        options: FULL_EVENTS,
        resources: scan.resources.map((row) => ({
          key: row.key,
          action: row.key === 'pictures:Portrait' ? 'overwrite' : row.defaultAction,
        })),
        tilesets: scan.tilesets.map((row) => ({ sourceTilesetId: row.sourceTilesetId, action: 'add' as const })),
      },
      LANG,
    );
    // Overwriting keeps the original name and replaces the bytes in place.
    assert.equal(fs.readFileSync(stagedPath(root, target, 'www/img/pictures/Portrait.png'), 'utf8'), 'portrait-source');
    const map = readStaged(root, target, 'www/data/Map002.json') as Record<string, any>;
    const picture = (map.events as any[])[1].pages[0].list.find((command: any) => command.code === 231);
    assert.equal(picture.parameters[1], 'Portrait');
  });

  test('import surfaces the unmapped-ids warning for cross-project references', () => {
    const scan = scanExternalMapImport(root, target, req([1]), LANG);
    assert.ok(scan.warnings.some((warning) => warning.code === 'unmapped-ids'));
  });

  test('import tileset overwrite reuses the chosen target tileset id and row', () => {
    const scan = scanExternalMapImport(root, target, req([1]), LANG);
    const apply = applyExternalMapImport(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapIds: [1],
        anchorParentId: 0,
        options: FULL_EVENTS,
        resources: scan.resources.map((row) => ({ key: row.key, action: row.defaultAction })),
        tilesets: [{ sourceTilesetId: 1, action: 'overwrite', targetTilesetId: 1 }],
      },
      LANG,
    );
    const map = readStaged(root, target, `www/data/Map${String(apply.mapIds[0]).padStart(3, '0')}.json`) as Record<string, any>;
    assert.equal(map.tilesetId, 1);
    const tilesets = readStaged(root, target, 'www/data/Tilesets.json') as any[];
    assert.equal(tilesets.length, 2); // overwrite in place, no new row
    assert.equal(tilesets[1].name, 'World');
    assert.equal(tilesets[1].tilesetNames[0], 'World_A1');
  });

  test('import tileset ignore points the map at an existing tileset without copying images', () => {
    const scan = scanExternalMapImport(root, target, req([1]), LANG);
    const apply = applyExternalMapImport(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapIds: [1],
        anchorParentId: 0,
        options: FULL_EVENTS,
        resources: scan.resources.map((row) => ({ key: row.key, action: row.defaultAction })),
        tilesets: [{ sourceTilesetId: 1, action: 'ignore', targetTilesetId: 1 }],
      },
      LANG,
    );
    const map = readStaged(root, target, `www/data/Map${String(apply.mapIds[0]).padStart(3, '0')}.json`) as Record<string, any>;
    assert.equal(map.tilesetId, 1);
    const tilesets = readStaged(root, target, 'www/data/Tilesets.json') as any[];
    assert.equal(tilesets.length, 2);
    assert.ok(!getProjectFileForRead(root, target, 'www/img/tilesets/World_A1.png'));
  });

  test('replace keeps the target identity and takes the source body', () => {
    const scan = scanExternalMapReplace(root, target, replaceReq(1, 1, REPLACE_OVERWRITE), LANG);
    assert.equal(scan.maps.length, 1);
    assert.equal(scan.maps[0].newMapId, 1);
    const apply = applyExternalMapReplace(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapId: 1,
        targetMapId: 1,
        options: REPLACE_OVERWRITE,
        resources: scan.resources.map((row) => ({ key: row.key, action: row.defaultAction })),
        tilesets: scan.tilesets.map((row) => ({ sourceTilesetId: row.sourceTilesetId, action: 'add' as const })),
      },
      LANG,
    );
    assert.deepEqual(apply.mapIds, [1]);

    const map = readStaged(root, target, 'www/data/Map001.json') as Record<string, any>;
    assert.equal(map.width, 12); // source dimensions
    assert.equal(map.height, 12);
    assert.equal(map.displayName, 'HomeDisplay'); // target displayName preserved
    assert.equal(map.tilesetId, 2); // source tileset added as a new row

    // MapInfos is untouched: id/name/parent/order stay as the target's.
    const mapInfos = readStaged(root, target, 'www/data/MapInfos.json') as any[];
    assert.equal(mapInfos[1].name, 'Home');
    assert.equal(mapInfos[1].parentId, 0);
    assert.equal(mapInfos[1].order, 1);
  });

  test('replace overwrites events when asked and rewrites their asset references', () => {
    const scan = scanExternalMapReplace(root, target, replaceReq(1, 1, REPLACE_OVERWRITE), LANG);
    applyExternalMapReplace(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapId: 1,
        targetMapId: 1,
        options: REPLACE_OVERWRITE,
        resources: scan.resources.map((row) => ({ key: row.key, action: row.defaultAction })),
        tilesets: scan.tilesets.map((row) => ({ sourceTilesetId: row.sourceTilesetId, action: 'add' as const })),
      },
      LANG,
    );
    const map = readStaged(root, target, 'www/data/Map001.json') as Record<string, any>;
    const npc = (map.events as any[])[1];
    assert.equal(npc.name, 'NPC'); // source event replaced the target's
    const picture = npc.pages[0].list.find((command: any) => command.code === 231);
    assert.equal(picture.parameters[1], 'Portrait_2'); // conflict rename rewritten in the replaced map
  });

  test('replace keeps target events and warns when the source map is smaller', () => {
    // Target keeps an event at (9,9); source map 2 is 8x8, so the kept event is out of bounds.
    const scan = scanExternalMapReplace(root, target, replaceReq(2, 1, REPLACE_KEEP), LANG);
    assert.ok(scan.warnings.some((warning) => warning.code === 'out-of-bounds-events'));
    const apply = applyExternalMapReplace(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapId: 2,
        targetMapId: 1,
        options: REPLACE_KEEP,
        resources: scan.resources.map((row) => ({ key: row.key, action: row.defaultAction })),
        tilesets: scan.tilesets.map((row) => ({ sourceTilesetId: row.sourceTilesetId, action: 'add' as const })),
      },
      LANG,
    );
    assert.deepEqual(apply.mapIds, [1]);
    const map = readStaged(root, target, 'www/data/Map001.json') as Record<string, any>;
    assert.equal(map.width, 8); // source dimensions
    const guard = (map.events as any[])[1];
    assert.equal(guard.name, 'Guard'); // target event preserved
    assert.equal(guard.x, 9); // not moved or removed
  });

  test('replace tileset ignore reuses the target map tilesetId and adds no tileset row', () => {
    const scan = scanExternalMapReplace(root, target, replaceReq(1, 1, REPLACE_OVERWRITE), LANG);
    const apply = applyExternalMapReplace(
      root,
      target,
      {
        sourceProjectPath: source,
        sourceMapId: 1,
        targetMapId: 1,
        options: REPLACE_OVERWRITE,
        resources: scan.resources.map((row) => ({ key: row.key, action: row.defaultAction })),
        tilesets: scan.tilesets.map((row) => ({ sourceTilesetId: row.sourceTilesetId, action: 'ignore' as const })),
      },
      LANG,
    );
    assert.deepEqual(apply.mapIds, [1]);
    const map = readStaged(root, target, 'www/data/Map001.json') as Record<string, any>;
    assert.equal(map.tilesetId, 1); // target's own tileset id, reused
    const tilesets = readStaged(root, target, 'www/data/Tilesets.json') as any[];
    assert.equal(tilesets.length, 2); // no new tileset row
  });
});

function req(sourceMapIds: number[], options: ExternalMapImportOptions = FULL_EVENTS) {
  return { sourceProjectPath: sourceOf(), sourceMapIds, options };
}

function replaceReq(sourceMapId: number, targetMapId: number, options: ExternalMapReplaceOptions) {
  return { sourceProjectPath: sourceOf(), sourceMapId, targetMapId, options };
}

// The active source path is captured per test run; req() is only called inside a test scope.
let activeSource = '';
function sourceOf(): string {
  return activeSource;
}

function stagedPath(root: string, project: string, relative: string): string {
  const file = getProjectFileForRead(root, project, relative);
  assert.ok(file, `expected a staged/committed file for ${relative}`);
  return file;
}

function readStaged(root: string, project: string, relative: string): unknown {
  return readJson(stagedPath(root, project, relative));
}

function createSourceProject(project: string): void {
  activeSource = project;
  const data = writeMvSkeleton(project);
  writeJson(path.join(data, 'MapInfos.json'), [
    null,
    { id: 1, name: 'Field', parentId: 0, order: 1 },
    { id: 2, name: 'Cave', parentId: 1, order: 2 },
  ]);
  writeJson(path.join(data, 'Tilesets.json'), [
    null,
    { id: 1, name: 'World', mode: 1, tilesetNames: ['World_A1', '', '', '', '', '', '', '', ''], flags: [] },
  ]);
  writeJson(path.join(data, 'Map001.json'), {
    width: 12,
    height: 12,
    tilesetId: 1,
    displayName: 'FieldDisplay',
    parallaxName: 'Sky',
    battleback1Name: '',
    battleback2Name: '',
    bgm: { name: '', volume: 90, pitch: 100, pan: 0 },
    bgs: { name: '', volume: 90, pitch: 100, pan: 0 },
    data: [],
    events: [
      null,
      {
        id: 1,
        name: 'NPC',
        x: 1,
        y: 1,
        pages: [
          {
            image: { characterName: 'Hero', characterIndex: 0 },
            list: [
              { code: 101, parameters: ['HeroFace', 0, 0, 2] },
              { code: 231, parameters: [1, 'Portrait', 0, 0, 0, 100, 100, 255, 0] },
              { code: 250, parameters: [{ name: 'Bell', volume: 90, pitch: 100, pan: 0 }] },
              { code: 201, parameters: [0, 5, 3, 4, 0, 0] },
              { code: 0, parameters: [] },
            ],
          },
        ],
      },
    ],
  });
  writeJson(path.join(data, 'Map002.json'), { width: 8, height: 8, tilesetId: 1, data: [], events: [null] });

  writeAsset(project, 'www/img/characters/Hero.png', 'hero-shared');
  writeAsset(project, 'www/img/faces/HeroFace.png', 'face-source');
  writeAsset(project, 'www/img/tilesets/World_A1.png', 'tileset-source');
  writeAsset(project, 'www/img/pictures/Portrait.png', 'portrait-source');
  writeAsset(project, 'www/img/parallaxes/Sky.png', 'sky-source');
  writeAsset(project, 'www/audio/se/Bell.ogg', 'bell-source');
}

function createTargetProject(project: string): void {
  const data = writeMvSkeleton(project);
  writeJson(path.join(data, 'MapInfos.json'), [null, { id: 1, name: 'Home', parentId: 0, order: 1 }]);
  writeJson(path.join(data, 'Tilesets.json'), [
    null,
    { id: 1, name: 'Home', mode: 1, tilesetNames: ['Home_A1', '', '', '', '', '', '', '', ''], flags: [] },
  ]);
  writeJson(path.join(data, 'Map001.json'), {
    width: 10,
    height: 10,
    tilesetId: 1,
    displayName: 'HomeDisplay',
    data: [],
    events: [
      null,
      { id: 1, name: 'Guard', x: 9, y: 9, pages: [{ image: { characterName: '', characterIndex: 0 }, list: [{ code: 0, parameters: [] }] }] },
    ],
  });

  // Hero is byte-identical (=> "same"); Portrait differs (=> "conflict").
  writeAsset(project, 'www/img/characters/Hero.png', 'hero-shared');
  writeAsset(project, 'www/img/pictures/Portrait.png', 'portrait-target');
}

function writeMvSkeleton(project: string): string {
  const data = path.join(project, 'www', 'data');
  fs.mkdirSync(data, { recursive: true });
  writeJson(path.join(data, 'System.json'), { switches: [null], variables: [null], gameTitle: path.basename(project) });
  return data;
}

function writeAsset(project: string, relative: string, body: string): void {
  const absolute = path.join(project, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body, 'utf8');
}
