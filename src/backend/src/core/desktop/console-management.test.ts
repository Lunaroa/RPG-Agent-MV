import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import { createDefaultRmmvDatabaseEntry } from '../rmmv/database-schema.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import { deleteProjectAssets, getAssetDetail, renameAsset } from './asset-management-service.ts';
import {
  buildProjectManagementScan,
  createProjectManagedEntry,
  getProjectManagedEntry,
  resizeProjectManagedDatabase,
  resetProjectManagedEntry,
  updateProjectManagedEntry,
} from './project-management-service.ts';

describe('console management services', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-management-'));
    project = path.join(root, 'projects', 'sample');
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
      null,
    ]);
    writeCompleteDatabaseFixture(project);
    fs.writeFileSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'), 'hero');
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('renames a project asset, updates references on disk, and blocks referenced deletes', async () => {
    const target = { scope: 'project' as const, category: 'characters', relativePath: 'www/img/characters/Hero.png' };
    assert.equal(getAssetDetail(root, project, target).references.length, 1);

    const renamed = renameAsset(root, project, target, 'Lead');

    assert.equal(renamed.fileName, 'Lead.png');
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Lead.png')), true);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), false);
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName, 'Lead');
    await assert.rejects(() => withTestLanguage(() => deleteProjectAssets(root, project, [{
      ...target,
      relativePath: 'www/img/characters/Lead.png',
    }], {}, {
      trashItem: async (absolutePath) => fs.unlinkSync(absolutePath),
    }).then((batch) => {
      const result = batch.results[0];
      if (result?.status === 'blocked' || result?.status === 'failed') throw new Error(result.error || 'blocked');
      return batch;
    })), /引用/);
  });

  test('reads and saves structured project entries directly', () => {
    const actor = getProjectManagedEntry(root, project, { kind: 'database', group: 'Actors', id: 1 });
    assert.equal((actor.value as any).name, 'Hero');

    updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Actors',
      id: 1,
      value: { ...(actor.value as any), name: 'Lead' },
    });
    updateProjectManagedEntry(root, project, { kind: 'switch', id: 1, value: { id: 1, name: 'Gate' } });

    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].name, 'Lead');
    assert.equal((readJson(path.join(project, 'www', 'data', 'System.json')) as any).switches[1], 'Gate');
    assert.throws(() => withTestLanguage(() => updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Actors',
      id: 1,
      value: { id: 2, name: 'Wrong' },
    })), /ID/);
    assert.throws(() => withTestLanguage(() => getProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Bogus',
      id: 1,
    })), /Unknown RMMV database group/);
    const system = getProjectManagedEntry(root, project, { kind: 'database', group: 'System', id: 0 });
    assert.equal((system.value as any).gameTitle, 'Console Test');
    assert.equal(system.schema?.isArrayTable, false);
  });

  test('resizes switch and variable maxima directly without deleting occupied ids', () => {
    const expanded = resizeProjectManagedDatabase(root, project, { kind: 'switch', maximum: 40 });
    assert.equal(expanded.previousMaximum, 1);
    assert.equal(expanded.maximum, 40);
    const systemPath = path.join(project, 'www', 'data', 'System.json');
    const switches = (readJson(systemPath) as any).switches;
    assert.equal(switches.length, 41);
    assert.equal(switches[1], 'Door');

    updateProjectManagedEntry(root, project, { kind: 'switch', id: 25, value: { id: 25, name: 'Marked' } });
    assert.throws(
      () => withTestLanguage(() => resizeProjectManagedDatabase(root, project, { kind: 'switch', maximum: 20 })),
      /不能缩小|cannot be reduced/i,
    );
    updateProjectManagedEntry(root, project, { kind: 'switch', id: 25, value: { id: 25, name: '' } });
    resizeProjectManagedDatabase(root, project, { kind: 'switch', maximum: 20 });
    assert.equal((readJson(systemPath) as any).switches.length, 21);
  });

  test('saves System-backed Types and Terms document groups directly', () => {
    const types = getProjectManagedEntry(root, project, { kind: 'database', group: 'Types', id: 0 });
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

    const system = readJson(path.join(project, 'www', 'data', 'System.json')) as any;
    assert.deepEqual(system.skillTypes, ['', 'Magic', 'Tech']);
    assert.deepEqual(system.terms.commands, ['', 'Fight', 'Run']);
  });

  test('routes type-list changes through stable ids and blocks referenced tail removal', () => {
    const system = getProjectManagedEntry(root, project, { kind: 'database', group: 'System', id: 0 });
    assert.throws(() => withTestLanguage(() => updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'System',
      id: 0,
      value: { ...(system.value as Record<string, unknown>), skillTypes: ['', 'Changed'] },
    })), /Types|类型/);

    const types = getProjectManagedEntry(root, project, { kind: 'database', group: 'Types', id: 0 });
    assert.throws(() => withTestLanguage(() => updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Types',
      id: 0,
      value: { ...(types.value as Record<string, unknown>), skillTypes: [''] },
    })), /Referenced|引用/);
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
    assert.equal((created.value as any).maxLevel, 99);
    assert.equal((readJson(actorsPath) as any[])[2].id, 2);
  });

  test('changes database capacity directly without deleting occupied ids', () => {
    const expanded = resizeProjectManagedDatabase(root, project, {
      kind: 'database',
      group: 'Actors',
      maximum: 4,
    });
    assert.equal(expanded.previousMaximum, 2);
    assert.equal(expanded.maximum, 4);
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as unknown[]).length, 5);

    const created = createProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Actors',
      value: { name: 'Support' },
    });
    assert.equal(created.id, 2);
    assert.throws(() => withTestLanguage(() => resizeProjectManagedDatabase(root, project, {
      kind: 'database',
      group: 'Actors',
      maximum: 1,
    })), /不能缩小|cannot be reduced/);

    resetProjectManagedEntry(root, project, { kind: 'database', group: 'Actors', id: 2 });
    const reduced = resizeProjectManagedDatabase(root, project, {
      kind: 'database',
      group: 'Actors',
      maximum: 1,
    });
    assert.equal(reduced.maximum, 1);
    assert.equal(buildProjectManagementScan(root, project).database.Actors?.capacity, 1);
  });

  test('preserves existing event-list issues during unrelated troop edits and blocks changed invalid commands', () => {
    const troopPath = path.join(project, 'www', 'data', 'Troops.json');
    const troop = createDefaultRmmvDatabaseEntry('Troops', 1);
    (troop.pages as Record<string, unknown>[])[0].list = [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2, 'Guide'] },
      { code: 401, indent: 0, parameters: ['Welcome'] },
      { code: 213, indent: 0, parameters: [0, 11, true] },
      { code: 0, indent: 0, parameters: [] },
    ];
    writeJson(troopPath, [null, troop]);
    const current = getProjectManagedEntry(root, project, { kind: 'database', group: 'Troops', id: 1 });
    const renamed = updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Troops',
      id: 1,
      value: { ...(current.value as Record<string, unknown>), name: 'Updated Troop' },
    });
    assert.equal((renamed.value as Record<string, unknown>).name, 'Updated Troop');

    const changed = structuredClone(renamed.value) as Record<string, unknown>;
    const changedPages = changed.pages as Array<{ list: Array<{ parameters: unknown[] }> }>;
    changedPages[0]!.list[2]!.parameters[1] = 12;
    assert.throws(() => withTestLanguage(() => updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Troops',
      id: 1,
      value: changed,
    })), /balloonId.*<= 10/);
    assert.equal((readJson(troopPath) as any[])[1].name, 'Updated Troop');
  });

  test('blocks database creation after the original MV id limit is full', () => {
    writeJson(path.join(project, 'www', 'data', 'Actors.json'), [
      null,
      ...Array.from({ length: 1000 }, (_entry, index) => ({
        ...createDefaultRmmvDatabaseEntry('Actors', index + 1),
        id: index + 1,
      })),
    ]);
    assert.throws(
      () => withTestLanguage(() => createProjectManagedEntry(root, project, { kind: 'database', group: 'Actors' })),
      /1000/,
    );
  });

  test('resets only unreferenced array records directly', () => {
    const actorsPath = path.join(project, 'www', 'data', 'Actors.json');
    const actors = readJson(actorsPath) as unknown[];
    actors[3] = { ...createDefaultRmmvDatabaseEntry('Actors', 3), id: 3, name: 'Unused' };
    writeJson(actorsPath, actors);

    assert.throws(
      () => withTestLanguage(() => resetProjectManagedEntry(root, project, { kind: 'database', group: 'Actors', id: 1 })),
      /reference|引用/i,
    );
    const reset = resetProjectManagedEntry(root, project, { kind: 'database', group: 'Actors', id: 3 });
    assert.equal(reset.reset, true);
    assert.equal((readJson(actorsPath) as unknown[])[3], null);
  });

  test('overview scan reads directly saved unnamed and renamed entries', () => {
    const skillsPath = path.join(project, 'www', 'data', 'Skills.json');
    writeJson(skillsPath, [null, null]);
    const created = createProjectManagedEntry(root, project, { kind: 'database', group: 'Skills' });
    assert.equal(buildProjectManagementScan(root, project).database.Skills?.count, 1);

    updateProjectManagedEntry(root, project, {
      kind: 'database',
      group: 'Skills',
      id: created.id,
      value: { ...(created.value as Record<string, unknown>), name: 'Fire II' },
    });

    const overview = buildProjectManagementScan(root, project);
    assert.equal(overview.database.Skills?.named.find((entry) => entry.id === created.id)?.name, 'Fire II');
    assert.equal((readJson(skillsPath) as any[])[created.id].name, 'Fire II');
  });
});

