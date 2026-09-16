import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  cleanupMapIpcHandlers,
  MAP_IPC_CHANNELS,
  registerMapIpcHandlers,
} from '../../ui/desktop/electron/map-ipc-bindings.ts';
import {
  cleanupSessionIpcHandlers,
  SESSION_IPC_CHANNELS,
  registerSessionIpcHandlers,
} from '../../ui/desktop/electron/session-ipc-bindings.ts';

const WORKFLOW_PATH = path.join(os.tmpdir(), 'api-contract-workflow');
const PROJECT_PATH = path.join(WORKFLOW_PATH, 'projects', 'sample');
const REMAINING_PROJECT_PATH = path.join(WORKFLOW_PATH, 'projects', 'remaining');

describe('map IPC bindings', () => {
  test('registers the production map channels and preserves contract envelopes', async () => {
    const handlers = new Map();
    const ipc = {
      handle(channel, listener) { handlers.set(channel, listener); },
      removeHandler(channel) { handlers.delete(channel); },
    };
    const calls = [];
    const pickerCalls = [];
    const desktop = createDesktopMock(calls);

    registerMapIpcHandlers(ipc, WORKFLOW_PATH, desktop, {
      productLanguage: () => 'en-US',
      withProductLanguage: (_language, fn) => fn(),
      trashProjectAsset: async () => undefined,
      selectPluginFile: async () => {
        pickerCalls.push(['plugin']);
        return null;
      },
      selectAssetFile: async (_event, category, extensions) => {
        pickerCalls.push(['asset', category, extensions]);
        return null;
      },
    });
    assert.deepEqual([...handlers.keys()].sort(), [...MAP_IPC_CHANNELS].sort());
    assert.equal(MAP_IPC_CHANNELS.some((channel) => channel.startsWith('sharedAssets:')), false);
    assert.equal(MAP_IPC_CHANNELS.includes('assetLibrary:catalog'), true);
    assert.equal(MAP_IPC_CHANNELS.includes('assetLibrary:import'), true);
    assert.equal(MAP_IPC_CHANNELS.includes('projects:remove'), true);
    assert.equal(MAP_IPC_CHANNELS.includes('projectAssets:browseTree'), true);
    assert.equal(MAP_IPC_CHANNELS.includes('projectAssets:browseCategory'), true);
    assert.equal(MAP_IPC_CHANNELS.includes('projectAssets:invalidateBrowseCache'), true);
    assert.equal(MAP_IPC_CHANNELS.some((channel) => channel.startsWith('staging:')), false);

    assert.equal(await handlers.get('plugins:selectInstallFile')({}), null);
    assert.equal(await handlers.get('projectAssets:selectImportFile')({}, 'pictures'), null);
    assert.deepEqual(pickerCalls, [
      ['plugin'],
      ['asset', 'pictures', ['png', 'jpg', 'jpeg', 'webp', 'rpgmvp']],
    ]);

    const removedProjectList = await handlers.get('projects:remove')(null, path.join(os.tmpdir(), 'removed-project'));
    const tree = await handlers.get('maps:tree')(null, 'projects/Project');
    const tilesets = await handlers.get('maps:tilesets')(null, 'projects/Project');
    const payload = await handlers.get('maps:get')(null, 1, 'projects/Project');
    const imported = await handlers.get('maps:importFromLibrary')(null, 'demo', 7, { name: 'Imported' }, 'projects/Project');

    assert.deepEqual(removedProjectList, {
      projects: [{ path: REMAINING_PROJECT_PATH, name: 'Remaining', isDefault: false }],
    });
    assert.deepEqual(tree, { project: PROJECT_PATH, blocks: [], maps: [] });
    assert.deepEqual(tilesets, { project: PROJECT_PATH, tilesets: [] });
    assert.equal(payload.info.name, 'Start');
    assert.equal(payload.tileset.imageUrls[0], 'rmmv-asset://project/demo/Outside_A1.png');
    assert.deepEqual(imported, { mapId: 2 });
    assert.deepEqual(calls.at(-1), ['import', WORKFLOW_PATH, PROJECT_PATH, 'demo', { name: 'Imported', parentId: 7 }]);

    cleanupMapIpcHandlers(ipc);
    assert.equal(handlers.size, 0);
  });
});

