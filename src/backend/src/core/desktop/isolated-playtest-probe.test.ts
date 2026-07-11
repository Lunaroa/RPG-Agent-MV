import assert from 'node:assert/strict';
import type childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import {
  deleteStagedProjectFile,
  writeStagedProjectJson,
} from './staging-service.ts';
import {
  executeIsolatedProbeWorker,
  runIsolatedRmmvPlaytestProbe,
  type IsolatedProbeWorkerRequest,
} from './isolated-playtest-probe.ts';

describe('isolated staged-project playtest probe', { concurrency: false }, () => {
  let root: string;
  let project: string;
  let leakedTemporaryProjects: string[];

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-verify-'));
    project = createProject(root);
    leakedTemporaryProjects = [];
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
      skipRuntimeLegacyCleanup: true,
      skipWorkspaceLegacyCleanup: true,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const temporaryProject of leakedTemporaryProjects) {
      fs.rmSync(temporaryProject, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('overlays every staged draft and deletion, changes only the temporary start, and verifies strict evidence', async () => {
    writeStagedProjectJson(root, project, 'data/Actors.json', [null, { id: 1, name: 'Draft Actor', pluginField: { kept: true } }]);
    deleteStagedProjectFile(root, project, 'data/obsolete.json');
    let temporaryProject = '';

    const result = await runIsolatedRmmvPlaytestProbe(root, project, {
      mapId: 2,
      x: 4,
      y: 5,
      timeoutMs: 5_000,
    }, {
      executeWorker: async (request) => {
        temporaryProject = request.temporaryProject;
        assert.equal(readJson(path.join(temporaryProject, 'data', 'Actors.json'))[1].name, 'Draft Actor');
        assert.deepEqual(readJson(path.join(temporaryProject, 'data', 'Actors.json'))[1].pluginField, { kept: true });
        assert.equal(fs.existsSync(path.join(temporaryProject, 'data', 'obsolete.json')), false);
        assert.deepEqual(readStart(temporaryProject), { startMapId: 2, startX: 4, startY: 5 });
        assert.equal(fs.existsSync(path.join(temporaryProject, 'save')), false);
        assert.equal(fs.existsSync(path.join(temporaryProject, 'www', 'save')), false);
        return strictWorkerResponse(request, { mapId: 2, x: 4, y: 5 });
      },
    });

    assert.equal(result.status, 'verified');
    assert.equal(result.verified, true);
    assert.equal(result.stagedFileCount, 2);
    assert.equal(result.evidence.coordinatesVerified, true);
    assert.equal(result.evidence.runtimeReady, true);
    assert.equal(result.evidence.eventIdle, true);
    assert.equal(result.evidence.sourceUnchanged, true);
    assert.equal(result.evidence.savesUnchanged, true);
    assert.equal(result.evidence.stagingUnchanged, true);
    assert.equal(result.evidence.temporaryProjectCleaned, true);
    assert.equal(fs.existsSync(temporaryProject), false);
    assert.equal(readJson(path.join(project, 'data', 'Actors.json'))[1].name, 'Source Actor');
    assert.deepEqual(readStart(project), { startMapId: 1, startX: 1, startY: 1 });
    assert.equal(fs.readFileSync(path.join(project, 'save', 'file1.rpgsave'), 'utf8'), 'source save');
  });

  test('blocks before starting a worker when staged source hashes conflict', async () => {
    writeStagedProjectJson(root, project, 'data/Actors.json', [null, { id: 1, name: 'Draft Actor' }]);
    writeJson(path.join(project, 'data', 'Actors.json'), [null, { id: 1, name: 'External Actor' }]);
    let workerCalls = 0;

    const result = await runIsolatedRmmvPlaytestProbe(root, project, {}, {
      executeWorker: async () => {
        workerCalls += 1;
        throw new Error('worker must not start');
      },
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.verified, false);
    assert.equal(workerCalls, 0);
    assert.equal(result.blockers.some((item) => /conflict/i.test(item)), true);
  });

  test('requires map coordinates together and validates them against the staged map', async () => {
    let workerCalls = 0;
    const missingCoordinate = await runIsolatedRmmvPlaytestProbe(root, project, { mapId: 2, x: 4 }, {
      executeWorker: async () => {
        workerCalls += 1;
        throw new Error('worker must not start');
      },
    });
    assert.equal(missingCoordinate.status, 'blocked');
    assert.equal(missingCoordinate.blockers.some((item) => /X and Y/i.test(item)), true);

    const outsideMap = await runIsolatedRmmvPlaytestProbe(root, project, { mapId: 2, x: 20, y: 5 }, {
      executeWorker: async () => {
        workerCalls += 1;
        throw new Error('worker must not start');
      },
    });
    assert.equal(outsideMap.status, 'blocked');
    assert.equal(outsideMap.blockers.some((item) => /outside/i.test(item)), true);
    assert.equal(workerCalls, 0);
  });

  test('invalidates otherwise-passing evidence when staging or source saves drift during the worker run', async () => {
    const result = await runIsolatedRmmvPlaytestProbe(root, project, {}, {
      executeWorker: async (request) => {
        writeStagedProjectJson(root, project, 'data/Actors.json', [null, { id: 1, name: 'Late Draft' }]);
        fs.writeFileSync(path.join(project, 'save', 'file1.rpgsave'), 'changed save', 'utf8');
        return strictWorkerResponse(request, { mapId: 1, x: 1, y: 1 });
      },
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.verified, false);
    assert.equal(result.evidence.stagingUnchanged, false);
    assert.equal(result.evidence.savesUnchanged, false);
  });

  test('returns review for a rendered ready map that never reaches event idle', async () => {
    const result = await runIsolatedRmmvPlaytestProbe(root, project, {}, {
      executeWorker: async (request) => {
        assert.equal(request.timeoutMs, 30_000);
        return strictWorkerResponse(request, {
          mapId: 1,
          x: 1,
          y: 1,
          probeStatus: 'review',
          eventIdle: false,
        });
      },
    });

    assert.equal(result.status, 'review');
    assert.equal(result.verified, false);
    assert.equal(result.evidence.runtimeReady, true);
    assert.equal(result.evidence.eventIdle, false);
  });

  test('blocks timeout limits outside the supported 5 to 60 second range', async () => {
    let workerCalls = 0;
    const tooShort = await runIsolatedRmmvPlaytestProbe(root, project, { timeoutMs: 4_999 }, {
      executeWorker: async () => {
        workerCalls += 1;
        throw new Error('worker must not start');
      },
    });
    const tooLong = await runIsolatedRmmvPlaytestProbe(root, project, { timeoutMs: 60_001 }, {
      executeWorker: async () => {
        workerCalls += 1;
        throw new Error('worker must not start');
      },
    });

    assert.equal(tooShort.status, 'blocked');
    assert.equal(tooLong.status, 'blocked');
    assert.equal(tooShort.blockers.some((item) => /timeoutMs.*5000.*60000/i.test(item)), true);
    assert.equal(workerCalls, 0);
  });

  test('never verifies when the temporary project cannot be cleaned', async () => {
    let temporaryProject = '';
    const result = await runIsolatedRmmvPlaytestProbe(root, project, {}, {
      executeWorker: async (request) => {
        temporaryProject = request.temporaryProject;
        leakedTemporaryProjects.push(temporaryProject);
        return strictWorkerResponse(request, { mapId: 1, x: 1, y: 1 });
      },
      removeTemporaryProject: () => {
        throw new Error('injected cleanup failure');
      },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.verified, false);
    assert.equal(result.evidence.temporaryProjectCleaned, false);
    assert.match(result.error || '', /injected cleanup failure/);
    assert.equal(fs.existsSync(temporaryProject), true);
  });

  test('blocks an incomplete copied runtime before starting the worker', async () => {
    fs.rmSync(path.join(project, 'js', 'plugins.js'));
    let workerCalls = 0;

    const result = await runIsolatedRmmvPlaytestProbe(root, project, {}, {
      executeWorker: async () => {
        workerCalls += 1;
        throw new Error('worker must not start');
      },
    });

    assert.equal(result.status, 'blocked');
    assert.equal(workerCalls, 0);
    assert.equal(result.blockers.some((item) => /runtime is incomplete.*plugins\.js/i.test(item)), true);
  });

  test('starts the probe worker hidden with the copied project as its working directory', async () => {
    const artifactDir = path.join(root, 'runtime', 'out', 'worker-boundary');
    const responsePath = path.join(artifactDir, 'worker-response.json');
    let executable = '';
    let args: string[] = [];
    let spawnOptions: childProcess.SpawnOptions | undefined;

    const response = await executeIsolatedProbeWorker({
      temporaryProject: project,
      artifactDir,
      generatedAt: '2026-01-01T00:00:00.000Z-probe',
      timeoutMs: 5_000,
      mapId: 1,
      x: 1,
      y: 1,
    }, {
      spawnProcess: (nextExecutable, nextArgs, nextOptions) => {
        executable = nextExecutable;
        args = nextArgs;
        spawnOptions = nextOptions;
        const child = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          kill: () => true,
          pid: 1234,
        }) as unknown as childProcess.ChildProcess;
        queueMicrotask(() => {
          writeJson(responsePath, { ok: false, error: 'injected worker boundary response' });
          child.emit('exit', 0, null);
        });
        return child;
      },
    });

    assert.equal(response.ok, false);
    assert.match(response.error || '', /injected worker boundary response/);
    assert.equal(executable, process.execPath);
    assert.equal(args[0], '--experimental-strip-types');
    assert.match(args[1] || '', /isolated-playtest-probe-worker\.ts$/);
    assert.equal(spawnOptions?.cwd, project);
    assert.equal(spawnOptions?.windowsHide, true);
    assert.equal(spawnOptions?.shell, false);
    assert.equal((spawnOptions?.env as NodeJS.ProcessEnv | undefined)?.ELECTRON_RUN_AS_NODE, '1');
  });
});

function createProject(root: string): string {
  const project = path.join(root, 'projects', 'sample');
  const dataDir = path.join(project, 'data');
  const jsDir = path.join(project, 'js');
  fs.mkdirSync(path.join(project, 'save'), { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.exe'), 'runner placeholder', 'utf8');
  fs.writeFileSync(path.join(project, 'index.html'), '<body><script src="js/main.js"></script></body>', 'utf8');
  writeJson(path.join(project, 'package.json'), { name: 'sample', main: 'index.html' });
  for (const fileName of [
    'rpg_core.js',
    'rpg_managers.js',
    'rpg_objects.js',
    'rpg_scenes.js',
    'rpg_sprites.js',
    'rpg_windows.js',
    'main.js',
    'plugins.js',
  ]) {
    fs.writeFileSync(path.join(jsDir, fileName), '// runtime fixture\n', 'utf8');
  }
  fs.writeFileSync(path.join(project, 'save', 'file1.rpgsave'), 'source save', 'utf8');
  writeJson(path.join(dataDir, 'System.json'), {
    startMapId: 1,
    startX: 1,
    startY: 1,
    switches: [null],
    variables: [null],
  });
  writeJson(path.join(dataDir, 'Map001.json'), mapData(10, 10));
  writeJson(path.join(dataDir, 'Map002.json'), mapData(20, 12));
  writeJson(path.join(dataDir, 'Actors.json'), [null, { id: 1, name: 'Source Actor' }]);
  writeJson(path.join(dataDir, 'obsolete.json'), { remove: true });
  return project;
}

function mapData(width: number, height: number): Record<string, unknown> {
  return { width, height, tilesetId: 1, data: Array(width * height * 6).fill(0), events: [null] };
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readStart(project: string): { startMapId: number; startX: number; startY: number } {
  const system = readJson(path.join(project, 'data', 'System.json'));
  return { startMapId: system.startMapId, startX: system.startX, startY: system.startY };
}

function strictWorkerResponse(
  request: IsolatedProbeWorkerRequest,
  options: {
    mapId: number;
    x: number;
    y: number;
    probeStatus?: 'pass' | 'review';
    eventIdle?: boolean;
  },
): any {
  const rawProbePath = path.join(request.artifactDir, 'nwjs-playable-probe.json');
  const screenshotPath = path.join(request.artifactDir, 'nwjs-playable-screen.png');
  const stdoutPath = path.join(request.artifactDir, 'probe.stdout.log');
  const stderrPath = path.join(request.artifactDir, 'probe.stderr.log');
  fs.mkdirSync(request.artifactDir, { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from('non-empty-png-evidence'));
  const probe = {
    status: options.probeStatus || 'pass',
    ready: true,
    errors: [],
    screen: { exists: true, nonBlank: true, screenshotWritten: true },
    map: {
      expectedStartMapId: options.mapId,
      currentMapId: options.mapId,
      onStartMap: true,
      player: { x: options.x, y: options.y },
    },
    events: {
      complete: options.eventIdle !== false,
      eventRunning: options.eventIdle === false,
      interpreterRunning: false,
      messageBusy: false,
      playerCanMove: options.eventIdle !== false,
    },
  };
  writeJson(rawProbePath, probe);
  fs.writeFileSync(stdoutPath, '', 'utf8');
  fs.writeFileSync(stderrPath, '', 'utf8');
  return {
    ok: true,
    run: {
      attempted: true,
      method: 'nwjs-playable',
      status: options.probeStatus || 'pass',
      detail: options.eventIdle === false ? 'event loop remained busy' : 'strict probe evidence passed',
      gameExe: path.join(request.temporaryProject, 'Game.exe'),
      probe,
      artifacts: {
        resultJson: rawProbePath,
        screenPng: screenshotPath,
        stdout: stdoutPath,
        stderr: stderrPath,
      },
      runnerStarted: true,
      processExited: true,
      timedOut: false,
      exitCode: 0,
      signal: null,
    },
  };
}
