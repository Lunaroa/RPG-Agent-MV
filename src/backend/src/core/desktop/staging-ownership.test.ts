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

function fileStatus(status: any, relativePath: string): any {
  const entry = status.files.find((candidate: any) => candidate.relativePath === relativePath);
  assert.ok(entry, `expected staging status for ${relativePath}`);
  return entry;
}

function reasonCodes(status: any): string[] {
  return status.conflictReasons.map((reason: any) => reason.code).sort();
}
