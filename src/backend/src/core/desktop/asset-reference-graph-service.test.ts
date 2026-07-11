import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import {
  buildStagedAwareAssetInventory,
  deleteAsset,
  getAssetDetail,
  importLocalAssetFile,
  renameAsset,
  replaceMissingAssetReference,
} from './asset-management-service.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import {
  buildAssetReferenceGraph,
  checkAssetDeleteSafety,
  checkAssetRenameSafety,
  findMissingAssetReferences,
  findUnusedProjectAssets,
} from './asset-reference-graph-service.ts';
import { getProjectStagingStatus, getProjectFileForRead } from './staging-service.ts';

describe('asset reference graph service', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-reference-graph-'));
    project = path.join(root, 'projects', 'Project');
    createRmmvFixture(project);
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('scans RMMV database, map events, audio commands and plugin configuration references', () => {
    const graph = buildAssetReferenceGraph(root, project);

    assertReference(graph.references, 'characters', 'Hero', 'www/data/Actors.json');
    assertReference(graph.references, 'characters', 'Hero', 'www/data/Map001.json');
    assertReference(graph.references, 'faces', 'HeroFace', 'www/data/Actors.json');
    assertReference(graph.references, 'faces', 'HeroFace', 'www/data/Map001.json');
    assertReference(graph.references, 'tilesets', 'World_A1', 'www/data/Tilesets.json');
    assertReference(graph.references, 'pictures', 'Portrait', 'www/data/Map001.json');
    assertReference(graph.references, 'se', 'Bell', 'www/data/Map001.json');
    assertReference(graph.references, 'plugins', 'QuestPlugin', 'www/js/plugins.js');

    assertAsset(graph.assets, 'characters', 'Hero', 'www/img/characters/Hero.png');
    assertAsset(graph.assets, 'faces', 'HeroFace', 'www/img/faces/HeroFace.png');
    assertAsset(graph.assets, 'tilesets', 'World_A1', 'www/img/tilesets/World_A1.png');
    assertAsset(graph.assets, 'plugins', 'QuestPlugin', 'www/js/plugins/QuestPlugin.js');

    assertMissing(graph.missingReferences, 'se', 'MissingBell');
    assertMissing(graph.missingReferences, 'plugins', 'MissingPlugin');
    assertUnused(graph.unusedAssets, 'pictures', 'Unused');
    assertUnused(graph.unusedAssets, 'plugins', 'UnusedPlugin');
  });

  test('exposes missing references, unused assets and mutation safety checks', () => withTestLanguage(() => {
    const missing = findMissingAssetReferences(root, project);
    const unused = findUnusedProjectAssets(root, project);
    assertMissing(missing, 'se', 'MissingBell');
    assertUnused(unused, 'pictures', 'Unused');

    const deleteHero = checkAssetDeleteSafety(root, project, {
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    });
    assert.equal(deleteHero.ok, false);
    assert.ok(deleteHero.references.length >= 2);

    const deleteUnused = checkAssetDeleteSafety(root, project, {
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    });
    assert.equal(deleteUnused.ok, true);

    const renameHero = checkAssetRenameSafety(root, project, {
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    }, 'Lead');
    assert.equal(renameHero.ok, true);
    assert.equal(renameHero.nextRelativePath, 'www/img/characters/Lead.png');
    assert.ok(renameHero.references.some((reference) => reference.file === 'www/data/Actors.json'));
  }));

  test('feeds asset-management detail and delete guard from the graph', () => {
    const detail = getAssetDetail(root, project, {
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    });
    assert.ok(detail.references.some((reference) => reference.file === 'www/data/Actors.json'));
    assert.ok(detail.references.some((reference) => reference.file === 'www/data/Map001.json'));

    assert.throws(() => withTestLanguage(() => deleteAsset(root, project, {
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    })), /引用/);
  });

  test('deleteAsset stages safe unused asset deletion without touching source file', () => {
    const sourcePath = path.join(project, 'www', 'img', 'pictures', 'Unused.png');
    assert.equal(fs.existsSync(sourcePath), true);

    const result = deleteAsset(root, project, {
      scope: 'project',
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    });

    assert.deepEqual(result, { deleted: true });
    assert.equal(fs.existsSync(sourcePath), true);
    const status = getProjectStagingStatus(root, project);
    const stagedEntry = status.files.find((entry) => entry.relativePath === 'www/img/pictures/Unused.png');
    assert.ok(stagedEntry);
    assert.equal(stagedEntry.delete, true);
    assert.equal(stagedEntry.dirty, true);
  });

  test('importLocalAssetFile copies a local file into the category directory through staging', () => {
    const localFile = path.join(root, 'desktop-local-assets', 'ImportedPortrait.png');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'imported portrait');

    const result = importLocalAssetFile(root, project, {
      category: 'pictures',
      sourceFile: localFile,
    });

    assert.equal(result.category, 'pictures');
    assert.equal(result.name, 'ImportedPortrait');
    assert.equal(result.relativePath, 'www/img/pictures/ImportedPortrait.png');
    assert.equal(result.staged, true);
    assert.equal(result.size, 'imported portrait'.length);
    assert.deepEqual(result.references, []);

    const sourceTarget = path.join(project, 'www', 'img', 'pictures', 'ImportedPortrait.png');
    assert.equal(fs.existsSync(sourceTarget), false);
    const stagedPath = getProjectFileForRead(root, project, 'www/img/pictures/ImportedPortrait.png');
    assert.equal(typeof stagedPath, 'string');
    assert.ok(stagedPath);
    assert.notEqual(stagedPath, sourceTarget);
    assert.equal(fs.readFileSync(stagedPath as string, 'utf8'), 'imported portrait');

    const status = getProjectStagingStatus(root, project);
    const stagedEntry = status.files.find((entry) => entry.relativePath === 'www/img/pictures/ImportedPortrait.png');
    assert.ok(stagedEntry);
    assert.equal(stagedEntry.sourceExisted, false);
    assert.equal(stagedEntry.dirty, true);

    const graph = buildAssetReferenceGraph(root, project);
    const imported = graph.assets.find((asset) => asset.relativePath === 'www/img/pictures/ImportedPortrait.png');
    assert.ok(imported);
    assert.equal(imported.category, 'pictures');
    assert.equal(imported.staged, true);
  });

  test('importLocalAssetFile rejects unsupported extensions for the selected category', () => {
    const localFile = path.join(root, 'desktop-local-assets', 'BadPortrait.txt');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'not an image');

    assert.throws(() => withTestLanguage(() => importLocalAssetFile(root, project, {
      category: 'pictures',
      sourceFile: localFile,
    })), /不支持/);
  });

  test('importLocalAssetFile blocks existing targets unless overwrite is explicit', () => {
    const localFile = path.join(root, 'desktop-local-assets', 'Replacement.png');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'replacement hero');
    const sourceTarget = path.join(project, 'www', 'img', 'characters', 'Hero.png');
    assert.equal(fs.readFileSync(sourceTarget, 'utf8'), 'hero');

    assert.throws(() => withTestLanguage(() => importLocalAssetFile(root, project, {
      category: 'characters',
      sourceFile: localFile,
      targetName: 'Hero',
    })), /覆盖导入/);

    const result = importLocalAssetFile(root, project, {
      category: 'characters',
      sourceFile: localFile,
      targetName: 'Hero',
      overwrite: true,
    });

    assert.equal(result.relativePath, 'www/img/characters/Hero.png');
    assert.equal(result.staged, true);
    assert.equal(fs.readFileSync(sourceTarget, 'utf8'), 'hero');
    const stagedPath = getProjectFileForRead(root, project, 'www/img/characters/Hero.png');
    assert.ok(stagedPath);
    assert.equal(fs.readFileSync(stagedPath as string, 'utf8'), 'replacement hero');
  });

  test('importLocalAssetFile rejects unsafe local import inputs', () => {
    const localFile = path.join(root, 'desktop-local-assets', 'Unsafe.png');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'unsafe');

    assert.throws(() => withTestLanguage(() => importLocalAssetFile(root, project, {
      category: 'pictures',
      sourceFile: 'Unsafe.png',
    })), /绝对路径/);
    assert.throws(() => withTestLanguage(() => importLocalAssetFile(root, project, {
      category: 'pictures',
      sourceFile: localFile,
      targetName: '../Unsafe',
    })), /资产名称无效/);
    assert.throws(() => withTestLanguage(() => importLocalAssetFile(root, project, {
      category: 'pictures',
      sourceFile: localFile,
      overwrite: 'yes' as never,
    })), /overwrite/);
  });

  test('replaceMissingAssetReference writes to staging and keeps source file unchanged', () => {
    const sourceMapPath = path.join(project, 'www', 'data', 'Map001.json');
    const mapBefore = readJson(sourceMapPath) as Record<string, unknown>;
    assert.equal(JSON.stringify(mapBefore), JSON.stringify(mapBefore), 'source data baseline');
    const beforeSource = JSON.stringify(mapBefore);

    const result = replaceMissingAssetReference(root, project, {
      category: 'se',
      missingName: 'MissingBell',
      replacementName: 'Bell',
    });

    assert.equal(result.category, 'se');
    assert.equal(result.missingName, 'MissingBell');
    assert.equal(result.replacementName, 'Bell');
    assert.equal(result.updatedReferences, 1);
    assert.deepEqual(result.updatedFiles, ['www/data/Map001.json']);

    const status = getProjectStagingStatus(root, project);
    assert.equal(status.staged, true);
    const stagedEntry = status.files.find((entry) => entry.relativePath === 'www/data/Map001.json');
    assert.ok(stagedEntry);
    assert.equal(stagedEntry.dirty, true);

    const stagedPath = getProjectFileForRead(root, project, 'www/data/Map001.json');
    assert.equal(typeof stagedPath, 'string');
    assert.ok(stagedPath);
    assert.notEqual(stagedPath, sourceMapPath);
    const stagedMap = readJson(stagedPath as string) as Record<string, unknown>;
    const afterStage = JSON.stringify(stagedMap);
    assert.notEqual(afterStage, beforeSource);
    assert.ok(afterStage.includes('"Bell"'));
    assert.ok(!afterStage.includes('"MissingBell"'));

    const sourceAgain = JSON.stringify(readJson(sourceMapPath) as Record<string, unknown>);
    assert.equal(sourceAgain, beforeSource);
    assert.ok(sourceAgain.includes('MissingBell'));
  });

  test('replaceMissingAssetReference can stage missing plugin configuration fixes', () => {
    const sourcePluginConfig = path.join(project, 'www', 'js', 'plugins.js');
    const beforeSource = fs.readFileSync(sourcePluginConfig, 'utf8');

    const result = replaceMissingAssetReference(root, project, {
      category: 'plugins',
      missingName: 'MissingPlugin',
      replacementName: 'QuestPlugin',
    });

    assert.equal(result.category, 'plugins');
    assert.equal(result.missingName, 'MissingPlugin');
    assert.equal(result.replacementName, 'QuestPlugin');
    assert.equal(result.updatedReferences, 1);
    assert.deepEqual(result.updatedFiles, ['www/js/plugins.js']);

    const stagedPath = getProjectFileForRead(root, project, 'www/js/plugins.js');
    assert.equal(typeof stagedPath, 'string');
    assert.ok(stagedPath);
    assert.notEqual(stagedPath, sourcePluginConfig);
    const stagedRaw = fs.readFileSync(stagedPath as string, 'utf8');
    assert.ok(stagedRaw.includes('QuestPlugin'));
    assert.ok(!stagedRaw.includes('MissingPlugin'));

    assert.equal(fs.readFileSync(sourcePluginConfig, 'utf8'), beforeSource);
    assert.ok(beforeSource.includes('MissingPlugin'));
  });

  test('renames references inside plugin parameters before staging the asset move', () => {
    const sourcePluginConfig = path.join(project, 'www', 'js', 'plugins.js');
    const sourceConfigBefore = fs.readFileSync(sourcePluginConfig, 'utf8');

    const result = renameAsset(root, project, {
      scope: 'project',
      category: 'pictures',
      relativePath: 'www/img/pictures/Portrait.png',
    }, 'PortraitAlt');

    assert.equal(result.name, 'PortraitAlt');
    assert.equal(result.references.length, 2);
    const stagedPluginConfig = fs.readFileSync(getProjectFileForRead(root, project, 'www/js/plugins.js')!, 'utf8');
    assert.match(stagedPluginConfig, /img\/pictures\/PortraitAlt/);
    assert.doesNotMatch(stagedPluginConfig, /img\/pictures\/Portrait"/);
    assert.match(
      JSON.stringify(readJson(getProjectFileForRead(root, project, 'www/data/Map001.json')!)),
      /PortraitAlt/,
    );
    assert.equal(fs.readFileSync(sourcePluginConfig, 'utf8'), sourceConfigBefore);
    assert.equal(getProjectFileForRead(root, project, 'www/img/pictures/Portrait.png'), null);
    assert.ok(getProjectFileForRead(root, project, 'www/img/pictures/PortraitAlt.png'));
  });

  test('builds project asset lists from the effective staged add, rename, and delete state', () => {
    const localFile = path.join(root, 'desktop-local-assets', 'NewPicture.png');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'new picture');
    importLocalAssetFile(root, project, { category: 'pictures', sourceFile: localFile });
    renameAsset(root, project, {
      scope: 'project',
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    }, 'RenamedUnused');
    deleteAsset(root, project, {
      scope: 'project',
      category: 'pictures',
      relativePath: 'www/img/pictures/RenamedUnused.png',
    });

    const inventory = buildStagedAwareAssetInventory(root, project);
    assert.equal(inventory.images.pictures.names.includes('NewPicture'), true);
    assert.equal(inventory.images.pictures.names.includes('Unused'), false);
    assert.equal(inventory.images.pictures.names.includes('RenamedUnused'), false);
    assert.equal(inventory.images.pictures.files.includes('NewPicture.png'), true);
  });
});

