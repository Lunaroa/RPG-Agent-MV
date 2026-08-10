import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import type {
  InteractiveBattleTestBattler,
  InteractiveParticleAnimationPreview,
  InteractivePlaytestMode,
  InteractivePlaytestIsolatedFileEvidence,
  InteractivePlaytestIsolatedFailureEvidence,
  InteractivePlaytestIsolatedOutputEvidence,
  InteractivePlaytestResult,
  InteractivePlaytestRun,
  InteractivePlaytestRunStatus,
  InteractivePlaytestRuntimeInfo,
  InteractivePlaytestStagingSummary,
} from '../../../../contract/types.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import { attestIsolatedPreparationResponse } from './isolated-project-attestation.ts';
import {
  prepareBattleTestProject,
  type BattleTestConfiguration,
  type BattleTestProjectPreparation,
} from './battle-test-preparation.ts';
import {
  cleanupIsolatedProject,
  verifyIsolatedSourceState,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts';
import {
  buildIsolatedNwLaunchCommand,
  type IsolatedNwActivePackageEvidence,
} from './isolated-nw-app-launch.ts';
import {
  prepareParticleAnimationPreview,
  type ParticleAnimationPreviewPreparation,
} from './particle-animation-preview-preparation.ts';
import { getProjectStagingStatus } from './staging-service.ts';
import {
  createRpgMakerMZRuntimeOutputSanitizer,
  redactRpgMakerMZRuntimePath,
  resolveRpgMakerMZProjectRuntime,
  type RpgMakerMZProjectRuntime,
} from './rpg-maker-mz-runtime.ts';
import {
  resolveInteractiveProjectRuntime,
  type InteractiveProjectRuntime,
  type InteractiveProjectRuntimeResolution,
} from './interactive-playtest-runtime.ts';

export interface InteractivePlaytestStream extends EventEmitter {
  on(event: 'data', listener: (chunk: Buffer | string) => void): this;
}

export interface InteractivePlaytestChild extends EventEmitter {
  pid?: number;
  stdout: InteractivePlaytestStream | null;
  stderr: InteractivePlaytestStream | null;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface InteractivePlaytestSpawnOptions {
  cwd: string;
  windowsHide: false;
  shell: false;
  stdio: ['ignore', 'pipe', 'pipe'];
}

export interface InteractivePlaytestDependencies {
  spawnProcess: (
    executable: string,
    args: readonly string[],
    options: InteractivePlaytestSpawnOptions,
  ) => InteractivePlaytestChild;
  getStagingStatus: (workflowRoot: string, project: string) => unknown;
  requestGracefulStop: (child: InteractivePlaytestChild) => { ok: boolean; error?: string };
  forceKillProcessTree: (child: InteractivePlaytestChild) => Promise<{ ok: boolean; error?: string }>;
  forceKillProcessTreeSync: (child: InteractivePlaytestChild) => { ok: boolean; error?: string };
  onStatus: (run: InteractivePlaytestRun) => void;
  inspectProject: (project: string) => { engine: RpgMakerEngine; editable: boolean; missingRequired: string[] };
  resolveMZRuntime: (projectDirectory: string) => RpgMakerMZProjectRuntime;
  resolveProjectRuntime: (projectDirectory: string, engine: RpgMakerEngine) => InteractiveProjectRuntimeResolution;
  prepareBattleTest: (
    workflowRoot: string,
    project: string,
    configuration: BattleTestConfiguration,
  ) => BattleTestProjectPreparation | Promise<BattleTestProjectPreparation>;
  prepareParticlePreview: (
    workflowRoot: string,
    project: string,
    animation: InteractiveParticleAnimationPreview,
  ) => ParticleAnimationPreviewPreparation | Promise<ParticleAnimationPreviewPreparation>;
  verifyIsolatedSource: typeof verifyIsolatedSourceState;
  cleanupIsolated: typeof cleanupIsolatedProject;
  randomUUID: () => string;
  now: () => Date;
  startupTimeoutMs: number;
  stopGraceMs: number;
  forceExitWaitMs: number;
}

export interface InteractivePlaytestStartOptions {
  mode?: InteractivePlaytestMode;
  confirmedStagingHash?: string;
  sessionId?: string;
  troopId?: number;
  battlers?: InteractiveBattleTestBattler[];
  battleback1Name?: string;
  battleback2Name?: string;
  animationPreview?: InteractiveParticleAnimationPreview;
}

interface IsolatedNwInteractiveStartOptions {
  sessionId: string;
  profileDirectory: string;
  sourceProject: string;
  preparation: IsolatedProjectPreparation;
  evidence: IsolatedNwEvidenceContract;
}

interface IsolatedNwEvidenceContract {
  paths: {
    engineEntry: string;
    loadState: string;
    diagnostics: string;
    sceneHandshake: string;
  };
  schemas: {
    engineEntry: string;
    loadState: string;
    diagnostics: string;
    sceneHandshake: string;
  };
  application: IsolatedNwActivePackageEvidence;
}

interface IsolatedNwEvidenceContext extends IsolatedNwEvidenceContract {
  sessionId: string;
  temporaryProject: string;
}

interface StagingConfirmation {
  staged: boolean;
  summary: InteractivePlaytestStagingSummary;
  hash: string;
}

const STARTUP_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 2_000;
const FORCE_EXIT_WAIT_MS = 2_000;
const ISOLATED_OUTPUT_MAX_OBSERVED_BYTES = 256 * 1024;

const TERMINAL_STATUSES = new Set<InteractivePlaytestRunStatus>([
  'stopped',
  'exited',
  'failed',
  'stop_failed',
]);

export class InteractivePlaytestService {
  readonly #workflowRoot: string;
  readonly #dependencies: InteractivePlaytestDependencies;
  readonly #runs = new Map<string, InteractivePlaytestRun>();
  #currentRun: InteractivePlaytestRun | null = null;
  #child: InteractivePlaytestChild | null = null;
  #stopRequested = false;
  #stopPromise: Promise<InteractivePlaytestResult> | null = null;
  #battlePreparation: BattleTestProjectPreparation | ParticleAnimationPreviewPreparation | null = null;
  #unlaunchedPreparation = false;
  #preparingIsolation = false;
  #isolatedEvidenceContext: IsolatedNwEvidenceContext | null = null;

  constructor(
    workflowRoot: string,
    dependencies: Partial<InteractivePlaytestDependencies> = {},
  ) {
    this.#workflowRoot = path.resolve(workflowRoot);
    this.#dependencies = {
      spawnProcess: dependencies.spawnProcess || defaultSpawnProcess,
      getStagingStatus: dependencies.getStagingStatus || getProjectStagingStatus,
      requestGracefulStop: dependencies.requestGracefulStop || defaultRequestGracefulStop,
      forceKillProcessTree: dependencies.forceKillProcessTree || defaultForceKillProcessTree,
      forceKillProcessTreeSync: dependencies.forceKillProcessTreeSync || defaultForceKillProcessTreeSync,
      onStatus: dependencies.onStatus || (() => undefined),
      inspectProject: dependencies.inspectProject || inspectRmmvProject,
      resolveMZRuntime: dependencies.resolveMZRuntime || resolveRpgMakerMZProjectRuntime,
      resolveProjectRuntime: dependencies.resolveProjectRuntime || resolveInteractiveProjectRuntime,
      prepareBattleTest: dependencies.prepareBattleTest || prepareBattleTestProject,
      prepareParticlePreview: dependencies.prepareParticlePreview || prepareParticleAnimationPreview,
      verifyIsolatedSource: dependencies.verifyIsolatedSource || verifyIsolatedSourceState,
      cleanupIsolated: dependencies.cleanupIsolated || cleanupIsolatedProject,
      randomUUID: dependencies.randomUUID || crypto.randomUUID,
      now: dependencies.now || (() => new Date()),
      startupTimeoutMs: dependencies.startupTimeoutMs ?? STARTUP_TIMEOUT_MS,
      stopGraceMs: dependencies.stopGraceMs ?? STOP_GRACE_MS,
      forceExitWaitMs: dependencies.forceExitWaitMs ?? FORCE_EXIT_WAIT_MS,
    };
  }

  current(): InteractivePlaytestResult {
    return {
      confirmationRequired: false,
      ...(this.#currentRun ? { run: cloneRun(this.#currentRun) } : {}),
    };
  }

  runtimeInfo(projectRoot: string): InteractivePlaytestRuntimeInfo {
    const project = fs.realpathSync.native(path.resolve(projectRoot));
    const manifest = this.#dependencies.inspectProject(project);
    if (!manifest.editable) {
      throw new Error(`The RPG Maker project is not editable: ${manifest.missingRequired.join(', ')}`);
    }
    const resolution = this.#dependencies.resolveProjectRuntime(project, manifest.engine);
    if (!resolution.runtime) {
      return {
        engine: manifest.engine,
        source: 'unavailable',
        executable: null,
        configurable: true,
        status: resolution.selectionRequired?.reason === 'invalid' ? 'invalid' : 'missing',
      };
    }
    return {
      engine: manifest.engine,
      source: resolution.runtime.source,
      executable: resolution.runtime.executable,
      configurable: resolution.runtime.source !== 'project-local',
      status: 'ready',
    };
  }

  getRun(runId: string): InteractivePlaytestRun | null {
    const run = this.#runs.get(runId);
    return run ? cloneRun(run) : null;
  }

  async start(
    projectRoot: string,
    options: InteractivePlaytestStartOptions = {},
  ): Promise<InteractivePlaytestResult> {
    return this.#start(projectRoot, options, null);
  }

  async startIsolatedNwApp(
    projectRoot: string,
    options: IsolatedNwInteractiveStartOptions,
  ): Promise<InteractivePlaytestResult> {
    return this.#start(projectRoot, { mode: 'project', sessionId: options.sessionId }, options);
  }

  captureIsolatedNwFailureEvidence(
    sessionId: string,
    reason: InteractivePlaytestIsolatedFailureEvidence['reason'],
  ): InteractivePlaytestResult {
    const run = this.#currentRun;
    const context = this.#isolatedEvidenceContext;
    if (!run?.isolatedLaunch || run.sessionId !== sessionId || context?.sessionId !== sessionId) {
      throw new Error('The isolated playtest evidence session is not active.');
    }
    const normalized = normalizeIsolatedFailureEvidence(captureIsolatedFailureEvidence(context, reason, this.#dependencies.now()));
    run.isolatedLaunch.failureEvidence = normalized;
    this.#appendIsolatedStage('evidence-captured', normalized.capturedAt);
    run.updatedAt = normalized.capturedAt;
    this.#publish(run, 'bounded failure evidence captured');
    return this.current();
  }

  async #start(
    projectRoot: string,
    options: InteractivePlaytestStartOptions,
    isolatedNwApp: IsolatedNwInteractiveStartOptions | null,
  ): Promise<InteractivePlaytestResult> {
    if (this.#child && this.#child.exitCode === null) {
      return {
        ...this.current(),
        error: `Interactive playtest ${this.#currentRun?.runId || ''} is already running.`,
      };
    }
    if (this.#preparingIsolation) {
      return {
        ...this.current(),
        error: 'Another interactive playtest is already being prepared.',
      };
    }
    if (this.#battlePreparation) {
      this.#retryPendingBattleCleanup();
      if (this.#battlePreparation) {
        return {
          ...this.current(),
          error: 'A previous isolated playtest project could not be cleaned up. New playtests are blocked until cleanup succeeds.',
        };
      }
    }
    this.#isolatedEvidenceContext = null;

    const mode = options.mode || 'project';
    let project: string;
    try {
      project = fs.realpathSync.native(path.resolve(projectRoot));
    } catch {
      return { confirmationRequired: false, error: `RPG Maker project directory does not exist: ${path.resolve(projectRoot)}` };
    }
    let engine: RpgMakerEngine;
    try {
      const manifest = this.#dependencies.inspectProject(project);
      if (!manifest.editable) {
        return {
          confirmationRequired: false,
          error: `The RPG Maker project is not editable: ${manifest.missingRequired.join(', ')}`,
        };
      }
      engine = manifest.engine;
    } catch (error) {
      return { confirmationRequired: false, error: errorMessage(error) };
    }

    let projectRuntime: InteractiveProjectRuntime | null = null;
    let launchProject = project;
    let executable = '';
    let evidenceExecutable = '';
    let privateExecutable = '';
    let battlePreparation: BattleTestProjectPreparation | null = null;
    let particlePreparation: ParticleAnimationPreviewPreparation | null = null;
    if (mode === 'project') {
      const resolution = this.#dependencies.resolveProjectRuntime(project, engine);
      if (resolution.selectionRequired) {
        return {
          confirmationRequired: false,
          runtimeSelectionRequired: resolution.selectionRequired,
        };
      }
      if (!resolution.runtime) return { confirmationRequired: false, error: 'The RPG Maker playtest runtime could not be resolved.' };
      projectRuntime = resolution.runtime;
      executable = projectRuntime.executable;
      evidenceExecutable = projectRuntime.evidenceExecutable;
      privateExecutable = projectRuntime.privateExecutable || '';
      let staging: StagingConfirmation;
      try {
        staging = buildStagingConfirmation(this.#dependencies.getStagingStatus(this.#workflowRoot, project));
      } catch (error) {
        return { confirmationRequired: false, error: errorMessage(error) };
      }
      if (staging.staged && options.confirmedStagingHash !== staging.hash) {
        return {
          confirmationRequired: true,
          stagingSummary: staging.summary,
          stagingSummaryHash: staging.hash,
        };
      }
    } else {
      if (engine === 'rpg-maker-mz') {
        const resolution = this.#dependencies.resolveProjectRuntime(project, engine);
        if (resolution.selectionRequired) {
          return { confirmationRequired: false, runtimeSelectionRequired: resolution.selectionRequired };
        }
        if (!resolution.runtime) return { confirmationRequired: false, error: 'The RPG Maker playtest runtime could not be resolved.' };
        projectRuntime = resolution.runtime;
        executable = projectRuntime.executable;
        evidenceExecutable = projectRuntime.evidenceExecutable;
        privateExecutable = projectRuntime.privateExecutable || '';
      } else {
        executable = path.join(project, 'Game.exe');
        evidenceExecutable = executable;
      }
    }

    if (mode === 'battle_test') {
      this.#preparingIsolation = true;
      try {
        // Preparation may run in a worker process; never block the caller thread.
        battlePreparation = await this.#dependencies.prepareBattleTest(this.#workflowRoot, project, {
          troopId: requirePositiveInteger(options.troopId, 'Battle Test troopId'),
          battlers: Array.isArray(options.battlers) ? options.battlers : [],
          battleback1Name: String(options.battleback1Name || ''),
          battleback2Name: String(options.battleback2Name || ''),
        });
      } catch (error) {
        return { confirmationRequired: false, error: errorMessage(error) };
      } finally {
        this.#preparingIsolation = false;
      }
      this.#battlePreparation = battlePreparation;
      this.#unlaunchedPreparation = true;
      launchProject = battlePreparation.temporaryProject;
      if (battlePreparation.engine !== engine) {
        const cleanupError = this.#cleanupUnlaunchedPreparation(battlePreparation, 'Battle Test');
        return { confirmationRequired: false, error: ['Battle Test project engine changed while preparing the isolated copy.', cleanupError].filter(Boolean).join(' ') };
      }
      if (engine === 'rpg-maker-mv') {
        if (!battlePreparation.executable) {
          const cleanupError = this.#cleanupUnlaunchedPreparation(battlePreparation, 'Battle Test');
          return { confirmationRequired: false, error: ['Game.exe was not found in the isolated RPG Maker MV project.', cleanupError].filter(Boolean).join(' ') };
        }
        executable = battlePreparation.executable;
        evidenceExecutable = executable;
      }
    } else if (mode === 'particle_preview') {
      if (!options.animationPreview) {
        return { confirmationRequired: false, error: 'Particle animation preview data is required.' };
      }
      this.#preparingIsolation = true;
      try {
        particlePreparation = await this.#dependencies.prepareParticlePreview(
          this.#workflowRoot,
          project,
          options.animationPreview,
        );
      } catch (error) {
        return { confirmationRequired: false, error: errorMessage(error) };
      } finally {
        this.#preparingIsolation = false;
      }
      this.#battlePreparation = particlePreparation;
      this.#unlaunchedPreparation = true;
      launchProject = particlePreparation.appDirectory;
      if (particlePreparation.engine !== engine) {
        const cleanupError = this.#cleanupUnlaunchedPreparation(particlePreparation, 'Particle preview');
        return { confirmationRequired: false, error: ['Particle preview project engine changed while preparing the isolated copy.', cleanupError].filter(Boolean).join(' ') };
      }
    } else if (mode !== 'project') {
      return { confirmationRequired: false, error: `Unsupported interactive playtest mode: ${String(mode)}` };
    }

    let isolatedCommand: ReturnType<typeof buildIsolatedNwLaunchCommand> | null = null;
    try {
      if (isolatedNwApp) {
        attestIsolatedPreparationResponse({
          sourceProject: isolatedNwApp.sourceProject,
          temporaryProject: project,
          ownership: isolatedNwApp.preparation.ownership,
        }, isolatedNwApp.preparation);
      }
      isolatedCommand = isolatedNwApp && projectRuntime
        ? buildIsolatedNwLaunchCommand(
          projectRuntime,
          isolatedNwApp.preparation,
          isolatedNwApp.sessionId,
          isolatedNwApp.profileDirectory,
          'staged-project',
        )
        : null;
    } catch (error) {
      const cleanupError = this.#battlePreparation
        ? this.#cleanupUnlaunchedPreparation(this.#battlePreparation, mode === 'particle_preview' ? 'Particle preview' : 'Battle Test')
        : '';
      return {
        confirmationRequired: false,
        error: [redactRuntimePath(errorMessage(error), privateExecutable || ''), cleanupError].filter(Boolean).join(' '),
      };
    }
    if (isolatedNwApp) {
      this.#isolatedEvidenceContext = normalizeIsolatedEvidenceContext(launchProject, isolatedNwApp);
    }

    const now = this.#dependencies.now();
    const runId = buildRunId(now, this.#dependencies.randomUUID());
    const artifactDir = path.join(this.#workflowRoot, 'runtime', 'out', 'playtest', 'interactive', runId);
    const artifactRelativeDir = path.posix.join('runtime', 'out', 'playtest', 'interactive', runId);
    const artifactLocations = buildArtifactLocations(artifactDir);
    const run: InteractivePlaytestRun = {
      runId,
      status: 'starting',
      mode,
      engine,
      project: isolatedCommand ? 'source-project' : mode === 'particle_preview' ? '[current RPG Maker MZ project]' : project,
      executable: isolatedCommand ? isolatedCommand.evidence.executableRole : evidenceExecutable,
      cwd: isolatedCommand ? 'temporary-project' : mode === 'particle_preview' ? '[isolated particle preview]' : launchProject,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      exitCode: null,
      signal: null,
      forced: false,
      stagingIncluded: Boolean(isolatedNwApp) || mode !== 'project',
      sourceSaveRisk: !isolatedNwApp && mode === 'project',
      temporaryProject: Boolean(isolatedNwApp) || mode !== 'project',
      ...(battlePreparation ? {
        troopId: battlePreparation.troopId,
        troopName: battlePreparation.troopName,
        stagedFileCount: battlePreparation.staging.files.length,
      } : {}),
      ...(particlePreparation ? { effectName: particlePreparation.effectName } : {}),
      ...(isolatedCommand ? {
        isolatedLaunch: {
          ...isolatedCommand.evidence,
          argumentRoles: [...isolatedCommand.evidence.argumentRoles],
          checks: { ...isolatedCommand.evidence.checks },
          digests: { ...isolatedCommand.evidence.digests },
          application: {
            ...this.#isolatedEvidenceContext!.application,
            digests: { ...this.#isolatedEvidenceContext!.application.digests },
          },
          stages: [
            { stage: 'constructed', at: now.toISOString() },
            { stage: 'spawn-requested', at: this.#dependencies.now().toISOString() },
          ],
        },
      } : {}),
      lifecycleOnly: true,
      artifactDir: isolatedCommand ? artifactRelativeDir : artifactDir,
      artifactPath: isolatedCommand ? path.posix.join(artifactRelativeDir, 'playtest-run.json') : artifactLocations.artifactPath,
      logPath: isolatedCommand ? path.posix.join(artifactRelativeDir, 'playtest.log') : artifactLocations.logPath,
      stdoutPath: isolatedCommand ? path.posix.join(artifactRelativeDir, 'stdout.log') : artifactLocations.stdoutPath,
      stderrPath: isolatedCommand ? path.posix.join(artifactRelativeDir, 'stderr.log') : artifactLocations.stderrPath,
    };
    initializeArtifacts(run, artifactLocations, Boolean(isolatedCommand));
    this.#currentRun = run;
    this.#runs.set(runId, run);
    this.#stopRequested = false;
    this.#battlePreparation = battlePreparation || particlePreparation;
    this.#unlaunchedPreparation = false;
    this.#publish(run, 'launch requested');

    return new Promise<InteractivePlaytestResult>((resolve) => {
      let startResolved = false;
      let startupTimer: ReturnType<typeof setTimeout> | null = null;
      const resolveStart = () => {
        if (startResolved) return;
        startResolved = true;
        if (startupTimer) clearTimeout(startupTimer);
        resolve(this.current());
      };

      let child: InteractivePlaytestChild;
      try {
        const args = isolatedCommand
          ? isolatedCommand.args
          : mode === 'project'
            ? projectRuntime?.launchStyle === 'external'
              ? engine === 'rpg-maker-mv' ? [launchProject, 'test'] : [launchProject]
              : []
            : engine === 'rpg-maker-mz'
              ? [launchProject, ...(mode === 'battle_test' ? ['test&btest'] : [])]
              : mode === 'battle_test' ? ['test&btest'] : [];
        child = this.#dependencies.spawnProcess(isolatedCommand?.executable || executable, args, {
          cwd: launchProject,
          windowsHide: false,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        this.#finishWithIsolation('failed', { error: redactRuntimePath(errorMessage(error), privateExecutable || '') });
        resolveStart();
        return;
      }
      this.#child = child;
      const outputRuntimeExecutable = privateExecutable || '';
      const stdoutCapture = isolatedCommand
        ? attachIsolatedOutput(child.stdout, artifactLocations.stdoutPath, artifactLocations.logPath, 'stdout')
        : { flush: attachOutput(child.stdout, artifactLocations.stdoutPath, artifactLocations.logPath, outputRuntimeExecutable) };
      const stderrCapture = isolatedCommand
        ? attachIsolatedOutput(child.stderr, artifactLocations.stderrPath, artifactLocations.logPath, 'stderr')
        : { flush: attachOutput(child.stderr, artifactLocations.stderrPath, artifactLocations.logPath, outputRuntimeExecutable) };
      const flushOutput = () => {
        const stdout = stdoutCapture.flush();
        const stderr = stderrCapture.flush();
        if (run.isolatedLaunch && stdout && stderr) run.isolatedLaunch.output = { stdout, stderr };
      };

      child.once('spawn', () => {
        if (!this.#isCurrent(runId) || TERMINAL_STATUSES.has(this.#currentRun!.status)) return;
        if (run.isolatedLaunch && Number.isSafeInteger(child.pid) && Number(child.pid) > 0) {
          run.isolatedLaunch.childPid = Number(child.pid);
        }
        this.#appendIsolatedStage('runner-spawned');
        this.#update({ status: 'running', ...(child.pid ? { pid: child.pid } : {}) }, 'runner started');
        resolveStart();
      });
      child.once('error', (error: Error) => {
        if (!this.#isCurrent(runId) || TERMINAL_STATUSES.has(this.#currentRun!.status)) return;
        flushOutput();
        this.#child = null;
        this.#finishWithIsolation('failed', { error: redactRuntimePath(error.message, outputRuntimeExecutable) });
        resolveStart();
      });
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (!this.#isCurrent(runId)) return;
        flushOutput();
        if (this.#currentRun!.status === 'stop_failed') {
          const existingError = this.#currentRun!.error;
          this.#child = null;
          this.#finishWithIsolation('failed', {
            exitCode: code,
            signal,
            ...(existingError ? { error: existingError } : {}),
          });
          resolveStart();
          return;
        }
        if (TERMINAL_STATUSES.has(this.#currentRun!.status)) return;
        const stopped = this.#stopRequested;
        const existingError = this.#currentRun?.error;
        this.#child = null;
        this.#finishWithIsolation(stopped ? 'stopped' : code === 0 ? 'exited' : 'failed', {
          exitCode: code,
          signal,
          ...(stopped || code === 0 || existingError
            ? {}
            : { error: `The playtest runner exited with code ${code ?? 'unknown'}.` }),
        });
        resolveStart();
      });

      startupTimer = setTimeout(() => {
        if (startResolved || !this.#isCurrent(runId) || this.#currentRun?.status !== 'starting') return;
        void this.#handleStartupTimeout(child).finally(resolveStart);
      }, this.#dependencies.startupTimeoutMs);
    });
  }

  async stop(): Promise<InteractivePlaytestResult> {
    if (this.#stopPromise) return this.#stopPromise;
    const child = this.#child;
    if (!child || child.exitCode !== null) {
      this.#retryPendingBattleCleanup();
      return this.current();
    }
    this.#stopPromise = this.#stopChild(child).finally(() => {
      this.#stopPromise = null;
    });
    return this.#stopPromise;
  }

  async shutdown(): Promise<InteractivePlaytestResult> {
    return this.stop();
  }

  shutdownSync(): InteractivePlaytestResult {
    const child = this.#child;
    if (!child || child.exitCode !== null) {
      this.#retryPendingBattleCleanup();
      return this.current();
    }
    this.#stopRequested = true;
    this.#dependencies.requestGracefulStop(child);
    const forced = this.#dependencies.forceKillProcessTreeSync(child);
    if (child.exitCode !== null) {
      this.#child = null;
      this.#finishWithIsolation('stopped', { exitCode: child.exitCode, signal: child.signalCode, forced: true });
    } else {
      this.#finish('stop_failed', {
        forced: true,
        error: forced.error || 'The playtest runner process-tree cleanup could not be confirmed before application exit.',
      });
    }
    return this.current();
  }

  async #stopChild(child: InteractivePlaytestChild): Promise<InteractivePlaytestResult> {
    this.#stopRequested = true;
    this.#update({ status: 'stopping' }, 'graceful stop requested');
    const graceful = this.#dependencies.requestGracefulStop(child);
    const gracefulError = graceful.error || (graceful.ok ? '' : 'The playtest runner rejected the graceful stop request.');
    if (await waitForExit(child, this.#dependencies.stopGraceMs)) return this.current();

    this.#update({ forced: true }, 'force process-tree cleanup requested');
    const forced = await this.#dependencies.forceKillProcessTree(child);
    if (await waitForExit(child, this.#dependencies.forceExitWaitMs)) return this.current();

    const error = forced.error || gracefulError || 'The playtest runner process tree did not exit after forced cleanup.';
    this.#finish('stop_failed', { forced: true, error });
    return this.current();
  }

  async #handleStartupTimeout(child: InteractivePlaytestChild): Promise<void> {
    this.#update({
      forced: true,
      error: `The playtest runner startup timed out after ${this.#dependencies.startupTimeoutMs}ms.`,
    }, 'startup timeout');
    const forced = await this.#dependencies.forceKillProcessTree(child);
    this.#update({}, 'startup timeout cleanup requested');
    await waitForExit(child, this.#dependencies.forceExitWaitMs);
    if (this.#child === child) {
      this.#finish('stop_failed', {
        forced: true,
        error: forced.error
          ? `The playtest runner startup timed out; cleanup failed: ${forced.error}`
          : 'The playtest runner startup timed out and its process tree did not exit after cleanup.',
      });
    }
  }

  #isCurrent(runId: string): boolean {
    return this.#currentRun?.runId === runId;
  }

  #update(
    patch: Partial<InteractivePlaytestRun>,
    logMessage: string,
  ): void {
    if (!this.#currentRun) return;
    Object.assign(this.#currentRun, patch, { updatedAt: this.#dependencies.now().toISOString() });
    this.#publish(this.#currentRun, logMessage);
  }

  #appendIsolatedStage(
    stage: NonNullable<InteractivePlaytestRun['isolatedLaunch']>['stages'][number]['stage'],
    at = this.#dependencies.now().toISOString(),
  ): void {
    const stages = this.#currentRun?.isolatedLaunch?.stages;
    if (!stages || stages.some((entry) => entry.stage === stage)) return;
    if (stages.length >= 8) throw new Error('The isolated launch evidence exceeded the bounded stage count.');
    stages.push({ stage, at });
  }

  #finish(
    status: Extract<InteractivePlaytestRunStatus, 'stopped' | 'exited' | 'failed' | 'stop_failed'>,
    patch: Partial<InteractivePlaytestRun>,
  ): void {
    if (!this.#currentRun) return;
    const finished = this.#dependencies.now();
    this.#appendIsolatedStage('finished', finished.toISOString());
    Object.assign(this.#currentRun, patch, {
      status,
      updatedAt: finished.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - new Date(this.#currentRun.startedAt).getTime()),
    });
    this.#publish(this.#currentRun, status);
  }

  #finishWithIsolation(
    status: Extract<InteractivePlaytestRunStatus, 'stopped' | 'exited' | 'failed'>,
    patch: Partial<InteractivePlaytestRun>,
  ): void {
    const isolation = this.#finalizeBattlePreparation();
    const errors = [patch.error, isolation.error].filter(Boolean);
    this.#finish(isolation.error ? 'failed' : status, {
      ...patch,
      ...isolation.patch,
      ...(errors.length ? { error: errors.join(' ') } : {}),
    });
  }

  #retryPendingBattleCleanup(): void {
    if (!this.#battlePreparation) return;
    if (this.#unlaunchedPreparation || !this.#currentRun) {
      this.#cleanupUnlaunchedPreparation(this.#battlePreparation, 'Isolated preview');
      return;
    }
    const existingError = this.#currentRun.error;
    this.#finishWithIsolation('failed', existingError ? { error: existingError } : {});
  }

  #cleanupUnlaunchedPreparation(
    preparation: BattleTestProjectPreparation | ParticleAnimationPreviewPreparation,
    label: string,
  ): string {
    try {
      this.#dependencies.cleanupIsolated(preparation);
      if (this.#battlePreparation === preparation) {
        this.#battlePreparation = null;
        this.#unlaunchedPreparation = false;
      }
      return '';
    } catch (error) {
      this.#battlePreparation = preparation;
      this.#unlaunchedPreparation = true;
      return `${label} temporary project cleanup failed; its isolation owner was retained. ${errorMessage(error)}`;
    }
  }

  #finalizeBattlePreparation(): { patch: Partial<InteractivePlaytestRun>; error?: string } {
    const preparation = this.#battlePreparation;
    if (!preparation) return { patch: {} };
    const label = this.#currentRun?.mode === 'particle_preview' ? 'Particle preview' : 'Battle Test';
    const failures: string[] = [];
    let sourceUnchanged = false;
    let savesUnchanged = false;
    let stagingUnchanged = false;
    try {
      const state = this.#dependencies.verifyIsolatedSource(this.#workflowRoot, preparation);
      sourceUnchanged = state.sourceUnchanged;
      savesUnchanged = state.savesUnchanged;
      stagingUnchanged = state.stagingUnchanged;
      if (!sourceUnchanged) failures.push(`Source project content changed during ${label}.`);
      if (!savesUnchanged) failures.push(`Source project save content changed during ${label}.`);
      if (!stagingUnchanged) failures.push(`Staged project content changed during ${label}.${state.stagingError ? ` ${state.stagingError}` : ''}`);
    } catch (error) {
      failures.push(`${label} source isolation could not be verified: ${errorMessage(error)}`);
    }

    let temporaryProjectCleaned = false;
    try {
      this.#dependencies.cleanupIsolated(preparation);
      temporaryProjectCleaned = !fs.existsSync(preparation.temporaryProject);
      if (!temporaryProjectCleaned) failures.push(`${label} temporary project still exists after cleanup.`);
    } catch (error) {
      failures.push(`${label} temporary project cleanup failed: ${errorMessage(error)}`);
    }
    if (temporaryProjectCleaned) {
      this.#battlePreparation = null;
      this.#unlaunchedPreparation = false;
    }
    return {
      patch: {
        sourceUnchanged,
        savesUnchanged,
        stagingUnchanged,
        temporaryProjectCleaned,
      },
      ...(failures.length ? { error: failures.join(' ') } : {}),
    };
  }

  #publish(run: InteractivePlaytestRun, logMessage: string): void {
    const artifacts = buildArtifactLocations(path.join(this.#workflowRoot, 'runtime', 'out', 'playtest', 'interactive', run.runId));
    appendLog(artifacts.logPath, `${run.updatedAt} ${run.status} ${logMessage}\n`);
    writeJsonAtomic(artifacts.artifactPath, run.isolatedLaunch ? isolatedPlaytestArtifact(run) : run);
    this.#runs.set(run.runId, run);
    this.#dependencies.onStatus(cloneRun(run));
  }
}

