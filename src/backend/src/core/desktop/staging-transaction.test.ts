import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { StagingManifestDao } from '../db/dao/staging-manifest-dao.ts';
import { closeDatabase } from '../db/pool.ts';
import * as staging from './staging-service.ts';
import { commitStagingTransaction } from './staging-transaction.ts';

interface Fixture {
  root: string;
  project: string;
  originals: Record<string, Buffer | null>;
}

interface TransactionFaults {
  beforeReplace?: (entry: { relativePath: string; index: number }) => void;
  beforeDelete?: (entry: { relativePath: string; index: number }) => void;
  beforeDraftMove?: (entry: { relativePath: string; index: number }) => void;
  beforeDraftRestore?: (entry: { relativePath: string; index: number }) => void;
  beforeManifestUpdate?: () => void;
}

describe('atomic staging transactions', { concurrency: false }, () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = createFixture();
    await bootstrapDatabase(fixture.root, {
      dbPath: path.join(fixture.root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
      skipRuntimeLegacyCleanup: true,
      skipWorkspaceLegacyCleanup: true,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test('rolls back the first replacement when the second replacement fails', () => {
    stageOperation(fixture, 'database-op-replace', {
      'www/data/Actors.json': Buffer.from('actors-draft\n'),
      'www/data/Items.json': Buffer.from('items-draft\n'),
    });
    const manifestBefore = latestManifest(fixture);
    const draftsBefore = draftSnapshots(fixture, [
      'www/data/Actors.json',
      'www/data/Items.json',
    ]);

    assert.throws(
      () => applyOperation(fixture, 'database-op-replace', {
        beforeReplace: ({ index }) => {
          if (index === 1) throw new Error('injected second replacement failure');
        },
      }),
      /injected second replacement failure/,
    );

    assertSourceSnapshot(fixture, 'www/data/Actors.json');
    assertSourceSnapshot(fixture, 'www/data/Items.json');
    assert.deepEqual(latestManifest(fixture), manifestBefore);
    assertDraftSnapshots(fixture, draftsBefore);
  });

  test('retains the transaction tree when a draft move and its restore both fail', () => {
    stageOperation(fixture, 'database-op-draft-restore', {
      'www/data/Actors.json': Buffer.from('actors-draft\n'),
      'www/data/Items.json': Buffer.from('items-draft\n'),
    });
    const manifestBefore = latestManifest(fixture);
    let caught: unknown;

    try {
      applyOperation(fixture, 'database-op-draft-restore', {
        beforeDraftMove: ({ index }) => {
          if (index === 1) throw new Error('injected second draft move failure');
        },
        beforeDraftRestore: ({ index }) => {
          if (index === 0) throw new Error('injected first draft restore failure');
        },
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof AggregateError);
    const messages = caught.errors.map((error) => String((error as Error).message));
    assert.equal(messages.some((message) => message.includes('second draft move failure')), true);
    assert.equal(messages.some((message) => message.includes('first draft restore failure')), true);
    assertSourceSnapshot(fixture, 'www/data/Actors.json');
    assertSourceSnapshot(fixture, 'www/data/Items.json');
    assert.deepEqual(latestManifest(fixture), manifestBefore);
    assert.equal(fs.existsSync(draftPath(fixture, 'www/data/Actors.json')), false);
    assert.deepEqual(fs.readFileSync(draftPath(fixture, 'www/data/Items.json')), Buffer.from('items-draft\n'));

    const transactionDrafts = findFiles(
      path.join(stagingRoot(fixture), 'transactions'),
      (candidate) => candidate.endsWith(path.join('www', 'data', 'Actors.json')),
    );
    assert.equal(transactionDrafts.length, 1);
    assert.deepEqual(fs.readFileSync(transactionDrafts[0]), Buffer.from('actors-draft\n'));
    const recoveryBackups = findFiles(
      path.join(fixture.project, 'www', 'data'),
      (candidate) => candidate.includes('.rmmv-staging-') && candidate.endsWith('.backup'),
    );
    assert.equal(recoveryBackups.length >= 2, true);
  });

  test('removes directories prepared for an uncommitted new file when later preparation fails', () => {
    const firstSource = path.join(fixture.project, 'generated', 'first', 'First.json');
    const secondSource = path.join(fixture.project, 'generated', 'second', 'Second.json');
    const firstDraft = path.join(fixture.root, 'runtime', 'unit-drafts', 'First.json');
    const missingDraft = path.join(fixture.root, 'runtime', 'unit-drafts', 'Missing.json');
    fs.mkdirSync(path.dirname(firstDraft), { recursive: true });
    fs.writeFileSync(firstDraft, Buffer.from('first-draft\n'));
    let manifestUpdated = false;

    assert.throws(
      () => commitStagingTransaction({
        entries: [
          {
            relativePath: 'generated/first/First.json',
            sourceFile: firstSource,
            draftFile: firstDraft,
            delete: false,
          },
          {
            relativePath: 'generated/second/Second.json',
            sourceFile: secondSource,
            draftFile: missingDraft,
            delete: false,
          },
        ],
        transactionRoot: path.join(fixture.root, 'runtime', 'unit-transactions'),
        updateManifest: () => {
          manifestUpdated = true;
        },
      }),
      /Staged project file is missing/,
    );

    assert.equal(manifestUpdated, false);
    assert.equal(fs.existsSync(firstSource), false);
    assert.equal(fs.existsSync(secondSource), false);
    assert.equal(fs.existsSync(path.dirname(firstSource)), false);
    assert.equal(fs.existsSync(path.dirname(secondSource)), false);
  });

  test('restores exact existing, new, and deleted source states when deletion fails', () => {
    stageOperation(fixture, 'database-op-delete', {
      'www/data/Actors.json': Buffer.from('actors-draft\n'),
      'www/data/NewEntries.json': Buffer.from('new-draft\n'),
      'www/data/States.json': null,
    });
    const manifestBefore = latestManifest(fixture);
    const draftsBefore = draftSnapshots(fixture, [
      'www/data/Actors.json',
      'www/data/NewEntries.json',
      'www/data/States.json',
    ]);

    assert.throws(
      () => applyOperation(fixture, 'database-op-delete', {
        beforeDelete: () => {
          throw new Error('injected deletion failure');
        },
      }),
      /injected deletion failure/,
    );

    assertSourceSnapshot(fixture, 'www/data/Actors.json');
    assertSourceSnapshot(fixture, 'www/data/NewEntries.json');
    assertSourceSnapshot(fixture, 'www/data/States.json');
    assert.deepEqual(latestManifest(fixture), manifestBefore);
    assertDraftSnapshots(fixture, draftsBefore);
  });

  test('does not create source directories for deletion of a file that never existed', () => {
    const relativePath = 'www/optional/deep/Missing.json';
    stageOperation(fixture, 'database-op-delete-missing', { [relativePath]: null });
    const sourceDirectory = path.dirname(sourcePath(fixture, relativePath));
    assert.equal(fs.existsSync(sourceDirectory), false);

    const result = applyStagedOperation(fixture, 'database-op-delete-missing') as any;

    assert.equal(result.applied, true);
    assert.equal(fs.existsSync(sourcePath(fixture, relativePath)), false);
    assert.equal(fs.existsSync(sourceDirectory), false);
  });

  test('runs semantic validation before touching any source file', () => {
    stageOperation(fixture, 'database-op-semantic', {
      'www/data/Actors.json': Buffer.from('actors-draft\n'),
      'www/data/NewEntries.json': Buffer.from('new-draft\n'),
      'www/data/States.json': null,
    });
    const manifestBefore = latestManifest(fixture);
    let callbackSawOriginals = false;

    assert.throws(
      () => applyStagedOperation(fixture, 'database-op-semantic', {
        validate: () => {
          assertAllSourceSnapshots(fixture);
          callbackSawOriginals = true;
          throw new Error('semantic validation rejected the operation');
        },
      }),
      /semantic validation rejected the operation/,
    );

    assert.equal(callbackSawOriginals, true);
    assertAllSourceSnapshots(fixture);
    assert.deepEqual(latestManifest(fixture), manifestBefore);
  });

  test('rolls back sources and restores drafts when manifest update fails', () => {
    stageOperation(fixture, 'database-op-manifest', {
      'www/data/Actors.json': Buffer.from('actors-draft\n'),
      'www/data/NewEntries.json': Buffer.from('new-draft\n'),
      'www/data/States.json': null,
    });
    const manifestBefore = latestManifest(fixture);
    const draftsBefore = draftSnapshots(fixture, [
      'www/data/Actors.json',
      'www/data/NewEntries.json',
      'www/data/States.json',
    ]);
    let hookSawCommittedSources = false;

    assert.throws(
      () => applyOperation(fixture, 'database-op-manifest', {
        beforeManifestUpdate: () => {
          assert.deepEqual(fs.readFileSync(sourcePath(fixture, 'www/data/Actors.json')), Buffer.from('actors-draft\n'));
          assert.deepEqual(fs.readFileSync(sourcePath(fixture, 'www/data/NewEntries.json')), Buffer.from('new-draft\n'));
          assert.equal(fs.existsSync(sourcePath(fixture, 'www/data/States.json')), false);
          hookSawCommittedSources = true;
          throw new Error('injected manifest update failure');
        },
      }),
      /injected manifest update failure/,
    );

    assert.equal(hookSawCommittedSources, true);
    assertAllSourceSnapshots(fixture);
    assert.deepEqual(latestManifest(fixture), manifestBefore);
    assertDraftSnapshots(fixture, draftsBefore);
  });

  test('applies and cleans only one operation while preserving unrelated drafts and operations', () => {
    stageOperation(fixture, 'database-op-a', {
      'www/data/Actors.json': Buffer.from('actors-owned-draft\n'),
    });
    stageOperation(fixture, 'database-op-b', {
      'www/data/Items.json': Buffer.from('items-owned-draft\n'),
    });
    staging.writeStagedProjectBuffer(
      fixture.root,
      fixture.project,
      'www/data/Classes.json',
      Buffer.from('classes-manual-draft\n'),
    );

    const result = applyStagedOperation(fixture, 'database-op-a') as any;

    assert.equal(result.applied, true);
    assert.equal(result.operation.operationId, 'database-op-a');
    assert.deepEqual(fs.readFileSync(sourcePath(fixture, 'www/data/Actors.json')), Buffer.from('actors-owned-draft\n'));
    assertSourceSnapshot(fixture, 'www/data/Items.json');
    assertSourceSnapshot(fixture, 'www/data/Classes.json');
    assert.equal(staging.getDatabaseStagingOperation(fixture.root, fixture.project, 'database-op-a'), null);
    assert.equal(staging.getDatabaseStagingOperation(fixture.root, fixture.project, 'database-op-b')?.operationId, 'database-op-b');
    assert.deepEqual(fs.readFileSync(draftPath(fixture, 'www/data/Items.json')), Buffer.from('items-owned-draft\n'));
    assert.deepEqual(fs.readFileSync(draftPath(fixture, 'www/data/Classes.json')), Buffer.from('classes-manual-draft\n'));
    const status = staging.getProjectStagingStatus(fixture.root, fixture.project) as any;
    assert.deepEqual(status.files.map((entry: any) => entry.relativePath).sort(), [
      'www/data/Classes.json',
      'www/data/Items.json',
    ]);
  });

  test('restores operation drafts when discard metadata fails and never touches source', () => {
    stageOperation(fixture, 'database-op-discard', {
      'www/data/Actors.json': Buffer.from('actors-draft\n'),
      'www/data/NewEntries.json': Buffer.from('new-draft\n'),
      'www/data/States.json': null,
    });
    stageOperation(fixture, 'database-op-keep', {
      'www/data/Items.json': Buffer.from('items-kept-draft\n'),
    });
    staging.writeStagedProjectBuffer(
      fixture.root,
      fixture.project,
      'www/data/Classes.json',
      Buffer.from('classes-kept-draft\n'),
    );
    const manifestBefore = latestManifest(fixture);
    const draftsBefore = draftSnapshots(fixture, [
      'www/data/Actors.json',
      'www/data/NewEntries.json',
      'www/data/States.json',
    ]);

    assert.throws(
      () => discardOperation(fixture, 'database-op-discard', {
        beforeManifestUpdate: () => {
          assertAllSourceSnapshots(fixture);
          throw new Error('injected discard manifest failure');
        },
      }),
      /injected discard manifest failure/,
    );

    assertAllSourceSnapshots(fixture);
    assert.deepEqual(latestManifest(fixture), manifestBefore);
    assertDraftSnapshots(fixture, draftsBefore);

    const result = discardStagedOperation(fixture, 'database-op-discard') as any;
    assert.equal(result.discarded, true);
    assert.equal(result.operation.operationId, 'database-op-discard');
    assertAllSourceSnapshots(fixture);
    assert.equal(staging.getDatabaseStagingOperation(fixture.root, fixture.project, 'database-op-discard'), null);
    assert.equal(staging.getDatabaseStagingOperation(fixture.root, fixture.project, 'database-op-keep')?.operationId, 'database-op-keep');
    assert.equal(fs.existsSync(draftPath(fixture, 'www/data/Actors.json')), false);
    assert.equal(fs.existsSync(draftPath(fixture, 'www/data/NewEntries.json')), false);
    assert.deepEqual(fs.readFileSync(draftPath(fixture, 'www/data/Items.json')), Buffer.from('items-kept-draft\n'));
    assert.deepEqual(fs.readFileSync(draftPath(fixture, 'www/data/Classes.json')), Buffer.from('classes-kept-draft\n'));
  });

  test('uses the same atomic transaction for direct desktop project apply and discard', () => {
    staging.writeStagedProjectBuffer(
      fixture.root,
      fixture.project,
      'www/data/Actors.json',
      Buffer.from('actors-manual-draft\n'),
    );
    stageOperation(fixture, 'database-op-project', {
      'www/data/Items.json': Buffer.from('items-owned-draft\n'),
    });
    const manifestBefore = latestManifest(fixture);

    assert.throws(
      () => staging.applyProjectStaging(fixture.root, fixture.project, { expectedOperationIds: [] } as any),
      /operation set changed/i,
    );
    assert.deepEqual(latestManifest(fixture), manifestBefore);

    assert.throws(
      () => staging.applyProjectStaging(fixture.root, fixture.project, {
        expectedOperationIds: ['database-op-project'],
        transactionDependencies: {
          beforeReplace: ({ index }: { index: number }) => {
            if (index === 1) throw new Error('injected desktop project failure');
          },
        },
      } as any),
      /injected desktop project failure/,
    );
    assertSourceSnapshot(fixture, 'www/data/Actors.json');
    assertSourceSnapshot(fixture, 'www/data/Items.json');
    assert.deepEqual(latestManifest(fixture), manifestBefore);

    const applied = staging.applyProjectStaging(fixture.root, fixture.project) as any;
    assert.equal(applied.applied, true);
    assert.deepEqual(applied.operations.map((entry: any) => entry.operationId), ['database-op-project']);
    assert.deepEqual(fs.readFileSync(sourcePath(fixture, 'www/data/Actors.json')), Buffer.from('actors-manual-draft\n'));
    assert.deepEqual(fs.readFileSync(sourcePath(fixture, 'www/data/Items.json')), Buffer.from('items-owned-draft\n'));

    staging.writeStagedProjectBuffer(
      fixture.root,
      fixture.project,
      'www/data/Classes.json',
      Buffer.from('classes-second-draft\n'),
    );
    const discardManifest = latestManifest(fixture);
    const discardDraft = fs.readFileSync(draftPath(fixture, 'www/data/Classes.json'));
    assert.throws(
      () => staging.discardProjectStaging(fixture.root, fixture.project, {
        transactionDependencies: {
          beforeManifestUpdate: () => {
            throw new Error('injected desktop discard failure');
          },
        },
      } as any),
      /injected desktop discard failure/,
    );
    assert.deepEqual(latestManifest(fixture), discardManifest);
    assert.deepEqual(fs.readFileSync(draftPath(fixture, 'www/data/Classes.json')), discardDraft);
    assert.deepEqual(fs.readFileSync(sourcePath(fixture, 'www/data/Classes.json')), fixture.originals['www/data/Classes.json']);
  });
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-staging-transaction-'));
  const project = path.join(root, 'projects', 'sample');
  const originals: Record<string, Buffer | null> = {
    'www/data/Actors.json': Buffer.from('\uFEFFactors-original\r\n'),
    'www/data/Items.json': Buffer.from('items-original-without-final-newline'),
    'www/data/Classes.json': Buffer.from('classes-original\n'),
    'www/data/States.json': Buffer.from('states-original\r\n'),
    'www/data/NewEntries.json': null,
  };
  for (const [relativePath, bytes] of Object.entries(originals)) {
    if (bytes === null) continue;
    const target = path.join(project, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return { root, project, originals };
}

function stageOperation(
  fixture: Fixture,
  operationId: string,
  changes: Record<string, Buffer | null>,
): void {
  const files = Object.keys(changes);
  staging.registerDatabaseStagingOperation(fixture.root, fixture.project, {
    operationId,
    planHash: crypto.createHash('sha256').update(`plan:${operationId}`).digest('hex'),
    sessionId: 'sample-session',
    changes: [{ table: 'Actors', ids: [1] }],
    files,
  });
  for (const [relativePath, bytes] of Object.entries(changes)) {
    const ownership = { operationId };
    if (bytes === null) {
      staging.deleteStagedProjectFile(fixture.root, fixture.project, relativePath, ownership);
    } else {
      staging.writeStagedProjectBuffer(fixture.root, fixture.project, relativePath, bytes, ownership);
    }
  }
}

function applyStagedOperation(
  fixture: Fixture,
  operationId: string,
  options?: Record<string, unknown>,
): unknown {
  return requireApi('applyStagedOperation')(fixture.root, fixture.project, operationId, options);
}

function discardStagedOperation(fixture: Fixture, operationId: string): unknown {
  return requireApi('discardStagedOperation')(fixture.root, fixture.project, operationId);
}

function applyOperation(fixture: Fixture, operationId: string, faults: TransactionFaults): unknown {
  return applyStagedOperation(fixture, operationId, { transactionDependencies: faults });
}

function discardOperation(fixture: Fixture, operationId: string, faults: TransactionFaults): unknown {
  return requireApi('discardStagedOperation')(
    fixture.root,
    fixture.project,
    operationId,
    { transactionDependencies: faults },
  );
}

function requireApi(name: string): (...args: any[]) => any {
  const value = (staging as unknown as Record<string, unknown>)[name];
  assert.equal(typeof value, 'function', `expected staging-service to export ${name}`);
  return value as (...args: any[]) => any;
}

function latestManifest(fixture: Fixture): Record<string, unknown> {
  const row = StagingManifestDao.getLatestByProject(staging.projectHash(fixture.project));
  assert.ok(row);
  return row.manifest;
}

function sourcePath(fixture: Fixture, relativePath: string): string {
  return path.join(fixture.project, ...relativePath.split('/'));
}

function draftPath(fixture: Fixture, relativePath: string): string {
  return path.join(stagingRoot(fixture), 'draft', ...relativePath.split('/'));
}

function stagingRoot(fixture: Fixture): string {
  return path.join(
    fixture.root,
    'runtime',
    'agent-console-staging',
    staging.projectHash(fixture.project),
  );
}

function findFiles(root: string, predicate: (candidate: string) => boolean): string[] {
  if (!fs.existsSync(root)) return [];
  const matches: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(candidate, predicate));
    else if (entry.isFile() && predicate(candidate)) matches.push(candidate);
  }
  return matches;
}

function assertSourceSnapshot(fixture: Fixture, relativePath: string): void {
  const expected = fixture.originals[relativePath];
  const target = sourcePath(fixture, relativePath);
  assert.equal(fs.existsSync(target), expected !== null);
  if (expected !== null) assert.deepEqual(fs.readFileSync(target), expected);
}

function assertAllSourceSnapshots(fixture: Fixture): void {
  for (const relativePath of Object.keys(fixture.originals)) {
    assertSourceSnapshot(fixture, relativePath);
  }
}

function draftSnapshots(fixture: Fixture, relativePaths: string[]): Map<string, Buffer | null> {
  return new Map(relativePaths.map((relativePath) => {
    const target = draftPath(fixture, relativePath);
    return [relativePath, fs.existsSync(target) ? fs.readFileSync(target) : null];
  }));
}

function assertDraftSnapshots(fixture: Fixture, snapshots: Map<string, Buffer | null>): void {
  for (const [relativePath, expected] of snapshots) {
    const target = draftPath(fixture, relativePath);
    assert.equal(fs.existsSync(target), expected !== null);
    if (expected !== null) assert.deepEqual(fs.readFileSync(target), expected);
  }
}
