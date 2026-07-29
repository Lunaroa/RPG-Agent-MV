import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { patchProjectConfig } from './project-config-service.ts';
import {
  buildGlobalSearchDocuments,
  computeGlobalSearchRevision,
  DEFAULT_MATCH_PRECISION,
  getGlobalSearchIndexState,
  MATCH_PRECISION_THRESHOLDS,
  pickMatchPrecision,
  rebuildGlobalSearchIndex,
  searchGlobalProjectIndex,
} from './project-search-service.ts';

const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgagent-search-wf-'));
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgagent-search-prj-'));

await bootstrapDatabase(workflowRoot, { dbPath: path.join(workflowRoot, 'data', 'test.db'), importLegacyJson: false });

function writeJson(relative: string, value: unknown): void {
  const file = path.join(projectRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

writeJson('data/MapInfos.json', [null, { id: 1, name: 'Intro Field', parentId: 0, order: 1 }]);
writeJson('data/Map001.json', {
  displayName: 'Intro Field North',
  note: '<region:tutorial>',
  events: [null, {
    id: 1,
    name: 'Greeter',
    note: 'quest-hint',
    pages: [{ list: [{ code: 401, parameters: ['Welcome to the demo village'] }] }],
  }],
});
writeJson('data/CommonEvents.json', [null, {
  id: 1,
  name: 'Opening',
  list: [{ code: 401, parameters: ['Common greeting line'] }],
}]);
writeJson('data/Items.json', [null, {
  id: 1, name: 'Potion', description: 'Restores HP', note: '<heal:50>',
}]);
writeJson('data/System.json', {
  switches: [null, 'Boss Defeated'],
  variables: [null, 'Gold Count'],
});
fs.mkdirSync(path.join(projectRoot, 'js', 'plugins'), { recursive: true });
fs.writeFileSync(
  path.join(projectRoot, 'js', 'plugins', 'MyPlugin.js'),
  '/*:\n * @plugindesc Adds fancy stuff.\n * @help Type FANCY in game.\n */\n',
  'utf8',
);
fs.writeFileSync(
  path.join(projectRoot, 'js', 'plugins.js'),
  'var $plugins =\n[\n{"name":"MyPlugin","status":true,"description":"Fancy plugin","parameters":{"Speed":"42"}}\n];\n',
  'utf8',
);
fs.mkdirSync(path.join(projectRoot, 'img', 'pictures'), { recursive: true });
fs.writeFileSync(path.join(projectRoot, 'img', 'pictures', 'hero.png'), '');

after(() => {
  closeDatabase();
  fs.rmSync(workflowRoot, { recursive: true, force: true });
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('project global search index', () => {
  test('builds documents across all six categories', () => {
    const documents = buildGlobalSearchDocuments(workflowRoot, projectRoot);
    const byCategory = new Map<string, number>();
    for (const document of documents) {
      byCategory.set(document.category, (byCategory.get(document.category) || 0) + 1);
    }
    for (const category of ['file', 'map', 'event', 'database', 'plugin', 'pluginParam']) {
      assert.ok((byCategory.get(category) || 0) > 0, `expected ${category} documents`);
    }
    const eventDoc = documents.find((document) => document.id === 'event:1:1');
    assert.ok(eventDoc, 'map event document exists');
    assert.match(eventDoc!.text, /demo village/);
    assert.match(eventDoc!.text, /quest-hint/);
    const mapDoc = documents.find((document) => document.id === 'map:1');
    assert.match(mapDoc!.text, /region:tutorial/);
    const switchDoc = documents.find((document) => document.id === 'database:Switches:1');
    assert.equal(switchDoc!.title, 'Boss Defeated');
    const fileDoc = documents.find((document) => document.category === 'file');
    assert.equal(fileDoc!.title, 'hero.png');
    assert.equal(fileDoc!.assetCategoryId, 'pictures');
  });

  test('search finds database rows and persists the index in .luna_rpg', async () => {
    const result = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'Potion');
    assert.ok(result.hits.some((hit) => hit.document.id === 'database:Items:1'));
    assert.ok(result.tookMs >= 0);
    assert.ok(result.indexDocCount > 0);
    assert.ok(fs.existsSync(path.join(projectRoot, '.luna_rpg', 'search-index.json')));
    assert.equal(getGlobalSearchIndexState(projectRoot).status, 'ready');
  });

  test('category filter limits hits to the requested categories', async () => {
    const result = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'MyPlugin', {
      categories: ['pluginParam'],
    });
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.every((hit) => hit.document.category === 'pluginParam'));
  });

  test('exact mode does case-insensitive substring matching', async () => {
    const result = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'fancy', { exact: true });
    assert.ok(result.hits.some((hit) => hit.document.category === 'plugin'));
    const miss = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'zzz-not-there', { exact: true });
    assert.equal(miss.hits.length, 0);
    assert.equal(miss.total, 0);
  });

  test('maxResults caps hits while total reports all matches', async () => {
    const result = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'e', {
      exact: true,
      maxResults: 1,
    });
    assert.equal(result.hits.length, 1);
    assert.ok(result.total > 1);
  });

  test('extra configured folders join the file index', async () => {
    fs.mkdirSync(path.join(projectRoot, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'notes', 'todo-list.txt'), 'draft', 'utf8');
    patchProjectConfig(projectRoot, { search: { extraFolders: ['notes'] } });
    const state = await rebuildGlobalSearchIndex(workflowRoot, projectRoot);
    assert.equal(state.status, 'ready');
    const result = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'todo-list', { exact: true });
    assert.ok(result.hits.some((hit) => hit.document.relativePath === 'notes/todo-list.txt'));
  });

  test('absolute extra folders index files outside the project', async () => {
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgagent-search-ext-'));
    try {
      fs.writeFileSync(path.join(externalRoot, 'external-notes.md'), 'design', 'utf8');
      const absolute = externalRoot.replace(/\\/g, '/');
      patchProjectConfig(projectRoot, { search: { extraFolders: [absolute] } });
      const state = await rebuildGlobalSearchIndex(workflowRoot, projectRoot);
      assert.equal(state.status, 'ready');
      const result = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'external-notes', { exact: true });
      assert.ok(
        result.hits.some((hit) => hit.document.title === 'external-notes.md'),
        'expected the external file to join the index',
      );
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  test('revision changes when project data changes', () => {
    const before = computeGlobalSearchRevision(projectRoot);
    writeJson('data/Items.json', [null, {
      id: 1, name: 'Hi-Potion', description: 'Restores more HP', note: '',
    }]);
    const after_ = computeGlobalSearchRevision(projectRoot);
    assert.notEqual(before, after_);
  });
});