function buildStagingConfirmation(status: unknown): StagingConfirmation {
  const source = isRecord(status) ? status : {};
  const files = Array.isArray(source.files)
    ? source.files.filter(isRecord).map((entry) => ({
      relativePath: String(entry.relativePath || ''),
      baseHash: entry.baseHash ?? null,
      sourceHash: entry.sourceHash ?? null,
      draftHash: entry.draftHash ?? null,
      recordedDraftHash: entry.recordedDraftHash ?? null,
      operationId: entry.operationId ?? null,
      delete: Boolean(entry.delete),
      conflict: Boolean(entry.conflict),
      conflictReasons: Array.isArray(entry.conflictReasons) ? entry.conflictReasons : [],
      updatedAt: entry.updatedAt ?? null,
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    : [];
  const operations = Array.isArray(source.operations)
    ? source.operations.filter(isRecord).map((entry) => ({
      operationId: String(entry.operationId || ''),
      planHash: String(entry.planHash || ''),
      files: Array.isArray(entry.files) ? entry.files.map(String).sort() : [],
    })).sort((left, right) => left.operationId.localeCompare(right.operationId))
    : [];
  const maps = Array.isArray(source.maps) ? source.maps.map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [];
  const staged = Boolean(source.staged) || files.length > 0 || operations.length > 0;
  const payload = { version: 1, files, operations, maps };
  return {
    staged,
    summary: {
      fileCount: files.length,
      operationCount: operations.length,
      mapCount: maps.length,
      conflict: Boolean(source.conflict) || files.some((file) => file.conflict),
      files: files.map((file) => file.relativePath),
    },
    hash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

interface InteractiveArtifactLocations {
  artifactDir: string;
  artifactPath: string;
  logPath: string;
  stdoutPath: string;
  stderrPath: string;
}

function buildArtifactLocations(artifactDir: string): InteractiveArtifactLocations {
  return {
    artifactDir,
    artifactPath: path.join(artifactDir, 'playtest-run.json'),
    logPath: path.join(artifactDir, 'playtest.log'),
    stdoutPath: path.join(artifactDir, 'stdout.log'),
    stderrPath: path.join(artifactDir, 'stderr.log'),
  };
}

function initializeArtifacts(
  run: InteractivePlaytestRun,
  artifacts: InteractiveArtifactLocations,
  isolatedNw: boolean,
): void {
  fs.mkdirSync(artifacts.artifactDir, { recursive: true });
  fs.writeFileSync(artifacts.stdoutPath, '', 'utf8');
  fs.writeFileSync(artifacts.stderrPath, '', 'utf8');
  fs.writeFileSync(
    artifacts.logPath,
    `RPG Agent MV ${isolatedNw ? 'isolated UI preview' : run.mode === 'battle_test' ? 'isolated Battle Test' : run.mode === 'particle_preview' ? 'isolated MZ particle preview' : 'interactive source playtest'}\nEvidence scope: process lifecycle and isolation only; this does not prove battle, story, or playability correctness.\n`,
    'utf8',
  );
}

function attachIsolatedOutput(
  stream: InteractivePlaytestStream | null,
  outputPath: string,
  logPath: string,
  role: 'stdout' | 'stderr',
): { flush: () => InteractivePlaytestIsolatedOutputEvidence } {
  const hash = crypto.createHash('sha256');
  let observedBytes = 0;
  let truncated = false;
  let summary: InteractivePlaytestIsolatedOutputEvidence | null = null;
  const observe = (value: string | Buffer) => {
    if (summary) return;
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const remaining = Math.max(0, ISOLATED_OUTPUT_MAX_OBSERVED_BYTES - observedBytes);
    const observed = bytes.subarray(0, remaining);
    if (observed.length) {
      hash.update(observed);
      observedBytes += observed.length;
    }
    if (observed.length < bytes.length) truncated = true;
  };
  const flush = (): InteractivePlaytestIsolatedOutputEvidence => {
    if (summary) return summary;
    summary = Object.freeze({ observedBytes, digest: hash.digest('hex'), truncated });
    const line = `${role} semantic evidence: observedBytes=${summary.observedBytes} digest=${summary.digest} truncated=${summary.truncated}\n`;
    fs.writeFileSync(outputPath, line, 'utf8');
    fs.appendFileSync(logPath, line, 'utf8');
    return summary;
  };
  stream?.on('data', observe);
  stream?.once('end', flush);
  stream?.once('close', flush);
  return { flush };
}

function attachOutput(
  stream: InteractivePlaytestStream | null,
  outputPath: string,
  logPath: string,
  runtimeExecutable: string,
): () => void {
  const sanitizer = createRpgMakerMZRuntimeOutputSanitizer(runtimeExecutable);
  const append = (value: string | Buffer) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    if (bytes.length === 0) return;
    fs.appendFileSync(outputPath, bytes);
    fs.appendFileSync(logPath, bytes);
  };
  const flush = () => {
    append(sanitizer.flush());
  };
  stream?.on('data', (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    if (!runtimeExecutable) {
      append(bytes);
      return;
    }
    append(sanitizer.push(bytes.toString('utf8')));
  });
  stream?.once('end', flush);
  stream?.once('close', flush);
  return flush;
}

function appendLog(filePath: string, message: string): void {
  fs.appendFileSync(filePath, message, 'utf8');
}

function waitForExit(child: InteractivePlaytestChild, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(child.exitCode !== null), timeoutMs);
    child.once('exit', onExit);
  });
}

function defaultSpawnProcess(
  executable: string,
  args: readonly string[],
  options: InteractivePlaytestSpawnOptions,
): InteractivePlaytestChild {
  return childProcess.spawn(executable, [...args], options) as InteractivePlaytestChild;
}

function defaultRequestGracefulStop(child: InteractivePlaytestChild): { ok: boolean; error?: string } {
  if (process.platform === 'win32' && child.pid) {
    const result = childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return result.status === 0
      ? { ok: true }
      : { ok: false, error: result.error?.message || `taskkill failed with status ${result.status ?? 'unknown'}.` };
  }
  try {
    return child.kill('SIGTERM') ? { ok: true } : { ok: false, error: 'The playtest runner rejected SIGTERM.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

async function defaultForceKillProcessTree(child: InteractivePlaytestChild): Promise<{ ok: boolean; error?: string }> {
  return defaultForceKillProcessTreeSync(child);
}

function defaultForceKillProcessTreeSync(child: InteractivePlaytestChild): { ok: boolean; error?: string } {
  if (!child.pid) return { ok: false, error: 'The playtest runner process id is unavailable.' };
  if (process.platform === 'win32') {
    const result = childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return result.status === 0
      ? { ok: true }
      : { ok: false, error: result.error?.message || `taskkill failed with status ${result.status ?? 'unknown'}.` };
  }
  try {
    return child.kill('SIGKILL') ? { ok: true } : { ok: false, error: 'The playtest runner rejected SIGKILL.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

}

function isolatedPlaytestArtifact(run: InteractivePlaytestRun): Record<string, unknown> {
  const evidence = run.isolatedLaunch;
  if (!evidence) throw new Error('Isolated playtest artifact evidence is unavailable.');
  return {
    schemaVersion: '1.0.0',
    runId: run.runId,
    status: run.status,
    mode: run.mode,
    engine: run.engine,
    projectRole: 'source-project',
    executableRole: evidence.executableRole,
    cwdRole: 'temporary-project',
    sessionDigest: evidence.digests.session,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
    exitCode: run.exitCode,
    signal: run.signal,
    forced: run.forced,
    stagingIncluded: run.stagingIncluded,
    sourceSaveRisk: run.sourceSaveRisk,
    temporaryProject: run.temporaryProject,
    errorPresent: Boolean(run.error),
    ...(run.error ? { errorDigest: evidenceDigest('isolated-run-error', run.error) } : {}),
    artifactFiles: {
      run: 'playtest-run.json',
      lifecycle: 'playtest.log',
      stdout: 'stdout.log',
      stderr: 'stderr.log',
    },
    isolatedLaunch: evidence,
  };
}

function normalizeIsolatedEvidenceContext(
  temporaryProjectInput: string,
  options: IsolatedNwInteractiveStartOptions,
): IsolatedNwEvidenceContext {
  const temporaryProject = fs.realpathSync.native(path.resolve(temporaryProjectInput));
  const rootStat = fs.lstatSync(temporaryProject);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('The isolated evidence root must be an ordinary directory.');
  const schemas = { ...options.evidence.schemas };
  for (const value of Object.values(schemas)) {
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value) || value.length > 32) {
      throw new Error('The isolated evidence schema is invalid.');
    }
  }
  const paths = { ...options.evidence.paths };
  for (const value of Object.values(paths)) resolveEvidenceTarget(temporaryProject, value);
  const application = normalizeIsolatedApplicationEvidence(temporaryProject, options.evidence.application);
  return { sessionId: options.sessionId, temporaryProject, paths, schemas, application };
}

function normalizeIsolatedApplicationEvidence(
  temporaryProject: string,
  input: IsolatedNwActivePackageEvidence,
): IsolatedNwActivePackageEvidence {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== '1.0.0' || input.uniqueNameValid !== true) {
    throw new Error('The isolated active package evidence is invalid.');
  }
  if (!['index.html', 'www/index.html'].includes(input.activePackageMain)) {
    throw new Error('The isolated active package main evidence is invalid.');
  }
  resolveEvidenceTarget(temporaryProject, input.activePackageMain);
  resolveEvidenceTarget(temporaryProject, input.entryRelativePath);
  const digests = { ...input.digests };
  if (Object.keys(digests).sort().join(',') !== 'entry,index,package'
    || Object.values(digests).some((value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
    throw new Error('The isolated active package digest evidence is invalid.');
  }
  return {
    schemaVersion: '1.0.0',
    activePackageMain: input.activePackageMain,
    uniqueNameValid: true,
    entryRelativePath: input.entryRelativePath,
    digests,
  };
}

function captureIsolatedFailureEvidence(
  context: IsolatedNwEvidenceContext,
  reason: InteractivePlaytestIsolatedFailureEvidence['reason'],
  capturedAt: Date,
): InteractivePlaytestIsolatedFailureEvidence {
  return {
    capturedAt: capturedAt.toISOString(),
    reason,
    files: [
      summarizeIsolatedEvidenceFile(context, 'engine-entry', context.paths.engineEntry, 8 * 1024),
      summarizeIsolatedEvidenceFile(context, 'load-state', context.paths.loadState, 8 * 1024),
      summarizeIsolatedEvidenceFile(context, 'diagnostics', context.paths.diagnostics, 512 * 1024),
      summarizeIsolatedEvidenceFile(context, 'scene-handshake', context.paths.sceneHandshake, 8 * 1024),
    ],
  };
}

function summarizeIsolatedEvidenceFile(
  context: IsolatedNwEvidenceContext,
  role: InteractivePlaytestIsolatedFileEvidence['role'],
  relativePath: string,
  maximumBytes: number,
): InteractivePlaytestIsolatedFileEvidence {
  let target: string;
  try {
    target = resolveEvidenceTarget(context.temporaryProject, relativePath);
  } catch {
    return { role, state: 'invalid', observedBytes: 0, truncated: false };
  }
  if (!fs.existsSync(target)) return { role, state: 'missing', observedBytes: 0, truncated: false };
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || !isPathWithin(context.temporaryProject, fs.realpathSync.native(target))) {
      return { role, state: 'invalid', observedBytes: 0, truncated: false };
    }
  } catch {
    return { role, state: 'invalid', observedBytes: 0, truncated: false };
  }
  if (stat.size > maximumBytes) {
    return { role, state: 'unbounded', observedBytes: Math.min(stat.size, 8 * 1024 * 1024), truncated: true };
  }
  let source: string;
  try { source = fs.readFileSync(target, 'utf8'); } catch { return { role, state: 'invalid', observedBytes: 0, truncated: false }; }
  const base: InteractivePlaytestIsolatedFileEvidence = {
    role,
    state: 'present',
    observedBytes: Buffer.byteLength(source, 'utf8'),
    digest: crypto.createHash('sha256').update(source).digest('hex'),
    truncated: false,
  };
  if (role === 'diagnostics') {
    const records = source.split(/\r?\n/).filter(Boolean).slice(0, 10_000);
    let valid = 0;
    let sessionOwned = 0;
    let schemasMatch = true;
    for (const line of records) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        valid += 1;
        if (value.sessionId === context.sessionId) sessionOwned += 1;
        if (value.schemaVersion !== context.schemas.diagnostics) schemasMatch = false;
      } catch { schemasMatch = false; }
    }
    return {
      ...base,
      schemaMatches: schemasMatch,
      sessionMatches: records.length === sessionOwned,
      recordCount: records.length,
      sessionOwnedRecordCount: sessionOwned,
    };
  }
  try {
    const value = JSON.parse(source) as Record<string, unknown>;
    if (role === 'engine-entry') {
      const phase = typeof value.phase === 'string' && ['entry-invoked', 'entry-failed', 'engine-entry-loaded'].includes(value.phase)
        ? value.phase as InteractivePlaytestIsolatedFileEvidence['phase']
        : undefined;
      const stage = typeof value.stage === 'string' && ['node-api', 'document-url', 'document-root', 'targets', 'session-marker', 'session-boundary'].includes(value.stage)
        ? value.stage as InteractivePlaytestIsolatedFileEvidence['stage']
        : undefined;
      if (!phase || (phase === 'entry-failed') !== Boolean(stage) || (phase !== 'entry-failed' && value.stage !== undefined)) {
        return { ...base, state: 'invalid' };
      }
      return {
        ...base,
        schemaMatches: value.schemaVersion === context.schemas.engineEntry,
        sessionMatches: value.sessionId === context.sessionId,
        phase,
        ...(stage ? { stage } : {}),
      };
    }
    if (role === 'load-state') {
      const phase = typeof value.phase === 'string' && ['engine-entry-loaded', 'bootstrap-loaded', 'runtime-configured', 'target-scheduled', 'scene-ready'].includes(value.phase)
        ? value.phase as InteractivePlaytestIsolatedFileEvidence['phase']
        : undefined;
      return {
        ...base,
        schemaMatches: value.schemaVersion === context.schemas.loadState,
        sessionMatches: value.sessionId === context.sessionId,
        ...(phase ? { phase } : {}),
      };
    }
    return {
      ...base,
      schemaMatches: value.schemaVersion === context.schemas.sceneHandshake,
      sessionMatches: value.sessionId === context.sessionId,
      expectedSceneMatchesActual: typeof value.expectedScene === 'string' && value.expectedScene === value.actualScene,
    };
  } catch {
    return { ...base, state: 'invalid' };
  }
}

function resolveEvidenceTarget(root: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 512 || relativePath.includes('\0') || relativePath.includes('\\')
    || relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('The isolated evidence path must be a canonical project-relative path.');
  }
  const target = path.resolve(root, ...relativePath.split('/'));
  if (!isPathWithin(root, target)) throw new Error('The isolated evidence path escaped the temporary project.');
  const parent = fs.realpathSync.native(path.dirname(target));
  const parentStat = fs.lstatSync(path.dirname(target));
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !isPathWithin(root, parent)) {
    throw new Error('The isolated evidence parent escaped the temporary project.');
  }
  return target;
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizeIsolatedFailureEvidence(
  input: InteractivePlaytestIsolatedFailureEvidence,
): InteractivePlaytestIsolatedFailureEvidence {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Isolated failure evidence must be an object.');
  if (!['startup-failed', 'runner-failed', 'handshake-failed'].includes(input.reason)) {
    throw new Error('Isolated failure evidence reason is invalid.');
  }
  const captured = new Date(input.capturedAt);
  if (!Number.isFinite(captured.getTime()) || input.capturedAt.length > 64) {
    throw new Error('Isolated failure evidence timestamp is invalid.');
  }
  if (!Array.isArray(input.files) || input.files.length !== 4) {
    throw new Error('Isolated failure evidence files are invalid.');
  }
  const roles = new Set<string>();
  const files = input.files.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Isolated failure evidence file is invalid.');
    if (!['engine-entry', 'load-state', 'diagnostics', 'scene-handshake'].includes(entry.role) || roles.has(entry.role)) {
      throw new Error('Isolated failure evidence file role is invalid.');
    }
    roles.add(entry.role);
    if (!['missing', 'present', 'invalid', 'unbounded'].includes(entry.state)) {
      throw new Error('Isolated failure evidence file state is invalid.');
    }
    if (!Number.isSafeInteger(entry.observedBytes) || entry.observedBytes < 0 || entry.observedBytes > 8 * 1024 * 1024) {
      throw new Error('Isolated failure evidence file size is invalid.');
    }
    if (entry.digest !== undefined && !/^[a-f0-9]{64}$/.test(entry.digest)) {
      throw new Error('Isolated failure evidence digest is invalid.');
    }
    if (typeof entry.truncated !== 'boolean') throw new Error('Isolated failure evidence truncation flag is invalid.');
    const numberValue = (value: number | undefined, label: string) => {
      if (value === undefined) return undefined;
      if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new Error(`${label} is invalid.`);
      return value;
    };
    const booleanValue = (value: boolean | undefined, label: string) => {
      if (value !== undefined && typeof value !== 'boolean') throw new Error(`${label} is invalid.`);
      return value;
    };
    if (entry.phase !== undefined && !['entry-invoked', 'entry-failed', 'engine-entry-loaded', 'bootstrap-loaded', 'runtime-configured', 'target-scheduled', 'scene-ready'].includes(entry.phase)) {
      throw new Error('Isolated failure evidence phase is invalid.');
    }
    if (entry.stage !== undefined && !['node-api', 'document-url', 'document-root', 'targets', 'session-marker', 'session-boundary'].includes(entry.stage)) {
      throw new Error('Isolated failure evidence stage is invalid.');
    }
    if ((entry.phase === 'entry-failed') !== Boolean(entry.stage) || (entry.phase !== 'entry-failed' && entry.stage !== undefined)) {
      throw new Error('Isolated failure evidence phase and stage are inconsistent.');
    }
    return {
      role: entry.role,
      state: entry.state,
      observedBytes: entry.observedBytes,
      ...(entry.digest ? { digest: entry.digest } : {}),
      truncated: entry.truncated,
      ...(entry.schemaMatches !== undefined ? { schemaMatches: booleanValue(entry.schemaMatches, 'Isolated evidence schema flag')! } : {}),
      ...(entry.sessionMatches !== undefined ? { sessionMatches: booleanValue(entry.sessionMatches, 'Isolated evidence session flag')! } : {}),
      ...(entry.phase ? { phase: entry.phase } : {}),
      ...(entry.stage ? { stage: entry.stage } : {}),
      ...(entry.recordCount !== undefined ? { recordCount: numberValue(entry.recordCount, 'Isolated evidence record count')! } : {}),
      ...(entry.sessionOwnedRecordCount !== undefined ? { sessionOwnedRecordCount: numberValue(entry.sessionOwnedRecordCount, 'Isolated evidence session record count')! } : {}),
      ...(entry.expectedSceneMatchesActual !== undefined
        ? { expectedSceneMatchesActual: booleanValue(entry.expectedSceneMatchesActual, 'Isolated evidence scene flag')! }
        : {}),
    };
  });
  for (const requiredRole of ['engine-entry', 'load-state', 'diagnostics', 'scene-handshake']) {
    if (!roles.has(requiredRole)) throw new Error('Isolated failure evidence is missing a required file role.');
  }
  return {
    capturedAt: captured.toISOString(),
    reason: input.reason,
    files,
  };
}

function evidenceDigest(role: string, value: string): string {
  return crypto.createHash('sha256').update(`${role}\0${value}`).digest('hex');
}

function buildRunId(now: Date, uuid: string): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const suffix = uuid.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
  return `interactive-${stamp}-${suffix}`;
}

function cloneRun(run: InteractivePlaytestRun): InteractivePlaytestRun {
  return structuredClone(run);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requirePositiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactRuntimePath(message: string, executable: string): string {
  return redactRpgMakerMZRuntimePath(message, executable);
}
