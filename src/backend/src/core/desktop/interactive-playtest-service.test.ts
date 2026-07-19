import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  InteractivePlaytestService,
  type InteractivePlaytestChild,
  type InteractivePlaytestDependencies,
  type InteractivePlaytestSpawnOptions,
} from './interactive-playtest-service.ts';
import type { BattleTestProjectPreparation } from './battle-test-preparation.ts';
import type { ParticleAnimationPreviewPreparation } from './particle-animation-preview-preparation.ts';

describe('interactive desktop playtest lifecycle', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-playtest-'));
    project = path.join(root, 'projects', 'sample');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.exe'), 'test runner placeholder', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('requires a current staging-summary confirmation and launches only the project Game.exe', async () => {
    const child = new FakeChild();
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }> = [];
    let stagingVersion = 'draft-a';
    const service = createService(root, {
      child,
      stagingStatus: () => stagedStatus(stagingVersion),
      spawnCalls,
    });

    const first = await service.start(project, { sessionId: 'session-1' });
    assert.equal(first.confirmationRequired, true);
    assert.equal(first.stagingSummary?.fileCount, 1);
    assert.equal(spawnCalls.length, 0);

    stagingVersion = 'draft-b';
    const stale = await service.start(project, {
      sessionId: 'session-1',
      confirmedStagingHash: first.stagingSummaryHash,
    });
    assert.equal(stale.confirmationRequired, true);
    assert.notEqual(stale.stagingSummaryHash, first.stagingSummaryHash);
    assert.equal(spawnCalls.length, 0);

    const starting = service.start(project, {
      sessionId: 'session-1',
      confirmedStagingHash: stale.stagingSummaryHash,
    });
    queueMicrotask(() => child.emitSpawn());
    const running = await starting;
    assert.equal(running.run?.status, 'running');
    assert.equal(running.run?.stagingIncluded, false);
    assert.equal(running.run?.sourceSaveRisk, true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].executable, path.join(project, 'Game.exe'));
    assert.deepEqual(spawnCalls[0].args, []);
    assert.equal(spawnCalls[0].options.cwd, project);
    assert.equal(spawnCalls[0].options.windowsHide, false);
    assert.equal((spawnCalls[0].options as { shell?: unknown }).shell, false);
    assert.equal(fs.readFileSync(path.join(project, 'Game.exe'), 'utf8'), 'test runner placeholder');

    const duplicate = await service.start(project, { confirmedStagingHash: stale.stagingSummaryHash });
    assert.equal(duplicate.run?.status, 'running');
    assert.match(String(duplicate.error), /already running/i);
    assert.equal(spawnCalls.length, 1);

    await delay(25);
    assert.equal(service.current().run?.status, 'running');
    assert.equal(fs.existsSync(service.current().run!.artifactPath), true);
  });

  test('requests runtime selection when a source-only MV project has no saved runner', async () => {
    fs.rmSync(path.join(project, 'Game.exe'));
    const service = createService(root, { child: new FakeChild() });
    const result = await service.start(project);
    assert.equal(result.run, undefined);
    assert.equal(result.confirmationRequired, false);
    assert.deepEqual(result.runtimeSelectionRequired, { engine: 'rpg-maker-mv', reason: 'missing' });
  });

  test('requests runtime selection when the project-local MZ runtime is incomplete', async () => {
    const service = createService(root, {
      child: new FakeChild(),
      inspectProject: () => ({ engine: 'rpg-maker-mz', editable: true, missingRequired: [] }),
      resolveMZRuntime: () => { throw new Error('The project-local RPG Maker MZ runtime is incomplete: nw.dll is missing.'); },
    });
    const result = await service.start(project);
    assert.equal(result.run, undefined);
    assert.deepEqual(result.runtimeSelectionRequired, { engine: 'rpg-maker-mz', reason: 'missing' });
  });

  test('launches a source-only MV project through a saved external runtime', async () => {
    fs.rmSync(path.join(project, 'Game.exe'));
    const child = new FakeChild();
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }> = [];
    const selectedExecutable = path.join(root, 'runtime', 'game.exe');
    const service = createService(root, {
      child,
      spawnCalls,
      resolveProjectRuntime: () => ({
        runtime: {
          engine: 'rpg-maker-mv',
          executable: selectedExecutable,
          runtimeRoot: path.dirname(selectedExecutable),
          source: 'configured',
          launchStyle: 'external',
          evidenceExecutable: 'configured-rpg-maker-mv-nwjs',
          privateExecutable: selectedExecutable,
        },
      }),
    });
    const starting = service.start(project);
    queueMicrotask(() => child.emitSpawn());
    const running = await starting;
    assert.equal(running.run?.status, 'running');
    assert.equal(running.run?.executable, 'configured-rpg-maker-mv-nwjs');
    assert.equal(spawnCalls[0].executable, selectedExecutable);
    assert.deepEqual(spawnCalls[0].args, [project]);
  });

  test('launches a source-only MZ project through a selected external nw.exe', async () => {
    const child = new FakeChild();
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }> = [];
    const selectedExecutable = path.join(root, 'runtime', 'nw.exe');
    const service = createService(root, {
      child,
      spawnCalls,
      inspectProject: () => ({ engine: 'rpg-maker-mz', editable: true, missingRequired: [] }),
      resolveProjectRuntime: () => ({
        runtime: {
          engine: 'rpg-maker-mz',
          executable: selectedExecutable,
          runtimeRoot: path.dirname(selectedExecutable),
          source: 'configured',
          launchStyle: 'external',
          evidenceExecutable: 'configured-rpg-maker-mz-nwjs',
          privateExecutable: selectedExecutable,
        },
      }),
    });
    const starting = service.start(project);
    queueMicrotask(() => child.emitSpawn());
    const running = await starting;
    assert.equal(running.run?.status, 'running');
    assert.equal(running.run?.executable, 'configured-rpg-maker-mz-nwjs');
    assert.equal(spawnCalls[0].executable, selectedExecutable);
    assert.deepEqual(spawnCalls[0].args, [project]);
    assert.equal(spawnCalls[0].options.cwd, project);
  });

  test('launches MZ normal playtest with the validated project-local Game.exe', async () => {
    const child = new FakeChild();
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }> = [];
    const localRuntime = path.join(project, 'Game.exe');
    const service = createService(root, {
      child,
      spawnCalls,
      inspectProject: () => ({ engine: 'rpg-maker-mz', editable: true, missingRequired: [] }),
      resolveMZRuntime: () => ({ executable: localRuntime, projectRoot: project, engineVersion: '1.10.0' }),
    });

    const starting = service.start(project);
    queueMicrotask(() => child.emitSpawn());
    const running = await starting;
    assert.equal(running.run?.engine, 'rpg-maker-mz');
    assert.equal(spawnCalls[0].executable, localRuntime);
    assert.deepEqual(spawnCalls[0].args, [project]);
    assert.equal(running.run?.executable, 'project-local-rpg-maker-mz-nwjs');

    const emittedPath = localRuntime.replaceAll('\\', '/');
    const splitAt = Math.floor(emittedPath.length / 2);
    child.stdout.emit('data', Buffer.from(`runtime=${emittedPath.slice(0, splitAt)}`, 'utf8'));
    child.stdout.emit('data', Buffer.from(`${emittedPath.slice(splitAt)}\n`, 'utf8'));
    child.stderr.emit('data', Buffer.from(`project-runtime=${path.dirname(localRuntime)}\n`, 'utf8'));
    child.emitExit(0, null);

    const finished = service.current().run!;
    const stdout = fs.readFileSync(finished.stdoutPath, 'utf8');
    const stderr = fs.readFileSync(finished.stderrPath, 'utf8');
    const log = fs.readFileSync(finished.logPath, 'utf8');
    assert.doesNotMatch(`${stdout}\n${stderr}\n${log}`, new RegExp(escapeRegex(project), 'i'));
    assert.match(`${stdout}\n${stderr}\n${log}`, /project-local RPG Maker MZ runtime/);
  });

  test('records an early launch error as failed evidence', async () => {
    const child = new FakeChild();
    const service = createService(root, { child });
    const starting = service.start(project);
    queueMicrotask(() => child.emit('error', new Error('injected launch failure')));
    const result = await starting;
    assert.equal(result.run?.status, 'failed');
    assert.match(String(result.run?.error), /injected launch failure/);
    assert.equal(fs.existsSync(result.run!.artifactPath), true);
  });

  test('records a normal exit and never imposes an overall playtest timeout', async () => {
    const child = new FakeChild();
    const service = createService(root, { child });
    const starting = service.start(project);
    queueMicrotask(() => child.emitSpawn());
    await starting;

    await delay(25);
    assert.equal(service.current().run?.status, 'running');
    child.emitExit(0, null);

    const exited = service.current();
    assert.equal(exited.run?.status, 'exited');
    assert.equal(exited.run?.exitCode, 0);
  });

  test('fails a launch that never reaches spawn and attempts process-tree cleanup', async () => {
    const child = new FakeChild();
    let forceCalls = 0;
    const service = createService(root, {
      child,
      forceKill: async () => {
        forceCalls += 1;
        queueMicrotask(() => child.emitExit(1, 'SIGKILL'));
        return { ok: true };
      },
    });

    const result = await service.start(project);
    assert.equal(result.run?.status, 'failed');
    assert.equal(result.run?.forced, true);
    assert.match(String(result.run?.error), /timed out/i);
    assert.equal(forceCalls, 1);
  });

  test('keeps startup cleanup failure stoppable until the child exit is observed', async () => {
    const child = new FakeChild();
    const service = createService(root, {
      child,
      forceKill: async () => ({ ok: false, error: 'injected startup cleanup failure' }),
    });

    const result = await service.start(project);
    assert.equal(result.run?.status, 'stop_failed');
    assert.match(String(result.run?.error), /injected startup cleanup failure/);

    child.emitExit(1, 'SIGKILL');
    assert.equal(service.current().run?.status, 'failed');
    assert.notEqual(service.current().run?.status, 'stopped');
  });

  test('stops gracefully before the two-second force-cleanup path', async () => {
    const child = new FakeChild();
    child.onKill = () => queueMicrotask(() => child.emitExit(0, null));
    let forceCalls = 0;
    const service = createService(root, {
      child,
      forceKill: async () => {
        forceCalls += 1;
        return { ok: true };
      },
    });
    const starting = service.start(project);
    queueMicrotask(() => child.emitSpawn());
    await starting;

    const stopped = await service.stop();
    assert.equal(stopped.run?.status, 'stopped');
    assert.equal(stopped.run?.forced, false);
    assert.equal(child.killCalls, 1);
    assert.equal(forceCalls, 0);
  });

  test('force-cleans the process tree after grace and never reports a failed cleanup as stopped', async () => {
    const forceChild = new FakeChild();
    let forceCalls = 0;
    const forceService = createService(root, {
      child: forceChild,
      forceKill: async () => {
        forceCalls += 1;
        queueMicrotask(() => forceChild.emitExit(1, 'SIGKILL'));
        return { ok: true };
      },
    });
    const forceStarting = forceService.start(project);
    queueMicrotask(() => forceChild.emitSpawn());
    await forceStarting;
    const forceStopped = await forceService.stop();
    assert.equal(forceStopped.run?.status, 'stopped');
    assert.equal(forceStopped.run?.forced, true);
    assert.equal(forceCalls, 1);

    const failedChild = new FakeChild();
    const failedService = createService(root, {
      child: failedChild,
      forceKill: async () => ({ ok: false, error: 'injected force failure' }),
    });
    const failedStarting = failedService.start(project);
    queueMicrotask(() => failedChild.emitSpawn());
    await failedStarting;
    const failedStop = await failedService.stop();
    assert.equal(failedStop.run?.status, 'stop_failed');
    assert.notEqual(failedStop.run?.status, 'stopped');
    assert.match(String(failedStop.run?.error), /injected force failure/);

    failedChild.emitExit(0, null);
    assert.equal(failedService.current().run?.status, 'failed');
    assert.notEqual(failedService.current().run?.status, 'stopped');
  });

  test('application shutdown uses the same verified stop path', async () => {
    const child = new FakeChild();
    child.onKill = () => queueMicrotask(() => child.emitExit(0, null));
    const service = createService(root, { child });
    const starting = service.start(project);
    queueMicrotask(() => child.emitSpawn());
    await starting;

    const result = await service.shutdown();
    assert.equal(result.run?.status, 'stopped');
    assert.equal(child.killCalls, 1);
  });

  test('launches Battle Test only from the isolated staged copy with the fixed MV argument', async () => {
    const child = new FakeChild();
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }> = [];
    const isolated = createBattlePreparation(root, project);
    let cleanupCalls = 0;
    const service = createService(root, {
      child,
      spawnCalls,
      prepareBattleTest: () => isolated,
      verifyIsolatedSource: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      cleanupIsolated: (preparation) => {
        cleanupCalls += 1;
        fs.rmSync(preparation.temporaryProject, { recursive: true, force: true });
      },
    });

    const starting = service.start(project, {
      mode: 'battle_test',
      troopId: 3,
      battlers: [{ actorId: 1, level: 8, equips: [1, 0] }],
      battleback1Name: 'Field',
      battleback2Name: 'Forest',
    });
    queueMicrotask(() => child.emitSpawn());
    const running = await starting;
    assert.equal(running.run?.mode, 'battle_test');
    assert.equal(running.run?.troopId, 3);
    assert.equal(running.run?.troopName, 'Sample Troop');
    assert.equal(running.run?.stagingIncluded, true);
    assert.equal(running.run?.sourceSaveRisk, false);
    assert.equal(running.run?.temporaryProject, true);
    assert.deepEqual(spawnCalls[0].args, ['test&btest']);
    assert.equal(spawnCalls[0].executable, isolated.executable);
    assert.equal(spawnCalls[0].options.cwd, isolated.temporaryProject);
    assert.equal(cleanupCalls, 0);

    child.emitExit(0, null);
    const exited = service.current().run!;
    assert.equal(exited.status, 'exited');
    assert.equal(exited.sourceUnchanged, true);
    assert.equal(exited.savesUnchanged, true);
    assert.equal(exited.stagingUnchanged, true);
    assert.equal(exited.temporaryProjectCleaned, true);
    assert.equal(cleanupCalls, 1);
    assert.equal(fs.existsSync(isolated.temporaryProject), false);
  });

  test('launches MZ Battle Test from the isolated copy through the source project Game.exe', async () => {
    const child = new FakeChild();
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }> = [];
    const isolated = createBattlePreparation(root, project);
    isolated.engine = 'rpg-maker-mz';
    delete isolated.executable;
    const localRuntime = path.join(project, 'Game.exe');
    const service = createService(root, {
      child,
      spawnCalls,
      inspectProject: () => ({ engine: 'rpg-maker-mz', editable: true, missingRequired: [] }),
      resolveMZRuntime: () => ({ executable: localRuntime, projectRoot: project, engineVersion: '1.10.0' }),
      prepareBattleTest: () => isolated,
      verifyIsolatedSource: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      cleanupIsolated: (preparation) => fs.rmSync(preparation.temporaryProject, { recursive: true, force: true }),
    });

    const starting = service.start(project, {
      mode: 'battle_test',
      troopId: 3,
      battlers: [{ actorId: 1, level: 8, equips: [1, 0] }],
      battleback1Name: '',
      battleback2Name: '',
    });
    queueMicrotask(() => child.emitSpawn());
    const running = await starting;
    assert.equal(running.run?.engine, 'rpg-maker-mz');
    assert.equal(spawnCalls[0].executable, localRuntime);
    assert.deepEqual(spawnCalls[0].args, [isolated.temporaryProject, 'test&btest']);
    assert.equal(spawnCalls[0].options.cwd, isolated.temporaryProject);
  });

  test('launches MZ particle preview from its stripped isolated app without persisting the private source path', async () => {
    const child = new FakeChild();
    const spawnCalls: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }> = [];
    const isolated = createParticlePreparation(project);
    const localRuntime = path.join(project, 'Game.exe');
    let cleanupCalls = 0;
    const service = createService(root, {
      child,
      spawnCalls,
      inspectProject: () => ({ engine: 'rpg-maker-mz', editable: true, missingRequired: [] }),
      resolveMZRuntime: () => ({ executable: localRuntime, projectRoot: project, engineVersion: '1.10.0' }),
      prepareParticlePreview: () => isolated,
      verifyIsolatedSource: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      cleanupIsolated: (preparation) => {
        cleanupCalls += 1;
        fs.rmSync(preparation.temporaryProject, { recursive: true, force: true });
      },
    });

    const starting = service.start(project, {
      mode: 'particle_preview',
      animationPreview: particleAnimation(),
    });
    queueMicrotask(() => child.emitSpawn());
    const running = await starting;
    assert.equal(running.run?.mode, 'particle_preview');
    assert.equal(running.run?.effectName, 'fx/Spark');
    assert.equal(running.run?.project, '[current RPG Maker MZ project]');
    assert.equal(running.run?.cwd, '[isolated particle preview]');
    assert.equal(running.run?.temporaryProject, true);
    assert.equal(running.run?.sourceSaveRisk, false);
    assert.equal(running.run?.stagingIncluded, true);
    assert.equal(spawnCalls[0].executable, localRuntime);
    assert.deepEqual(spawnCalls[0].args, [isolated.appDirectory]);
    assert.equal(spawnCalls[0].options.cwd, isolated.appDirectory);
    assert.doesNotMatch(fs.readFileSync(running.run!.artifactPath, 'utf8'), new RegExp(escapeRegex(project), 'i'));

    child.emitExit(0, null);
    assert.equal(service.current().run?.status, 'exited');
    assert.equal(service.current().run?.sourceUnchanged, true);
    assert.equal(service.current().run?.temporaryProjectCleaned, true);
    assert.equal(cleanupCalls, 1);
  });

  test('redacts the project-local MZ executable path from launch failures and logs', async () => {
    const child = new FakeChild();
    const localRuntime = path.join(project, 'Game.exe');
    const service = createService(root, {
      child,
      spawnError: new Error(`spawn ${localRuntime} ENOENT`),
      inspectProject: () => ({ engine: 'rpg-maker-mz', editable: true, missingRequired: [] }),
      resolveMZRuntime: () => ({ executable: localRuntime, projectRoot: project, engineVersion: '1.10.0' }),
    });

    const result = await service.start(project, { mode: 'project' });
    assert.equal(result.run?.status, 'failed');
    assert.equal(String(result.run?.error).includes(localRuntime), false);
    assert.match(String(result.run?.error), /project-local RPG Maker MZ runtime/);
    const log = fs.readFileSync(result.run!.logPath, 'utf8');
    assert.equal(log.includes(localRuntime), false);
  });

  test('does not report Battle Test success when isolated cleanup fails', async () => {
    const child = new FakeChild();
    const isolated = createBattlePreparation(root, project);
    let cleanupShouldFail = true;
    let prepareCalls = 0;
    const service = createService(root, {
      child,
      prepareBattleTest: () => {
        prepareCalls += 1;
        return isolated;
      },
      verifyIsolatedSource: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      cleanupIsolated: (preparation) => {
        if (cleanupShouldFail) throw new Error('injected isolated cleanup failure');
        fs.rmSync(preparation.temporaryProject, { recursive: true, force: true });
      },
    });
    const starting = service.start(project, {
      mode: 'battle_test',
      troopId: 3,
      battlers: [{ actorId: 1, level: 8, equips: [1, 0] }],
      battleback1Name: '',
      battleback2Name: '',
    });
    queueMicrotask(() => child.emitSpawn());
    await starting;
    child.emitExit(0, null);
    assert.equal(service.current().run?.status, 'failed');
    assert.equal(service.current().run?.temporaryProjectCleaned, false);
    assert.match(String(service.current().run?.error), /cleanup failure/i);

    const blocked = await service.start(project, { mode: 'project' });
    assert.match(String(blocked.error), /previous isolated playtest project/i);
    assert.equal(prepareCalls, 1);

    cleanupShouldFail = false;
    const retried = await service.stop();
    assert.equal(retried.run?.temporaryProjectCleaned, true);
    assert.equal(fs.existsSync(isolated.temporaryProject), false);
  });
});

