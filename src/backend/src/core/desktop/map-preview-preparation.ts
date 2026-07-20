import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IsolatedMapPreviewPreparation } from './isolated-project-preparation.ts';
import type {
  MapPreviewPreparationWorkerRequest,
  MapPreviewPreparationWorkerResponse,
} from './map-preview-preparation-worker.ts';

export class MapPreviewPreparationCancelledError extends Error {}
export class MapPreviewPreparationFailedError extends Error {
  readonly stage: string;

  constructor(stage: string, message: string) {
    super(message);
    this.stage = stage;
  }
}

export interface MapPreviewPreparationTask {
  child: childProcess.ChildProcess;
  temporaryProject: string;
  result: Promise<IsolatedMapPreviewPreparation>;
  cancel(): Promise<void>;
  cancelSync(): void;
}

export interface MapPreviewPreparationDependencies {
  spawnProcess?(executable: string, args: string[], options: childProcess.SpawnOptions): childProcess.ChildProcess;
}

export function startMapPreviewPreparation(
  workflowRoot: string,
  project: string,
  dependencies: MapPreviewPreparationDependencies = {},
): MapPreviewPreparationTask {
  const controlDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-agent-preview-worker-'));
  const temporaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-agent-map-preview-'));
  const requestPath = path.join(controlDirectory, 'request.json');
  const responsePath = path.join(controlDirectory, 'response.json');
  const request: MapPreviewPreparationWorkerRequest = {
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
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  let cancelled = false;
  let settled = false;
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
    let failure = error;
    if (!failure && !preparation) failure = new Error('Map preview preparation did not return an isolated project.');
    if (controlCleanupError) failure = appendCleanupError(failure, controlCleanupError);
    if (failure) {
      const temporaryCleanupError = removeDirectory(temporaryProject, 'temporary preview project');
      rejectResult(temporaryCleanupError ? appendCleanupError(failure, temporaryCleanupError) : failure);
    } else {
      resolveResult(preparation!);
    }
  };
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
      if (!response.ok) {
        finish(new MapPreviewPreparationFailedError(response.stage, response.error));
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
  if (error instanceof MapPreviewPreparationFailedError) return new MapPreviewPreparationFailedError(error.stage, message);
  return new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
