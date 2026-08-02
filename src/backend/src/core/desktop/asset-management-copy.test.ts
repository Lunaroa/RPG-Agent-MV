import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { createDefaultRmmvDatabaseEntry } from '../rmmv/database-schema.ts';
import { writeJson } from '../rmmv/json.ts';
import { RPG_MAKER_MZ_ENGINE_FILES } from '../rmmv/rpg-maker-engine.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import { copyProjectAssets } from './asset-management-service.ts';
import { invalidateProjectAssetReferenceGraphCache } from './asset-reference-graph-service.ts';
import { listProjectAssetCategory } from './project-asset-browser-service.ts';
import {
  getProjectFileForRead,
  registerDatabaseStagingOperation,
  stageProjectFilesAtomically,
} from './staging-service.ts';

describe('copyProjectAssets', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-asset-copy-'));
    project = path.join(root, 'projects', 'sample');
    createMvFixture(project);
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
    invalidateProjectAssetReferenceGraphCache();
  });

  afterEach(() => {
    invalidateProjectAssetReferenceGraphCache();
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('copies inside the same category with name_2 then name_3', () => {
    const first = copyProjectAssets(root, project, {
      targets: [{ scope: 'project', category: 'pictures', relativePath: 'www/img/pictures/Unused.png' }],
    });
    assert.equal(first.results.length, 1);
    assert.equal(first.results[0]!.status, 'copied');
    assert.equal(first.results[0]!.copiedName, 'Unused_2');
    assert.deepEqual(first.results[0]!.copiedRelativePaths, ['www/img/pictures/Unused_2.png']);
    assert.equal(first.results[0]!.detail?.name, 'Unused_2');

    const second = copyProjectAssets(root, project, {
      targets: [{ scope: 'project', category: 'pictures', name: 'Unused' }],
    });
    assert.equal(second.results[0]!.status, 'copied');
    assert.equal(second.results[0]!.copiedName, 'Unused_3');

    for (const name of ['Unused_2.png', 'Unused_3.png']) {
      const absolute = path.join(project, 'www', 'img', 'pictures', name);
      assert.equal(fs.existsSync(absolute), true, `${name} should exist`);
      assert.equal(fs.readFileSync(absolute, 'utf8'), 'unused');
    }
    const listing = listProjectAssetCategory(root, project, 'pictures');
    assert.equal(listing.entries.some((entry) => entry.name === 'Unused_2'), true);
    assert.equal(listing.entries.some((entry) => entry.name === 'Unused_3'), true);
  });

  test('copies every variant of a logical audio asset', () => {
    const batch = copyProjectAssets(root, project, {
      targets: [{ scope: 'project', category: 'bgm', name: 'Theme' }],
    });
    assert.equal(batch.results[0]!.status, 'copied');
    assert.equal(batch.results[0]!.copiedName, 'Theme_2');
    assert.deepEqual(
      [...(batch.results[0]!.copiedRelativePaths || [])].sort(),
      ['www/audio/bgm/Theme_2.m4a', 'www/audio/bgm/Theme_2.ogg'],
    );
    assert.equal(fs.readFileSync(path.join(project, 'www', 'audio', 'bgm', 'Theme_2.ogg'), 'utf8'), 'ogg');
    assert.equal(fs.readFileSync(path.join(project, 'www', 'audio', 'bgm', 'Theme_2.m4a'), 'utf8'), 'm4a');
    assert.equal(fs.existsSync(path.join(project, 'www', 'audio', 'bgm', 'Theme.ogg')), true);
  });

  test('copies encrypted variants', () => {
    fs.writeFileSync(path.join(project, 'www', 'img', 'characters', 'Locked.rpgmvp'), 'locked');
    invalidateProjectAssetReferenceGraphCache();

    const batch = copyProjectAssets(root, project, {
      targets: [{ scope: 'project', category: 'characters', name: 'Locked' }],
    });
    assert.equal(batch.results[0]!.status, 'copied');
    assert.deepEqual(batch.results[0]!.copiedRelativePaths, ['www/img/characters/Locked_2.rpgmvp']);
    assert.equal(
      fs.readFileSync(path.join(project, 'www', 'img', 'characters', 'Locked_2.rpgmvp'), 'utf8'),
      'locked',
    );
  });

  test('copies across categories into the target directory', () => {
    const batch = copyProjectAssets(root, project, {
      targets: [{ scope: 'project', category: 'pictures', name: 'Unused' }],
      targetCategory: 'characters',
    });
    assert.equal(batch.results[0]!.status, 'copied');
    assert.deepEqual(batch.results[0]!.copiedRelativePaths, ['www/img/characters/Unused_2.png']);
    assert.equal(
      fs.readFileSync(path.join(project, 'www', 'img', 'characters', 'Unused_2.png'), 'utf8'),
      'unused',
    );
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused.png')), true);
  });

  test('skips a name whose staged draft already occupies it, without touching the draft', () => {
    stageProjectFilesAtomically(root, project, [{
      relativePath: 'www/img/pictures/Unused_2.png',
      content: Buffer.from('draft', 'utf8'),
    }]);

    // The staging-aware inventory sees the draft as asset "Unused_2", so the
    // copy must land on Unused_3 and leave the unapplied draft alone.
    const batch = copyProjectAssets(root, project, {
      targets: [{ scope: 'project', category: 'pictures', name: 'Unused' }],
    });
    assert.equal(batch.results[0]!.status, 'copied');
    assert.equal(batch.results[0]!.copiedName, 'Unused_3');
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused_3.png')), true);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused_2.png')), false);
    const stagedDraft = getProjectFileForRead(root, project, 'www/img/pictures/Unused_2.png');
    assert.ok(stagedDraft);
    assert.equal(fs.readFileSync(stagedDraft, 'utf8'), 'draft');
  });

  test('refuses to copy when an operation reservation occupies a source variant', () => {
    registerDatabaseStagingOperation(root, project, {
      operationId: 'c'.repeat(32),
      planHash: 'd'.repeat(64),
      changes: [{ kind: 'update', group: 'Actors', id: 1 }],
      files: ['www/img/pictures/Unused.png'],
    });

    const batch = withTestLanguage(() => copyProjectAssets(root, project, {
      targets: [{ scope: 'project', category: 'pictures', name: 'Unused' }],
    }));
    assert.equal(batch.results[0]!.status, 'failed');
    assert.ok(batch.results[0]!.error);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused_2.png')), false);
  });

  test('marks every pending item failed when the atomic apply fails, without partial writes', () => {
    fs.writeFileSync(path.join(project, 'www', 'img', 'pictures', 'Busy.png'), 'busy');
    // Force the atomic apply to fail: the computed destination is an existing directory.
    fs.mkdirSync(path.join(project, 'www', 'img', 'pictures', 'Busy_2.png'), { recursive: true });
    invalidateProjectAssetReferenceGraphCache();

    const batch = copyProjectAssets(root, project, {
      targets: [
        { scope: 'project', category: 'pictures', name: 'Unused' },
        { scope: 'project', category: 'pictures', name: 'Busy' },
      ],
    });
    assert.equal(batch.results.length, 2);
    assert.equal(batch.results[0]!.status, 'failed');
    assert.equal(batch.results[1]!.status, 'failed');
    assert.ok(batch.results[0]!.error);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused_2.png')), false);
    // The blocker directory itself is untouched.
    assert.equal(fs.statSync(path.join(project, 'www', 'img', 'pictures', 'Busy_2.png')).isDirectory(), true);
  });

  test('copy lands under MZ img/faces without the www prefix', () => {
    const mzProject = path.join(root, 'projects', 'mz_sample');
    writeMzFixture(mzProject);

    const batch = copyProjectAssets(root, mzProject, {
      targets: [{ scope: 'project', category: 'faces', name: 'Actor1' }],
    });
    assert.equal(batch.results[0]!.status, 'copied');
    assert.deepEqual(batch.results[0]!.copiedRelativePaths, ['img/faces/Actor1_2.png']);
    assert.equal(fs.existsSync(path.join(mzProject, 'img', 'faces', 'Actor1_2.png')), true);
    assert.equal(fs.existsSync(path.join(mzProject, 'www', 'img', 'faces', 'Actor1_2.png')), false);

    const listing = listProjectAssetCategory(root, mzProject, 'faces');
    assert.equal(listing.entries.some((entry) => entry.name === 'Actor1_2'), true);
  });
});

