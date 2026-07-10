import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { StagingManifestDao } from '../db/dao/staging-manifest-dao.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { runRmmvMapEditor } from '../rmmv/rmmv-handlers.ts';
import * as stagingLockApi from './staging-lock.ts';
import * as stagingApi from './staging-service.ts';

interface Fixture {
  root: string;
  project: string;
}

type OperationInput = {
  operationId: string;
  planHash: string;
  sessionId?: string;
  changes: unknown;
  files: string[];
};

describe('staging ownership, conflicts, and locking', { concurrency: false }, () => {
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

  test('keeps version 4 manifests without operations as unowned drafts', () => {
    stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', [null, { id: 1, name: 'Draft' }]);
    const stored = latestManifest(fixture);
    delete stored.operations;
    delete (stored.files as Record<string, Record<string, unknown>>)['www/data/Actors.json'].operationId;
    const row = StagingManifestDao.getLatestByProject(stagingApi.projectHash(fixture.project));
    assert.ok(row);
    StagingManifestDao.update(row.id, stored);

    const legacyStatus = stagingApi.getProjectStagingStatus(fixture.root, fixture.project) as any;
    assert.equal(legacyStatus.files[0].operationId, undefined);
    assert.deepEqual(legacyStatus.operations, []);

    stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', [null, { id: 1, name: 'Updated' }]);
    const normalized = latestManifest(fixture);
    assert.equal(normalized.version, 4);
    assert.equal(Object.hasOwn(normalized, 'operations'), true);
    assert.equal(Object.hasOwn(normalized, 'operation'), false);
    assert.deepEqual(normalized.operations, {});
    assert.equal((normalized.files as any)['www/data/Actors.json'].operationId, undefined);
  });

  test('uses one Windows project, lock, and file identity across path casing aliases', {
    skip: process.platform !== 'win32',
  }, () => {
    const projectAlias = fixture.project.toUpperCase();
    assert.notEqual(projectAlias, fixture.project);
    assert.equal(stagingApi.projectHash(projectAlias), stagingApi.projectHash(fixture.project));

    registerOperation(fixture, operation('database-op-case-a', ['www/data/Actors.json']));
    expectCode(
      () => registerOperation(
        { ...fixture, project: projectAlias },
        operation('database-op-case-b', ['WWW/DATA/ACTORS.JSON']),
      ),
      'STAGING_FILE_OWNED',
    );

    const file = lockPath(fixture);
    fs.writeFileSync(file, JSON.stringify({
      pid: process.pid,
      token: 'case-shared-lock',
      createdAt: new Date().toISOString(),
    }), { flag: 'wx' });
    expectCode(
      () => stagingApi.writeStagedProjectJson(
        fixture.root,
        projectAlias,
        'WWW/DATA/CLASSES.JSON',
        [null],
      ),
      'STAGING_BUSY',
    );
    fs.unlinkSync(file);
  });

  test('migrates one legacy case-sensitive v4 identity only when the canonical target is empty', {
    skip: process.platform !== 'win32',
  }, () => {
    const legacyHash = legacyProjectHash(fixture.project);
    const canonicalHash = canonicalProjectHash(fixture.project);
    assert.notEqual(legacyHash, canonicalHash);
    seedLegacyDraft(fixture, legacyHash, 'www/data/Actors.json', [null, { id: 1, name: 'Legacy Draft' }]);

    const projectAlias = fixture.project.toUpperCase();
    const status = stagingApi.getProjectStagingStatus(fixture.root, projectAlias) as any;
    assert.equal(stagingApi.projectHash(projectAlias), canonicalHash);
    assert.equal(status.staged, true);
    assert.deepEqual(status.operations, []);
    assert.equal(status.files[0].relativePath, 'www/data/Actors.json');
    const effective = stagingApi.getProjectFileForRead(
      fixture.root,
      projectAlias,
      'WWW/DATA/ACTORS.JSON',
    );
    assert.ok(effective);
    assert.equal((JSON.parse(fs.readFileSync(effective, 'utf8')) as any)[1].name, 'Legacy Draft');
    assert.equal(StagingManifestDao.getLatestByProject(legacyHash), null);
    assert.ok(StagingManifestDao.getLatestByProject(canonicalHash));
    assert.equal(fs.existsSync(stagingRootForHash(fixture, legacyHash)), false);
    assert.equal(fs.existsSync(stagingRootForHash(fixture, canonicalHash)), true);
  });

  test('discovers and migrates a v4 manifest written through a third Windows path casing', {
    skip: process.platform !== 'win32',
  }, () => {
    const thirdCaseProject = path.join(path.dirname(fixture.project), 'pRoJeCt');
    const legacyHash = legacyProjectHash(thirdCaseProject);
    const canonicalHash = canonicalProjectHash(fixture.project);
    assert.notEqual(legacyHash, legacyProjectHash(fixture.project));
    assert.notEqual(legacyHash, canonicalHash);
    seedLegacyDraft(
      fixture,
      legacyHash,
      'www/data/Actors.json',
      [null, { id: 1, name: 'Third Case Draft' }],
      thirdCaseProject,
    );

    const status = stagingApi.getProjectStagingStatus(fixture.root, fixture.project) as any;
    assert.equal(status.staged, true);
    assert.equal(status.files[0].relativePath, 'www/data/Actors.json');
    assert.equal(StagingManifestDao.getLatestByProject(legacyHash), null);
    assert.ok(StagingManifestDao.getLatestByProject(canonicalHash));
    const effective = stagingApi.getProjectFileForRead(
      fixture.root,
      fixture.project,
      'www/data/Actors.json',
    );
    assert.ok(effective);
    assert.equal((JSON.parse(fs.readFileSync(effective, 'utf8')) as any)[1].name, 'Third Case Draft');
  });

  test('fails fast instead of merging multiple matching legacy Windows staging identities', {
    skip: process.platform !== 'win32',
  }, () => {
    const firstProject = fixture.project;
    const secondProject = path.join(path.dirname(fixture.project), 'pRoJeCt');
    const firstHash = legacyProjectHash(firstProject);
    const secondHash = legacyProjectHash(secondProject);
    assert.notEqual(firstHash, secondHash);
    StagingManifestDao.create(firstHash, emptyManifest(firstProject, firstHash));
    StagingManifestDao.create(secondHash, emptyManifest(secondProject, secondHash));

    expectCode(
      () => stagingApi.getProjectStagingStatus(fixture.root, fixture.project),
      'STAGING_IDENTITY_COLLISION',
    );
    assert.ok(StagingManifestDao.getLatestByProject(firstHash));
    assert.ok(StagingManifestDao.getLatestByProject(secondHash));
  });

  test('registers disjoint normalized file sets and rejects invalid or overlapping ownership', () => {
    const first = registerOperation(fixture, operation('database-op-a', ['www/data/./Actors.json'])) as any;
    const second = registerOperation(fixture, operation('database-op-b', ['www\\data\\Items.json'])) as any;
    registerOperation(fixture, operation('database-op-0', ['www/data/Classes.json']));

    assert.equal(first.operationId, 'database-op-a');
    assert.deepEqual(first.files, ['www/data/Actors.json']);
    assert.equal(second.operationId, 'database-op-b');
    assert.deepEqual(second.files, ['www/data/Items.json']);
    assert.equal(getOperation(fixture, 'database-op-a')?.kind, 'database');
    assert.equal(getOperation(fixture, 'missing-operation'), null);

    const manifest = latestManifest(fixture);
    assert.deepEqual(Object.keys(manifest.operations as object).sort(), ['database-op-0', 'database-op-a', 'database-op-b']);
    assert.equal((manifest.operations as any)['database-op-a'].operationId, 'database-op-a');
    assert.equal((manifest.files as any)['www/data/Actors.json'].operationId, 'database-op-a');
    assert.equal((manifest.files as any)['www/data/Items.json'].operationId, 'database-op-b');
    assert.deepEqual(
      (stagingApi.getProjectStagingStatus(fixture.root, fixture.project) as any).operations
        .map((candidate: any) => candidate.operationId),
      ['database-op-0', 'database-op-a', 'database-op-b'],
    );

    expectCode(
      () => registerOperation(fixture, operation('database-op-a', ['www/data/Classes.json'])),
      'STAGING_DUPLICATE_OPERATION_ID',
    );
    expectCode(
      () => registerOperation(fixture, operation('database-op-c', ['www/data/Actors.json'])),
      'STAGING_FILE_OWNED',
    );
    expectCode(
      () => registerOperation(fixture, operation('bad id', ['www/data/Classes.json'])),
      'STAGING_INVALID_OPERATION_ID',
    );
    expectCode(
      () => registerOperation(fixture, operation('database-op-empty', [])),
      'STAGING_EMPTY_FILE_SET',
    );
    expectCode(
      () => registerOperation(fixture, { ...operation('database-op-hash', ['www/data/Classes.json']), planHash: 'not-a-hash' }),
      'STAGING_INVALID_PLAN_HASH',
    );
    expectCode(
      () => registerOperation(fixture, operation('database-op-path', ['../outside.json'])),
      'STAGING_UNSAFE_PATH',
    );
    expectCode(
      () => registerOperation(fixture, operation('database-op-parent-segment', ['www/data/../outside.json'])),
      'STAGING_UNSAFE_PATH',
    );
  });

  test('treats prototype-named operation IDs as own keys and preserves duplicate error codes', () => {
    const constructorOperation = registerOperation(
      fixture,
      operation('constructor', ['www/data/Actors.json']),
    ) as any;
    const toStringOperation = registerOperation(
      fixture,
      operation('toString', ['www/data/Items.json']),
    ) as any;

    assert.equal(constructorOperation.operationId, 'constructor');
    assert.equal(toStringOperation.operationId, 'toString');
    assert.equal(getOperation(fixture, 'constructor')?.operationId, 'constructor');
    assert.equal(getOperation(fixture, 'toString')?.operationId, 'toString');
    expectCode(
      () => registerOperation(fixture, operation('constructor', ['www/data/Classes.json'])),
      'STAGING_DUPLICATE_OPERATION_ID',
    );
    expectCode(
      () => registerOperation(fixture, operation('toString', ['www/data/Skills.json'])),
      'STAGING_DUPLICATE_OPERATION_ID',
    );
  });

  test('rejects unowned drafts and leaves failed registration fully atomic', () => {
    stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Skills.json', [null, { id: 1, name: 'Manual' }]);
    const untouchedDraft = draftPath(fixture, 'www/data/Classes.json');

    expectCode(
      () => registerOperation(fixture, operation('database-op-atomic', [
        'www/data/Classes.json',
        'www/data/Skills.json',
      ])),
      'STAGING_UNOWNED_DRAFT',
    );

    assert.equal(fs.existsSync(untouchedDraft), false);
    assert.equal(getOperation(fixture, 'database-op-atomic'), null);
    const status = stagingApi.getProjectStagingStatus(fixture.root, fixture.project) as any;
    assert.deepEqual(status.files.map((entry: any) => entry.relativePath), ['www/data/Skills.json']);
    assert.equal(status.files[0].operationId, undefined);

    const orphanDraft = draftPath(fixture, 'www/data/Actors.json');
    fs.mkdirSync(path.dirname(orphanDraft), { recursive: true });
    fs.writeFileSync(orphanDraft, Buffer.from('patcher context'));
    const nonSerializable = operation('database-op-rollback', ['www/data/Actors.json']);
    nonSerializable.changes = 1n;
    assert.throws(() => registerOperation(fixture, nonSerializable));
    assert.deepEqual(fs.readFileSync(orphanDraft), Buffer.from('patcher context'));
    assert.equal(getOperation(fixture, 'database-op-rollback'), null);
  });

  test('requires the exact registered owner for every staged write API', () => {
    registerOperation(fixture, operation('database-op-a', ['www/data/Actors.json']));
    registerOperation(fixture, operation('database-op-b', ['www/data/Items.json']));
    registerOperation(fixture, operation('database-op-map', ['www/data/Map001.json']));

    expectCode(
      () => stagingApi.ensureStagedProjectFile(fixture.root, fixture.project, 'www/data/Actors.json'),
      'STAGING_OWNER_REQUIRED',
    );
    expectCode(
      () => stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', [], owner('database-op-b')),
      'STAGING_WRONG_OWNER',
    );
    expectCode(
      () => stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', [], owner('missing-operation')),
      'STAGING_OPERATION_NOT_FOUND',
    );

    const actors = stagingApi.writeStagedProjectJson(
      fixture.root,
      fixture.project,
      'www/data/Actors.json',
      [null, { id: 1, name: 'Owned' }],
      owner('database-op-a'),
    ) as any;
    assert.equal(actors.entry.operationId, 'database-op-a');
    const items = stagingApi.writeStagedProjectBuffer(
      fixture.root,
      fixture.project,
      'www/data/Items.json',
      Buffer.from('[null]'),
      owner('database-op-b'),
    ) as any;
    assert.equal(items.entry.operationId, 'database-op-b');
    assert.equal(
      (stagingApi.deleteStagedProjectFile(
        fixture.root,
        fixture.project,
        'www/data/Items.json',
        owner('database-op-b'),
      ) as any).entry.operationId,
      'database-op-b',
    );

    expectCode(
      () => stagingApi.ensureStagedMap(fixture.root, fixture.project, 1),
      'STAGING_OWNER_REQUIRED',
    );
    const stagedMap = stagingApi.ensureStagedMap(fixture.root, fixture.project, 1, owner('database-op-map')) as any;
    fs.writeFileSync(stagedMap.mapFile, Buffer.from('{"owned":true}'));
    expectCode(
      () => stagingApi.markStagedMapUpdated(fixture.root, fixture.project, 1),
      'STAGING_OWNER_REQUIRED',
    );
    const mapStatus = stagingApi.markStagedMapUpdated(
      fixture.root,
      fixture.project,
      1,
      owner('database-op-map'),
    ) as any;
    assert.equal(mapStatus.operationId, 'database-op-map');
  });

  test('holds one project lock across staged map preparation, mutation, hashing, and manifest update', () => {
    const mutateStagedMap = requireApi('withStagedMapMutation');
    const outcome = mutateStagedMap(
      fixture.root,
      fixture.project,
      1,
      (staged: { mapFile: string }) => {
        expectCode(
          () => stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Items.json', [null]),
          'STAGING_BUSY',
        );
        const map = JSON.parse(fs.readFileSync(staged.mapFile, 'utf8')) as Record<string, unknown>;
        map.width = 4;
        writeJson(staged.mapFile, map);
        return { width: map.width };
      },
    ) as any;

    assert.deepEqual(outcome.result, { width: 4 });
    assert.equal(outcome.staging.conflict, false);
    assert.equal(outcome.staging.draftHash, outcome.staging.recordedDraftHash);
    assert.equal((JSON.parse(fs.readFileSync(outcome.mapFile, 'utf8')) as any).width, 4);
  });

  test('reports every source and draft conflict reason truthfully', () => {
    const stagedActors = stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', [null, { id: 1, name: 'Draft' }]) as any;
    const stagedClasses = stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Classes.json', [null, { id: 1, name: 'Draft' }]) as any;
    const stagedItems = stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Items.json', [null, { id: 1, name: 'Draft' }]) as any;
    const stagedSkills = stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Skills.json', [null, { id: 1, name: 'Draft' }]) as any;
    const stagedMap = stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Map001.json', { width: 2, changed: true }) as any;
    const stagedStates = stagingApi.deleteStagedProjectFile(fixture.root, fixture.project, 'www/data/States.json') as any;

    writeJson(sourcePath(fixture, 'www/data/Actors.json'), [null, { id: 1, name: 'Source drift' }]);
    fs.unlinkSync(sourcePath(fixture, 'www/data/Classes.json'));
    fs.unlinkSync(stagedItems.draftFile);
    fs.writeFileSync(stagedSkills.draftFile, Buffer.from('[null,{"id":1,"name":"Tampered"}]'));
    fs.writeFileSync(stagedMap.draftFile, Buffer.from('{"width":9}'));
    fs.writeFileSync(draftPath(fixture, 'www/data/States.json'), Buffer.from('[null]'));

    assert.ok(fs.existsSync(stagedActors.draftFile));
    assert.ok(fs.existsSync(stagedClasses.draftFile));
    const status = stagingApi.getProjectStagingStatus(fixture.root, fixture.project) as any;
    assert.equal(status.conflict, true);
    assert.deepEqual(reasonCodes(fileStatus(status, 'www/data/Actors.json')), ['SOURCE_HASH_CHANGED']);
    assert.deepEqual(reasonCodes(fileStatus(status, 'www/data/Classes.json')), ['SOURCE_EXISTENCE_CHANGED']);
    assert.deepEqual(reasonCodes(fileStatus(status, 'www/data/Items.json')), ['DRAFT_HASH_CHANGED', 'DRAFT_MISSING']);
    assert.deepEqual(reasonCodes(fileStatus(status, 'www/data/Skills.json')), ['DRAFT_HASH_CHANGED']);
    assert.deepEqual(reasonCodes(fileStatus(status, 'www/data/Map001.json')), ['DRAFT_HASH_CHANGED']);
    assert.equal(stagedStates.entry.delete, true);
    assert.deepEqual(reasonCodes(fileStatus(status, 'www/data/States.json')), ['DRAFT_HASH_CHANGED']);

    const mapStatus = stagingApi.getStagingStatus(fixture.root, fixture.project, 1) as any;
    assert.equal(mapStatus.conflict, true);
    assert.deepEqual(reasonCodes(mapStatus), ['DRAFT_HASH_CHANGED']);
    assert.notEqual(mapStatus.draftHash, mapStatus.recordedDraftHash);
  });

  test('preflights all supplied paths without writing and returns no partial result on conflict', () => {
    stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', [null, { id: 1, name: 'Draft' }]);
    stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Items.json', [null, { id: 1, name: 'Draft' }]);

    const clean = preflight(fixture, ['www/data/./Actors.json', 'www\\data\\Items.json']) as any[];
    assert.deepEqual(clean.map((entry) => entry.relativePath), ['www/data/Actors.json', 'www/data/Items.json']);
    assert.equal(clean.every((entry) => entry.conflict === false), true);

    writeJson(sourcePath(fixture, 'www/data/Items.json'), [null, { id: 1, name: 'Source drift' }]);
    const before = latestManifest(fixture);
    const draftBefore = fs.readFileSync(draftPath(fixture, 'www/data/Items.json'));
    expectCode(
      () => preflight(fixture, ['www/data/Actors.json', 'www/data/Items.json']),
      'STAGING_CONFLICT',
    );
    assert.deepEqual(latestManifest(fixture), before);
    assert.deepEqual(fs.readFileSync(draftPath(fixture, 'www/data/Items.json')), draftBefore);
    assert.equal(fs.existsSync(lockPath(fixture)), false);

    expectCode(
      () => preflight(fixture, ['www/data/Actors.json', 'www/data/States.json']),
      'STAGING_FILE_NOT_STAGED',
    );
  });

  test('blocks operation-owned map actions and Agent project-level apply or discard bypasses', () => {
    registerOperation(fixture, operation('database-op-project', ['www/data/Actors.json']));
    stagingApi.writeStagedProjectJson(
      fixture.root,
      fixture.project,
      'www/data/Actors.json',
      [null, { id: 1, name: 'Owned' }],
      owner('database-op-project'),
    );

    expectCode(
      () => runRmmvMapEditor({
        action: 'applyProject',
        workflowRoot: fixture.root,
        project: fixture.project,
      }),
      'STAGING_OPERATION_OWNED',
    );
    expectCode(
      () => runRmmvMapEditor({
        action: 'discardProject',
        workflowRoot: fixture.root,
        project: fixture.project,
      }),
      'STAGING_OPERATION_OWNED',
    );
    assert.equal((stagingApi.discardProjectStaging(fixture.root, fixture.project) as any).discarded, true);

    registerOperation(fixture, operation('database-op-map', ['www/data/Map001.json']));
    stagingApi.writeStagedProjectJson(
      fixture.root,
      fixture.project,
      'www/data/Map001.json',
      { width: 3, height: 2 },
      owner('database-op-map'),
    );
    expectCode(
      () => stagingApi.applyStagedMap(fixture.root, fixture.project, 1),
      'STAGING_OPERATION_OWNED',
    );
    expectCode(
      () => stagingApi.discardStagedMap(fixture.root, fixture.project, 1),
      'STAGING_OPERATION_OWNED',
    );

    assert.equal((stagingApi.applyProjectStaging(fixture.root, fixture.project) as any).applied, true);
    assert.equal((JSON.parse(fs.readFileSync(sourcePath(fixture, 'www/data/Map001.json'), 'utf8')) as any).width, 3);
  });

  test('fails fast on a live project lock and recovers one provably dead PID lock', () => {
    fs.mkdirSync(path.dirname(lockPath(fixture)), { recursive: true });
    fs.writeFileSync(lockPath(fixture), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' });
    expectCode(
      () => stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', []),
      'STAGING_BUSY',
    );
    assert.equal((stagingApi.getProjectStagingStatus(fixture.root, fixture.project) as any).staged, false);

    fs.unlinkSync(lockPath(fixture));
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(exited.status, 0);
    assert.equal(typeof exited.pid, 'number');
    fs.writeFileSync(lockPath(fixture), JSON.stringify({ pid: exited.pid, createdAt: new Date().toISOString() }), { flag: 'wx' });

    stagingApi.writeStagedProjectJson(fixture.root, fixture.project, 'www/data/Actors.json', [null]);
    assert.equal((stagingApi.getProjectStagingStatus(fixture.root, fixture.project) as any).staged, true);
    assert.equal(fs.existsSync(lockPath(fixture)), false);
  });

  test('dead-lock recovery cannot remove a replacement lock acquired after its observation', () => {
    const recoverObservedLock = (stagingLockApi as unknown as Record<string, unknown>)
      .tryRemoveObservedProjectStagingLock;
    assert.equal(typeof recoverObservedLock, 'function', 'expected an atomic observed-lock recovery API');

    const file = lockPath(fixture);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const observed = {
      pid: 2147483647,
      token: 'observed-dead-token',
      createdAt: new Date(0).toISOString(),
      projectHash: stagingApi.projectHash(fixture.project),
    };
    const replacement = {
      pid: process.pid,
      token: 'replacement-live-token',
      createdAt: new Date().toISOString(),
      projectHash: stagingApi.projectHash(fixture.project),
    };
    fs.writeFileSync(file, JSON.stringify(replacement), { flag: 'wx' });

    const recoveredReplacement = (recoverObservedLock as (lockFile: string, metadata: unknown) => boolean)(
      file,
      observed,
    );
    assert.equal(recoveredReplacement, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), replacement);

    fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify(observed), { flag: 'wx' });
    assert.equal(
      (recoverObservedLock as (lockFile: string, metadata: unknown) => boolean)(file, observed),
      true,
    );
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(`${file}.recovery`), false);
  });

  test('an orphaned recovery claim never makes dead-lock recovery permanently busy', () => {
    const recoverObservedLock = (stagingLockApi as unknown as Record<string, unknown>)
      .tryRemoveObservedProjectStagingLock as (lockFile: string, metadata: unknown) => boolean;
    assert.equal(typeof recoverObservedLock, 'function');

    const file = lockPath(fixture);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const observed = {
      pid: 2147483647,
      token: 'dead-with-orphaned-claim',
      createdAt: new Date(0).toISOString(),
      projectHash: stagingApi.projectHash(fixture.project),
    };
    fs.writeFileSync(file, JSON.stringify(observed), { flag: 'wx' });
    const orphanClaim = legacyRecoveryClaimPath(file, observed.token);
    fs.writeFileSync(orphanClaim, 'orphaned recovery claim', { flag: 'wx' });

    assert.equal(recoverObservedLock(file, observed), true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(orphanClaim), true);
    const recoveryFiles = fs.readdirSync(path.dirname(file))
      .filter((name) => name.startsWith(`${path.basename(file)}.recovery-`));
    assert.deepEqual(recoveryFiles, [path.basename(orphanClaim)]);
  });
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-staging-ownership-'));
  const project = path.join(root, 'projects', 'Project');
  for (const name of ['Actors', 'Classes', 'Items', 'Skills', 'States']) {
    writeJson(path.join(project, 'www', 'data', `${name}.json`), [null, { id: 1, name: `Sample ${name}` }]);
  }
  writeJson(path.join(project, 'www', 'data', 'Map001.json'), {
    width: 2,
    height: 2,
    tilesetId: 1,
    data: Array(24).fill(0),
    events: [null],
  });
  writeJson(path.join(project, 'www', 'data', 'MapInfos.json'), [null, { id: 1, name: 'Sample Map' }]);
  writeJson(path.join(project, 'www', 'data', 'System.json'), { switches: [null], variables: [null] });
  writeJson(path.join(project, 'www', 'data', 'Tilesets.json'), [null, { id: 1, name: 'Sample Tileset' }]);
  return { root, project };
}

