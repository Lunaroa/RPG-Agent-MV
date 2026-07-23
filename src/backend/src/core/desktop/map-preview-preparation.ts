import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IsolatedMapPreviewPreparation } from './isolated-project-preparation.ts';
import type {
  MapPreviewLoadProgress,
  MapPreviewPreflightFailure,
} from '../../../../contract/types.ts';
import type {
  MapPreviewPreparationWorkerRequest,
  MapPreviewPreparationWorkerMessage,
  MapPreviewPreparationWorkerResponse,
} from './map-preview-preparation-worker.ts';

const PREPARATION_OUTPUT_LIMIT = 32_768;

export class MapPreviewPreparationCancelledError extends Error {}
export class MapPreviewPreparationFailedError extends Error {
  readonly stage: string;
  readonly runtimeOutput?: string;
  readonly preflightFailure?: MapPreviewPreflightFailure;

  constructor(
    stage: string,
    message: string,
    runtimeOutput?: string,
    preflightFailure?: MapPreviewPreflightFailure,
  ) {
    super(message);
    this.stage = stage;
    this.runtimeOutput = runtimeOutput;
    this.preflightFailure = preflightFailure;
  }
}

export interface MapPreviewPreparationTask {
  taskId: string;
  child: childProcess.ChildProcess;
  temporaryProject: string;
  result: Promise<IsolatedMapPreviewPreparation>;
  cancel(): Promise<void>;
  cancelSync(): void;
}

export interface MapPreviewPreparationDependencies {
  spawnProcess?(executable: string, args: string[], options: childProcess.SpawnOptions): childProcess.ChildProcess;
  taskId?: string;
  onProgress?(progress: MapPreviewLoadProgress): void;
}

export function startMapPreviewPreparation(
  workflowRoot: string,
  project: string,
  dependencies: MapPreviewPreparationDependencies = {},
): MapPreviewPreparationTask {
  const taskId = dependencies.taskId || crypto.randomUUID();
  const controlDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-agent-preview-worker-'));
  const temporaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-agent-map-preview-'));
  const requestPath = path.join(controlDirectory, 'request.json');
  const responsePath = path.join(controlDirectory, 'response.json');
  const request: MapPreviewPreparationWorkerRequest = {
    taskId,
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    temporaryProject,
  };
  fs.writeFileSync(requestPath, `${JSON.stringify(request)}\n`, 'utf8');
  const workerScript = fileURLToPath(new URL('./map-preview-preparation-worker.ts', import.meta.url));
  const spawnProcess = dependencies.spawnProcess
    || ((executable: string, args: string[], options: childProcess.SpawnOptions) => childProcess.spawn(executable, args, options));
  const child = spawnProcess(process.execPath, [
    '--experimental-strip-types',
    '--experimental-transform-types',
    workerScript,
    requestPath,
    responsePath,
  ], {
    cwd: path.resolve(workflowRoot),
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  let cancelled = false;
  let settled = false;
  let runtimeOutput = '';
  let resolveResult!: (preparation: IsolatedMapPreviewPreparation) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<IsolatedMapPreviewPreparation>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const finish = (error?: Error, preparation?: IsolatedMapPreviewPreparation) => {
    if (settled) return;
    settled = true;
    const controlCleanupError = removeDirectory(controlDirectory, 'preparation control directory');
    let failure = error ? attachRuntimeOutput(error, runtimeOutput) : undefined;
    if (!failure && !preparation) failure = new Error('Map preview preparation did not return an isolated project.');
    if (controlCleanupError) failure = appendCleanupError(failure, controlCleanupError);
    if (failure) {
      const temporaryCleanupError = removeDirectory(temporaryProject, 'temporary preview project');
      rejectResult(temporaryCleanupError ? appendCleanupError(failure, temporaryCleanupError) : failure);
    } else {
      resolveResult(preparation!);
    }
  };
  const appendOutput = (chunk: unknown) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    runtimeOutput = `${runtimeOutput}${text}`.slice(-PREPARATION_OUTPUT_LIMIT);
  };
  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);
  child.on('message', (message: unknown) => {
    if (settled || cancelled || !isProgressMessage(message)) return;
    if (message.progress.taskId !== taskId) return;
    dependencies.onProgress?.(message.progress);
  });
  child.once('error', (error) => finish(cancelled ? new MapPreviewPreparationCancelledError('Map preview preparation was cancelled.') : error));
  child.once('exit', (code, signal) => {
    if (cancelled) {
      finish(new MapPreviewPreparationCancelledError('Map preview preparation was cancelled.'));
      return;
    }
    if (!fs.existsSync(responsePath)) {
      finish(new Error(`Map preview preparation worker exited without a response (${code ?? signal ?? 'unknown'}).`));
      return;
    }
    try {
      const response = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as MapPreviewPreparationWorkerResponse;
      if (response.ok === false) {
        finish(new MapPreviewPreparationFailedError(
          response.stage,
          response.error,
          runtimeOutput,
          response.preflightFailure,
        ));
        return;
      }
      if (path.resolve(response.preparation.temporaryProject) !== path.resolve(temporaryProject)) {
        finish(new Error('Map preview preparation worker returned an unexpected temporary project.'));
        return;
      }
      finish(undefined, response.preparation);
    } catch (error) {
      finish(new Error(`Cannot read map preview preparation response: ${errorMessage(error)}`));
    }
  });
  return {
    taskId,
    child,
    temporaryProject,
    result,
    async cancel() {
      if (settled) return;
      cancelled = true;
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        if (child.exitCode != null || child.signalCode != null) resolve();
        else child.once('exit', () => resolve());
      });
      finish(new MapPreviewPreparationCancelledError('Map preview preparation was cancelled.'));
    },
    cancelSync() {
      if (settled) return;
      cancelled = true;
      if (child.pid && child.exitCode == null && child.signalCode == null) {
        if (process.platform === 'win32') {
          childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            shell: false,
            stdio: 'ignore',
          });
        } else {
          child.kill('SIGKILL');
        }
      }
      finish(new MapPreviewPreparationCancelledError('Map preview preparation was cancelled.'));
    },
  };
}