function writeCompleteDatabaseFixture(project: string): void {
  const dataDir = path.join(project, 'www', 'data');
  const arrayTables: Array<[string, string, number[]]> = [
    ['Classes', 'Classes.json', [1]],
    ['Skills', 'Skills.json', []],
    ['Items', 'Items.json', []],
    ['Weapons', 'Weapons.json', [1]],
    ['Armors', 'Armors.json', [1, 2, 3]],
    ['Enemies', 'Enemies.json', []],
    ['Troops', 'Troops.json', [1]],
    ['States', 'States.json', []],
    ['Animations', 'Animations.json', []],
    ['Tilesets', 'Tilesets.json', [1]],
    ['CommonEvents', 'CommonEvents.json', []],
  ];
  for (const [group, fileName, ids] of arrayTables) {
    const records: unknown[] = [null];
    for (const id of ids) {
      const record = createDefaultRmmvDatabaseEntry(group, id);
      if (group === 'Armors') record.etypeId = id + 1;
      records[id] = record;
    }
    writeJson(path.join(dataDir, fileName), records);
  }
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, {
    id: 1,
    expanded: true,
    name: 'Sample Map',
    order: 1,
    parentId: 0,
    scrollX: 0,
    scrollY: 0,
  }]);
  writeJson(path.join(dataDir, 'Map001.json'), {
    autoplayBgm: false,
    autoplayBgs: false,
    battleback1Name: '',
    battleback2Name: '',
    bgm: { name: '', pan: 0, pitch: 100, volume: 90 },
    bgs: { name: '', pan: 0, pitch: 100, volume: 90 },
    disableDashing: false,
    displayName: '',
    encounterList: [],
    encounterStep: 30,
    events: [null],
    height: 1,
    note: '',
    parallaxLoopX: false,
    parallaxLoopY: false,
    parallaxName: '',
    parallaxShow: true,
    parallaxSx: 0,
    parallaxSy: 0,
    scrollType: 0,
    specifyBattleback: false,
    tilesetId: 1,
    width: 1,
    data: [0, 0, 0, 0, 0, 0],
  });
}
