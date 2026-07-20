import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { verifyIsolatedSourceState } from './isolated-project-preparation.ts';
import {
  MapPreviewPreparationCancelledError,
  MapPreviewPreparationFailedError,
  startMapPreviewPreparation,
} from './map-preview-preparation.ts';
import { writeStagedProjectJson } from './staging-service.ts';

test('prepares the isolated preview off the main event loop with one reusable source snapshot', { concurrency: false }, async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-worker-test-'));
  const project = path.join(workflowRoot, 'projects', 'demo');
  try {
    await bootstrapDatabase(workflowRoot, { importLegacyJson: false });
    fs.mkdirSync(path.join(project, 'www', 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'save'), { recursive: true });
    fs.writeFileSync(path.join(project, 'www', 'data', 'Map001.json'), '{"width":1,"height":1}', 'utf8');
    fs.writeFileSync(path.join(project, 'www', 'data', 'System.json'), '{"switches":[],"variables":[]}', 'utf8');
    const sourceTimestamp = new Date('2020-01-02T03:04:05.000Z');
    fs.utimesSync(path.join(project, 'www', 'data', 'System.json'), sourceTimestamp, sourceTimestamp);
    fs.writeFileSync(path.join(project, 'www', 'save', 'file1.rpgsave'), 'private-save', 'utf8');
    writeStagedProjectJson(workflowRoot, project, 'www/data/Map001.json', { width: 2, height: 1 });

    const task = startMapPreviewPreparation(workflowRoot, project);
    let heartbeat = false;
    setImmediate(() => { heartbeat = true; });
    const preparation = await task.result;

    assert.equal(heartbeat, true);
    assert.equal(preparation.savesExcluded, true);
    assert.equal(fs.existsSync(path.join(preparation.temporaryProject, 'www', 'save')), false);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(preparation.temporaryProject, 'www', 'data', 'Map001.json'), 'utf8')),
      { width: 2, height: 1 },
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'www', 'data', 'Map001.json'), 'utf8')), { width: 1, height: 1 });
    assert.ok(Math.abs(
      fs.statSync(path.join(preparation.temporaryProject, 'www', 'data', 'System.json')).mtimeMs - sourceTimestamp.getTime(),
    ) < 2);
    assert.deepEqual(
      preparation.sourceSnapshot.map((entry) => entry.relativePath),
      ['www/data/Map001.json', 'www/data/System.json'],
    );
    assert.deepEqual(verifyIsolatedSourceState(workflowRoot, preparation), {
      sourceUnchanged: true,
      savesUnchanged: true,
      stagingUnchanged: true,
    });
    fs.rmSync(preparation.temporaryProject, { recursive: true, force: true });
  } finally {
    closeDatabase();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test('cancels the preparation worker and removes its partial isolated project', async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-worker-cancel-'));
  const project = path.join(workflowRoot, 'projects', 'demo');
  try {
    fs.mkdirSync(project, { recursive: true });
    for (let index = 0; index < 32; index += 1) {
      fs.writeFileSync(path.join(project, `file-${index}.bin`), Buffer.alloc(256 * 1024, index));
    }
    const task = startMapPreviewPreparation(workflowRoot, project);
    const result = assert.rejects(task.result, MapPreviewPreparationCancelledError);
    await task.cancel();
    await result;
    assert.equal(fs.existsSync(task.temporaryProject), false);
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test('reports a stable preparation stage and cleans the temporary project on failure', async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-worker-failure-'));
  try {
    const task = startMapPreviewPreparation(workflowRoot, path.join(workflowRoot, 'projects', 'missing'));
    await assert.rejects(task.result, (error: unknown) => {
      assert.ok(error instanceof MapPreviewPreparationFailedError);
      assert.equal(error.stage, 'resolve-source-project');
      return true;
    });
    assert.equal(fs.existsSync(task.temporaryProject), false);
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});