function createMvFixture(projectRoot: string): void {
  const data = path.join(projectRoot, 'www', 'data');
  fs.mkdirSync(path.join(projectRoot, 'www', 'img', 'characters'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'www', 'img', 'pictures'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'www', 'audio', 'bgm'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'www', 'js', 'plugins'), { recursive: true });
  writeJson(path.join(data, 'System.json'), {
    ...createDefaultRmmvDatabaseEntry('System'),
    gameTitle: 'Sample',
    switches: [null],
    variables: [null],
  });
  writeJson(path.join(data, 'Actors.json'), [
    null,
    { ...createDefaultRmmvDatabaseEntry('Actors', 1), name: 'Hero', characterName: 'Hero' },
  ]);
  for (const group of [
    'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops',
    'States', 'Animations', 'Tilesets', 'CommonEvents', 'MapInfos',
  ]) {
    writeJson(path.join(data, `${group}.json`), [null]);
  }
  writeJson(path.join(data, 'MapInfos.json'), [null, { id: 1, name: 'Town', parentId: 0, order: 1 }]);
  writeJson(path.join(data, 'Map001.json'), { events: [null] });
  fs.writeFileSync(path.join(projectRoot, 'www', 'img', 'characters', 'Hero.png'), 'hero');
  fs.writeFileSync(path.join(projectRoot, 'www', 'img', 'pictures', 'Unused.png'), 'unused');
  fs.writeFileSync(path.join(projectRoot, 'www', 'audio', 'bgm', 'Theme.ogg'), 'ogg');
  fs.writeFileSync(path.join(projectRoot, 'www', 'audio', 'bgm', 'Theme.m4a'), 'm4a');
  fs.writeFileSync(path.join(projectRoot, 'www', 'js', 'plugins.js'), 'var $plugins = [];\n');
}

function writeMzFixture(projectRoot: string): void {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(projectRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === 'js/rmmz_core.js'
      ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
      : relative === 'package.json'
        ? '{"main":"index.html"}'
        : '';
    fs.writeFileSync(file, content, 'utf8');
  }
  fs.mkdirSync(path.join(projectRoot, 'img', 'faces'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'img', 'faces', 'Actor1.png'), 'face');
  writeJson(path.join(projectRoot, 'data', 'System.json'), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816 },
  });
  writeJson(path.join(projectRoot, 'data', 'MapInfos.json'), [null, { id: 1, name: 'Sample Map' }]);
  writeJson(path.join(projectRoot, 'data', 'Map001.json'), {
    width: 1,
    height: 1,
    tilesetId: 0,
    data: Array(6).fill(0),
    events: [null],
  });
}