function operation(operationId: string, files: string[]): OperationInput {
  return {
    operationId,
    planHash: crypto.createHash('sha256').update(`plan:${operationId}`).digest('hex'),
    sessionId: 'sample-session',
    changes: [{ table: 'Actors', ids: [1] }],
    files,
  };
}

function owner(operationId: string): { operationId: string } {
  return { operationId };
}

function requireApi(name: string): (...args: any[]) => any {
  const value = (stagingApi as unknown as Record<string, unknown>)[name];
  assert.equal(typeof value, 'function', `expected staging-service to export ${name}`);
  return value as (...args: any[]) => any;
}

function registerOperation(fixture: Fixture, input: OperationInput): unknown {
  return requireApi('registerDatabaseStagingOperation')(fixture.root, fixture.project, input);
}

function getOperation(fixture: Fixture, operationId: string): any {
  return requireApi('getDatabaseStagingOperation')(fixture.root, fixture.project, operationId);
}

function preflight(fixture: Fixture, files: string[]): unknown {
  return requireApi('preflightStagedProjectFiles')(fixture.root, fixture.project, files);
}

function expectCode(action: () => unknown, expectedCode: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code?: string }).code, expectedCode);
    return true;
  });
}

function latestManifest(fixture: Fixture): Record<string, any> {
  const row = StagingManifestDao.getLatestByProject(stagingApi.projectHash(fixture.project));
  assert.ok(row);
  return row.manifest as Record<string, any>;
}