describe('session IPC bindings', () => {
  test('registers the session channels and delegates task read/write', async () => {
    const handlers = new Map();
    const ipc = {
      handle(channel, listener) { handlers.set(channel, listener); },
      removeHandler(channel) { handlers.delete(channel); },
    };
    const calls = [];
    const runtime = {
      getBootstrap() { return {}; },
      list() { return []; },
      get() { return {}; },
      history() { return []; },
      create() { return Promise.resolve({}); },
      preview() { return Promise.resolve({}); },
      stop() { return {}; },
      delete() { return true; },
      saveChatLog() { return true; },
      submitAskResult() { return { ok: true }; },
      subscribe() { return []; },
      unsubscribe() {},
      listTasks(sessionId) { calls.push(['listTasks', sessionId]); return [{ id: '1', subject: 'a', status: 'pending', blocks: [], blockedBy: [] }]; },
      updateTask(sessionId, taskId, patch) { calls.push(['updateTask', sessionId, taskId, patch]); return { ok: true, task: { id: taskId, status: patch.status, subject: 'a', blocks: [], blockedBy: [] } }; },
      getPlan(sessionId) { calls.push(['getPlan', sessionId]); return { sessionId, mode: 'idle', title: '计划', planMarkdown: '' }; },
      listSubagents(sessionId) { calls.push(['listSubagents', sessionId]); return { sessionId, items: [] }; },
      stopSubagent(sessionId, taskId) { calls.push(['stopSubagent', sessionId, taskId]); return { ok: true, requestId: 'req-1' }; },
    };

    registerSessionIpcHandlers(ipc, runtime);
    assert.deepEqual([...handlers.keys()].sort(), [...SESSION_IPC_CHANNELS].sort());
    assert.equal(SESSION_IPC_CHANNELS.includes('sessions:listTasks'), true);
    assert.equal(SESSION_IPC_CHANNELS.includes('sessions:updateTask'), true);
    assert.equal(SESSION_IPC_CHANNELS.includes('sessions:getPlan'), true);
    assert.equal(SESSION_IPC_CHANNELS.includes('sessions:listSubagents'), true);
    assert.equal(SESSION_IPC_CHANNELS.includes('sessions:stopSubagent'), true);

    const tasks = await handlers.get('sessions:listTasks')(null, 'sess-1');
    const updated = await handlers.get('sessions:updateTask')(null, 'sess-1', '1', { status: 'completed' });
    const plan = await handlers.get('sessions:getPlan')(null, 'sess-1');
    const subagents = await handlers.get('sessions:listSubagents')(null, 'sess-1');
    const stopped = await handlers.get('sessions:stopSubagent')(null, 'sess-1', 'agent-1');

    assert.equal(tasks[0].id, '1');
    assert.equal(updated.ok, true);
    assert.equal(updated.task.status, 'completed');
    assert.equal(plan.mode, 'idle');
    assert.equal(subagents.items.length, 0);
    assert.equal(stopped.requestId, 'req-1');
    assert.deepEqual(calls, [
      ['listTasks', 'sess-1'],
      ['updateTask', 'sess-1', '1', { status: 'completed' }],
      ['getPlan', 'sess-1'],
      ['listSubagents', 'sess-1'],
      ['stopSubagent', 'sess-1', 'agent-1'],
    ]);

    cleanupSessionIpcHandlers(ipc);
    assert.equal(handlers.size, 0);
  });
});

function createDesktopMock(calls) {
  const project = PROJECT_PATH;
  return {
    project: {
      listProjects() { return []; },
      refreshProjects() { return []; },
      registerExternalProject() { return { path: project, name: 'Project', isDefault: true }; },
      removeRegisteredProject(root, target) {
        calls.push(['removeProject', root, target]);
        return [{ path: REMAINING_PROJECT_PATH, name: 'Remaining', isDefault: false }];
      },
      initializeProjectGitBaseline() { return { ok: true }; },
      saveProjectVersion() { return { ok: true, committed: false, message: '当前没有新的改动需要保存' }; },
      resolveProjectPath(root, value) {
        calls.push(['resolve', root, value]);
        return project;
      },
      getProjectCompatibilityWarning() { return null; },
    },
    maps: {
      buildMapIndex(_root, resolved) { return { project: resolved, blocks: [], maps: [] }; },
      buildTilesetIndex(_root, resolved) { return { project: resolved, tilesets: [] }; },
      buildMapPayload() {
        return {
          project,
          info: { id: 1, name: 'Start' },
          map: { width: 1, height: 1, tilesetId: 1, data: [0], events: [null] },
          tileset: { id: 1, name: 'Outside', tilesetNames: ['Outside_A1'], flags: [], imageUrls: ['rmmv-asset://project/demo/Outside_A1.png'] },
          system: { switches: [], variables: [] },
        };
      },
      createMapDraft() { return { mapId: 2 }; },
      importMapDraftFromLibrary(root, resolved, assetId, properties) { calls.push(['import', root, resolved, assetId, properties]); return { mapId: 2 }; },
      updateMapPropertiesDraft() { return {}; },
      reparentMapDraft() { return {}; },
      duplicateMapDraft() { return {}; },
      deleteMapDraft() { return {}; },
      postMapTiles() { return {}; },
      createPlaytestArtifact() { return {}; },
    },
    events: {
      createEvent() { return {}; },
      updateEvent() { return {}; },
      removeEvent() { return {}; },
      duplicateEvent() { return {}; },
    },
    assetManagement: {
      getAssetImportFileExtensions() { return ['png', 'jpg', 'jpeg', 'webp', 'rpgmvp']; },
    },
    projectAssetBrowser: {
      buildProjectAssetCategoryTree() { return { project, nodes: [] }; },
      listProjectAssetCategory() { return { categoryId: 'pictures', directory: 'img/pictures', entries: [] }; },
      invalidateProjectAssetBrowserCache() {},
    },
    library: {
      listMapLibrary() { return { totalEntries: 0, entries: [] }; },
      getMapLibrarySelection() { return null; },
      writeMapLibrarySelection() { return {}; },
    },
    storyPages: {
      syncStoryProject() { return { profile: null, issues: [] }; },
    },
  };
}
