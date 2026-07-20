import fs from 'node:fs';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import { prepareIsolatedMapPreviewProject } from './isolated-project-preparation.ts';

export interface MapPreviewPreparationWorkerRequest {
  workflowRoot: string;
  project: string;
  temporaryProject: string;
}

export type MapPreviewPreparationWorkerResponse =
  | { ok: true; preparation: ReturnType<typeof prepareIsolatedMapPreviewProject> }
  | { ok: false; stage: string; error: string };

let currentStage = 'worker-startup';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeFailure(responsePath: string, error: unknown): void {
  writeJsonAtomic(responsePath, {
    ok: false,
    stage: currentStage,
    error: errorMessage(error),
  } satisfies MapPreviewPreparationWorkerResponse);
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) throw new Error('Map preview preparation worker requires request and response paths.');
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8')) as MapPreviewPreparationWorkerRequest;
  try {
    currentStage = 'bootstrap-database';
    await bootstrapDatabase(request.workflowRoot, {
      importLegacyJson: false,
      skipWorkspaceLegacyCleanup: true,
      skipRuntimeLegacyCleanup: true,
    });
    const preparation = prepareIsolatedMapPreviewProject(
      request.workflowRoot,
      request.project,
      request.temporaryProject,
      { onStage: (stage) => { currentStage = stage; } },
    );
    currentStage = 'write-worker-response';
    writeJsonAtomic(responsePath, { ok: true, preparation } satisfies MapPreviewPreparationWorkerResponse);
  } catch (error) {
    writeFailure(responsePath, error);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

void main().catch((error) => {
  const responsePath = process.argv[3];
  if (responsePath) {
    try { writeFailure(responsePath, error); } catch { /* The parent reports the missing response. */ }
  }
  process.exitCode = 1;
});
