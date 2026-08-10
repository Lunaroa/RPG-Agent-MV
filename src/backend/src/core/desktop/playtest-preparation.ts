import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { InteractiveParticleAnimationPreview } from '../../../../contract/types.ts';
import type {
  BattleTestConfiguration,
  BattleTestProjectPreparation,
} from './battle-test-preparation.ts';
import type { ParticleAnimationPreviewPreparation } from './particle-animation-preview-preparation.ts';
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

export interface PlaytestPreparationHostDependencies {
  spawnProcess?(executable: string, args: string[], options: childProcess.SpawnOptions): childProcess.ChildProcess;
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

/** Runs the UI designer temporary-project copy outside Electron's main thread. */
export async function prepareUiDesignerPreviewInWorker(
  workflowRoot: string,
  project: string,
  temporaryPrefix?: string,
  dependencies: PlaytestPreparationHostDependencies = {},
): Promise<IsolatedProjectPreparation> {
  const challenge = createOwnedEmptyIsolatedProject(project, {
    temporaryPrefix: temporaryPrefix || 'ui-designer-preview-',
  });
  const preparation = await runOwnedPreparationWorker(challenge, {
    operation: 'ui_designer_preview',
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    ownershipChallenge: challenge,
    physicalCopyAllProjectDirectories: true,
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
  fs.writeFileSync(requestPath, `${JSON.stringify(request)}\n`, 'utf8');
  const workerScript = fileURLToPath(new URL('./playtest-preparation-worker.ts', import.meta.url));
  const spawnProcess = dependencies.spawnProcess
    || ((executable: string, args: string[], options: childProcess.SpawnOptions) => childProcess.spawn(executable, args, options));
  try {
    const child = spawnProcess(process.execPath, [
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
    let runtimeOutput = '';
    const appendOutput = (chunk: unknown) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      runtimeOutput = `${runtimeOutput}${text}`.slice(-PREPARATION_OUTPUT_LIMIT);
    };
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => resolve());
    });
    if (!fs.existsSync(responsePath)) {
      const detail = runtimeOutput.trim();
      throw new Error(`Playtest preparation worker exited without a response.${detail ? ` ${detail}` : ''}`);
    }
    const response = JSON.parse(fs.readFileSync(responsePath, 'utf8')) as PlaytestPreparationWorkerResponse;
    if (!response.ok) throw new Error(response.error);
    return response.preparation;
  } finally {
    cleanupOwnedIsolatedProject(controlOwnership);
  }
}

async function runOwnedPreparationWorker(
  challenge: IsolatedProjectOwnershipChallenge,
  request: PlaytestPreparationWorkerRequest,
  dependencies: PlaytestPreparationHostDependencies,
): Promise<BattleTestProjectPreparation | ParticleAnimationPreviewPreparation | IsolatedProjectPreparation> {
  try {
    const preparation = await runPreparationWorker(request, dependencies);
    return attestIsolatedPreparationResponse(challenge, preparation);
  } catch (error) {
    try { cleanupOwnedIsolatedProject(challenge); } catch { /* Retain an unattested worker project. */ }
    throw error;
  }
}