function sourcePath(fixture: Fixture, relativePath: string): string {
  return path.join(fixture.project, ...relativePath.split('/'));
}

function draftPath(fixture: Fixture, relativePath: string): string {
  return path.join(
    fixture.root,
    'runtime',
    'agent-console-staging',
    stagingApi.projectHash(fixture.project),
    'draft',
    ...relativePath.split('/'),
  );
}

function lockPath(fixture: Fixture): string {
  return path.join(
    fixture.root,
    'runtime',
    'agent-console-staging',
    `${stagingApi.projectHash(fixture.project)}.lock`,
  );
}

function legacyProjectHash(project: string): string {
  return crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 16);
}

function canonicalProjectHash(project: string): string {
  const real = fs.realpathSync.native(path.resolve(project));
  const identity = process.platform === 'win32' ? real.toLowerCase() : real;
  return crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16);
}

function stagingRootForHash(fixture: Fixture, hash: string): string {
  return path.join(fixture.root, 'runtime', 'agent-console-staging', hash);
}

function seedLegacyDraft(
  fixture: Fixture,
  hash: string,
  relativePath: string,
  value: unknown,
  manifestProject = fixture.project,
): void {
  const source = sourcePath(fixture, relativePath);
  const draft = path.join(stagingRootForHash(fixture, hash), 'draft', ...relativePath.split('/'));
  writeJson(draft, value);
  const baseHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const draftHash = crypto.createHash('sha256').update(fs.readFileSync(draft)).digest('hex');
  StagingManifestDao.create(hash, {
    ...emptyManifest(manifestProject, hash),
    files: {
      [relativePath]: {
        relativePath,
        sourceExisted: true,
        baseHash,
        baseMtimeMs: fs.statSync(source).mtimeMs,
        draftHash,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

function legacyRecoveryClaimPath(lockFile: string, token: string): string {
  const identity = `token:${token}`;
  const suffix = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `${lockFile}.recovery-${suffix}`;
}

function emptyManifest(project: string, hash: string): Record<string, unknown> {
  return {
    version: 4,
    project,
    projectHash: hash,
    maps: {},
    files: {},
  };
}

function fileStatus(status: any, relativePath: string): any {
  const entry = status.files.find((candidate: any) => candidate.relativePath === relativePath);
  assert.ok(entry, `expected staging status for ${relativePath}`);
  return entry;
}

function reasonCodes(status: any): string[] {
  return status.conflictReasons.map((reason: any) => reason.code).sort();
}
