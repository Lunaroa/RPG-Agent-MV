import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { createDefaultRmmvDatabaseEntry } from '../rmmv/database-schema.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import { deleteAsset, getAssetDetail, renameAsset } from './asset-management-service.ts';
import { createProjectManagedEntry, getProjectManagedEntry, updateProjectManagedEntry, buildProjectManagementScan } from './project-management-service.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import { discardProjectStaging, getProjectFileForRead, getProjectStagingStatus } from './staging-service.ts';

describe('console management services', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-management-'));
    project = path.join(root, 'projects', 'Project');
    fs.mkdirSync(path.join(project, 'www', 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'img', 'characters'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    writeJson(path.join(project, 'www', 'data', 'System.json'), {
      ...createDefaultRmmvDatabaseEntry('System'),
      switches: [null, 'Door'],
      variables: [null, 'Progress'],
      gameTitle: 'Console Test',
    });
    writeJson(path.join(project, 'www', 'data', 'Actors.json'), [
      null,
      { ...createDefaultRmmvDatabaseEntry('Actors', 1), name: 'Hero', characterName: 'Hero' },
    ]);
    fs.writeFileSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'), 'hero');
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('renames a project asset, updates references, and supports discard', () => {
    const target = { scope: 'project' as const, category: 'characters', relativePath: 'www/img/characters/Hero.png' };
    assert.equal(getAssetDetail(root, project, target).references.length, 1);
    const renamed = renameAsset(root, project, target, 'Lead');
    assert.equal(renamed.fileName, 'Lead.png');
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Lead.png')), false);
    const stagedActors = getProjectFileForRead(root, project, 'www/data/Actors.json');
    assert.ok(stagedActors);
    assert.equal((readJson(stagedActors) as any[])[1].characterName, 'Lead');
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName, 'Hero');
    assert.equal(getProjectStagingStatus(root, project).staged, true);
    assert.throws(() => withTestLanguage(() => deleteAsset(root, project, { ...target, relativePath: 'www/img/characters/Lead.png' })), /引用/);
    discardProjectStaging(root, project);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), true);
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName, 'Hero');
  });

  test('reads and updates structured project entries through staging', () => {
    const actor = getProjectManagedEntry(root, project, { kind: 'database', group: 'Actors', id: 1 });
    assert.equal((actor.value as any).name, 'Hero');
    updateProjectManagedEntry(root, project, { kind: 'database', group: 'Actors', id: 1, value: { ...(actor.value as any), name: 'Lead' } });
    updateProjectManagedEntry(root, project, { kind: 'switch', id: 1, value: { id: 1, name: 'Gate' } });
    assert.equal((readJson(getProjectFileForRead(root, project, 'www/data/Actors.json')!) as any[])[1].name, 'Lead');
    assert.equal((readJson(getProjectFileForRead(root, project, 'www/data/System.json')!) as any).switches[1], 'Gate');
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].name, 'Hero');
    assert.equal((readJson(path.join(project, 'www', 'data', 'System.json')) as any).switches[1], 'Door');
    assert.throws(() => withTestLanguage(() => updateProjectManagedEntry(root, project, { kind: 'database', group: 'Actors', id: 1, value: { id: 2, name: 'Wrong' } })), /ID/);
    assert.throws(() => withTestLanguage(() => getProjectManagedEntry(root, project, { kind: 'database', group: 'Bogus', id: 1 })), /Unknown RMMV database group/);
    assert.throws(() => withTestLanguage(() => getProjectManagedEntry(root, project, { kind: 'database', group: 'System', id: 1 })), /固定文档条目/);
    const system = getProjectManagedEntry(root, project, { kind: 'database', group: 'System', id: 0 });
    assert.equal((system.value as any).gameTitle, 'Console Test');
    assert.equal(system.schema?.isArrayTable, false);
    assert.equal(system.relativePath, 'www/data/System.json');
  });

  test('edits System-backed Types and Terms document groups through staging', () => {
    const types = getProjectManagedEntry(root, project, { kind: 'database', group: 'Types', id: 0 });
    assert.deepEqual((types.value as any).skillTypes, ['', 'Magic', 'Special']);
    updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Types',
      id: 0,
      value: { ...(types.value as any), skillTypes: ['', 'Magic', 'Tech'] },
    });
    const terms = getProjectManagedEntry(root, project, { kind: 'database', group: 'Terms', id: 0 });
    updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Terms',
      id: 0,
      value: { ...(terms.value as any), commands: ['', 'Fight', 'Run'] },
    });
    const stagedSystem = readJson(getProjectFileForRead(root, project, 'www/data/System.json')!) as any;
    assert.deepEqual(stagedSystem.skillTypes, ['', 'Magic', 'Tech']);
    assert.deepEqual(stagedSystem.terms.commands, ['', 'Fight', 'Run']);
    const sourceSystem = readJson(path.join(project, 'www', 'data', 'System.json')) as any;
    assert.deepEqual(sourceSystem.skillTypes, ['', 'Magic', 'Special']);
  });

  test('creates database entries from schema defaults using the first free id', () => {
    const actorsPath = path.join(project, 'www', 'data', 'Actors.json');
    writeJson(actorsPath, [
      null,
      { ...createDefaultRmmvDatabaseEntry('Actors', 1), id: 1, name: 'Hero' },
      null,
      { ...createDefaultRmmvDatabaseEntry('Actors', 3), id: 3, name: 'Mage' },
    ]);
    const created = createProjectManagedEntry(root, project, { kind: 'database', group: 'Actors' });
    assert.equal(created.id, 2);
    assert.equal((created.value as any).id, 2);
    assert.equal((created.value as any).maxLevel, 99);
    assert.equal((readJson(getProjectFileForRead(root, project, 'www/data/Actors.json')!) as any[])[2].id, 2);
    assert.equal((readJson(actorsPath) as any[])[2], null);
    assert.throws(() => withTestLanguage(() => createProjectManagedEntry(root, project, { kind: 'database', group: 'System' })), /不能新增/);
  });

  test('overview scan reads staged database changes and unnamed entries', () => {
    writeJson(path.join(project, 'www', 'data', 'Skills.json'), [null]);
    const created = createProjectManagedEntry(root, project, { kind: 'database', group: 'Skills' });
    const stagedOverview = buildProjectManagementScan(root, project);
    assert.equal(stagedOverview.database.Skills?.count, 1);
    assert.equal(stagedOverview.database.Skills?.named.some((entry) => entry.id === created.id), true);
    updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Skills',
      id: created.id,
      value: { ...(created.value as Record<string, unknown>), name: 'Fire II' },
    });
    const renamedOverview = buildProjectManagementScan(root, project);
    assert.equal(renamedOverview.database.Skills?.named.find((entry) => entry.id === created.id)?.name, 'Fire II');
    assert.equal((readJson(path.join(project, 'www', 'data', 'Skills.json')) as unknown[])[created.id], undefined);
  });
});
