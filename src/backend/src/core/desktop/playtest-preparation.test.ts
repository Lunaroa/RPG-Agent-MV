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
import {
  prepareBattleTestInWorker,
  prepareParticlePreviewInWorker,
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
    await assert.rejects(
      prepareBattleTestInWorker(root, path.join(root, 'projects', 'missing'), {
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
    advanced: { screenWidth: 816, screenHeight: 624 },
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
