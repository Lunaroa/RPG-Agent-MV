import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { EventContractDao } from '../db/dao/event-contract-dao.ts';
import { closeDatabase } from '../db/pool.ts';
import { writeJson } from '../rmmv/json.ts';
import { createEvent } from './event-service.ts';
import {
  clearPlacementQueueSession,
  getPlacementQueueSession,
  savePlacementQueueSession,
} from './placement-queue-service.ts';
import { approveContract, registerContract, rejectContract } from '../workflow/event/event-registry.ts';
import { initializeOriginalStoryProject } from './story-page-sync-service.ts';

interface Fixture {
  root: string;
  project: string;
  mapFile: string;
}

describe('placement queue service', { concurrency: false }, () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = createFixture();
    await bootstrapDatabase(fixture.root, {
      dbPath: path.join(fixture.root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
    });
    initializeOriginalStoryProject(fixture.project);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test('persists and restores pending placement session per project', () => {
    savePlacementQueueSession(fixture.project, {
      askId: 'ask-placement-1',
      sessionId: 'session-1',
      events: [{
        contractId: 'demo.greeter',
        eventName: 'EV_GreeterIntro',
        targetMapId: 3,
        status: 'draft',
      }],
    });

    const restored = getPlacementQueueSession(fixture.root, fixture.project);
    assert.ok(restored);
    assert.equal(restored!.askId, 'ask-placement-1');
    assert.equal(restored!.events.length, 1);
    assert.equal(restored!.events[0].contractId, 'demo.greeter');
    assert.equal(restored!.events[0].eventName, 'EV_GreeterIntro');
  });

  test('rebuilds pending queue from draft registry contracts after restart', () => {
    EventContractDao.create('demo.greeter', 'Project', {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'demo.greeter',
      purpose: 'Greeter intro placement test.',
      rmmvTarget: { operation: 'add-map-event', mapId: 1, eventName: 'EV_GreeterIntro' },
      implementation: { commands: [{ kind: 'text', text: 'Hello' }] },
    }, 'draft');
    createEvent(fixture.root, fixture.project, 1, {
      name: 'EV_GreeterIntro',
      x: 0,
      y: 0,
      note: 'AIWF:story:demo.greeter\nAIWF:unplaced',
      pages: [{ list: [{ code: 0, indent: 0, parameters: [] }] }],
    });

    const restored = getPlacementQueueSession(fixture.root, fixture.project);
    assert.ok(restored);
    assert.equal(restored!.events.length, 1);
    assert.equal(restored!.events[0].contractId, 'demo.greeter');
    assert.equal(restored!.events[0].eventName, 'EV_GreeterIntro');
    assert.equal(restored!.events[0].targetMapId, 1);
    assert.equal(restored!.events[0].status, 'draft');
  });

  test('clears queue when every event is placed', () => {
    savePlacementQueueSession(fixture.project, {
      askId: 'ask-placement-2',
      sessionId: 'session-2',
      events: [{
        contractId: 'demo.done',
        eventName: 'Done',
        targetMapId: 1,
        status: 'placed',
        placedEventId: 1,
        x: 2,
        y: 3,
      }],
    });

    const restored = getPlacementQueueSession(fixture.root, fixture.project);
    assert.equal(restored, null);
  });

  test('clearPlacementQueueSession removes persisted state', () => {
    savePlacementQueueSession(fixture.project, {
      askId: 'ask-placement-3',
      sessionId: 'session-3',
      events: [{
        contractId: 'demo.pending',
        eventName: 'Pending',
        targetMapId: 1,
        status: 'draft',
      }],
    });
    clearPlacementQueueSession(fixture.project);
    assert.equal(getPlacementQueueSession(fixture.root, fixture.project), null);
  });

  test('does not rebuild pending queue from reviewing registry contracts', () => {
    EventContractDao.create('demo.reviewing', 'Project', {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'demo.reviewing',
      purpose: 'Reviewing placement test.',
      rmmvTarget: { operation: 'add-map-event', mapId: 1, eventName: 'EV_Reviewing' },
      implementation: { commands: [{ kind: 'text', text: 'Needs approval first' }] },
    }, 'reviewing');

    const restored = getPlacementQueueSession(fixture.root, fixture.project);
    assert.equal(restored, null);
  });

  test('rebuilds pending queue after reviewing contract is approved', async () => {
    await registerContract(fixture.project, {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'demo.approved',
      purpose: 'Approved placement test.',
      rmmvTarget: { operation: 'add-map-event', mapId: 1, eventName: 'EV_Approved' },
      implementation: { commands: [{ kind: 'text', text: 'Ready to place' }] },
    }, { runtimeRoot: path.join(fixture.root, 'runtime') });

    approveContract(fixture.project, 'demo.approved', {
      runtimeRoot: path.join(fixture.root, 'runtime'),
      note: '人工确认通过',
    });

    const restored = getPlacementQueueSession(fixture.root, fixture.project);
    assert.equal(restored?.events.length, 1);
    assert.equal(restored?.events[0].contractId, 'demo.approved');
    assert.equal(restored?.events[0].status, 'draft');
  });

  test('removes rejected registry contracts from a saved queue', () => {
    EventContractDao.create('demo.rejected', 'Project', {
      engine: 'rpg-maker-mv',
      kind: 'EventContract',
      id: 'demo.rejected',
      purpose: 'Rejected placement test.',
      rmmvTarget: { operation: 'add-map-event', mapId: 1, eventName: 'EV_Rejected' },
      implementation: { commands: [{ kind: 'text', text: 'No longer needed' }] },
    }, 'draft');
    savePlacementQueueSession(fixture.project, {
      askId: 'ask-rejected',
      sessionId: 'session-rejected',
      events: [{
        contractId: 'demo.rejected',
        eventName: 'EV_Rejected',
        targetMapId: 1,
        status: 'draft',
      }],
    });

    rejectContract(fixture.project, 'demo.rejected', { runtimeRoot: path.join(fixture.root, 'runtime') });

    assert.equal(getPlacementQueueSession(fixture.root, fixture.project), null);
  });
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-placement-queue-'));
  const project = path.join(root, 'projects', 'Project');
  const dataDir = path.join(project, 'www', 'data');
  const mapFile = path.join(dataDir, 'Map001.json');
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(dataDir, 'Tilesets.json'), [null, { id: 1, name: 'Outside', mode: 1, tilesetNames: ['Outside_A1'], flags: [] }]);
  writeJson(path.join(dataDir, 'System.json'), {
    switches: [null, 'Door'],
    variables: [null, 'Progress'],
    startMapId: 1,
    startX: 0,
    startY: 0,
  });
  writeJson(mapFile, { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
  fs.mkdirSync(path.join(project, 'www', 'js'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'index.html'), '<!doctype html><script src="js/rpg_core.js"></script>');
  fs.writeFileSync(path.join(project, 'www', 'js', 'rpg_core.js'), 'window.Utils = {};');
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins.js'), 'var $plugins = [];');
  return { root, project, mapFile };
}
