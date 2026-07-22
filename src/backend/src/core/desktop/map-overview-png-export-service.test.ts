import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { MapOverviewPngExportScene } from '../../../../contract/types.ts';
import {
  cancelMapOverviewPngExport,
  getMapOverviewPngExportStatus,
  initializeMapOverviewPngExportService,
  startMapOverviewPngExport,
} from './map-overview-png-export-service.ts';

test('PNG export service enforces one global task and cancellation preserves the target', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-map-export-service-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', 'sample');
  fs.mkdirSync(project, { recursive: true });
  const outputPath = path.join(root, 'existing.png');
  fs.writeFileSync(outputPath, 'existing target', 'utf8');
  const scene = makeScene(project, 'service-export-1');
  initializeMapOverviewPngExportService(root);

  const started = startMapOverviewPngExport({ workflowRoot: root, project, outputPath, scene });
  assert.equal(started.phase, 'preflight');
  assert.throws(() => startMapOverviewPngExport({
    workflowRoot: root,
    project,
    outputPath: path.join(root, 'second.png'),
    scene: makeScene(project, 'service-export-2'),
  }), /already running/);

  const cancelled = await cancelMapOverviewPngExport(scene.requestId);
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(cancelled.canceled, true);
  assert.equal(getMapOverviewPngExportStatus()?.requestId, scene.requestId);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'existing target');
  assert.equal(fs.existsSync(path.join(root, 'runtime', 'map-overview-exports', `${scene.requestId}.json`)), false);
});

function makeScene(project: string, requestId: string): MapOverviewPngExportScene {
  return {
    requestId,
    project,
    projectName: 'Sample',
    snapshotVersion: 'snapshot-v1',
    nodes: [{
      id: 1,
      name: 'Sample',
      readState: 'missing',
      mapWidth: 2,
      mapHeight: 2,
      thumbnailVersion: null,
      position: { x: 0, y: 0 },
    }],
    edges: [],
  };
}
