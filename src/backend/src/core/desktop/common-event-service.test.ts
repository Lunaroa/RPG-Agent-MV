import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import {
  changeCommonEventTrigger,
  createCommonEvent,
  deleteCommonEvent,
  duplicateCommonEvent,
  editCommonEventCommandList,
  findCommonEventUsages,
  getCommonEvent,
  listCommonEvents,
  renameCommonEvent,
  updateCommonEvent,
} from './common-event-service.ts';
import { applyProjectStaging, getProjectFileForRead, getProjectStagingStatus } from './staging-service.ts';

describe('common event service', { concurrency: false }, () => {
  let root: string;
  let project: string;
  let dataDir: string;
  let commonEventsFile: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-common-events-'));
    project = path.join(root, 'projects', 'Project');
    dataDir = path.join(project, 'www', 'data');
    commonEventsFile = path.join(dataDir, 'CommonEvents.json');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    writeJson(path.join(dataDir, 'System.json'), {
      switches: [null, 'Door', 'Parallel OK'],
      variables: [null, 'Progress'],
      startCommonEvent: 0,
    });
    writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: true }]);
    writeJson(path.join(dataDir, 'Map001.json'), {
      width: 2,
      height: 2,
      data: Array(24).fill(0),
      events: [null, {
        id: 1,
        name: 'Caller',
        pages: [{
          list: [
            { code: 117, indent: 0, parameters: [3] },
            { code: 0, indent: 0, parameters: [] },
          ],
        }],
      }],
    });
    writeJson(commonEventsFile, [
      null,
      { id: 1, name: 'Intro', trigger: 0, switchId: 0, list: [{ code: 0, indent: 0, parameters: [] }] },
      null,
      { id: 3, name: 'Called', trigger: 0, switchId: 0, list: [{ code: 0, indent: 0, parameters: [] }] },
    ]);
    writeJson(path.join(dataDir, 'Skills.json'), [
      null,
      { id: 1, name: 'Call CE', effects: [{ code: 44, dataId: 3, value1: 0, value2: 0 }] },
    ]);
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('lists and gets existing common events', () => {
    const list = listCommonEvents(root, project);
    assert.equal(list.relativePath, 'www/data/CommonEvents.json');
    assert.deepEqual(list.commonEvents.map((event) => event.id), [1, 3]);
    const entry = getCommonEvent(root, project, { id: 1 });
    assert.equal(entry.kind, 'commonEvent');
    assert.equal((entry.value as { name: string }).name, 'Intro');
  });

  test('creates a common event in staging and keeps source unchanged until apply', () => {
    const created = createCommonEvent(root, project, {
      name: 'Parallel Loop',
      trigger: 2,
      switchId: 2,
      list: [
        { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
        { code: 401, indent: 0, parameters: ['Tick'] },
        { code: 0, indent: 0, parameters: [] },
      ],
    });

    assert.equal(created.entry.id, 2);
    assert.equal((created.entry.value as { trigger: number }).trigger, 2);
    assert.equal((readJson(commonEventsFile) as unknown[])[2], null);
    const stagedFile = getProjectFileForRead(root, project, 'www/data/CommonEvents.json');
    assert.ok(stagedFile);
    assert.equal((readJson(stagedFile) as Array<{ name?: string } | null>)[2]?.name, 'Parallel Loop');
    assert.equal(getProjectStagingStatus(root, project).staged, true);

    assert.equal(applyProjectStaging(root, project).applied, true);
    assert.equal((readJson(commonEventsFile) as Array<{ name?: string } | null>)[2]?.name, 'Parallel Loop');
    assert.equal(getProjectStagingStatus(root, project).staged, false);
  });

  test('updates, renames, changes trigger, and edits command list', () => {
    updateCommonEvent(root, project, {
      id: 1,
      value: { id: 1, name: 'Intro Updated', trigger: 0, switchId: 0, list: [{ code: 0, indent: 0, parameters: [] }] },
    });
    renameCommonEvent(root, project, { id: 1, name: 'Intro Renamed' });
    changeCommonEventTrigger(root, project, { id: 1, trigger: 1, switchId: 1 });
    editCommonEventCommandList(root, project, {
      id: 1,
      list: [
        { code: 117, indent: 0, parameters: [3] },
        { code: 0, indent: 0, parameters: [] },
      ],
    });

    const stagedFile = getProjectFileForRead(root, project, 'www/data/CommonEvents.json');
    assert.ok(stagedFile);
    const event = (readJson(stagedFile) as RmmvCommonEventTest[])[1];
    assert.equal(event.name, 'Intro Renamed');
    assert.equal(event.trigger, 1);
    assert.equal(event.switchId, 1);
    assert.equal(event.list[0].code, 117);
    assert.equal((readJson(commonEventsFile) as RmmvCommonEventTest[])[1].name, 'Intro');
  });

  test('duplicates to the next empty slot', () => {
    const duplicated = duplicateCommonEvent(root, project, { id: 1 });
    assert.equal(duplicated.entry.id, 2);
    assert.equal((duplicated.entry.value as { name: string }).name, 'Intro Copy');
    const stagedFile = getProjectFileForRead(root, project, 'www/data/CommonEvents.json');
    assert.ok(stagedFile);
    assert.equal((readJson(stagedFile) as RmmvCommonEventTest[])[2].id, 2);
  });

  test('blocks delete when map commands or database effects reference the common event', () => {
    const references = findCommonEventUsages(root, project, 3);
    assert.ok(references.some((ref) => ref.kind === 'mapEventCommand'));
    assert.ok(references.some((ref) => ref.kind === 'databaseEffect'));
    assert.throws(
      () => deleteCommonEvent(root, project, { id: 3 }),
      /仍被引用/,
    );
  });

  test('deletes an unreferenced common event through staging', () => {
    const result = deleteCommonEvent(root, project, { id: 1 });
    assert.equal(result.deleted, true);
    assert.equal((readJson(commonEventsFile) as unknown[])[1] === null, false);
    const stagedFile = getProjectFileForRead(root, project, 'www/data/CommonEvents.json');
    assert.ok(stagedFile);
    assert.equal((readJson(stagedFile) as unknown[])[1], null);
  });

  test('validates autorun and parallel switch range', () => {
    assert.throws(
      () => createCommonEvent(root, project, { name: 'Bad', trigger: 1, switchId: 99 }),
      /条件开关 99 超出/,
    );
    assert.throws(
      () => changeCommonEventTrigger(root, project, { id: 1, trigger: 2, switchId: 0 }),
      /必须设置有效开关/,
    );
  });
});

interface RmmvCommonEventTest {
  id: number;
  name: string;
  trigger: number;
  switchId: number;
  list: Array<{ code: number; indent: number; parameters: unknown[] }>;
}
