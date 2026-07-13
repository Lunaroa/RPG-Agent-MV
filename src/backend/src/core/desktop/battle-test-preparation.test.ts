import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { createDefaultRmmvDatabaseEntry } from '../rmmv/database-schema.ts';
import { writeJson } from '../rmmv/json.ts';
import { writeStagedProjectJson } from './staging-service.ts';
import { cleanupIsolatedProject, verifyIsolatedSourceState } from './isolated-project-preparation.ts';
import { prepareBattleTestProject } from './battle-test-preparation.ts';

describe('isolated Battle Test preparation', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'battle-test-preparation-'));
    project = createProject(root);
    await bootstrapDatabase(root, {
      dbPath: path.join(root, 'data', 'test.db'),
      importLegacyJson: false,
      skipRuntimeLegacyCleanup: true,
      skipWorkspaceLegacyCleanup: true,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('overlays staging, excludes saves, and changes only the copied Battle Test fields', () => {
    const stagedTroops = readJson(path.join(project, 'data', 'Troops.json'));
    stagedTroops[1].name = 'Staged Troop';
    writeStagedProjectJson(root, project, 'data/Troops.json', stagedTroops);
    const sourceSystem = readJson(path.join(project, 'data', 'System.json'));
    const preparation = prepareBattleTestProject(root, project, {
      troopId: 1,
      battlers: [{ actorId: 1, level: 12, equips: [1, 1] }],
      battleback1Name: 'Field',
      battleback2Name: 'Forest',
    });

    assert.equal(preparation.troopName, 'Staged Troop');
    assert.equal(preparation.staging.files.length, 1);
    assert.equal(fs.existsSync(path.join(preparation.temporaryProject, 'save')), false);
    const temporarySystem = readJson(path.join(preparation.temporaryProject, 'data', 'System.json'));
    assert.equal(temporarySystem.testTroopId, 1);
    assert.deepEqual(temporarySystem.testBattlers, [{ actorId: 1, level: 12, equips: [1, 1] }]);
    assert.equal(temporarySystem.battleback1Name, 'Field');
    assert.equal(temporarySystem.battleback2Name, 'Forest');
    assert.equal(sourceSystem.testBattlers[0].level, 1);
    assert.equal(readJson(path.join(project, 'data', 'System.json')).testBattlers[0].level, 1);
    assert.deepEqual(verifyIsolatedSourceState(root, preparation), {
      sourceUnchanged: true,
      savesUnchanged: true,
      stagingUnchanged: true,
    });

    cleanupIsolatedProject(preparation);
    assert.equal(fs.existsSync(preparation.temporaryProject), false);
  });

  test('blocks duplicate actors, missing battlebacks, and over-limit troops before launch', () => {
    assert.throws(() => prepareBattleTestProject(root, project, {
      troopId: 1,
      battlers: [
        { actorId: 1, level: 1, equips: [1, 1] },
        { actorId: 1, level: 2, equips: [1, 1] },
      ],
      battleback1Name: 'Field',
      battleback2Name: 'Forest',
    }), /more than once/i);

    assert.throws(() => prepareBattleTestProject(root, project, {
      troopId: 1,
      battlers: [{ actorId: 1, level: 1, equips: [1, 1] }],
      battleback1Name: 'Missing',
      battleback2Name: 'Forest',
    }), /image was not found/i);

    const troops = readJson(path.join(project, 'data', 'Troops.json'));
    troops[1].members = Array.from({ length: 9 }, () => ({ enemyId: 1, hidden: false, x: 408, y: 436 }));
    writeJson(path.join(project, 'data', 'Troops.json'), troops);
    assert.throws(() => prepareBattleTestProject(root, project, {
      troopId: 1,
      battlers: [{ actorId: 1, level: 1, equips: [1, 1] }],
      battleback1Name: 'Field',
      battleback2Name: 'Forest',
    }), /at most 8/i);
  });
});

