import fs from 'node:fs';

import type {
  MapPreviewLoadProgress,
  MapPreviewPreflightFailure,
} from '../../../../contract/types.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import { prepareIsolatedMapPreviewProject } from './isolated-project-preparation.ts';
import {
  inspectMapPreviewStagingConflict,
  mapPreviewStagingConflictFromError,
} from './map-preview-staging-conflict.ts';

export interface MapPreviewPreparationWorkerRequest {
  taskId: string;
  workflowRoot: string;
  project: string;
  temporaryProject: string;
}

export type MapPreviewPreparationWorkerResponse =
  | { ok: true; preparation: Awaited<ReturnType<typeof prepareIsolatedMapPreviewProject>> }
  | {
    ok: false;
    stage: string;
    error: string;
    preflightFailure?: MapPreviewPreflightFailure;
  };

export type MapPreviewPreparationWorkerMessage =
  | { type: 'progress'; progress: MapPreviewLoadProgress };

let currentStage = 'worker-startup';
let progressStage: MapPreviewLoadProgress['stage'] | null = null;
let progressTaskStartedAt = '';
let progressStageStartedAt = '';
let lastProgressAt = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeFailure(
  responsePath: string,
  error: unknown,
  request?: MapPreviewPreparationWorkerRequest,
): void {
  let preflightFailure = mapPreviewStagingConflictFromError(error);
  if (!preflightFailure && request) {
    try {
      preflightFailure = inspectMapPreviewStagingConflict(request.workflowRoot, request.project);
    } catch {
      // Preserve the original preparation failure when staging cannot be inspected.
    }
  }
  writeJsonAtomic(responsePath, {
    ok: false,
    stage: currentStage,
    error: errorMessage(error),
    ...(preflightFailure ? { preflightFailure } : {}),
  } satisfies MapPreviewPreparationWorkerResponse);
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) throw new Error('Map preview preparation worker requires request and response paths.');
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8')) as MapPreviewPreparationWorkerRequest;
  try {
    reportProgress(request.taskId, { stage: 'starting-worker' }, true);
    currentStage = 'bootstrap-database';
    await bootstrapDatabase(request.workflowRoot, {
      importLegacyJson: false,
      skipWorkspaceLegacyCleanup: true,
      skipRuntimeLegacyCleanup: true,
    });
    const preparation = await prepareIsolatedMapPreviewProject(
      request.workflowRoot,
      request.project,
      request.temporaryProject,
      {
        onStage: (stage) => { currentStage = stage; },
        onProgress: (progress) => reportProgress(request.taskId, progress),
      },
    );
    currentStage = 'write-worker-response';
    writeJsonAtomic(responsePath, { ok: true, preparation } satisfies MapPreviewPreparationWorkerResponse);
  } catch (error) {
    writeFailure(responsePath, error, request);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

function reportProgress(
  taskId: string,
  update: Omit<MapPreviewLoadProgress, 'taskId' | 'phase' | 'taskStartedAt' | 'stageStartedAt' | 'updatedAt'>,
  force = false,
): void {
  if (!process.send) return;
  const now = Date.now();
  if (!progressTaskStartedAt) progressTaskStartedAt = new Date(now).toISOString();
  const stageChanged = progressStage !== update.stage;
  const complete = update.total !== undefined && update.completed === update.total;
  if (!force && !stageChanged && !complete && now - lastProgressAt < 100) return;
  if (stageChanged) {
    progressStage = update.stage;
    progressStageStartedAt = new Date(now).toISOString();
  }
  lastProgressAt = now;
  process.send({
    type: 'progress',
    progress: {
      taskId,
      phase: 'isolation',
      ...update,
      taskStartedAt: progressTaskStartedAt,
      stageStartedAt: progressStageStartedAt || new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
  } satisfies MapPreviewPreparationWorkerMessage);
}

void main().catch((error) => {
  const responsePath = process.argv[3];
  if (responsePath) {
    try { writeFailure(responsePath, error); } catch { /* The parent reports the missing response. */ }
  }
  process.exitCode = 1;
});
