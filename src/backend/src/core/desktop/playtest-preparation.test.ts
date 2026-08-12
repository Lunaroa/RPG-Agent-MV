import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { InteractiveParticleAnimationPreview } from '../../../../contract/types.ts';
import { writeJson } from '../rmmv/json.ts';
import { RPG_MAKER_MZ_ENGINE_FILES } from '../rmmv/rpg-maker-engine.ts';
import { cleanupIsolatedProject } from './isolated-project-preparation.ts';
import { cleanupOwnedIsolatedProject } from './isolated-project-attestation.ts';
import {
  PreparationWorkerError,
  prepareBattleTestInWorker,
  prepareParticlePreviewInWorker,
  prepareUiDesignerRendererInWorker,
} from './playtest-preparation.ts';

describe('playtest preparation worker host', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-playtest-prep-test-'));
    project = path.join(root, 'projects', 'sample');
    writeMZProject(project);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('prepares an isolated particle preview in a worker process and round-trips the result', async () => {
    const preparation = await prepareParticlePreviewInWorker(root, project, animation());
    try {
      assert.equal(preparation.engine, 'rpg-maker-mz');
      assert.equal(preparation.effectName, 'fx/Spark');
      assert.equal(preparation.temporaryProject.startsWith(os.tmpdir()), true);
      assert.equal(fs.existsSync(path.join(preparation.appDirectory, 'index.html')), true);
      assert.equal(typeof preparation.sourceFingerprint, 'string');
      assert.equal(preparation.staging.files.length, 0);
    } finally {
      cleanupIsolatedProject(preparation);
    }
    assert.equal(fs.existsSync(preparation.temporaryProject), false);
  });

  test('propagates preparation errors from the worker as plain error messages', async () => {
    const missingProject = path.join(root, 'projects', 'missing');
    fs.mkdirSync(missingProject, { recursive: true });
    await assert.rejects(
      prepareBattleTestInWorker(root, missingProject, {
        troopId: 1,
        battlers: [{ actorId: 1, level: 1, equips: [] }],
        battleback1Name: '',
        battleback2Name: '',
      }),
      /RPG Maker data folder|does not exist/,
    );
  });

  test('reports a worker that exits without writing a response', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: null;
      stderr: null;
    };
    child.stdout = null;
    child.stderr = null;
    await assert.rejects(
      prepareParticlePreviewInWorker(root, project, animation(), {
        spawnProcess: () => {
          setImmediate(() => child.emit('exit', 1, null));
          return child as never;
        },
      }),
      /exited without a response/,
    );
  });

  test('prepares a sparse UI designer overlay in the worker without copying engine files', async () => {
    const preparation = await prepareUiDesignerRendererInWorker(root, project);
    try {
      assert.equal(preparation.sourceAccessMode, 'protocol-read-only');
      assert.equal(fs.existsSync(path.join(preparation.temporaryProject, 'data')), false);
      assert.equal(fs.existsSync(path.join(preparation.temporaryProject, 'js')), false);
    } finally {
      cleanupIsolatedProject(preparation);
    }
  });

  test('reports an asynchronous worker spawn error without waiting for the watchdog', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
    child.stdout = null;
    child.stderr = null;
    const started = Date.now();
    await assert.rejects(
      prepareParticlePreviewInWorker(root, project, animation(), {
        spawnProcess: () => {
          setImmediate(() => child.emit('error', new Error('spawn failed')));
          return child as never;
        },
        workerTimeoutMs: 500,
      }),
      /could not be started.*spawn failed/,
    );
    assert.equal(Date.now() - started < 400, true);
  });

  test('bounds a non-responsive worker, terminates it, and waits for terminal proof', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: null;
      stderr: null;
      kill: (signal?: NodeJS.Signals | number) => boolean;
    };
    child.stdout = null;
    child.stderr = null;
    let killCalls = 0;
    child.kill = () => {
      killCalls += 1;
      setImmediate(() => child.emit('exit', null, 'SIGTERM'));
      return true;
    };
    await assert.rejects(
      prepareParticlePreviewInWorker(root, project, animation(), {
        spawnProcess: () => child as never,
        workerTimeoutMs: 5,
        workerTerminationGraceMs: 5,
      }),
      /exceeded its 5ms limit and was terminated/,
    );
    assert.equal(killCalls, 1);
  });

  test('retains both ownership challenges when termination is not confirmed', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: null;
      stderr: null;
      kill: (signal?: NodeJS.Signals | number) => boolean;
    };
    child.stdout = null;
    child.stderr = null;
    child.kill = () => true;
    let failure: unknown;
    try {
      await prepareParticlePreviewInWorker(root, project, animation(), {
        spawnProcess: () => child as never,
        workerTimeoutMs: 5,
        workerTerminationGraceMs: 5,
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof PreparationWorkerError);
    assert.equal(failure.retainedOwners.length, 2);
    for (const owner of failure.retainedOwners) cleanupOwnedIsolatedProject(owner);
    assert.equal(failure.retainedOwners.every((owner) => !fs.existsSync(owner.temporaryProject)), true);
  });
});

function animation(): InteractiveParticleAnimationPreview {
  return {
    displayType: 0,
    effectName: 'fx/Spark',
    scale: 100,
    speed: 100,
    offsetX: 0,
    offsetY: 0,
    rotation: { x: 0, y: 0, z: 0 },
    alignBottom: false,
    flashTimings: [],
    soundTimings: [],
  };
}

function writeMZProject(project: string): void {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(project, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === 'js/rmmz_core.js'
      ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
      : relative === 'package.json'
        ? '{"main":"index.html"}'
        : '';
    fs.writeFileSync(file, content, 'utf8');
  }
  for (const relative of [
    'js/libs/pixi.js',
    'js/libs/pako.min.js',
    'js/libs/localforage.min.js',
    'js/libs/effekseer.min.js',
    'js/libs/effekseer.wasm',
  ]) {
    const file = path.join(project, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'runtime fixture', 'utf8');
  }
  fs.mkdirSync(path.join(project, 'effects', 'fx'), { recursive: true });
  fs.writeFileSync(path.join(project, 'effects', 'fx', 'Spark.efkefc'), 'selected effect', 'utf8');
  fs.mkdirSync(path.join(project, 'img', 'battlebacks1'), { recursive: true });
  fs.writeFileSync(path.join(project, 'img', 'battlebacks1', 'Grassland.png'), 'battleback image', 'utf8');
  writeJson(path.join(project, 'data', 'System.json'), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 },
    battleback1Name: 'Grassland',
    battleback2Name: '',
    startMapId: 1,
  });
  writeJson(path.join(project, 'data', 'MapInfos.json'), [null, { id: 1, name: 'Sample Map' }]);
  writeJson(path.join(project, 'data', 'Map001.json'), {
    width: 1,
    height: 1,
    tilesetId: 0,
    data: Array(6).fill(0),
    events: [null],
  });
}