function createProject(root: string): string {
  const project = path.join(root, 'projects', 'sample');
  const data = path.join(project, 'data');
  fs.mkdirSync(path.join(project, 'save'), { recursive: true });
  fs.mkdirSync(path.join(project, 'img', 'battlebacks1'), { recursive: true });
  fs.mkdirSync(path.join(project, 'img', 'battlebacks2'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.exe'), 'runner', 'utf8');
  fs.writeFileSync(path.join(project, 'save', 'file1.rpgsave'), 'save', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'battlebacks1', 'Field.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'battlebacks2', 'Forest.png'), 'png', 'utf8');

  const actor = createDefaultRmmvDatabaseEntry('Actors', 1);
  actor.equips = [1, 1];
  const classEntry = createDefaultRmmvDatabaseEntry('Classes', 1);
  const skill = createDefaultRmmvDatabaseEntry('Skills', 1);
  skill.animationId = -1;
  skill.damage = { type: 0, elementId: 0, formula: '0', variance: 0, critical: false };
  const item = createDefaultRmmvDatabaseEntry('Items', 1);
  item.animationId = -1;
  item.damage = { type: 0, elementId: 0, formula: '0', variance: 0, critical: false };
  const weapon = createDefaultRmmvDatabaseEntry('Weapons', 1);
  weapon.etypeId = 1;
  const armor = createDefaultRmmvDatabaseEntry('Armors', 1);
  armor.etypeId = 2;
  const enemy = createDefaultRmmvDatabaseEntry('Enemies', 1);
  enemy.actions = [{ skillId: 1, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5 }];
  const troop = createDefaultRmmvDatabaseEntry('Troops', 1);
  troop.name = 'Source Troop';
  troop.members = [{ enemyId: 1, hidden: false, x: 408, y: 436 }];
  const state = createDefaultRmmvDatabaseEntry('States', 1);
  const commonEvent = createDefaultRmmvDatabaseEntry('CommonEvents', 1);
  const system = createDefaultRmmvDatabaseEntry('System');
  system.elements = ['', 'Normal'];
  system.skillTypes = ['', 'Magic'];
  system.weaponTypes = ['', 'Sword'];
  system.armorTypes = ['', 'Shield'];
  system.equipTypes = ['', 'Weapon', 'Shield'];
  system.switches = ['', 'Switch'];
  system.variables = ['', 'Variable'];
  system.partyMembers = [1];
  system.testBattlers = [{ actorId: 1, level: 1, equips: [1, 1] }];
  system.testTroopId = 1;
  system.startMapId = 1;
  system.editMapId = 1;
  system.magicSkills = [1];
  system.battleback1Name = 'SourceField';
  system.battleback2Name = 'SourceForest';

  writeJson(path.join(data, 'Actors.json'), [null, actor]);
  writeJson(path.join(data, 'Animations.json'), [null, createDefaultRmmvDatabaseEntry('Animations', 1)]);
  writeJson(path.join(data, 'Armors.json'), [null, armor]);
  writeJson(path.join(data, 'Classes.json'), [null, classEntry]);
  writeJson(path.join(data, 'CommonEvents.json'), [null, commonEvent]);
  writeJson(path.join(data, 'Enemies.json'), [null, enemy]);
  writeJson(path.join(data, 'Items.json'), [null, item]);
  writeJson(path.join(data, 'Skills.json'), [null, skill]);
  writeJson(path.join(data, 'States.json'), [null, state]);
  writeJson(path.join(data, 'System.json'), system);
  writeJson(path.join(data, 'Tilesets.json'), [null, createDefaultRmmvDatabaseEntry('Tilesets', 1)]);
  writeJson(path.join(data, 'Troops.json'), [null, troop]);
  writeJson(path.join(data, 'Weapons.json'), [null, weapon]);
  writeJson(path.join(data, 'MapInfos.json'), [null, { id: 1, name: 'Start', order: 1, parentId: 0, expanded: false, scrollX: 0, scrollY: 0 }]);
  writeJson(path.join(data, 'Map001.json'), { width: 10, height: 10, tilesetId: 1, encounterList: [], data: [], events: [null] });
  return project;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
