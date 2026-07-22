import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { createDefaultRmmvDatabaseEntry } from '../rmmv/database-schema.ts';
import { writeJson } from '../rmmv/json.ts';
import {
  buildProjectManagementAssetInventory,
  checkProjectAssetDeleteSafety,
} from './asset-management-service.ts';
import { buildProjectManagementScan } from './project-management-service.ts';
import { stageProjectFilesAtomically } from './staging-service.ts';

describe('project management resilient reads', { concurrency: false }, () => {
  let workflowRoot: string;
  let project: string;

  beforeEach(async () => {
    workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-read-resilience-'));
    project = path.join(workflowRoot, 'projects', 'sample');
    fs.mkdirSync(path.join(workflowRoot, 'data'), { recursive: true });
    await bootstrapDatabase(workflowRoot, {
      dbPath: path.join(workflowRoot, 'data', 'test.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  });

  test('returns all 250 maps and 5000 events without truncation', () => {
    createProjectFixture(project, 250, 20);

    const scan = buildProjectManagementScan(workflowRoot, project);

    assert.equal(scan.maps.length, 250);
    assert.equal(scan.maps.reduce((total, map) => total + map.eventCount, 0), 5000);
    assert.equal(scan.maps.every((map) => map.readState === 'ready'), true);
    assert.deepEqual(scan.readIssues, []);
  });

  test('isolates malformed map JSON and invalid event structures', () => {
    createProjectFixture(project, 4, 2);
    const dataDir = path.join(project, 'www', 'data');
    fs.writeFileSync(path.join(dataDir, 'Map002.json'), '{ broken', 'utf8');
    writeJson(path.join(dataDir, 'Map003.json'), mapData({ invalidEvents: true }));

    const scan = buildProjectManagementScan(workflowRoot, project);

    assert.equal(scan.maps.length, 4);
    assert.equal(scan.maps.filter((map) => map.readState === 'ready').length, 2);
    assert.equal(scan.maps.find((map) => map.id === 2)?.readState, 'invalid');
    assert.equal(scan.maps.find((map) => map.id === 3)?.readState, 'invalid');
    assert.equal(scan.database.Actors.readState, 'ready');
    assert.deepEqual(
      scan.readIssues.filter((issue) => issue.scope === 'map').map((issue) => issue.relativePath).sort(),
      ['www/data/Map002.json', 'www/data/Map003.json'],
    );
    assertSafeIssuePayloads(scan.readIssues, project);
  });

  test('distinguishes missing maps from an invalid optional database group', () => {
    createProjectFixture(project, 3, 1);
    const dataDir = path.join(project, 'www', 'data');
    fs.rmSync(path.join(dataDir, 'Map003.json'));
    fs.writeFileSync(path.join(dataDir, 'Animations.json'), '{ invalid', 'utf8');

    const scan = buildProjectManagementScan(workflowRoot, project);

    assert.equal(scan.maps.find((map) => map.id === 3)?.readState, 'missing');
    assert.equal(scan.database.Animations.readState, 'invalid');
    assert.equal(scan.database.Actors.readState, 'ready');
    assert.ok(scan.readIssues.some((issue) => (
      issue.code === 'missing-file' && issue.relativePath === 'www/data/Map003.json' && issue.mapId === 3
    )));
    assert.ok(scan.readIssues.some((issue) => (
      issue.code === 'read-failed' && issue.relativePath === 'www/data/Animations.json' && issue.databaseGroup === 'Animations'
    )));
    assertSafeIssuePayloads(scan.readIssues, project);
    assert.ok(buildProjectManagementAssetInventory(workflowRoot, project).assets);
  });

  test('contains foundational file failures to their dependent overview regions', () => {
    createProjectFixture(project, 3, 1);
    const dataDir = path.join(project, 'www', 'data');
    fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), '{ invalid', 'utf8');

    const mapIndexFailure = buildProjectManagementScan(workflowRoot, project);

    assert.equal(mapIndexFailure.maps.length, 0);
    assert.equal(mapIndexFailure.database.Actors.readState, 'ready');
    assert.ok(mapIndexFailure.readIssues.some((issue) => (
      issue.scope === 'project' && issue.relativePath === 'www/data/MapInfos.json'
    )));

    createProjectFixture(project, 3, 1);
    fs.writeFileSync(path.join(dataDir, 'System.json'), '{ invalid', 'utf8');

    const systemFailure = buildProjectManagementScan(workflowRoot, project);

    assert.equal(systemFailure.maps.length, 3);
    assert.equal(systemFailure.database.Actors.readState, 'ready');
    assert.equal(systemFailure.database.System.readState, 'invalid');
    assert.ok(systemFailure.readIssues.some((issue) => (
      issue.scope === 'project' && issue.relativePath === 'www/data/System.json'
    )));
    assertSafeIssuePayloads(systemFailure.readIssues, project);
  });

  test('keeps read-only assets staged-aware while strict mutation safety still rejects malformed maps', () => {
    createProjectFixture(project, 3, 1);
    const dataDir = path.join(project, 'www', 'data');
    const characterDir = path.join(project, 'www', 'img', 'characters');
    fs.mkdirSync(characterDir, { recursive: true });
    fs.writeFileSync(path.join(characterDir, 'Before.png'), 'before', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'Map002.json'), '{ invalid', 'utf8');
    stageProjectFilesAtomically(workflowRoot, project, [
      { relativePath: 'www/img/characters/Before.png', delete: true },
      { relativePath: 'www/img/characters/After.png', content: Buffer.from('after', 'utf8') },
    ]);

    const overview = buildProjectManagementAssetInventory(workflowRoot, project);

    assert.ok(overview.assets);
    assert.deepEqual(overview.readIssues, []);
    assert.deepEqual(overview.assets.images.characters.names, ['After']);
    assert.throws(() => checkProjectAssetDeleteSafety(workflowRoot, project, {
      scope: 'project',
      category: 'characters',
      relativePath: 'www/img/characters/Before.png',
    }));
  });
});

function createProjectFixture(projectRoot: string, mapCount: number, eventsPerMap: number): void {
  const dataDir = path.join(projectRoot, 'www', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  writeJson(path.join(dataDir, 'System.json'), {
    ...createDefaultRmmvDatabaseEntry('System'),
    gameTitle: 'Sample Project',
    switches: [null, 'Sample Switch'],
    variables: [null, 'Sample Variable'],
  });
  const arrayGroups = [
    'Actors', 'Animations', 'Armors', 'Classes', 'CommonEvents', 'Enemies',
    'Items', 'Skills', 'States', 'Tilesets', 'Troops', 'Weapons',
  ];
  for (const group of arrayGroups) writeJson(path.join(dataDir, `${group}.json`), [null]);

  const mapInfos: unknown[] = [null];
  for (let id = 1; id <= mapCount; id += 1) {
    mapInfos[id] = { id, name: `Sample Map ${id}`, parentId: 0, order: id };
    writeJson(path.join(dataDir, `Map${String(id).padStart(3, '0')}.json`), mapData({ eventsPerMap }));
  }
  writeJson(path.join(dataDir, 'MapInfos.json'), mapInfos);
}

function mapData(options: { eventsPerMap?: number; invalidEvents?: boolean } = {}): Record<string, unknown> {
  const events: unknown[] | Record<string, unknown> = options.invalidEvents
    ? { unexpected: true }
    : [
        null,
        ...Array.from({ length: options.eventsPerMap ?? 0 }, (_, index) => ({
          id: index + 1,
          name: `Sample Event ${index + 1}`,
          note: '',
          x: 0,
          y: 0,
          pages: [],
        })),
      ];
  return {
    width: 1,
    height: 1,
    tilesetId: 1,
    scrollType: 0,
    events,
    data: [0, 0, 0, 0, 0, 0],
  };
}

function assertSafeIssuePayloads(
  issues: Array<{ relativePath: string; message: string }>,
  projectRoot: string,
): void {
  for (const issue of issues) {
    assert.equal(path.isAbsolute(issue.relativePath), false);
    assert.equal(issue.message.includes(projectRoot), false);
    assert.equal(issue.message.includes(os.tmpdir()), false);
  }
}
