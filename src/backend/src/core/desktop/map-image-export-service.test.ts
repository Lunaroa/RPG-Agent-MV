import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import sharp from 'sharp';

import type { MapImageExportScene } from '../../../../contract/types.ts';
import { buildExtendedTilesetDescriptors } from '../../../../contract/extended-tileset.ts';
import { decodePng } from '../workflow/map/map-render.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import {
  cancelMapImageExportPreview,
  generateMapImageExportPreview,
  validateMapImageExportPreviewForFinalization,
} from './map-image-export-service.ts';

describe('map image export worker', { concurrency: false }, () => {
  let databaseRoot = '';

  beforeEach(async () => {
    databaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-map-image-export-db-'));
    await bootstrapDatabase(databaseRoot, {
      dbPath: path.join(databaseRoot, 'data', 'map-image-export.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(databaseRoot, { recursive: true, force: true });
  });

test('preserves transparency and exact 1-100 percent dimensions', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-100');

  const full = await generateMapImageExportPreview(fixture.root, fixture.project, scene);
  assert.equal(full.width, 96);
  assert.equal(full.height, 48);
  const fullPng = decodePng(Buffer.from(full.pngBase64, 'base64'));
  assert.equal(fullPng.rgba.every((value, index) => index % 4 !== 3 || value === 0), true);

  const onePercent = await generateMapImageExportPreview(fixture.root, fixture.project, {
    ...scene,
    requestId: 'map-image-1',
    options: { ...scene.options, scalePercent: 1 },
  });
  assert.deepEqual([onePercent.width, onePercent.height], [1, 1]);

  const half = await generateMapImageExportPreview(fixture.root, fixture.project, {
    ...scene,
    requestId: 'map-image-50',
    options: { ...scene.options, scalePercent: 50 },
  });
  assert.deepEqual([half.width, half.height], [48, 24]);
});

test('rejects a stale dialog snapshot', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-stale');
  fs.writeFileSync(fixture.mapFile, JSON.stringify({ width: 1, height: 1, tilesetId: 1, data: Array(6).fill(0), events: [null] }), 'utf8');
  await assert.rejects(
    generateMapImageExportPreview(fixture.root, fixture.project, scene),
    /MAP_IMAGE_REVISION_STALE/,
  );
});

test('reports the highest acceptable scale before allocating an oversized image', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(fixture.mapFile, JSON.stringify({
    width: 1000,
    height: 1000,
    tilesetId: 1,
    data: [],
    events: [null],
  }), 'utf8');
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-size-limit');

  await assert.rejects(
    generateMapImageExportPreview(fixture.root, fixture.project, scene),
    /MAP_IMAGE_SIZE_LIMIT.*at most 46%/,
  );
});

test('fails recoverably when an image resource disappears after the dialog opens', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const names = Array(9).fill('');
  names[5] = 'MissingSheet';
  fs.writeFileSync(path.join(fixture.project, 'www', 'data', 'Tilesets.json'), JSON.stringify([
    null,
    { id: 1, tilesetNames: names, flags: [] },
  ]), 'utf8');
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-resource-missing');

  await assert.rejects(
    generateMapImageExportPreview(fixture.root, fixture.project, scene),
    /MAP_IMAGE_RESOURCE_MISSING.*MissingSheet/,
  );
});

test('revalidates a trusted preview before clipboard or file finalization', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-finalize');
  const preview = await generateMapImageExportPreview(fixture.root, fixture.project, scene);
  assert.deepEqual(await validateMapImageExportPreviewForFinalization(preview, false), {
    project: fixture.project,
    mapId: 1,
    mapName: 'Sample',
  });
  await assert.rejects(
    validateMapImageExportPreviewForFinalization({ ...preview, pngBase64: `${preview.pngBase64}AA` }, false),
    /MAP_IMAGE_PREVIEW_INVALID/,
  );

  fs.writeFileSync(fixture.mapFile, JSON.stringify({
    width: 1, height: 1, tilesetId: 1, data: Array(6).fill(0), events: [null],
  }), 'utf8');
  await assert.rejects(
    validateMapImageExportPreviewForFinalization(preview, false),
    /MAP_IMAGE_REVISION_STALE/,
  );

  assert.equal((await cancelMapImageExportPreview(preview.requestId)).canceled, true);
  await assert.rejects(
    validateMapImageExportPreviewForFinalization(preview, false),
    /MAP_IMAGE_PREVIEW_INVALID/,
  );
});

