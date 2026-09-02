import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import sharp from 'sharp';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { createDefaultRmmvDatabaseEntry } from '../rmmv/database-schema.ts';
import { writeJson } from '../rmmv/json.ts';
import { getProjectManagedEntry, updateProjectManagedEntry } from './project-management-service.ts';

describe('extended tileset database transitions', { concurrency: false }, () => {
  let root = '';
  let project = '';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-extended-tileset-'));
    project = path.join(root, 'projects', 'sample');
    fs.mkdirSync(path.join(project, 'www', 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'img', 'tilesets'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV 1.6.2', 'utf8');
    writeJson(path.join(project, 'www', 'data', 'System.json'), {
      ...createDefaultRmmvDatabaseEntry('System'),
      switches: [null],
      variables: [null],
    });
    writeDatabaseFixture(project);
    writeJson(path.join(project, 'www', 'data', 'MapInfos.json'), [null, {
      id: 1, name: 'Sample Map', parentId: 0, order: 1, expanded: false, scrollX: 0, scrollY: 0,
    }]);
    writeMap(project, 0);
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'extended-tileset-test.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('keeps types immutable, grows flags, and removes only an unused trailing sheet', async () => {
    await writeTilesetPng(project, 'ExtraNormal', 768, 768);
    await writeTilesetPng(project, 'ExtraA5', 384, 768);
    writeTilesets(project, Array(9).fill(''));

    const initial = tilesetValue(root, project);
    updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: { ...initial, tilesetNames: [...initial.tilesetNames, 'ExtraNormal'], rpgAgentExtendedTilesetTypes: ['normal'] },
    });
    const first = tilesetValue(root, project);
    assert.deepEqual(first.rpgAgentExtendedTilesetTypes, ['normal']);
    assert.equal(first.flags.length, 8448);
    assert.throws(() => updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: { ...first, rpgAgentExtendedTilesetTypes: ['A5'] },
    }), /type is immutable/);

    updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: {
        ...first,
        tilesetNames: [...first.tilesetNames, 'ExtraA5'],
        rpgAgentExtendedTilesetTypes: ['normal', 'A5'],
      },
    });
    const second = tilesetValue(root, project);
    assert.equal(second.flags.length, 8576);
    writeMap(project, 8448);
    assert.throws(() => updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: {
        ...second,
        tilesetNames: second.tilesetNames.slice(0, -1),
        rpgAgentExtendedTilesetTypes: ['normal'],
      },
    }), /Map001 Sample Map/);

    writeMap(project, 0, 8448);
    assert.throws(() => updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: {
        ...second,
        tilesetNames: second.tilesetNames.slice(0, -1),
        rpgAgentExtendedTilesetTypes: ['normal'],
      },
    }), /Map001 Sample Map/);

    writeMap(project, 0);
    updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: {
        ...second,
        tilesetNames: second.tilesetNames.slice(0, -1),
        rpgAgentExtendedTilesetTypes: ['normal'],
      },
    });
    const removed = tilesetValue(root, project);
    assert.equal(removed.flags.length, 8448);
    assert.deepEqual(removed.rpgAgentExtendedTilesetTypes, ['normal']);
  });

  test('migrates legacy extra names as normal and rejects ids outside that interpretation', async () => {
    await writeTilesetPng(project, 'LegacyExtra', 768, 768);
    writeTilesets(project, [...Array(9).fill(''), 'LegacyExtra']);
    writeMap(project, 8192);
    const legacy = tilesetValue(root, project);
    updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: { ...legacy, note: 'migration' },
    });
    assert.deepEqual(tilesetValue(root, project).rpgAgentExtendedTilesetTypes, ['normal']);
  });

  test('rejects legacy ids outside the inferred range and invalid PNG dimensions', async () => {
    await writeTilesetPng(project, 'LegacyExtra', 768, 768);
    writeTilesets(project, [...Array(9).fill(''), 'LegacyExtra']);
    writeMap(project, 8448);
    const legacy = tilesetValue(root, project);
    assert.throws(() => updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: { ...legacy, note: 'migration' },
    }), /migrate legacy extended tileset data.*Map001/);

    await writeTilesetPng(project, 'SecondExtra', 768, 768);
    assert.throws(() => updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: {
        ...legacy,
        tilesetNames: [...legacy.tilesetNames, 'SecondExtra'],
        rpgAgentExtendedTilesetTypes: ['normal', 'normal'],
      },
    }), /migrate legacy extended tileset data.*Map001/);

    writeMap(project, 0);
    await writeTilesetPng(project, 'WrongSize', 48, 48);
    writeTilesets(project, Array(9).fill(''));
    const stock = tilesetValue(root, project);
    assert.throws(() => updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: {
        ...stock,
        tilesetNames: [...stock.tilesetNames, 'WrongSize'],
        rpgAgentExtendedTilesetTypes: ['normal'],
      },
    }), /requires 768x768/);
  });

  test('accepts an extended tileset image in a safe project-relative subdirectory', async () => {
    await writeTilesetPng(project, 'interior/ExtraNormal', 768, 768);
    writeTilesets(project, Array(9).fill(''));
    const stock = tilesetValue(root, project);

    updateProjectManagedEntry(root, project, {
      kind: 'database', group: 'Tilesets', id: 1,
      value: {
        ...stock,
        tilesetNames: [...stock.tilesetNames, 'interior/ExtraNormal'],
        rpgAgentExtendedTilesetTypes: ['normal'],
      },
    });

    assert.equal(tilesetValue(root, project).tilesetNames[9], 'interior/ExtraNormal');
  });
});

function tilesetValue(root: string, project: string): Record<string, any> {
  return getProjectManagedEntry(root, project, { kind: 'database', group: 'Tilesets', id: 1 }).value as Record<string, any>;
}

function writeTilesets(project: string, tilesetNames: string[]): void {
  const value = createDefaultRmmvDatabaseEntry('Tilesets', 1);
  value.id = 1;
  value.name = 'Sample Tileset';
  value.tilesetNames = tilesetNames;
  value.flags = Array(8192).fill(0);
  delete value.rpgAgentExtendedTilesetTypes;
  writeJson(path.join(project, 'www', 'data', 'Tilesets.json'), [null, value]);
}

function writeDatabaseFixture(project: string): void {
  const dataDir = path.join(project, 'www', 'data');
  const tables: Array<[string, string, number[]]> = [
    ['Actors', 'Actors.json', [1]],
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
  for (const [group, fileName, ids] of tables) {
    const records: unknown[] = [null];
    for (const id of ids) {
      const record = createDefaultRmmvDatabaseEntry(group, id);
      if (group === 'Armors') record.etypeId = id + 1;
      records[id] = record;
    }
    writeJson(path.join(dataDir, fileName), records);
  }
}

function writeMap(project: string, tileId: number, eventTileId = 0): void {
  writeJson(path.join(project, 'www', 'data', 'Map001.json'), {
    width: 1,
    height: 1,
    tilesetId: 1,
    data: [tileId, 0, 0, 0, 0, 0],
    events: eventTileId > 0
      ? [null, { id: 1, x: 0, y: 0, pages: [{ image: { tileId: eventTileId } }] }]
      : [null],
  });
}

async function writeTilesetPng(project: string, name: string, width: number, height: number): Promise<void> {
  const target = path.join(project, 'www', 'img', 'tilesets', `${name}.png`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toFile(target);
}
