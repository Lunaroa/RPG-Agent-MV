import fs from 'node:fs';

import type { InteractiveParticleAnimationPreview } from '../../../../contract/types.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import {
  prepareBattleTestProject,
  type BattleTestConfiguration,
  type BattleTestProjectPreparation,
} from './battle-test-preparation.ts';
import {
  prepareParticleAnimationPreview,
  type ParticleAnimationPreviewPreparation,
} from './particle-animation-preview-preparation.ts';
import {
  prepareUiDesignerRendererOverlay,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts';
import type { IsolatedProjectOwnershipChallenge } from './isolated-project-attestation.ts';

interface WorkerOwnershipRequest {
  ownershipChallenge: IsolatedProjectOwnershipChallenge;
}

export type PlaytestPreparationWorkerRequest =
  | WorkerOwnershipRequest & {
    operation: 'battle_test';
    workflowRoot: string;
    project: string;
    configuration: BattleTestConfiguration;
  }
  | WorkerOwnershipRequest & {
    operation: 'particle_preview';
    workflowRoot: string;
    project: string;
    animation: InteractiveParticleAnimationPreview;
  }
  | WorkerOwnershipRequest & {
    operation: 'ui_designer_renderer';
    workflowRoot: string;
    project: string;
    temporaryPrefix?: string;
  };

export type PlaytestPreparationWorkerResponse =
  | { ok: true; preparation: BattleTestProjectPreparation | ParticleAnimationPreviewPreparation | IsolatedProjectPreparation }
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) throw new Error('Playtest preparation worker requires request and response paths.');
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8')) as PlaytestPreparationWorkerRequest;
  try {
    await bootstrapDatabase(request.workflowRoot, {
      importLegacyJson: false,
      skipWorkspaceLegacyCleanup: true,
      skipRuntimeLegacyCleanup: true,
    });
    const preparation = request.operation === 'battle_test'
      ? prepareBattleTestProject(request.workflowRoot, request.project, request.configuration, {
        ownershipChallenge: request.ownershipChallenge,
      })
      : request.operation === 'particle_preview'
        ? prepareParticleAnimationPreview(request.workflowRoot, request.project, request.animation, {}, {
          ownershipChallenge: request.ownershipChallenge,
        })
        : prepareUiDesignerRendererOverlay(request.workflowRoot, request.project, {
          ownershipChallenge: request.ownershipChallenge,
          ...(request.temporaryPrefix ? { temporaryPrefix: request.temporaryPrefix } : {}),
        });
    writeJsonAtomic(responsePath, { ok: true, preparation } satisfies PlaytestPreparationWorkerResponse);
  } catch (error) {
    writeJsonAtomic(responsePath, { ok: false, error: errorMessage(error) } satisfies PlaytestPreparationWorkerResponse);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}

void main().catch((error) => {
  const responsePath = process.argv[3];
  if (responsePath) {
    try {
      writeJsonAtomic(responsePath, { ok: false, error: errorMessage(error) } satisfies PlaytestPreparationWorkerResponse);
    } catch { /* The parent reports the missing response. */ }
  }
  process.exitCode = 1;
});
