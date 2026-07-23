import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import sharp from 'sharp';

import { mapOverviewTransferConditionVisual } from '../../../../contract/map-overview-transfer-condition.ts';
import type { MapOverviewPngExportScene, MapOverviewPngExportStatus } from '../../../../contract/types.ts';
import {
  mapOverviewSvgEdgeGeometry,
  mapOverviewSvgExportBounds,
  mapOverviewSvgNodeGeometry,
} from '../../../../contract/map-overview-svg-geometry.ts';

const WORKER_URL = new URL('./map-overview-png-export-worker.ts', import.meta.url);
const WORKER_EXEC_ARGV = ['--experimental-strip-types', '--experimental-transform-types'];

test('PNG export worker writes a transparent 1:1 overview through Sharp', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-map-export-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', 'sample');
  fs.mkdirSync(project, { recursive: true });
  const outputPath = path.join(root, 'sample-map-overview.png');
  const thumbnailVersion = 'a'.repeat(20);
  await writeThumbnailCache(root, project, thumbnailVersion);
  const scene = makeScene(project, 2, 2, thumbnailVersion);

  const status = await runWorker(root, outputPath, scene);
  assert.equal(status.phase, 'completed');
  assert.equal(status.outputPath, outputPath);
  const geometry = mapOverviewSvgNodeGeometry({ id: 1, name: 'Sample', readState: 'ready', width: 2, height: 2 }, { x: 0, y: 0 });
  const expected = mapOverviewSvgExportBounds([geometry], []);
  const metadata = await sharp(outputPath).metadata();
  assert.equal(metadata.width, expected.width);
  assert.equal(metadata.height, expected.height);
  assert.equal(metadata.hasAlpha, true);
  const pixel = await sharp(outputPath)
    .extract({ left: expected.translateX - 10, top: expected.translateY - 10, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.deepEqual([...pixel], [255, 0, 0, 255]);
  assert.equal(fs.existsSync(path.join(root, 'runtime', 'map-overview-exports', `${scene.requestId}.json`)), false);
});

test('PNG export worker uses the shared transfer-condition color', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-map-export-condition-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', 'sample');
  fs.mkdirSync(project, { recursive: true });
  const outputPath = path.join(root, 'condition-map-overview.png');
  const thumbnailVersion = 'b'.repeat(20);
  await writeThumbnailCache(root, project, thumbnailVersion);
  const scene = makeScene(project, 2, 2, thumbnailVersion);
  scene.edges.push({
    id: 'condition-edge',
    sourceMapId: 1,
    sourceX: 0,
    sourceY: 0,
    targetMapId: 1,
    targetX: 0,
    targetY: 0,
    count: 1,
    conditionCategory: 'variable',
  });

  const status = await runWorker(root, outputPath, scene);
  assert.equal(status.phase, 'completed');
  const { data, info } = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const expectedColor = hexToRgb(mapOverviewTransferConditionVisual('variable').stroke);
  let foundVariableColor = false;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const distance = Math.abs(data[offset] - expectedColor.red)
      + Math.abs(data[offset + 1] - expectedColor.green)
      + Math.abs(data[offset + 2] - expectedColor.blue);
    if (data[offset + 3] > 0 && distance <= 36) {
      foundVariableColor = true;
      break;
    }
  }
  assert.equal(foundVariableColor, true);
});

