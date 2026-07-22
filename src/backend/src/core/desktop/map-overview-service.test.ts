import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { decodePng, encodePng } from '../workflow/map/map-render.ts';
import {
  buildMapOverviewSnapshot,
  buildMapOverviewThumbnail,
  cancelMapOverviewThumbnailSession,
  requestMapOverviewThumbnail,
  resolveMapOverviewThumbnailFile,
} from './map-overview-service.ts';
import { writeStagedProjectJson, discardStagedMap } from './staging-service.ts';
import { resolveAssetRequest } from './asset-service.ts';

describe('map overview snapshot', () => {
  let root: string;
  let project: string;
  let dataDir: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-map-overview-'));
    project = path.join(root, 'projects', 'sample');
    dataDir = path.join(project, 'www', 'data');
    writeJson(path.join(dataDir, 'System.json'), { switches: [null], variables: [null] });
    writeJson(path.join(dataDir, 'Tilesets.json'), [null]);
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('aggregates directional transfers while retaining page and command sources', () => {
    writeInfos(3);
    writeMap(1, [
      event(1, 'Door', [
        page({ switch1Valid: true, switch1Id: 4 }, [transfer(2, 3, 4), transfer(2, 8, 9)]),
        page({ variableValid: true, variableId: 2, variableValue: 7 }, [transfer(1, 1, 1)]),
      ]),
    ]);
    writeMap(2, [event(1, 'Return', [page({}, [transfer(1, 5, 6)])])]);
    writeMap(3, []);

    const snapshot = buildMapOverviewSnapshot(root, project);

    assert.deepEqual(snapshot.edges.map((edge) => [edge.id, edge.count]), [
      ['1->1', 1],
      ['1->2', 2],
      ['2->1', 1],
    ]);
    const repeated = snapshot.edges.find((edge) => edge.id === '1->2')!;
    assert.deepEqual(repeated.sources.map((source) => [source.pageIndex, source.commandIndex, source.targetX, source.targetY]), [
      [0, 0, 3, 4],
      [0, 1, 8, 9],
    ]);
    assert.equal(repeated.sources[0].pageConditions.switch1Id, 4);
    assert.deepEqual(snapshot.nodes.map((node) => [node.id, node.incomingCount, node.outgoingCount]), [
      [1, 2, 3],
      [2, 2, 1],
      [3, 0, 0],
    ]);
  });

  test('counts variable transfers and reports invalid targets without creating fake nodes', () => {
    writeInfos(2);
    writeMap(1, [event(1, 'Gate', [page({}, [dynamicTransfer(), transfer(99, 1, 2)])])]);
    writeMap(2, []);

    const snapshot = buildMapOverviewSnapshot(root, project);

    assert.equal(snapshot.unresolvedTransferCount, 1);
    assert.equal(snapshot.invalidTargetCount, 1);
    assert.deepEqual(snapshot.edges, []);
    assert.deepEqual(snapshot.nodes.map((node) => node.id), [1, 2]);
    assert.equal(snapshot.nodes[0].unresolvedCount, 1);
    assert.equal(snapshot.nodes[0].issues[0].code, 'invalid-target');
    assert.equal(snapshot.nodes[0].issues[0].targetMapId, 99);
  });

  test('keeps missing and invalid map nodes and scans the remaining maps', () => {
    writeInfos(3);
    writeMap(1, [event(1, 'Gate', [page({}, [transfer(2, 1, 1)])])]);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'Map003.json'), '{', 'utf8');

    const snapshot = buildMapOverviewSnapshot(root, project);

    assert.equal(snapshot.edges.length, 1);
    assert.equal(snapshot.nodes.find((node) => node.id === 2)?.readState, 'missing');
    assert.equal(snapshot.nodes.find((node) => node.id === 3)?.readState, 'invalid');
    assert.deepEqual(snapshot.issues.map((issue) => issue.code).sort(), ['map-invalid', 'map-missing']);
  });

  test('returns all 999 registered maps without overlapping relationship identities', () => {
    writeInfos(999);
    for (let mapId = 1; mapId <= 999; mapId += 1) {
      writeMap(mapId, mapId < 999
        ? [event(1, 'Forward', [page({}, [transfer(mapId + 1, 0, 0)])])]
        : []);
    }

    const snapshot = buildMapOverviewSnapshot(root, project);

    assert.equal(snapshot.nodes.length, 999);
    assert.equal(snapshot.edges.length, 998);
    assert.equal(new Set(snapshot.edges.map((edge) => edge.id)).size, 998);
  });

  test('renders and caches a fixed thumbnail with parallax, tiles, and first-page event graphics', () => {
    writeInfos(1);
    writeJson(path.join(dataDir, 'Tilesets.json'), [
      null,
      { id: 1, tilesetNames: ['', '', '', '', '', 'Ground'] },
    ]);
    writeSolidPng(path.join(project, 'www', 'img', 'tilesets', 'Ground.png'), 768, 768, [30, 180, 70, 255]);
    writeSolidPng(path.join(project, 'www', 'img', 'parallaxes', 'Sky.png'), 24, 24, [30, 80, 190, 255]);
    writeSolidPng(path.join(project, 'www', 'img', 'characters', '$Guide.png'), 144, 192, [210, 50, 60, 255]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 2,
      height: 2,
      tilesetId: 1,
      parallaxName: 'Sky',
      parallaxShow: true,
      data: [1, 0, 0, 0, ...Array(20).fill(0)],
      events: [null, {
        id: 1,
        name: 'Guide',
        x: 1,
        y: 1,
        pages: [{ image: { tileId: 0, characterName: '$Guide', characterIndex: 0, direction: 2, pattern: 1 }, list: [] }],
      }],
    });

    const version = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    const first = buildMapOverviewThumbnail(root, project, 1, version, 'standard');
    const second = buildMapOverviewThumbnail(root, project, 1, version, 'standard');
    const file = resolveMapOverviewThumbnailFile(root, project, 1, version, 'standard');
    const decoded = decodePng(fs.readFileSync(file));

    assert.equal(first.width, 240);
    assert.equal(first.height, 144);
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(second.resourceUrl, first.resourceUrl);
    assert.equal(resolveAssetRequest(root, first.resourceUrl), file);
    assert.throws(() => resolveAssetRequest(root, first.resourceUrl.replace('/standard.png', '/../standard.png')));
    assert.ok(hasColor(decoded.rgba, [30, 80, 190]));
    assert.ok(hasColor(decoded.rgba, [30, 180, 70]));
    assert.ok(hasColor(decoded.rgba, [210, 50, 60]));
  });

  test('persists a validated snapshot and rebuilds it after source or staged map changes', () => {
    writeInfos(2);
    writeMap(1, [event(1, 'Gate', [page({}, [transfer(2, 1, 1)])])]);
    writeMap(2, []);

    const first = buildMapOverviewSnapshot(root, project);
    const cacheFile = findFile(path.join(root, 'runtime', 'map-overview-cache'), 'snapshot-v2.json');
    const cacheMtime = fs.statSync(cacheFile).mtimeMs;
    const second = buildMapOverviewSnapshot(root, project);
    assert.equal(second.generatedAt, first.generatedAt);
    assert.equal(fs.statSync(cacheFile).mtimeMs, cacheMtime);

    const stagedMap = {
      width: 2,
      height: 2,
      tilesetId: 0,
      data: Array(24).fill(0),
      events: [null, event(1, 'Gate', [page({}, [transfer(1, 2, 2)])])],
    };
    writeStagedProjectJson(root, project, 'www/data/Map001.json', stagedMap);
    const staged = buildMapOverviewSnapshot(root, project);
    assert.deepEqual(staged.edges.map((edge) => edge.id), ['1->1']);

    discardStagedMap(root, project, 1);
    const discarded = buildMapOverviewSnapshot(root, project);
    assert.deepEqual(discarded.edges.map((edge) => edge.id), ['1->2']);
  });

  test('recovers from a corrupt snapshot cache without serving stale data', () => {
    writeInfos(1);
    writeMap(1, []);
    const first = buildMapOverviewSnapshot(root, project);
    const cacheFile = findFile(path.join(root, 'runtime', 'map-overview-cache'), 'snapshot-v2.json');
    fs.writeFileSync(cacheFile, '{', 'utf8');
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 3,
      height: 2,
      tilesetId: 0,
      data: Array(36).fill(0),
      events: [null],
    });

    const rebuilt = buildMapOverviewSnapshot(root, project);
    assert.equal(rebuilt.nodes[0].width, 3);
    assert.notEqual(rebuilt.snapshotVersion, first.snapshotVersion);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
  });

  test('invalidates the snapshot for map list, tileset, and referenced image changes', () => {
    writeInfos(1);
    const tilesetFile = path.join(dataDir, 'Tilesets.json');
    const imageFile = path.join(project, 'www', 'img', 'tilesets', 'Ground.png');
    writeJson(tilesetFile, [null, { id: 1, tilesetNames: ['', '', '', '', '', 'Ground'] }]);
    writeSolidPng(imageFile, 48, 48, [10, 20, 30, 255]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 1,
      height: 1,
      tilesetId: 1,
      data: Array(6).fill(0),
      events: [null],
    });
    const first = buildMapOverviewSnapshot(root, project);

    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Renamed Sample', parentId: 0, order: 1 }]);
    const renamed = buildMapOverviewSnapshot(root, project);
    assert.equal(renamed.nodes[0].name, 'Renamed Sample');
    assert.notEqual(renamed.snapshotVersion, first.snapshotVersion);

    writeJson(tilesetFile, [null, { id: 1, tilesetNames: ['', '', '', '', '', 'Ground'], mode: 1 }]);
    const tilesetChanged = buildMapOverviewSnapshot(root, project);
    assert.notEqual(tilesetChanged.nodes[0].thumbnailVersion, renamed.nodes[0].thumbnailVersion);

    writeSolidPng(imageFile, 48, 48, [40, 50, 60, 255]);
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(imageFile, future, future);
    const resourceChanged = buildMapOverviewSnapshot(root, project);
    assert.notEqual(resourceChanged.nodes[0].thumbnailVersion, tilesetChanged.nodes[0].thumbnailVersion);
  });

  test('keeps three quality variants for the current content version and makes letterboxing transparent', () => {
    writeInfos(1);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, tilesetNames: [] }]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 4,
      height: 1,
      tilesetId: 1,
      data: Array(24).fill(0),
      events: [null],
    });
    const version = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;

    const standard = buildMapOverviewThumbnail(root, project, 1, version, 'standard');
    const high = buildMapOverviewThumbnail(root, project, 1, version, 'high');
    const ultra = buildMapOverviewThumbnail(root, project, 1, version, 'ultra');
    assert.deepEqual([standard.width, standard.height], [240, 144]);
    assert.deepEqual([high.width, high.height], [480, 288]);
    assert.deepEqual([ultra.width, ultra.height], [720, 432]);
    const decoded = decodePng(fs.readFileSync(resolveMapOverviewThumbnailFile(root, project, 1, version, 'high')));
    assert.equal(decoded.rgba[3], 0);
    const cacheFiles = fs.readdirSync(path.dirname(resolveMapOverviewThumbnailFile(root, project, 1, version, 'high')));
    assert.equal(cacheFiles.filter((name) => name.includes(version)).length, 3);

    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 5,
      height: 1,
      tilesetId: 1,
      data: Array(30).fill(0),
      events: [null],
    });
    const nextVersion = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    buildMapOverviewThumbnail(root, project, 1, nextVersion, 'high');
    const refreshedFiles = fs.readdirSync(path.dirname(resolveMapOverviewThumbnailFile(root, project, 1, nextVersion, 'high')));
    assert.equal(refreshedFiles.some((name) => name.includes(version)), false);
    assert.equal(refreshedFiles.some((name) => name.includes(nextVersion) && name.endsWith('-high.png')), true);
  });

  test('generates ultra thumbnails in a cancellable worker without blocking the caller', async () => {
    writeInfos(1);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, tilesetNames: [] }]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 2,
      height: 2,
      tilesetId: 1,
      data: [],
      events: [null],
    });
    const version = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    let settled = false;
    const request = requestMapOverviewThumbnail(root, project, 1, version, 'ultra', 'worker-session')
      .finally(() => { settled = true; });
    const coalesced = requestMapOverviewThumbnail(root, project, 1, version, 'ultra', 'coalesced-session');

    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    const thumbnail = await request;
    assert.strictEqual(await coalesced, thumbnail);
    assert.deepEqual([thumbnail.width, thumbnail.height, thumbnail.cacheHit], [720, 432, false]);

    const canceled = requestMapOverviewThumbnail(root, project, 1, version, 'standard', 'cancel-session');
    cancelMapOverviewThumbnailSession('cancel-session');
    await assert.rejects(canceled, (error: Error) => error.name === 'AbortError');
  });

  function writeInfos(count: number): void {
    writeJson(path.join(dataDir, 'MapInfos.json'), [
      null,
      ...Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        name: `Sample Map ${index + 1}`,
        parentId: 0,
        order: index + 1,
        expanded: true,
      })),
    ]);
  }

  function writeMap(mapId: number, events: unknown[]): void {
    writeJson(path.join(dataDir, `Map${String(mapId).padStart(3, '0')}.json`), {
      width: 2,
      height: 2,
      tilesetId: 0,
      data: Array(24).fill(0),
      events: [null, ...events],
    });
  }
});

