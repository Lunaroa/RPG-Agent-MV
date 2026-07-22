import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import sharp from 'sharp';

import type { MapOverviewPngExportScene, MapOverviewPngExportStatus } from '../../../../contract/types.ts';
import {
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

async function writeThumbnailCache(workflowRoot: string, project: string, version: string): Promise<void> {
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
      width: 24,
      height: 24,
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
    width: 24,
    height: 24,
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