test('draws only the first-page default character frame when requested', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const characters = path.join(fixture.project, 'www', 'img', 'characters');
  fs.mkdirSync(characters, { recursive: true });
  await sharp({ create: { width: 576, height: 384, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 48, height: 48, channels: 4, background: { r: 230, g: 30, b: 50, alpha: 1 } } }, left: 48, top: 0 }])
    .png()
    .toFile(path.join(characters, 'EventCharacter.png'));
  const map = {
    width: 2,
    height: 1,
    tilesetId: 1,
    data: Array(12).fill(0),
    events: [
      null,
      { id: 1, x: 0, y: 0, pages: [{ image: { tileId: 8192, characterName: 'EventCharacter', characterIndex: 0, pattern: 1, direction: 2 } }] },
      { id: 2, x: 1, y: 0, pages: [
        { image: { tileId: 0, characterName: 'EventCharacter', characterIndex: 0, pattern: 2, direction: 8 } },
        { image: { tileId: 0, characterName: '', characterIndex: 0, pattern: 0, direction: 2 } },
      ] },
    ],
  };
  fs.writeFileSync(fixture.mapFile, JSON.stringify(map), 'utf8');
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-events');
  const withoutEvents = decodePng(Buffer.from((await generateMapImageExportPreview(fixture.root, fixture.project, scene)).pngBase64, 'base64'));
  assert.equal(pixel(withoutEvents, 60, 12)[3], 0);

  const withEvents = decodePng(Buffer.from((await generateMapImageExportPreview(fixture.root, fixture.project, {
    ...scene,
    requestId: 'map-image-events-enabled',
    options: { ...scene.options, includeDefaultEventCharacters: true },
  })).pngBase64, 'base64'));
  assert.deepEqual(pixel(withEvents, 60, 12), [230, 30, 50, 255]);
  assert.equal(pixel(withEvents, 12, 12)[3], 0, 'tile-based event images are excluded');
});

test('composites normal, add, multiply, and screen unlimited layers at t=0', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const tilesets = path.join(fixture.project, 'www', 'img', 'tilesets');
  const parallaxes = path.join(fixture.project, 'www', 'img', 'parallaxes');
  fs.mkdirSync(tilesets, { recursive: true });
  fs.mkdirSync(parallaxes, { recursive: true });
  await writeSolidPng(path.join(tilesets, 'Base.png'), 768, 768, [100, 100, 100, 255]);
  await writeSolidPng(path.join(parallaxes, 'Overlay.png'), 48, 48, [100, 50, 20, 255]);
  const names = Array(9).fill('');
  names[5] = 'Base';
  fs.writeFileSync(path.join(fixture.project, 'www', 'data', 'Tilesets.json'), JSON.stringify([null, { id: 1, tilesetNames: names, flags: [] }]), 'utf8');
  fs.writeFileSync(fixture.mapFile, JSON.stringify({
    width: 4, height: 1, tilesetId: 1, data: [...Array(4).fill(1), ...Array(20).fill(0)], events: [null],
  }), 'utf8');
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-ulds');
  scene.unlimitedLayersEnabled = true;
  scene.options.includeUnlimitedLayers = true;
  scene.unlimitedLayerDraft = [0, 1, 2, 3].map((blendMode, index) => ({
    name: 'Overlay', path: 'parallaxes', x: index * 48, y: 0, z: 0.5,
    'scale.x': 1, 'scale.y': 1, blendMode, opacity: 255, loop: false,
  }));
  const result = decodePng(Buffer.from((await generateMapImageExportPreview(fixture.root, fixture.project, scene)).pngBase64, 'base64'));
  assert.deepEqual(pixel(result, 12, 12), [100, 50, 20, 255]);
  assert.deepEqual(pixel(result, 60, 12), [200, 150, 120, 255]);
  assert.deepEqual(pixel(result, 108, 12), [39, 19, 7, 255]);
  assert.deepEqual(pixel(result, 156, 12), [160, 130, 112, 255]);
});