function findFile(root: string, fileName: string): string {
  const found = findFileOrNull(root, fileName);
  if (found) return found;
  throw new Error(`Expected ${fileName} under temporary cache root.`);
}

function findFileOrNull(root: string, fileName: string): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileOrNull(candidate, fileName);
      if (nested) return nested;
    } else if (entry.name === fileName) {
      return candidate;
    }
  }
  return null;
}

function writeSolidPng(
  file: string,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): void {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
    rgba[offset + 3] = color[3];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(width, height, rgba));
}

function hasColor(rgba: Buffer, color: readonly [number, number, number]): boolean {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset] === color[0] && rgba[offset + 1] === color[1] && rgba[offset + 2] === color[2]) return true;
  }
  return false;
}

function event(id: number, name: string, pages: unknown[]): Record<string, unknown> {
  return { id, name, x: 0, y: 0, pages };
}

function page(conditions: Record<string, unknown>, list: unknown[]): Record<string, unknown> {
  return { conditions, image: {}, list };
}

function transfer(mapId: number, x: number, y: number): Record<string, unknown> {
  return { code: 201, indent: 0, parameters: [0, mapId, x, y, 2, 0] };
}

function dynamicTransfer(): Record<string, unknown> {
  return { code: 201, indent: 0, parameters: [1, 3, 4, 5, 2, 0] };
}
