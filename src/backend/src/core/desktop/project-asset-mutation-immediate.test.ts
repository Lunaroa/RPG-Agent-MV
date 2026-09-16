import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { createDefaultRmmvDatabaseEntry } from '../rmmv/database-schema.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import {
  deleteProjectAssets,
  importLocalAssetFile,
  importLocalAssetFiles,
  renameAsset,
} from './asset-management-service.ts';
import {
  buildAssetReferenceGraph,
  getProjectAssetReferenceGraph,
  invalidateProjectAssetReferenceGraphCache,
} from './asset-reference-graph-service.ts';
import { listProjectAssetCategory } from './project-asset-browser-service.ts';
import { writeProjectFilesAtomically } from './project-file-service.ts';

describe('project asset immediate mutations', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-asset-immediate-'));
    project = path.join(root, 'projects', 'sample');
    createFixture(project);
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
    invalidateProjectAssetReferenceGraphCache();
  });

  afterEach(() => {
    invalidateProjectAssetReferenceGraphCache();
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('rename commits only involved files and leaves unrelated directly saved files untouched', () => {
    const unrelatedRelative = 'www/data/Map002.json';
    const unrelatedSource = path.join(project, 'www', 'data', 'Map002.json');
    writeProjectFilesAtomically(root, project, [{
      relativePath: unrelatedRelative,
      content: Buffer.from('{"note":"saved change"}', 'utf8'),
    }]);
    const unrelatedBefore = fs.readFileSync(unrelatedSource, 'utf8');

    const renamed = renameAsset(root, project, {
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    }, 'Lead');

    assert.ok(renamed.changeManifest?.upsertRelativePaths.includes('www/img/characters/Lead.png'));
    assert.ok(renamed.changeManifest?.upsertRelativePaths.includes('www/data/Actors.json'));
    assert.ok(renamed.changeManifest?.deleteRelativePaths.includes('www/img/characters/Hero.png'));

    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Lead.png')), true);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), false);
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName, 'Lead');
    assert.equal(fs.readFileSync(unrelatedSource, 'utf8'), unrelatedBefore);
  });

  test('import commits only involved files and leaves unrelated directly saved files untouched', () => {
    const unrelatedRelative = 'www/data/Map002.json';
    const unrelatedSource = path.join(project, 'www', 'data', 'Map002.json');
    writeProjectFilesAtomically(root, project, [{
      relativePath: unrelatedRelative,
      content: Buffer.from('{"note":"saved change"}', 'utf8'),
    }]);
    const unrelatedBefore = fs.readFileSync(unrelatedSource, 'utf8');

    const localFile = path.join(root, 'desktop-local-assets', 'FreshPortrait.png');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'fresh portrait');

    const imported = importLocalAssetFile(root, project, {
      category: 'pictures',
      sourceFile: localFile,
    });

    assert.equal(imported.relativePath, 'www/img/pictures/FreshPortrait.png');
    assert.equal(fs.readFileSync(path.join(project, 'www', 'img', 'pictures', 'FreshPortrait.png'), 'utf8'), 'fresh portrait');
    assert.equal(fs.readFileSync(unrelatedSource, 'utf8'), unrelatedBefore);
  });

  test('importLocalAssetFiles returns per-item results without throwing on mixed failures', () => {
    const good = path.join(root, 'desktop-local-assets', 'Good.png');
    const bad = path.join(root, 'desktop-local-assets', 'Bad.txt');
    const clash = path.join(root, 'desktop-local-assets', 'Unused.png');
    fs.mkdirSync(path.dirname(good), { recursive: true });
    fs.writeFileSync(good, 'good');
    fs.writeFileSync(bad, 'bad');
    fs.writeFileSync(clash, 'clash');

    const batch = withTestLanguage(() => importLocalAssetFiles(root, project, {
      category: 'pictures',
      files: [
        { sourceFile: good },
        { sourceFile: bad },
        { sourceFile: clash },
      ],
    }));

    assert.equal(batch.results.length, 3);
    assert.equal(batch.results[0]?.status, 'imported');
    assert.equal(batch.results[1]?.status, 'failed');
    assert.match(batch.results[1]?.error || '', /不支持|\.txt/i);
    assert.equal(batch.results[2]?.status, 'skipped');
    assert.match(batch.results[2]?.error || '', /明确选择覆盖|choose replace explicitly/i);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Good.png')), true);
    assert.equal(fs.readFileSync(path.join(project, 'www', 'img', 'pictures', 'Unused.png'), 'utf8'), 'unused');
    assert.deepEqual(batch.changeManifest?.upsertRelativePaths, ['www/img/pictures/Good.png']);
    assert.deepEqual(batch.changeManifest?.deleteRelativePaths, []);
  });

  test('delete moves logical audio variants through trash port together', async () => {
    const trashed: string[] = [];
    const ogg = path.join(project, 'www', 'audio', 'bgm', 'Theme.ogg');
    const m4a = path.join(project, 'www', 'audio', 'bgm', 'Theme.m4a');
    assert.equal(fs.existsSync(ogg), true);
    assert.equal(fs.existsSync(m4a), true);

    const batch = await deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'bgm',
      relativePath: 'www/audio/bgm/Theme.ogg',
    }], { force: false }, {
      trashItem: async (absolutePath) => {
        trashed.push(absolutePath);
        fs.unlinkSync(absolutePath);
      },
    });

    assert.equal(batch.results[0]?.status, 'deleted');
    assert.deepEqual(batch.changeManifest?.deleteRelativePaths, ['www/audio/bgm/Theme.m4a', 'www/audio/bgm/Theme.ogg']);
    assert.deepEqual(trashed.sort(), [m4a, ogg].sort());
    assert.equal(fs.existsSync(ogg), false);
    assert.equal(fs.existsSync(m4a), false);
  });

  test('delete force allows referenced assets while default blocks them', async () => {
    const blocked = await withTestLanguage(() => deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    }], { force: false }, {
      trashItem: async (absolutePath) => {
        fs.unlinkSync(absolutePath);
      },
    }));
    assert.equal(blocked.results[0]?.status, 'blocked');
    assert.ok((blocked.results[0]?.references.length || 0) >= 1);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), true);

    const forced = await withTestLanguage(() => deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    }], { force: true }, {
      trashItem: async (absolutePath) => {
        fs.unlinkSync(absolutePath);
      },
    }));
    assert.equal(forced.results[0]?.status, 'deleted');
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), false);
  });

  test('delete reports partial failure in structured results without throwing', async () => {
    const batch = await withTestLanguage(() => deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'bgm',
      relativePath: 'www/audio/bgm/Theme.ogg',
    }], {}, {
      trashItem: async (absolutePath) => {
        if (absolutePath.endsWith('.m4a')) {
          throw new Error('recycle bin locked');
        }
        fs.unlinkSync(absolutePath);
      },
    }));

    assert.equal(batch.results.length, 1);
    assert.equal(batch.results[0]?.status, 'failed');
    assert.deepEqual(batch.results[0]?.deletedRelativePaths, ['www/audio/bgm/Theme.ogg']);
    assert.match(batch.results[0]?.error || '', /部分失败|partially failed/i);
    assert.match(batch.results[0]?.error || '', /Theme\.ogg/);
    assert.match(batch.results[0]?.error || '', /Theme\.m4a|recycle bin locked/);
    assert.equal(fs.existsSync(path.join(project, 'www', 'audio', 'bgm', 'Theme.ogg')), false);
    assert.equal(fs.existsSync(path.join(project, 'www', 'audio', 'bgm', 'Theme.m4a')), true);
  });

  test('trash port rejection never falls back to direct unlink', async () => {
    const unused = path.join(project, 'www', 'img', 'pictures', 'Unused.png');
    const batch = await withTestLanguage(() => deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    }], {}, {
      trashItem: async () => {
        throw new Error('trash unavailable');
      },
    }));
    assert.equal(batch.results[0]?.status, 'failed');
    assert.match(batch.results[0]?.error || '', /回收站|trash/i);
    assert.equal(fs.existsSync(unused), true);
  });

  test('delete updates graph and listing caches after moving an asset to trash', async () => {
    const listingBefore = listProjectAssetCategory(root, project, 'pictures');
    assert.equal(listingBefore.entries.some((entry) => entry.name === 'Unused'), true);

    const staleGraph = getProjectAssetReferenceGraph(root, project);
    assert.equal(
      staleGraph.assets.some((asset) => asset.category === 'pictures' && asset.name === 'Unused'),
      true,
    );

    const batch = await deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    }], {}, {
      trashItem: async (absolutePath) => {
        fs.unlinkSync(absolutePath);
      },
    });

    assert.equal(batch.results[0]?.status, 'deleted');
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused.png')), false);

    const graphAfter = getProjectAssetReferenceGraph(root, project, {
      buildGraph: buildAssetReferenceGraph,
    });
    assert.equal(
      graphAfter.assets.some((asset) => asset.category === 'pictures' && asset.name === 'Unused'),
      false,
    );

    const listingAfter = listProjectAssetCategory(root, project, 'pictures');
    assert.equal(listingAfter.entries.some((entry) => entry.name === 'Unused'), false);
  });
});

function createFixture(projectRoot: string): void {
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
  writeJson(path.join(data, 'MapInfos.json'), [null, { id: 1, name: 'Town', parentId: 0, order: 1 }, { id: 2, name: 'Cave', parentId: 0, order: 2 }]);
  writeJson(path.join(data, 'Map001.json'), {
    events: [null],
  });
  writeJson(path.join(data, 'Map002.json'), {
    events: [null],
  });
  fs.writeFileSync(path.join(projectRoot, 'www', 'img', 'characters', 'Hero.png'), 'hero');
  fs.writeFileSync(path.join(projectRoot, 'www', 'img', 'pictures', 'Unused.png'), 'unused');
  fs.writeFileSync(path.join(projectRoot, 'www', 'audio', 'bgm', 'Theme.ogg'), 'ogg');
  fs.writeFileSync(path.join(projectRoot, 'www', 'audio', 'bgm', 'Theme.m4a'), 'm4a');
  fs.writeFileSync(path.join(projectRoot, 'www', 'js', 'plugins.js'), 'var $plugins = [];\n');
}