test('renders all six extended sheet types through the export worker', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const types = ['A1', 'A2', 'A3', 'A4', 'A5', 'normal'] as const;
  const names = [...Array(9).fill(''), ...types.map((type) => `Extra${type}`)];
  const descriptors = buildExtendedTilesetDescriptors(names, types);
  const sizes = [[768, 576], [768, 576], [768, 384], [768, 720], [384, 768], [768, 768]] as const;
  const colors = [[220, 20, 40, 255], [255, 140, 0, 255], [240, 220, 20, 255], [40, 180, 80, 255], [40, 110, 220, 255], [150, 70, 190, 255]] as const;
  const tilesets = path.join(fixture.project, 'www', 'img', 'tilesets');
  fs.mkdirSync(tilesets, { recursive: true });
  for (let index = 0; index < descriptors.length; index += 1) {
    await writeSolidPng(path.join(tilesets, `${names[9 + index]}.png`), sizes[index][0], sizes[index][1], colors[index]);
  }
  const flags = Array(descriptors.at(-1)!.firstTileId + descriptors.at(-1)!.capacity).fill(0);
  fs.writeFileSync(path.join(fixture.project, 'www', 'data', 'Tilesets.json'), JSON.stringify([null, {
    id: 1, tilesetNames: names, flags, rpgAgentExtendedTilesetTypes: types,
  }]), 'utf8');
  const data = Array(6 * 6).fill(0);
  descriptors.forEach((descriptor, index) => { data[index] = descriptor.firstTileId; });
  fs.writeFileSync(fixture.mapFile, JSON.stringify({ width: 6, height: 1, tilesetId: 1, data, events: [null] }), 'utf8');
  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-extended');
  const result = decodePng(Buffer.from((await generateMapImageExportPreview(fixture.root, fixture.project, scene)).pngBase64, 'base64'));
  colors.forEach((color, index) => assert.deepEqual(pixel(result, index * 48 + 12, 12), color));
});

test('loads a tileset image from a safe project-relative subdirectory', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const nestedTilesets = path.join(fixture.project, 'www', 'img', 'tilesets', 'interior');
  fs.mkdirSync(nestedTilesets, { recursive: true });
  await writeSolidPng(path.join(nestedTilesets, 'NestedB.png'), 768, 768, [70, 120, 210, 255]);
  const names = Array(9).fill('');
  names[5] = 'interior/NestedB';
  fs.writeFileSync(path.join(fixture.project, 'www', 'data', 'Tilesets.json'), JSON.stringify([
    null,
    { id: 1, tilesetNames: names, flags: [] },
  ]), 'utf8');
  fs.writeFileSync(fixture.mapFile, JSON.stringify({
    width: 1, height: 1, tilesetId: 1, data: [1, 0, 0, 0, 0, 0], events: [null],
  }), 'utf8');

  const scene = createScene(fixture.project, fixture.mapFile, 100, 'map-image-nested-resource');
  const result = decodePng(Buffer.from((await generateMapImageExportPreview(
    fixture.root,
    fixture.project,
    scene,
  )).pngBase64, 'base64'));
  assert.deepEqual(pixel(result, 12, 12), [70, 120, 210, 255]);
});
});

function createFixture(): { root: string; project: string; mapFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-map-image-export-'));
  const project = path.join(root, 'projects', 'sample');
  const dataDir = path.join(project, 'www', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV 1.6.2', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Sample' }]), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'Tilesets.json'), JSON.stringify([null, { id: 1, tilesetNames: Array(9).fill(''), flags: [] }]), 'utf8');
  const mapFile = path.join(dataDir, 'Map001.json');
  fs.writeFileSync(mapFile, JSON.stringify({ width: 2, height: 1, tilesetId: 1, data: Array(12).fill(0), events: [null] }), 'utf8');
  return { root, project, mapFile };
}

function createScene(
  project: string,
  mapFile: string,
  scalePercent: number,
  requestId: string,
): MapImageExportScene {
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const tilesets = JSON.parse(fs.readFileSync(path.join(project, 'www', 'data', 'Tilesets.json'), 'utf8'));
  const tileset = tilesets[map.tilesetId] || { tilesetNames: [], flags: [] };
  const names = Array.isArray(tileset.tilesetNames) ? tileset.tilesetNames.map((name: unknown) => String(name || '')) : [];
  const flags = Array.isArray(tileset.flags) ? tileset.flags.map((flag: unknown) => Number(flag) || 0) : [];
  return {
    requestId,
    project,
    mapId: 1,
    mapName: 'Sample',
    mapRevision: crypto.createHash('sha256').update(fs.readFileSync(mapFile)).digest('hex'),
    tileSize: 48,
    map,
    tileset: {
      tilesetNames: names,
      flags,
      extendedTilesetSheets: buildExtendedTilesetDescriptors(names, tileset.rpgAgentExtendedTilesetTypes),
    },
    unlimitedLayerDraft: [],
    unlimitedLayersEnabled: false,
    options: {
      scalePercent,
      includeDefaultEventCharacters: false,
      includeUnlimitedLayers: false,
    },
  };
}

function pixel(image: ReturnType<typeof decodePng>, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.rgba.subarray(offset, offset + 4));
}

async function writeSolidPng(
  file: string,
  width: number,
  height: number,
  color: readonly [number, number, number, number],
): Promise<void> {
  await sharp({
    create: { width, height, channels: 4, background: { r: color[0], g: color[1], b: color[2], alpha: color[3] / 255 } },
  }).png().toFile(file);
}
