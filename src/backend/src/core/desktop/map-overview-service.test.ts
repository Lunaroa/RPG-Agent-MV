import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { MapOverviewScanProgress, MapOverviewSnapshot } from '../../../../contract/types.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { decodePng, encodePng } from '../workflow/map/map-render.ts';
import {
  buildMapOverviewSnapshot,
  buildMapOverviewThumbnail,
  cancelMapOverviewThumbnailSession,
  finalizeMapOverviewThumbnailCache,
  mapOverviewThumbnailWorkerConcurrency,
  requestMapOverviewThumbnail,
} from './map-overview-service.ts';
import { writeStagedProjectJson, discardStagedMap } from './staging-service.ts';

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

  test('aggregates transfers only when all six endpoint fields match', () => {
    writeInfos(3);
    writeMap(1, [
      event(1, 'Door', 1, 2, [
        page({ switch1Valid: true, switch1Id: 4 }, [transfer(2, 3, 4), transfer(2, 3, 4), transfer(2, 8, 9)]),
        page({ variableValid: true, variableId: 2, variableValue: 7 }, [transfer(1, 1, 1)]),
      ]),
    ], 10, 10);
    writeMap(2, [event(1, 'Return', 5, 6, [page({}, [transfer(1, 1, 2)])])], 10, 10);
    writeMap(3, [], 10, 10);

    const snapshot = buildMapOverviewSnapshot(root, project);

    assert.deepEqual(snapshot.edges.map((edge) => [edge.id, edge.count]), [
      ['1:1,2->1:1,1', 1],
      ['1:1,2->2:3,4', 2],
      ['1:1,2->2:8,9', 1],
      ['2:5,6->1:1,2', 1],
    ]);
    const repeated = snapshot.edges.find((edge) => edge.id === '1:1,2->2:3,4')!;
    assert.deepEqual(repeated.sources.map((source) => [source.pageIndex, source.commandIndex, source.sourceX, source.sourceY, source.targetX, source.targetY]), [
      [0, 0, 1, 2, 3, 4],
      [0, 1, 1, 2, 3, 4],
    ]);
    assert.equal(repeated.sources[0].pageConditions.switch1Id, 4);
    assert.deepEqual(snapshot.nodes.map((node) => [node.id, node.incomingCount, node.outgoingCount]), [
      [1, 2, 4],
      [2, 3, 1],
      [3, 0, 0],
    ]);
  });

  test('keeps bidirectional and self-loop edges separate by exact coordinates', () => {
    writeInfos(2);
    writeMap(1, [event(1, 'Portal', 0, 0, [page({}, [transfer(2, 1, 1), transfer(1, 0, 0)])])], 4, 4);
    writeMap(2, [event(1, 'Back', 1, 1, [page({}, [transfer(1, 0, 0)])])], 4, 4);

    const snapshot = buildMapOverviewSnapshot(root, project);
    assert.deepEqual(snapshot.edges.map((edge) => edge.id).sort(), [
      '1:0,0->1:0,0',
      '1:0,0->2:1,1',
      '2:1,1->1:0,0',
    ]);
  });

  test('emits invalid-coordinate without clamping or creating edges', () => {
    writeInfos(2);
    writeMap(1, [
      event(1, 'BadTarget', 0, 0, [page({}, [transfer(2, 9, 9)])]),
      event(2, 'BadSource', 9, 9, [page({}, [transfer(2, 0, 0)])]),
    ], 2, 2);
    writeMap(2, [], 2, 2);

    const snapshot = buildMapOverviewSnapshot(root, project);
    assert.deepEqual(snapshot.edges, []);
    const codes = snapshot.issues.filter((issue) => issue.code === 'invalid-coordinate');
    assert.equal(codes.length, 2);
    assert.equal(codes[0].eventId, 1);
    assert.equal(codes[0].targetX, 9);
    assert.equal(codes[0].targetY, 9);
    assert.equal(codes[0].targetMapId, 2);
    assert.equal(codes[1].eventId, 2);
    assert.equal(codes[1].sourceX, 9);
    assert.equal(codes[1].sourceY, 9);
  });

  test('counts variable transfers and reports invalid targets without creating fake nodes', () => {
    writeInfos(2);
    writeMap(1, [event(1, 'Gate', 0, 0, [page({}, [dynamicTransfer(), transfer(99, 1, 2)])])]);
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
    writeMap(1, [event(1, 'Gate', 0, 0, [page({}, [transfer(1, 1, 1)])])]);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'Map003.json'), '{', 'utf8');

    const snapshot = buildMapOverviewSnapshot(root, project);

    assert.equal(snapshot.edges.length, 1);
    assert.equal(snapshot.edges[0].id, '1:0,0->1:1,1');
    assert.equal(snapshot.nodes.find((node) => node.id === 2)?.readState, 'missing');
    assert.equal(snapshot.nodes.find((node) => node.id === 3)?.readState, 'invalid');
    assert.deepEqual(snapshot.issues.map((issue) => issue.code).sort(), ['map-invalid', 'map-missing']);
  });

  test('returns all 999 registered maps without overlapping relationship identities', () => {
    writeInfos(999);
    for (let mapId = 1; mapId <= 999; mapId += 1) {
      writeMap(mapId, mapId < 999
        ? [event(1, 'Forward', 0, 0, [page({}, [transfer(mapId + 1, 0, 0)])])]
        : []);
    }

    const snapshot = buildMapOverviewSnapshot(root, project);

    assert.equal(snapshot.nodes.length, 999);
    assert.equal(snapshot.edges.length, 998);
    assert.equal(new Set(snapshot.edges.map((edge) => edge.id)).size, 998);
  });

  test('renders a complete one-quarter Base64 PNG and reuses the persistent cache', () => {
    writeInfos(1);
    writeJson(path.join(dataDir, 'Tilesets.json'), [
      null,
      { id: 1, tilesetNames: ['', '', '', '', '', 'Ground'] },
    ]);
    writeSolidPng(path.join(project, 'www', 'img', 'tilesets', 'Ground.png'), 768, 768, [30, 180, 70, 255]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 3,
      height: 2,
      tilesetId: 1,
      data: [1, 0, 0, 0, 0, 0, ...Array(30).fill(0)],
      events: [null],
    });

    const version = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    const first = buildMapOverviewThumbnail(root, project, 1, version);
    const second = buildMapOverviewThumbnail(root, project, 1, version);
    const decoded = decodePng(Buffer.from(first.dataUrl.slice('data:image/png;base64,'.length), 'base64'));

    assert.equal(first.scaleDivisor, 4);
    assert.deepEqual([first.width, first.height], [36, 24]);
    assert.deepEqual([decoded.width, decoded.height], [36, 24]);
    assert.equal(first.mime, 'image/png');
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(second.dataUrl, first.dataUrl);
    assert.ok(hasColor(decoded.rgba, [30, 180, 70]));
  });

  test('persists a validated snapshot and rebuilds it after source or staged map changes', () => {
    writeInfos(2);
    writeMap(1, [event(1, 'Gate', 0, 0, [page({}, [transfer(2, 1, 1)])])]);
    writeMap(2, []);

    const first = buildMapOverviewSnapshot(root, project);
    const cacheFile = findFile(path.join(root, 'runtime', 'map-overview-cache'), 'snapshot-v4.json');
    const cacheMtime = fs.statSync(cacheFile).mtimeMs;
    const second = buildMapOverviewSnapshot(root, project);
    assert.equal(second.generatedAt, first.generatedAt);
    assert.equal(fs.statSync(cacheFile).mtimeMs, cacheMtime);

    const stagedMap = {
      width: 2,
      height: 2,
      tilesetId: 0,
      data: Array(24).fill(0),
      events: [null, event(1, 'Gate', 0, 0, [page({}, [transfer(1, 1, 1)])])],
    };
    writeStagedProjectJson(root, project, 'www/data/Map001.json', stagedMap);
    const staged = buildMapOverviewSnapshot(root, project);
    assert.deepEqual(staged.edges.map((edge) => edge.id), ['1:0,0->1:1,1']);

    discardStagedMap(root, project, 1);
    const discarded = buildMapOverviewSnapshot(root, project);
    assert.deepEqual(discarded.edges.map((edge) => edge.id), ['1:0,0->2:1,1']);
  });

  test('reports real progress for map reading, relationship scanning, image versioning, and cache checks', () => {
    writeInfos(2);
    writeMap(1, [event(1, 'Gate', 0, 0, [page({}, [transfer(2, 1, 1)])])]);
    writeMap(2, []);
    const freshProgress: MapOverviewScanProgress[] = [];

    buildMapOverviewSnapshot(root, project, progress => freshProgress.push(progress));

    for (const phase of ['reading-maps', 'scanning-relations', 'preparing-images'] as const) {
      assert.deepEqual(
        freshProgress.filter(progress => progress.phase === phase).map(progress => progress.completed),
        [0, 1, 2],
      );
    }
    const verification = freshProgress.filter(progress => progress.phase === 'verifying-project');
    assert.ok(verification.length > 1);
    assert.equal(verification.at(-1)?.completed, verification.at(-1)?.total);

    const cachedProgress: MapOverviewScanProgress[] = [];
    buildMapOverviewSnapshot(root, project, progress => cachedProgress.push(progress));
    const cacheChecks = cachedProgress.filter(progress => progress.phase === 'checking-cache');
    assert.ok(cacheChecks.length > 1);
    assert.equal(cacheChecks.at(-1)?.completed, cacheChecks.at(-1)?.total);
    assert.equal(cachedProgress.some(progress => progress.phase === 'reading-maps'), false);
  });

  test('recovers from a corrupt snapshot cache without serving stale data', () => {
    writeInfos(1);
    writeMap(1, []);
    const first = buildMapOverviewSnapshot(root, project);
    const cacheFile = findFile(path.join(root, 'runtime', 'map-overview-cache'), 'snapshot-v4.json');
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

  test('rebuilds a snapshot whose thumbnail renderer metadata is stale', () => {
    writeInfos(1);
    writeMap(1, []);
    buildMapOverviewSnapshot(root, project);
    const cacheFile = findFile(path.join(root, 'runtime', 'map-overview-cache'), 'snapshot-v4.json');
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
      thumbnailRendererVersion: number;
      snapshot: MapOverviewSnapshot;
    };
    cached.thumbnailRendererVersion = 0;
    cached.snapshot.nodes[0].thumbnailVersion = 'stale-thumbnail-version';
    fs.writeFileSync(cacheFile, `${JSON.stringify(cached, null, 2)}\n`, 'utf8');

    const rebuilt = buildMapOverviewSnapshot(root, project);
    const persisted = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
      thumbnailRendererVersion: number;
    };
    assert.notEqual(rebuilt.nodes[0].thumbnailVersion, 'stale-thumbnail-version');
    assert.notEqual(persisted.thumbnailRendererVersion, 0);
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
      data: [1, 0, 0, 0, 0, 0],
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

  test('invalidates only maps that use the changed tileset image slot', () => {
    writeInfos(2);
    const tilesetFile = path.join(dataDir, 'Tilesets.json');
    const groundFile = path.join(project, 'www', 'img', 'tilesets', 'Ground.png');
    const decorFile = path.join(project, 'www', 'img', 'tilesets', 'Decor.png');
    writeJson(tilesetFile, [null, { id: 1, tilesetNames: ['', '', '', '', '', 'Ground', 'Decor'] }]);
    writeSolidPng(groundFile, 768, 768, [10, 20, 30, 255]);
    writeSolidPng(decorFile, 768, 768, [40, 50, 60, 255]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 1, height: 1, tilesetId: 1, data: [1, 0, 0, 0, 0, 0], events: [null],
    });
    writeJson(path.join(dataDir, 'Map002.json'), {
      width: 1, height: 1, tilesetId: 1, data: [256, 0, 0, 0, 0, 0], events: [null],
    });
    const before = buildMapOverviewSnapshot(root, project);

    writeSolidPng(groundFile, 768, 768, [70, 80, 90, 255]);
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(groundFile, future, future);
    const after = buildMapOverviewSnapshot(root, project);

    assert.notEqual(after.nodes[0].thumbnailVersion, before.nodes[0].thumbnailVersion);
    assert.equal(after.nodes[1].thumbnailVersion, before.nodes[1].thumbnailVersion);
  });

  test('keeps only the current thumbnail version and rebuilds a corrupt cache atomically', () => {
    writeInfos(1);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, tilesetNames: [] }]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 20,
      height: 20,
      tilesetId: 1,
      data: Array(20 * 20 * 6).fill(0),
      events: [null],
    });
    const version = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    buildMapOverviewThumbnail(root, project, 1, version);
    const cacheFile = findFile(path.join(root, 'runtime', 'map-overview-thumbnails'), `${version}.json`);
    fs.writeFileSync(cacheFile, '{', 'utf8');
    assert.equal(buildMapOverviewThumbnail(root, project, 1, version).cacheHit, false);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cacheFile, 'utf8')));

    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 21,
      height: 20,
      tilesetId: 1,
      data: Array(21 * 20 * 6).fill(0),
      events: [null],
    });
    const nextVersion = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    buildMapOverviewThumbnail(root, project, 1, nextVersion);
    const mapDir = path.dirname(findFile(path.join(root, 'runtime', 'map-overview-thumbnails'), `${nextVersion}.json`));
    assert.deepEqual(fs.readdirSync(mapDir), [`${nextVersion}.json`]);
  });

  test('removes the project legacy chunk cache only after thumbnail collection finalization', () => {
    const legacy = path.join(root, 'runtime', 'map-overview-chunks', projectCacheKeyForTest(project), 'Map001');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'old.png'), 'cache', 'utf8');
    assert.equal(fs.existsSync(legacy), true);
    finalizeMapOverviewThumbnailCache(root, project);
    assert.equal(fs.existsSync(path.join(root, 'runtime', 'map-overview-chunks', projectCacheKeyForTest(project))), false);
  });

  test('uses the bounded worker pool, coalesces matching versions, and cancels by session', async () => {
    assert.equal(mapOverviewThumbnailWorkerConcurrency(1), 1);
    assert.equal(mapOverviewThumbnailWorkerConcurrency(3), 2);
    assert.equal(mapOverviewThumbnailWorkerConcurrency(16), 4);
    writeInfos(1);
    writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, tilesetNames: [] }]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 2,
      height: 2,
      tilesetId: 1,
      data: Array(24).fill(0),
      events: [null],
    });
    const version = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    let settled = false;
    const request = requestMapOverviewThumbnail(root, project, 1, version, 'worker-session')
      .finally(() => { settled = true; });
    const coalesced = requestMapOverviewThumbnail(root, project, 1, version, 'coalesced-session');

    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    const thumbnail = await request;
    assert.equal((await coalesced).dataUrl, thumbnail.dataUrl);
    assert.deepEqual([thumbnail.width, thumbnail.height, thumbnail.cacheHit], [24, 24, false]);

    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 80,
      height: 80,
      tilesetId: 1,
      data: Array(80 * 80 * 6).fill(0),
      events: [null],
    });
    const changedVersion = buildMapOverviewSnapshot(root, project).nodes[0].thumbnailVersion!;
    const canceled = requestMapOverviewThumbnail(root, project, 1, changedVersion, 'cancel-session');
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

  function writeMap(mapId: number, events: unknown[], width = 2, height = 2): void {
    writeJson(path.join(dataDir, `Map${String(mapId).padStart(3, '0')}.json`), {
      width,
      height,
      tilesetId: 0,
      data: Array(width * height * 6).fill(0),
      events: [null, ...events],
    });
  }
});

function projectCacheKeyForTest(project: string): string {
  return crypto.createHash('sha256').update(path.resolve(project).toLocaleLowerCase()).digest('hex').slice(0, 20);
}

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

function event(id: number, name: string, x: number, y: number, pages: unknown[]): Record<string, unknown> {
  return { id, name, x, y, pages };
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
