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
  buildAssetReferenceGraph,
  getProjectAssetReferenceGraph,
  invalidateProjectAssetReferenceGraphCache,
} from './asset-reference-graph-service.ts';
import { checkProjectAssetDeleteSafetyBatch } from './asset-management-service.ts';
import {
  applyProjectAssetReferenceGraphDelete,
  applyProjectAssetReferenceGraphRename,
} from './project-asset-reference-graph-cache.ts';
import { invalidateProjectAssetBrowserCache } from './project-asset-browser-service.ts';
import { stageProjectFilesAtomically, writeStagedProjectJson } from './staging-service.ts';

describe('project asset reference graph cache', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-asset-graph-cache-'));
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

  test('get hits cache after the first build', () => {
    const first = getProjectAssetReferenceGraph(root, project);
    const second = getProjectAssetReferenceGraph(root, project);
    assert.equal(first, second);
  });

  test('batch delete safety builds the graph only once on the production path', () => {
    let builds = 0;
    const targets = Array.from({ length: 10 }, () => ({
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    }));
    const results = checkProjectAssetDeleteSafetyBatch(root, project, targets, {
      buildGraph: (workflowRoot, projectPath) => {
        builds += 1;
        return buildAssetReferenceGraph(workflowRoot, projectPath);
      },
    });
    assert.equal(results.length, 10);
    assert.equal(builds, 1);
  });

  test('staging a new reference invalidates the cache so delete safety sees it', () => withTestLanguage(() => {
    const before = checkProjectAssetDeleteSafetyBatch(root, project, [{
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    }]);
    assert.equal(before[0]?.ok, true);

    const map = readJson(path.join(project, 'www', 'data', 'Map001.json')) as Record<string, unknown>;
    writeStagedProjectJson(root, project, 'www/data/Map001.json', {
      ...map,
      events: [
        null,
        {
          id: 1,
          name: 'Sign',
          pages: [{
            list: [
              { code: 231, indent: 0, parameters: [1, 'Unused', 0, 0, 0, 0, 100, 100, 255, 0] },
              { code: 0, indent: 0, parameters: [] },
            ],
          }],
        },
      ],
    });

    const after = checkProjectAssetDeleteSafetyBatch(root, project, [{
      category: 'pictures',
      relativePath: 'www/img/pictures/Unused.png',
    }]);
    assert.equal(after[0]?.ok, false);
    assert.ok((after[0]?.references.length || 0) >= 1);
  }));

  test('incremental delete of a referenced asset matches a full rebuild including missing refs', () => {
    const graph = buildAssetReferenceGraph(root, project);
    assert.ok(graph.references.some((reference) => reference.category === 'characters' && reference.name === 'Hero'));

    const updated = applyProjectAssetReferenceGraphDelete(graph, 'characters', 'Hero');
    assert.ok(updated);

    fs.unlinkSync(path.join(project, 'www', 'img', 'characters', 'Hero.png'));
    invalidateProjectAssetReferenceGraphCache(project);
    const rebuilt = buildAssetReferenceGraph(root, project);

    assert.deepEqual(updated.summary, rebuilt.summary);
    assert.deepEqual(
      normalizeMissing(updated.missingReferences),
      normalizeMissing(rebuilt.missingReferences),
    );
    assert.deepEqual(
      updated.unusedAssets.map((asset) => `${asset.category}:${asset.name}`).sort(),
      rebuilt.unusedAssets.map((asset) => `${asset.category}:${asset.name}`).sort(),
    );
  });

  test('incremental rename matches a full rebuild including missing and unused sets', () => {
    const graph = buildAssetReferenceGraph(root, project);
    const refs = graph.references.filter((reference) => reference.category === 'characters' && reference.name === 'Hero');
    const updated = applyProjectAssetReferenceGraphRename(graph, 'characters', 'Hero', 'Lead', refs);
    assert.ok(updated);

    fs.renameSync(
      path.join(project, 'www', 'img', 'characters', 'Hero.png'),
      path.join(project, 'www', 'img', 'characters', 'Lead.png'),
    );
    const actors = readJson(path.join(project, 'www', 'data', 'Actors.json')) as any[];
    actors[1].characterName = 'Lead';
    writeJson(path.join(project, 'www', 'data', 'Actors.json'), actors);
    invalidateProjectAssetReferenceGraphCache(project);
    const rebuilt = buildAssetReferenceGraph(root, project);

    assert.deepEqual(updated.summary, rebuilt.summary);
    assert.deepEqual(
      normalizeMissing(updated.missingReferences),
      normalizeMissing(rebuilt.missingReferences),
    );
    assert.deepEqual(
      updated.unusedAssets.map((asset) => `${asset.category}:${asset.name}`).sort(),
      rebuilt.unusedAssets.map((asset) => `${asset.category}:${asset.name}`).sort(),
    );
    assert.ok(updated.references.some((reference) => reference.category === 'characters' && reference.name === 'Lead'));
  });

  test('incremental rename returns null when reference counts diverge', () => {
    const graph = buildAssetReferenceGraph(root, project);
    const refs = graph.references.filter((reference) => reference.category === 'characters' && reference.name === 'Hero');
    const broken = applyProjectAssetReferenceGraphRename(graph, 'characters', 'Hero', 'Lead', refs.slice(0, 0));
    assert.equal(broken, null);
  });

  test('browser cache invalidation also clears the reference graph cache', () => {
    let builds = 0;
    getProjectAssetReferenceGraph(root, project, {
      buildGraph: (workflowRoot, projectPath) => {
        builds += 1;
        return buildAssetReferenceGraph(workflowRoot, projectPath);
      },
    });
    invalidateProjectAssetBrowserCache(project);
    getProjectAssetReferenceGraph(root, project, {
      buildGraph: (workflowRoot, projectPath) => {
        builds += 1;
        return buildAssetReferenceGraph(workflowRoot, projectPath);
      },
    });
    assert.equal(builds, 2);
  });

  test('atomic staging writes invalidate the graph cache', () => {
    const first = getProjectAssetReferenceGraph(root, project);
    stageProjectFilesAtomically(root, project, [{
      relativePath: 'www/data/Map001.json',
      content: Buffer.from(JSON.stringify({ events: [null] }), 'utf8'),
    }]);
    const second = getProjectAssetReferenceGraph(root, project);
    assert.notEqual(first, second);
  });
});

function normalizeMissing(entries: Array<{ category: string; name: string; file: string; path: string; expectedRelativePaths: string[] }>) {
  return entries
    .map((entry) => ({
      category: entry.category,
      name: entry.name,
      file: entry.file,
      path: entry.path,
      expectedRelativePaths: [...entry.expectedRelativePaths].sort(),
    }))
    .sort((left, right) => (
      left.category.localeCompare(right.category)
      || left.name.localeCompare(right.name)
      || left.file.localeCompare(right.file)
      || left.path.localeCompare(right.path)
    ));
}

function createFixture(projectRoot: string): void {
  const data = path.join(projectRoot, 'www', 'data');
  fs.mkdirSync(path.join(projectRoot, 'www', 'img', 'characters'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'www', 'img', 'pictures'), { recursive: true });
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
  fs.writeFileSync(path.join(projectRoot, 'www', 'js', 'plugins.js'), 'var $plugins = [];\n');
}