test('PNG export worker draws visible relationships above map thumbnails', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-map-export-layer-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', 'sample');
  fs.mkdirSync(project, { recursive: true });
  const outputPath = path.join(root, 'layered-map-overview.png');
  const thumbnailVersion = 'c'.repeat(20);
  await writeThumbnailCache(root, project, thumbnailVersion, 36, 36);
  const scene = makeScene(project, 3, 3, thumbnailVersion);
  scene.edges.push({
    id: 'visible-over-map',
    sourceMapId: 1,
    sourceX: 0,
    sourceY: 0,
    targetMapId: 1,
    targetX: 2,
    targetY: 2,
    count: 1,
    conditionCategory: 'none',
  });

  const status = await runWorker(root, outputPath, scene);
  assert.equal(status.phase, 'completed');
  const node = mapOverviewSvgNodeGeometry(
    { id: 1, name: 'Sample', readState: 'ready', width: 3, height: 3 },
    { x: 0, y: 0 },
  );
  const geometry = mapOverviewSvgEdgeGeometry(scene.edges[0], new Map([[node.id, node]]));
  const bounds = mapOverviewSvgExportBounds([node], [geometry]);
  const sourceX = Math.round(geometry.source.x + bounds.translateX);
  const sourceY = Math.round(geometry.source.y + bounds.translateY);
  const { data, info } = await sharp(outputPath)
    .extract({ left: sourceX - 2, top: sourceY - 2, width: 5, height: 5 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let foundRelationshipPixel = false;
  let foundWhiteEndpointOutline = false;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] !== 255 || data[offset + 1] !== 0 || data[offset + 2] !== 0) {
      foundRelationshipPixel = true;
    }
    foundWhiteEndpointOutline ||= data[offset] > 240 && data[offset + 1] > 240 && data[offset + 2] > 240
  }
  assert.equal(foundRelationshipPixel, true);
  assert.equal(foundWhiteEndpointOutline, false);
});

test('PNG export worker rejects oversized output without replacing an existing target', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-map-export-limit-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', 'sample');
  fs.mkdirSync(project, { recursive: true });
  const outputPath = path.join(root, 'existing.png');
  fs.writeFileSync(outputPath, 'existing target', 'utf8');

  const status = await runWorker(root, outputPath, makeScene(project, 2_800, 1));
  assert.equal(status.phase, 'failed');
  assert.equal(status.errorCode, 'size-limit');
  assert.ok((status.width || 0) > 32_767);
  assert.match(status.error || '', /32767/);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'existing target');
});

function makeScene(
  project: string,
  mapWidth: number,
  mapHeight: number,
  thumbnailVersion: string | null = null,
): MapOverviewPngExportScene {
  return {
    requestId: `test_${mapWidth}_${mapHeight}`,
    project,
    projectName: 'Sample',
    snapshotVersion: 'snapshot-v1',
    nodes: [{
      id: 1,
      name: 'Sample',
      readState: thumbnailVersion ? 'ready' : 'missing',
      mapWidth,
      mapHeight,
      thumbnailVersion,
      position: { x: 0, y: 0 },
    }],
    edges: [],
  };
}

async function writeThumbnailCache(
  workflowRoot: string,
  project: string,
  version: string,
  width = 24,
  height = 24,
): Promise<void> {
  const projectKey = crypto.createHash('sha256').update(path.resolve(project).toLocaleLowerCase()).digest('hex').slice(0, 20);
  const cacheFile = path.join(
    workflowRoot,
    'runtime',
    'map-overview-thumbnails',
    projectKey,
    'Map001',
    `${version}.json`,
  );
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const png = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  }).png().toBuffer();
  fs.writeFileSync(cacheFile, `${JSON.stringify({
    schemaVersion: 1,
    project: path.resolve(project),
    mapId: 1,
    version,
    scaleDivisor: 4,
    width,
    height,
    mime: 'image/png',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    warnings: [],
  })}\n`, 'utf8');
}

function runWorker(
  workflowRoot: string,
  outputPath: string,
  scene: MapOverviewPngExportScene,
): Promise<MapOverviewPngExportStatus> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { execArgv: WORKER_EXEC_ARGV });
    let settled = false;
    const finish = (status: MapOverviewPngExportStatus) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    worker.on('message', (message: { type: string; status: MapOverviewPngExportStatus }) => {
      if (message.type === 'complete' || message.type === 'failed') finish(message.status);
    });
    worker.on('error', reject);
    worker.on('exit', code => {
      if (!settled && code !== 0) reject(new Error(`Export worker exited with code ${code}.`));
    });
    worker.postMessage({ workflowRoot, project: scene.project, outputPath, scene });
  });
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}
