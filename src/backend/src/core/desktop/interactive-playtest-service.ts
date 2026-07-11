import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import type {
  InteractivePlaytestResult,
  InteractivePlaytestRun,
  InteractivePlaytestRunStatus,
  InteractivePlaytestStagingSummary,
} from '../../../../contract/types.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import { getProjectStagingStatus } from './staging-service.ts';

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
  randomUUID: () => string;
  now: () => Date;
  startupTimeoutMs: number;
  stopGraceMs: number;
  forceExitWaitMs: number;
}

export interface InteractivePlaytestStartOptions {
  confirmedStagingHash?: string;
  sessionId?: string;
}

interface StagingConfirmation {
  staged: boolean;
  summary: InteractivePlaytestStagingSummary;
  hash: string;
}

const STARTUP_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 2_000;
const FORCE_EXIT_WAIT_MS = 2_000;

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

  getRun(runId: string): InteractivePlaytestRun | null {
    const run = this.#runs.get(runId);
    return run ? cloneRun(run) : null;
  }

  async start(
    projectRoot: string,
    options: InteractivePlaytestStartOptions = {},
  ): Promise<InteractivePlaytestResult> {
    if (this.#child && this.#child.exitCode === null) {
      return {
        ...this.current(),
        error: `Interactive playtest ${this.#currentRun?.runId || ''} is already running.`,
      };
    }

    let project: string;
    try {
      project = fs.realpathSync.native(path.resolve(projectRoot));
    } catch {
      return { confirmationRequired: false, error: `RMMV project directory does not exist: ${path.resolve(projectRoot)}` };
    }
    const executable = path.join(project, 'Game.exe');
    if (!isFile(executable)) {
      return { confirmationRequired: false, error: `Game.exe was not found in the current project root: ${executable}` };
    }

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

    const now = this.#dependencies.now();
    const runId = buildRunId(now, this.#dependencies.randomUUID());
    const artifactDir = path.join(this.#workflowRoot, 'runtime', 'out', 'playtest', 'interactive', runId);
    const run: InteractivePlaytestRun = {
      runId,
      status: 'starting',
      project,
      executable,
      cwd: project,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      exitCode: null,
      signal: null,
      forced: false,
      stagingIncluded: false,
      sourceSaveRisk: true,
      lifecycleOnly: true,
      artifactDir,
      artifactPath: path.join(artifactDir, 'playtest-run.json'),
      logPath: path.join(artifactDir, 'playtest.log'),
      stdoutPath: path.join(artifactDir, 'stdout.log'),
      stderrPath: path.join(artifactDir, 'stderr.log'),
    };
    initializeArtifacts(run);
    this.#currentRun = run;
    this.#runs.set(runId, run);
    this.#stopRequested = false;
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
        child = this.#dependencies.spawnProcess(executable, [], {
          cwd: project,
          windowsHide: false,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        this.#finish('failed', { error: errorMessage(error) });
        resolveStart();
        return;
      }
      this.#child = child;
      attachOutput(child.stdout, run.stdoutPath, run.logPath);
      attachOutput(child.stderr, run.stderrPath, run.logPath);

      child.once('spawn', () => {
        if (!this.#isCurrent(runId) || TERMINAL_STATUSES.has(this.#currentRun!.status)) return;
        this.#update({ status: 'running', ...(child.pid ? { pid: child.pid } : {}) }, 'runner started');
        resolveStart();
      });
      child.once('error', (error: Error) => {
        if (!this.#isCurrent(runId) || TERMINAL_STATUSES.has(this.#currentRun!.status)) return;
        this.#child = null;
        this.#finish('failed', { error: error.message });
        resolveStart();
      });
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (!this.#isCurrent(runId)) return;
        if (this.#currentRun!.status === 'stop_failed') {
          const existingError = this.#currentRun!.error;
          this.#child = null;
          this.#finish('failed', {
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
        this.#finish(stopped ? 'stopped' : code === 0 ? 'exited' : 'failed', {
          exitCode: code,
          signal,
          ...(stopped || code === 0 || existingError
            ? {}
            : { error: `Game.exe exited with code ${code ?? 'unknown'}.` }),
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
    if (!child || child.exitCode !== null) return this.current();
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
    if (!child || child.exitCode !== null) return this.current();
    this.#stopRequested = true;
    this.#dependencies.requestGracefulStop(child);
    const forced = this.#dependencies.forceKillProcessTreeSync(child);
    if (child.exitCode !== null) {
      this.#child = null;
      this.#finish('stopped', { exitCode: child.exitCode, signal: child.signalCode, forced: true });
    } else {
      this.#finish('stop_failed', {
        forced: true,
        error: forced.error || 'Game.exe process-tree cleanup could not be confirmed before application exit.',
      });
    }
    return this.current();
  }

  async #stopChild(child: InteractivePlaytestChild): Promise<InteractivePlaytestResult> {
    this.#stopRequested = true;
    this.#update({ status: 'stopping' }, 'graceful stop requested');
    const graceful = this.#dependencies.requestGracefulStop(child);
    const gracefulError = graceful.error || (graceful.ok ? '' : 'Game.exe rejected the graceful stop request.');
    if (await waitForExit(child, this.#dependencies.stopGraceMs)) return this.current();

    this.#update({ forced: true }, 'force process-tree cleanup requested');
    const forced = await this.#dependencies.forceKillProcessTree(child);
    if (await waitForExit(child, this.#dependencies.forceExitWaitMs)) return this.current();

    const error = forced.error || gracefulError || 'Game.exe process tree did not exit after forced cleanup.';
    this.#finish('stop_failed', { forced: true, error });
    return this.current();
  }

  async #handleStartupTimeout(child: InteractivePlaytestChild): Promise<void> {
    this.#update({
      forced: true,
      error: `Game.exe startup timed out after ${this.#dependencies.startupTimeoutMs}ms.`,
    }, 'startup timeout');
    const forced = await this.#dependencies.forceKillProcessTree(child);
    this.#update({}, 'startup timeout cleanup requested');
    await waitForExit(child, this.#dependencies.forceExitWaitMs);
    if (this.#child === child) {
      this.#finish('stop_failed', {
        forced: true,
        error: forced.error
          ? `Game.exe startup timed out; cleanup failed: ${forced.error}`
          : `Game.exe startup timed out and its process tree did not exit after cleanup.`,
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

  #finish(
    status: Extract<InteractivePlaytestRunStatus, 'stopped' | 'exited' | 'failed' | 'stop_failed'>,
    patch: Partial<InteractivePlaytestRun>,
  ): void {
    if (!this.#currentRun) return;
    const finished = this.#dependencies.now();
    Object.assign(this.#currentRun, patch, {
      status,
      updatedAt: finished.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - new Date(this.#currentRun.startedAt).getTime()),
    });
    this.#publish(this.#currentRun, status);
  }

  #publish(run: InteractivePlaytestRun, logMessage: string): void {
    appendLog(run.logPath, `${run.updatedAt} ${run.status} ${logMessage}\n`);
    writeJsonAtomic(run.artifactPath, run);
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

function initializeArtifacts(run: InteractivePlaytestRun): void {
  fs.mkdirSync(run.artifactDir, { recursive: true });
  fs.writeFileSync(run.stdoutPath, '', 'utf8');
  fs.writeFileSync(run.stderrPath, '', 'utf8');
  fs.writeFileSync(
    run.logPath,
    'RPG Agent MV interactive playtest\nEvidence scope: process lifecycle only; this does not prove story or playability.\n',
    'utf8',
  );
}

function attachOutput(
  stream: InteractivePlaytestStream | null,
  outputPath: string,
  logPath: string,
): void {
  stream?.on('data', (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    fs.appendFileSync(outputPath, bytes);
    fs.appendFileSync(logPath, bytes);
  });
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
    return child.kill('SIGTERM') ? { ok: true } : { ok: false, error: 'Game.exe rejected SIGTERM.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

async function defaultForceKillProcessTree(child: InteractivePlaytestChild): Promise<{ ok: boolean; error?: string }> {
  return defaultForceKillProcessTreeSync(child);
}

function defaultForceKillProcessTreeSync(child: InteractivePlaytestChild): { ok: boolean; error?: string } {
  if (!child.pid) return { ok: false, error: 'Game.exe process id is unavailable.' };
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
    return child.kill('SIGKILL') ? { ok: true } : { ok: false, error: 'Game.exe rejected SIGKILL.' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function buildRunId(now: Date, uuid: string): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  const suffix = uuid.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
  return `interactive-${stamp}-${suffix}`;
}

function cloneRun(run: InteractivePlaytestRun): InteractivePlaytestRun {
  return structuredClone(run);
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
