import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import {
  MapPreviewPreparationFailedError,
  startMapPreviewPreparation,
} from './map-preview-preparation.ts';
import { normalizeMapPreviewFailureDetail } from './map-preview-service.ts';
import { STAGING_ERROR_CODES, StagingError } from './staging-errors.ts';
import { mapPreviewStagingConflictFromError } from './map-preview-staging-conflict.ts';
import { writeStagedProjectJson } from './staging-service.ts';

test('converts every supported staging reason without exposing hashes', () => {
  const failure = mapPreviewStagingConflictFromError(new StagingError(
    STAGING_ERROR_CODES.conflict,
    'Staging preflight found conflicted files.',
    {
      conflicts: [
        conflict('data/Map001.json', 'SOURCE_EXISTENCE_CHANGED', {
          expected: true,
          actual: false,
        }),
        conflict('data/Map002.json', 'SOURCE_HASH_CHANGED', {
          expected: 'private-base-hash',
          actual: 'private-source-hash',
        }),
        conflict('data/System.json', 'DRAFT_MISSING', {
          expected: 'private-draft-hash',
          actual: null,
        }),
        conflict('data/Tilesets.json', 'DRAFT_HASH_CHANGED', {
          expected: 'private-recorded-hash',
          actual: 'private-current-hash',
        }),
      ],
    },
  ));

  assert.deepEqual(failure, {
    code: 'staging-conflict',
    stage: 'staging-preflight',
    conflictCount: 4,
    conflicts: [
      { relativePath: 'data/Map001.json', reasons: ['SOURCE_EXISTENCE_CHANGED'] },
      { relativePath: 'data/Map002.json', reasons: ['SOURCE_HASH_CHANGED'] },
      { relativePath: 'data/System.json', reasons: ['DRAFT_MISSING'] },
      { relativePath: 'data/Tilesets.json', reasons: ['DRAFT_HASH_CHANGED'] },
    ],
  });
  assert.doesNotMatch(JSON.stringify(failure), /private-/);
});

test('ignores non-conflict staging errors', () => {
  assert.equal(mapPreviewStagingConflictFromError(new StagingError(
    STAGING_ERROR_CODES.busy,
    'Staging is busy.',
  )), undefined);
});

test('preserves only safe structured conflicts in normalized runtime failure details', () => {
  const detail = normalizeMapPreviewFailureDetail({
    stage: 'staging-preflight',
    message: 'Staging conflict.',
    stagingConflicts: [
      {
        relativePath: 'data/Map001.json',
        reasons: ['SOURCE_HASH_CHANGED', 'SOURCE_HASH_CHANGED'],
      },
      {
        relativePath: 'data/System.json',
        reasons: ['DRAFT_MISSING'],
      },
    ],
  }, null);

  assert.deepEqual(detail.stagingConflicts, [
    { relativePath: 'data/Map001.json', reasons: ['SOURCE_HASH_CHANGED'] },
    { relativePath: 'data/System.json', reasons: ['DRAFT_MISSING'] },
  ]);
});

test('preserves structured conflicts reported by the preparation worker', { concurrency: false }, async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-worker-conflict-'));
  const project = path.join(workflowRoot, 'projects', 'sample');
  const sourceFile = path.join(project, 'data', 'Map001.json');
  try {
    await bootstrapDatabase(workflowRoot, { importLegacyJson: false });
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, '{"width":1,"height":1}', 'utf8');
    writeStagedProjectJson(workflowRoot, project, 'data/Map001.json', { width: 2, height: 1 });
    fs.writeFileSync(sourceFile, '{"width":3,"height":1}', 'utf8');

    const task = startMapPreviewPreparation(workflowRoot, project);
    await assert.rejects(task.result, (error: unknown) => {
      assert.ok(error instanceof MapPreviewPreparationFailedError);
      assert.equal(error.preflightFailure?.code, 'staging-conflict');
      assert.deepEqual(error.preflightFailure?.conflicts, [{
        relativePath: 'data/Map001.json',
        reasons: ['SOURCE_HASH_CHANGED'],
      }]);
      return true;
    });
    assert.equal(fs.existsSync(task.temporaryProject), false);
  } finally {
    closeDatabase();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

function conflict(
  relativePath: string,
  code: string,
  reason: Record<string, unknown>,
): Record<string, unknown> {
  return {
    conflict: true,
    relativePath,
    conflictReasons: [{ code, ...reason }],
    baseHash: 'private-base-hash',
    sourceHash: 'private-source-hash',
    draftHash: 'private-draft-hash',
    recordedDraftHash: 'private-recorded-hash',
  };
}