class FakeChild extends EventEmitter implements InteractivePlaytestChild {
  readonly pid = 4200;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killCalls = 0;
  onKill: (() => void) | null = null;

  kill(): boolean {
    this.killCalls += 1;
    this.onKill?.();
    return true;
  }

  emitSpawn(): void {
    this.emit('spawn');
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

function createService(workflowRoot: string, options: {
  child: FakeChild;
  stagingStatus?: () => unknown;
  spawnCalls?: Array<{ executable: string; args: readonly string[]; options: InteractivePlaytestSpawnOptions }>;
  forceKill?: InteractivePlaytestDependencies['forceKillProcessTree'];
  prepareBattleTest?: InteractivePlaytestDependencies['prepareBattleTest'];
  prepareParticlePreview?: InteractivePlaytestDependencies['prepareParticlePreview'];
  verifyIsolatedSource?: InteractivePlaytestDependencies['verifyIsolatedSource'];
  cleanupIsolated?: InteractivePlaytestDependencies['cleanupIsolated'];
  inspectProject?: InteractivePlaytestDependencies['inspectProject'];
  resolveMZRuntime?: InteractivePlaytestDependencies['resolveMZRuntime'];
  resolveProjectRuntime?: InteractivePlaytestDependencies['resolveProjectRuntime'];
  spawnError?: Error;
}): InteractivePlaytestService {
  return new InteractivePlaytestService(workflowRoot, {
    spawnProcess: (executable, args, spawnOptions) => {
      if (options.spawnError) throw options.spawnError;
      options.spawnCalls?.push({ executable, args, options: spawnOptions });
      return options.child;
    },
    getStagingStatus: options.stagingStatus || (() => ({ staged: false, files: [], operations: [] })),
    inspectProject: options.inspectProject || (() => ({ engine: 'rpg-maker-mv', editable: true, missingRequired: [] })),
    ...(options.resolveMZRuntime ? { resolveMZRuntime: options.resolveMZRuntime } : {}),
    resolveProjectRuntime: options.resolveProjectRuntime || ((sourceProject, engine) => {
      if (engine === 'rpg-maker-mz') {
        try {
          const runtime = options.resolveMZRuntime?.(sourceProject);
          if (!runtime) return { selectionRequired: { engine, reason: 'missing' } };
          return {
            runtime: {
              engine,
              executable: runtime.executable,
              runtimeRoot: runtime.projectRoot,
              source: 'project-local',
              launchStyle: 'external',
              evidenceExecutable: 'project-local-rpg-maker-mz-nwjs',
              privateExecutable: runtime.executable,
            },
          };
        } catch {
          return { selectionRequired: { engine, reason: 'missing' } };
        }
      }
      const executable = path.join(sourceProject, 'Game.exe');
      return fs.existsSync(executable)
        ? {
            runtime: {
              engine,
              executable,
              runtimeRoot: sourceProject,
              source: 'project-local',
              launchStyle: 'embedded',
              evidenceExecutable: executable,
            },
          }
        : { selectionRequired: { engine, reason: 'missing' } };
    }),
    requestGracefulStop: (child) => ({
      ok: child.kill(),
    }),
    forceKillProcessTree: options.forceKill || (async () => ({ ok: true })),
    ...(options.prepareBattleTest ? { prepareBattleTest: options.prepareBattleTest } : {}),
    ...(options.prepareParticlePreview ? { prepareParticlePreview: options.prepareParticlePreview } : {}),
    ...(options.verifyIsolatedSource ? { verifyIsolatedSource: options.verifyIsolatedSource } : {}),
    ...(options.cleanupIsolated ? { cleanupIsolated: options.cleanupIsolated } : {}),
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    startupTimeoutMs: 10,
    stopGraceMs: 10,
    forceExitWaitMs: 10,
  });
}

function createBattlePreparation(_root: string, sourceProject: string): BattleTestProjectPreparation {
  const temporaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'battle-test-copy-'));
  const executable = path.join(temporaryProject, 'Game.exe');
  fs.writeFileSync(executable, 'isolated runner', 'utf8');
  return {
    sourceProject,
    temporaryProject,
    sourceFingerprint: 'source-hash',
    saveFingerprint: 'save-hash',
    staging: { files: [{ relativePath: 'data/Troops.json', delete: false, draftHash: 'draft-hash' }], digest: 'staging-hash' },
    savesExcluded: true,
    engine: 'rpg-maker-mv',
    executable,
    troopId: 3,
    troopName: 'Sample Troop',
    battlers: [{ actorId: 1, level: 8, equips: [1, 0] }],
    battleback1Name: 'Field',
    battleback2Name: 'Forest',
  };
}

function createParticlePreparation(sourceProject: string): ParticleAnimationPreviewPreparation {
  const temporaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'particle-preview-copy-'));
  const appDirectory = path.join(temporaryProject, 'particle-preview');
  fs.mkdirSync(appDirectory, { recursive: true });
  return {
    sourceProject,
    temporaryProject,
    sourceFingerprint: 'source-hash',
    saveFingerprint: 'save-hash',
    staging: { files: [], digest: 'staging-hash' },
    savesExcluded: true,
    engine: 'rpg-maker-mz',
    appDirectory,
    effectName: 'fx/Spark',
  };
}

function particleAnimation() {
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

function stagedStatus(draftHash: string): unknown {
  return {
    staged: true,
    files: [{
      relativePath: 'www/data/Actors.json',
      recordedDraftHash: draftHash,
      operationId: undefined,
      delete: false,
      conflict: false,
    }],
    operations: [],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
