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
  renameAsset,
} from './asset-management-service.ts';
import {
  buildAssetReferenceGraph,
  getProjectAssetReferenceGraph,
  invalidateProjectAssetReferenceGraphCache,
  putProjectAssetReferenceGraph,
} from './asset-reference-graph-service.ts';
import { listProjectAssetCategory } from './project-asset-browser-service.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  registerDatabaseStagingOperation,
  stageProjectFilesAtomically,
} from './staging-service.ts';

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

  test('rename commits only involved files and leaves unrelated staging drafts untouched', () => {
    const unrelatedRelative = 'www/data/Map002.json';
    const unrelatedSource = path.join(project, 'www', 'data', 'Map002.json');
    const unrelatedBefore = fs.readFileSync(unrelatedSource, 'utf8');
    stageProjectFilesAtomically(root, project, [{
      relativePath: unrelatedRelative,
      content: Buffer.from('{"note":"unreviewed draft"}', 'utf8'),
    }]);

    renameAsset(root, project, {
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    }, 'Lead');

    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Lead.png')), true);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), false);
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName, 'Lead');
    assert.equal(fs.readFileSync(unrelatedSource, 'utf8'), unrelatedBefore);
    const stagedUnrelated = getProjectFileForRead(root, project, unrelatedRelative);
    assert.ok(stagedUnrelated);
    assert.equal(fs.readFileSync(stagedUnrelated, 'utf8'), '{"note":"unreviewed draft"}');
    const status = getProjectStagingStatus(root, project);
    assert.equal(status.files.some((entry) => entry.relativePath === unrelatedRelative), true);
    assert.equal(status.files.some((entry) => entry.relativePath.includes('Hero') || entry.relativePath.includes('Lead')), false);
  });

  test('rename fail-fast when a target reference file already has an unapplied draft', () => {
    const actors = readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[];
    stageProjectFilesAtomically(root, project, [{
      relativePath: 'www/data/Actors.json',
      content: Buffer.from(JSON.stringify([
        null,
        { ...actors[1], name: 'Hero Draft Note', characterName: 'Hero' },
      ], null, 2), 'utf8'),
    }]);
    const heroBefore = fs.readFileSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'), 'utf8');
    const actorsBefore = (readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName;

    assert.throws(() => withTestLanguage(() => renameAsset(root, project, {
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    }, 'Lead')), /未应用的暂存草稿/);

    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), true);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Lead.png')), false);
    assert.equal(fs.readFileSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'), 'utf8'), heroBefore);
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName, actorsBefore);
  });

  test('rename fail-fast when a reference file is only reserved by a database staging operation', () => {
    const operationId = 'a'.repeat(32);
    registerDatabaseStagingOperation(root, project, {
      operationId,
      planHash: 'b'.repeat(64),
      changes: [{ kind: 'update', group: 'Actors', id: 1 }],
      files: ['www/data/Actors.json'],
    });
    const heroBefore = fs.readFileSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'), 'utf8');

    assert.throws(() => withTestLanguage(() => renameAsset(root, project, {
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Hero.png',
    }, 'Lead')), /预约|reserved/i);

    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Hero.png')), true);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'characters', 'Lead.png')), false);
    assert.equal(fs.readFileSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'), 'utf8'), heroBefore);
    assert.equal((readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[])[1].characterName, 'Hero');
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

  test('delete fail-fast when the target already has an unapplied staging draft', async () => {
    stageProjectFilesAtomically(root, project, [{
      relativePath: 'www/img/pictures/Unused.png',
      delete: true,
    }]);
    const batch = await withTestLanguage(() => deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    }], {}, {
      trashItem: async (absolutePath) => {
        fs.unlinkSync(absolutePath);
      },
    }));
    assert.equal(batch.results[0]?.status, 'failed');
    assert.match(batch.results[0]?.error || '', /未应用的暂存草稿/);
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused.png')), true);
  });

  test('delete staging conflict comparison is case-insensitive on Windows identity rules', {
    skip: process.platform !== 'win32' ? 'relativePathIdentity is case-sensitive off Windows' : false,
  }, async () => {
    stageProjectFilesAtomically(root, project, [{
      relativePath: 'www/img/pictures/Unused.png',
      delete: true,
    }]);
    const batch = await withTestLanguage(() => deleteProjectAssets(root, project, [{
      scope: 'project',
      category: 'pictures',
      relativePath: 'WWW/IMG/PICTURES/Unused.png',
    }], {}, {
      trashItem: async (absolutePath) => {
        fs.unlinkSync(absolutePath);
      },
    }));
    assert.equal(batch.results[0]?.status, 'failed');
    assert.match(batch.results[0]?.error || '', /未应用的暂存草稿/);
  });

  test('delete race after trash invalidates graph and listing caches before throwing', async () => {
    const stagingBefore = getProjectStagingStatus(root, project);
    const listingBefore = listProjectAssetCategory(root, project, 'pictures', undefined, {
      stagingStatus: stagingBefore,
    });
    assert.equal(listingBefore.entries.some((entry) => entry.name === 'Unused'), true);

    let builds = 0;
    const staleGraph = getProjectAssetReferenceGraph(root, project, {
      buildGraph: (workflowRoot, projectPath) => {
        builds += 1;
        return buildAssetReferenceGraph(workflowRoot, projectPath);
      },
    });
    assert.equal(builds, 1);
    assert.equal(
      staleGraph.assets.some((asset) => asset.category === 'pictures' && asset.name === 'Unused'),
      true,
    );

    await assert.rejects(
      () => withTestLanguage(() => deleteProjectAssets(root, project, [{
        scope: 'project',
        category: 'pictures',
        relativePath: 'www/img/pictures/Unused.png',
      }], {}, {
        trashItem: async (absolutePath) => {
          fs.unlinkSync(absolutePath);
          stageProjectFilesAtomically(root, project, [{
            relativePath: 'www/img/pictures/Unused.png',
            content: Buffer.from('raced draft after trash', 'utf8'),
          }]);
          putProjectAssetReferenceGraph(project, staleGraph);
        },
      })),
      /删除过程中工程暂存状态发生变化|staging changed while deleting/i,
    );

    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Unused.png')), false);

    getProjectAssetReferenceGraph(root, project, {
      buildGraph: (workflowRoot, projectPath) => {
        builds += 1;
        return buildAssetReferenceGraph(workflowRoot, projectPath);
      },
    });
    assert.equal(builds, 2);

    const listingAfter = listProjectAssetCategory(root, project, 'pictures', undefined, {
      stagingStatus: stagingBefore,
    });
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
