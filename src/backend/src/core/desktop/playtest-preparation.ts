import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { InteractiveParticleAnimationPreview } from '../../../../contract/types.ts';
import type { UiRuntimeSceneExport } from '../../../../contract/ui-designer.ts';
import type {
  BattleTestConfiguration,
  BattleTestProjectPreparation,
} from './battle-test-preparation.ts';
import type { ParticleAnimationPreviewPreparation } from './particle-animation-preview-preparation.ts';
import type { UiDesignerGamePreviewPreparation } from './ui-designer-game-preview-preparation.ts';
import type {
  PlaytestPreparationWorkerRequest,
  PlaytestPreparationWorkerResponse,
} from './playtest-preparation-worker.ts';
import type { IsolatedProjectPreparation } from './isolated-project-preparation.ts';
import {
  attestIsolatedPreparationResponse,
  cleanupOwnedIsolatedProject,
  createOwnedEmptyIsolatedProject,
  type IsolatedProjectOwnershipChallenge,
} from './isolated-project-attestation.ts';

const PREPARATION_OUTPUT_LIMIT = 32_768;
/**
 * Preparation is deliberately bounded.  A worker that stops responding must
 * never leave the Electron main process waiting forever or allow its owned
 * temporary tree to be removed before the child has exited.
 */
const DEFAULT_PREPARATION_WORKER_TIMEOUT_MS = 30_000;
const DEFAULT_PREPARATION_WORKER_TERMINATION_GRACE_MS = 2_000;

export class PreparationWorkerError extends Error {
  readonly terminalProof: boolean;
  readonly retainedOwners: IsolatedProjectOwnershipChallenge[];

  constructor(message: string, terminalProof: boolean, retainedOwners: IsolatedProjectOwnershipChallenge[] = []) {
    super(message);
    this.name = 'PreparationWorkerError';
    this.terminalProof = terminalProof;
    this.retainedOwners = retainedOwners;
  }

  retainOwner(owner: IsolatedProjectOwnershipChallenge): void {
    if (!this.retainedOwners.some((entry) => entry.temporaryProject === owner.temporaryProject)) {
      this.retainedOwners.push(owner);
    }
  }
}

export interface PlaytestPreparationHostDependencies {
  spawnProcess?(executable: string, args: string[], options: childProcess.SpawnOptions): childProcess.ChildProcess;
  /** Test-only clock/configuration hooks; production remains bounded. */
  workerTimeoutMs?: number;
  workerTerminationGraceMs?: number;
}

/**
 * Runs the isolated Battle Test preparation in a worker process so the Electron
 * main process never blocks on project copying or fingerprinting.
 */
export async function prepareBattleTestInWorker(
  workflowRoot: string,
  project: string,
  configuration: BattleTestConfiguration,
  dependencies: PlaytestPreparationHostDependencies = {},
): Promise<BattleTestProjectPreparation> {
  const challenge = createOwnedEmptyIsolatedProject(project, { temporaryPrefix: 'rmmv-agent-battle-test-' });
  const preparation = await runOwnedPreparationWorker(challenge, {
    operation: 'battle_test',
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    ownershipChallenge: challenge,
    configuration,
  }, dependencies);
  return preparation as BattleTestProjectPreparation;
}

/**
 * Runs the isolated playtest particle preview preparation (real NW.js window
 * path) in a worker process; see prepareBattleTestInWorker.
 */
export async function prepareParticlePreviewInWorker(
  workflowRoot: string,
  project: string,
  animation: InteractiveParticleAnimationPreview,
  dependencies: PlaytestPreparationHostDependencies = {},
): Promise<ParticleAnimationPreviewPreparation> {
  const challenge = createOwnedEmptyIsolatedProject(project, { temporaryPrefix: 'rpg-agent-mz-particle-preview-' });
  const preparation = await runOwnedPreparationWorker(challenge, {
    operation: 'particle_preview',
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    ownershipChallenge: challenge,
    animation,
  }, dependencies);
  return preparation as ParticleAnimationPreviewPreparation;
}

/** Builds the UI designer renderer's sparse session-owned overlay outside Electron's main thread. */
export async function prepareUiDesignerRendererInWorker(
  workflowRoot: string,
  project: string,
  temporaryPrefix?: string,
  dependencies: PlaytestPreparationHostDependencies = {},
): Promise<IsolatedProjectPreparation> {
  const challenge = createOwnedEmptyIsolatedProject(project, {
    temporaryPrefix: temporaryPrefix || 'ui-designer-renderer-',
  });
  const preparation = await runOwnedPreparationWorker(challenge, {
    operation: 'ui_designer_renderer',
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    ownershipChallenge: challenge,
    ...(temporaryPrefix ? { temporaryPrefix } : {}),
  }, dependencies);
  return preparation as IsolatedProjectPreparation;
}