describe('match precision mapping', () => {
  test('thresholds tighten from loose to strict', () => {
    assert.equal(MATCH_PRECISION_THRESHOLDS.loose, 0.35);
    assert.equal(MATCH_PRECISION_THRESHOLDS.medium, 0.22);
    assert.equal(MATCH_PRECISION_THRESHOLDS.strict, 0.12);
    assert.ok(MATCH_PRECISION_THRESHOLDS.loose > MATCH_PRECISION_THRESHOLDS.medium);
    assert.ok(MATCH_PRECISION_THRESHOLDS.medium > MATCH_PRECISION_THRESHOLDS.strict);
    assert.equal(DEFAULT_MATCH_PRECISION, 'loose');
  });

  test('pickMatchPrecision prefers explicit request, then config, then the loose default', () => {
    assert.equal(pickMatchPrecision('strict', 'medium'), 'strict');
    assert.equal(pickMatchPrecision(undefined, 'medium'), 'medium');
    assert.equal(pickMatchPrecision(undefined, undefined), DEFAULT_MATCH_PRECISION);
    // Unknown values are ignored at each level so a bad config never breaks search.
    assert.equal(pickMatchPrecision('bogus' as never, 'strict'), 'strict');
    assert.equal(pickMatchPrecision(undefined, 'nope' as never), DEFAULT_MATCH_PRECISION);
  });

  test('strict precision never returns more fuzzy hits than loose for a typo query', async () => {
    const loose = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'Potiom', { matchPrecision: 'loose' });
    const strict = await searchGlobalProjectIndex(workflowRoot, projectRoot, 'Potiom', { matchPrecision: 'strict' });
    assert.ok(strict.hits.length <= loose.hits.length);
  });
});