function createRmmvFixture(project: string): void {
  const data = path.join(project, 'www', 'data');
  fs.mkdirSync(data, { recursive: true });
  for (const dir of [
    'www/img/characters',
    'www/img/faces',
    'www/img/tilesets',
    'www/img/pictures',
    'www/audio/se',
    'www/js/plugins',
  ]) {
    fs.mkdirSync(path.join(project, ...dir.split('/')), { recursive: true });
  }

  writeJson(path.join(data, 'System.json'), {
    switches: [null],
    variables: [null],
    title1Name: '',
    title2Name: '',
    battleBgm: { name: '', volume: 90, pitch: 100, pan: 0 },
    victoryMe: { name: '', volume: 90, pitch: 100, pan: 0 },
    defeatMe: { name: '', volume: 90, pitch: 100, pan: 0 },
    sounds: [],
  });
  writeJson(path.join(data, 'Actors.json'), [null, {
    id: 1,
    name: 'Hero',
    characterName: 'Hero',
    faceName: 'HeroFace',
    battlerName: '',
  }]);
  writeJson(path.join(data, 'Classes.json'), [null, { id: 1, name: 'Hero' }]);
  writeJson(path.join(data, 'Skills.json'), [null, { id: 1, name: 'Slash', iconIndex: 0 }]);
  writeJson(path.join(data, 'Items.json'), [null, { id: 1, name: 'Potion', iconIndex: 0 }]);
  writeJson(path.join(data, 'Weapons.json'), [null, { id: 1, name: 'Sword', iconIndex: 0 }]);
  writeJson(path.join(data, 'Armors.json'), [null, { id: 1, name: 'Cloth', iconIndex: 0 }]);
  writeJson(path.join(data, 'Enemies.json'), [null, { id: 1, name: 'Bat', battlerName: '' }]);
  writeJson(path.join(data, 'Troops.json'), [null, { id: 1, name: 'Troop', pages: [] }]);
  writeJson(path.join(data, 'States.json'), [null, { id: 1, name: 'Poison', iconIndex: 0 }]);
  writeJson(path.join(data, 'Animations.json'), [null, { id: 1, name: 'Hit', animation1Name: '', animation2Name: '', timings: [] }]);
  writeJson(path.join(data, 'Tilesets.json'), [null, {
    id: 1,
    name: 'World',
    tilesetNames: ['World_A1', '', '', '', '', '', '', '', ''],
  }]);
  writeJson(path.join(data, 'CommonEvents.json'), [null, { id: 1, name: 'Common', list: [] }]);
  writeJson(path.join(data, 'MapInfos.json'), [null, { id: 1, name: 'Field', parentId: 0, order: 1 }]);
  writeJson(path.join(data, 'Map001.json'), {
    width: 10,
    height: 10,
    tilesetId: 1,
    parallaxName: '',
    battleback1Name: '',
    battleback2Name: '',
    data: [],
    events: [null, {
      id: 1,
      name: 'NPC',
      x: 1,
      y: 1,
      pages: [{
        image: { characterName: 'Hero', characterIndex: 0 },
        list: [
          { code: 101, parameters: ['HeroFace', 0, 0, 2] },
          { code: 231, parameters: [1, 'Portrait', 0, 0, 0, 100, 100, 255, 0] },
          { code: 250, parameters: [{ name: 'Bell', volume: 90, pitch: 100, pan: 0 }] },
          { code: 250, parameters: [{ name: 'MissingBell', volume: 90, pitch: 100, pan: 0 }] },
          { code: 0, parameters: [] },
        ],
      }],
    }],
  });

  fs.writeFileSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'), 'hero');
  fs.writeFileSync(path.join(project, 'www', 'img', 'faces', 'HeroFace.png'), 'face');
  fs.writeFileSync(path.join(project, 'www', 'img', 'tilesets', 'World_A1.png'), 'tileset');
  fs.writeFileSync(path.join(project, 'www', 'img', 'pictures', 'Portrait.png'), 'portrait');
  fs.writeFileSync(path.join(project, 'www', 'img', 'pictures', 'Unused.png'), 'unused');
  fs.writeFileSync(path.join(project, 'www', 'audio', 'se', 'Bell.ogg'), 'bell');
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins', 'QuestPlugin.js'), 'plugin');
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins', 'UnusedPlugin.js'), 'unused plugin');
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins.js'), 'var $plugins = ' + JSON.stringify([
    { name: 'QuestPlugin', status: true, description: '', parameters: { Portrait: 'img/pictures/Portrait' } },
    { name: 'MissingPlugin', status: true, description: '', parameters: {} },
  ]) + ';');
}

function assertReference(references: Array<{ category: string; name: string; file: string }>, category: string, name: string, file: string): void {
  assert.ok(references.some((reference) => reference.category === category && reference.name === name && reference.file === file));
}

function assertAsset(assets: Array<{ category: string; name: string; relativePath: string }>, category: string, name: string, relativePath: string): void {
  assert.ok(assets.some((asset) => asset.category === category && asset.name === name && asset.relativePath === relativePath));
}

function assertMissing(references: Array<{ category: string; name: string }>, category: string, name: string): void {
  assert.ok(references.some((reference) => reference.category === category && reference.name === name));
}

function assertUnused(assets: Array<{ category: string; name: string }>, category: string, name: string): void {
  assert.ok(assets.some((asset) => asset.category === category && asset.name === name));
}