async function runPreparationWorker(
  request: PlaytestPreparationWorkerRequest,
  dependencies: PlaytestPreparationHostDependencies,
): Promise<BattleTestProjectPreparation | ParticleAnimationPreviewPreparation | IsolatedProjectPreparation> {
  const controlOwnership = createOwnedEmptyIsolatedProject(request.project, {
    temporaryPrefix: 'rpg-agent-playtest-prep-',
  });
  const controlDirectory = controlOwnership.temporaryProject;
  const requestPath = path.join(controlDirectory, 'request.json');
  const responsePath = path.join(controlDirectory, 'response.json');
  const spawnProcess = dependencies.spawnProcess
    || ((executable: string, args: string[], options: childProcess.SpawnOptions) => childProcess.spawn(executable, args, options));
  const workerTimeoutMs = boundedTimeout(dependencies.workerTimeoutMs, DEFAULT_PREPARATION_WORKER_TIMEOUT_MS);
  const terminationGraceMs = boundedTimeout(dependencies.workerTerminationGraceMs, DEFAULT_PREPARATION_WORKER_TERMINATION_GRACE_MS);
  let terminalProof = false;
  let thrownError: unknown = null;
  try {
    try {
      fs.writeFileSync(requestPath, `${JSON.stringify(request)}\n`, 'utf8');
    } catch (error) {
      // No worker has been spawned yet, so the control owner is safe to
      // remove immediately; keep the public failure free of local paths.
      terminalProof = true;
      throw new PreparationWorkerError(`Playtest preparation worker request could not be written. ${sanitizeWorkerOutput(error)}`, true);
    }
    const workerScript = fileURLToPath(new URL('./playtest-preparation-worker.ts', import.meta.url));
    let child: childProcess.ChildProcess;
    try {
      child = spawnProcess(process.execPath, [
        '--experimental-strip-types',
        '--experimental-transform-types',
        workerScript,
        requestPath,
        responsePath,
      ], {
        cwd: request.workflowRoot,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    } catch (error) {
      terminalProof = true;
      throw new PreparationWorkerError(`Playtest preparation worker could not be started. ${sanitizeWorkerOutput(error)}`, true);
    }
    let runtimeOutput = '';
    const appendOutput = (chunk: unknown) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      runtimeOutput = `${runtimeOutput}${text}`.slice(-PREPARATION_OUTPUT_LIMIT);
    };
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
    const exit = await waitForPreparationWorkerExit(child, workerTimeoutMs, terminationGraceMs);
    terminalProof = exit.terminalProof;
    if (exit.errorMessage) {
      throw new PreparationWorkerError(`Playtest preparation worker could not be started. ${exit.errorMessage}`, terminalProof);
    }
    if (exit.timedOut) {
      throw new PreparationWorkerError(
        `Playtest preparation worker exceeded its ${workerTimeoutMs}ms limit and was terminated${terminalProof ? '.' : '; process termination was not confirmed.'}`,
        terminalProof,
      );
    }
    try {
      if (!fs.existsSync(responsePath)) {
        const detail = runtimeOutput.trim();
        throw new PreparationWorkerError(
          `Playtest preparation worker exited without a response.${detail ? ` ${sanitizeWorkerOutput(detail)}` : ''}`,
          terminalProof,
        );
      }
      const response = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as PlaytestPreparationWorkerResponse;
      if (!response.ok) throw new PreparationWorkerError(sanitizeWorkerOutput(response.error), terminalProof);
      return response.preparation;
    } catch (error) {
      if (error instanceof PreparationWorkerError) throw error;
      throw new PreparationWorkerError(
        `Playtest preparation worker response could not be read. ${sanitizeWorkerOutput(error)}`,
        terminalProof,
      );
    }
  } catch (error) {
    thrownError = error;
    if (error instanceof PreparationWorkerError) {
      if (!terminalProof) error.retainOwner(controlOwnership);
      throw error;
    }
    const wrapped = new PreparationWorkerError(
      `Playtest preparation worker failed. ${sanitizeWorkerOutput(error)}`,
      terminalProof,
    );
    if (!terminalProof) wrapped.retainOwner(controlOwnership);
    thrownError = wrapped;
    throw wrapped;
  } finally {
    // Never remove the control owner while a child could still be reading its
    // request or writing its response.  The caller retains the ownership
    // challenge as well when terminal proof is unavailable.
    if (terminalProof) {
      try {
        cleanupOwnedIsolatedProject(controlOwnership);
      } catch (cleanupError) {
        if (thrownError instanceof PreparationWorkerError) {
          thrownError.retainOwner(controlOwnership);
        } else if (!thrownError) {
          throw new PreparationWorkerError(
            `Playtest preparation worker cleanup could not be confirmed. ${sanitizeWorkerOutput(cleanupError)}`,
            true,
            [controlOwnership],
          );
        }
        // Preserve the original worker failure; the owner remains available
        // to the service recovery path for a later cleanup attempt.
      }
    }
  }
}

export async function prepareUiDesignerGamePreviewInWorker(
  workflowRoot: string,
  project: string,
  scene: UiRuntimeSceneExport,
  dependencies: PlaytestPreparationHostDependencies = {},
): Promise<UiDesignerGamePreviewPreparation> {
  const challenge = createOwnedEmptyIsolatedProject(project, { temporaryPrefix: 'rmmv-agent-ui-preview-' });
  const preparation = await runOwnedPreparationWorker(challenge, {
    operation: 'ui_designer_scene',
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    ownershipChallenge: challenge,
    scene,
  }, dependencies);
  return preparation as UiDesignerGamePreviewPreparation;
}

async function runOwnedPreparationWorker(
  challenge: IsolatedProjectOwnershipChallenge,
  request: PlaytestPreparationWorkerRequest,
  dependencies: PlaytestPreparationHostDependencies,
): Promise<BattleTestProjectPreparation | ParticleAnimationPreviewPreparation | UiDesignerGamePreviewPreparation | IsolatedProjectPreparation> {
  try {
    const preparation = await runPreparationWorker(request, dependencies);
    return attestIsolatedPreparationResponse(challenge, preparation);
  } catch (error) {
    if (error instanceof PreparationWorkerError && !error.terminalProof) error.retainOwner(challenge);
    if (!(error instanceof PreparationWorkerError) || error.terminalProof) {
      try { cleanupOwnedIsolatedProject(challenge); } catch { /* Retain an unattested worker project. */ }
    }
    throw error;
  }
}

interface PreparationWorkerExit {
  terminalProof: boolean;
  timedOut: boolean;
  errorMessage: string | null;
}

/** Waits for a worker, then terminates it in bounded graceful/forced phases. */
function waitForPreparationWorkerExit(
  child: childProcess.ChildProcess,
  timeoutMs: number,
  terminationGraceMs: number,
): Promise<PreparationWorkerExit> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;
    let forcedGrace: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    let errorMessage: string | null = null;

    const finish = (terminalProof: boolean): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (grace) clearTimeout(grace);
      if (forcedGrace) clearTimeout(forcedGrace);
      resolve({ terminalProof, timedOut, errorMessage });
    };
    child.once('exit', () => finish(true));
    child.once('error', (error) => {
      // Node reports a failed spawn through `error`; do not disguise that
      // bounded startup failure as a full worker timeout.  A late exit is
      // harmless because `finish` remains idempotent.
      errorMessage = sanitizeWorkerOutput(error);
      finish(true);
    });
    const forceTerminate = (): void => {
      try { child.kill('SIGKILL'); } catch { /* The terminal proof remains false. */ }
      forcedGrace = setTimeout(() => finish(false), terminationGraceMs);
    };
    const requestTerminate = (): void => {
      try { child.kill('SIGTERM'); } catch { /* Escalate after the bounded grace. */ }
      grace = setTimeout(forceTerminate, terminationGraceMs);
    };
    timeout = setTimeout(() => {
      timedOut = true;
      requestTerminate();
    }, timeoutMs);
  });
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.max(1, Math.min(15 * 60_000, Math.floor(Number(value)))) : fallback;
}

function sanitizeWorkerOutput(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const pathMatch = /(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?:Users|home|tmp|var|private|opt|mnt|workspace|workspaces|project|projects|repo|repos)\b)/i.exec(text);
  const redacted = pathMatch && pathMatch.index !== undefined
    ? `${text.slice(0, pathMatch.index).trimEnd()} <path>`
    : text.replace(/\b[a-f0-9]{32,}\b/gi, '<token>');
  return redacted.trim().slice(-2_048);
}