function removeDirectory(directory: string, label: string): Error | null {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
    if (fs.existsSync(directory)) return new Error(`The ${label} could not be removed.`);
    return null;
  } catch (error) {
    return new Error(`The ${label} could not be removed: ${errorMessage(error)}`);
  }
}

function appendCleanupError(error: Error | undefined, cleanupError: Error): Error {
  const message = [error?.message, cleanupError.message].filter(Boolean).join(' ');
  if (error instanceof MapPreviewPreparationCancelledError) return new MapPreviewPreparationCancelledError(message);
  if (error instanceof MapPreviewPreparationFailedError) {
    return new MapPreviewPreparationFailedError(
      error.stage,
      message,
      error.runtimeOutput,
      error.preflightFailure,
    );
  }
  return new Error(message);
}

function attachRuntimeOutput(error: Error, runtimeOutput: string): Error {
  const output = runtimeOutput.trim();
  if (!output || error instanceof MapPreviewPreparationCancelledError) return error;
  if (error instanceof MapPreviewPreparationFailedError) {
    return new MapPreviewPreparationFailedError(
      error.stage,
      error.message,
      error.runtimeOutput || output,
      error.preflightFailure,
    );
  }
  return new MapPreviewPreparationFailedError('preparation-worker', error.message, output);
}

function isProgressMessage(value: unknown): value is MapPreviewPreparationWorkerMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Partial<MapPreviewPreparationWorkerMessage>;
  if (message.type !== 'progress' || !message.progress || typeof message.progress !== 'object') return false;
  const progress = message.progress as Partial<MapPreviewLoadProgress>;
  return typeof progress.taskId === 'string'
    && progress.phase === 'isolation'
    && typeof progress.stage === 'string'
    && typeof progress.taskStartedAt === 'string'
    && typeof progress.stageStartedAt === 'string'
    && typeof progress.updatedAt === 'string';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
