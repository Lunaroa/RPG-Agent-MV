import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { registerMapIpcHandlers } from './map-ipc-bindings.ts';

const WORKSPACE_PATH = path.join(os.tmpdir(), 'rpg-agent-mv-workspace');
const PROJECT_PATH = path.join(os.tmpdir(), 'rpg-agent-mv-project');

function ipcOptions(overrides: Record<string, unknown> = {}) {
  return {
    withProductLanguage: (_language: unknown, fn: () => unknown) => fn(),
    trashProjectAsset: async () => undefined,
    ...overrides,
  };
}

describe('map IPC project compatibility warnings', () => {
  test('forwards the restricted workspace surface validation request', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      validateWorkspaceSurface: (...args: unknown[]) => {
        calls.push(args);
        return { version: 'version' };
      },
    }), ipcOptions());

    const request = { surface: 'editor', loadedVersion: 'previous', mapId: 3 };
    await handlers.get('workspaceSurfaces:validate')!({}, request, PROJECT_PATH);

    assert.deepEqual(calls, [[WORKSPACE_PATH, PROJECT_PATH, request]]);
  });

  test('forwards overview thumbnail requests, cancellation, and cache finalization', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    const canceled: string[] = [];
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      thumbnail: (...args: unknown[]) => {
        calls.push(args);
        return { ok: true };
      },
      cancelThumbnailSession: sessionId => canceled.push(sessionId),
      listProjects: () => [{ path: PROJECT_PATH }],
    }), ipcOptions());

    await handlers.get('maps:overviewThumbnail')!({}, 7, '0123456789abcdefabcd', PROJECT_PATH, 'session-1');
    await handlers.get('maps:cancelOverviewThumbnails')!({}, 'session-1');
    await handlers.get('maps:finalizeOverviewThumbnails')!({}, PROJECT_PATH);

    assert.deepEqual(calls, [[WORKSPACE_PATH, PROJECT_PATH, 7, '0123456789abcdefabcd', 'session-1']]);
    assert.deepEqual(canceled, ['session-1']);
  });

  test('forwards determinate overview scan progress to the requesting renderer session', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const events: Array<{ channel: string; payload: unknown }> = [];
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      overview: (...args: unknown[]) => {
        const reportProgress = args[2] as ((progress: unknown) => void) | undefined;
        reportProgress?.({ phase: 'reading-maps', completed: 2, total: 5 });
        return { nodes: [] };
      },
    }), ipcOptions());

    const result = await handlers.get('maps:overview')!({
      sender: { send: (channel: string, payload: unknown) => events.push({ channel, payload }) },
    }, PROJECT_PATH, 'overview-session');

    assert.deepEqual(result, { nodes: [] });
    assert.deepEqual(events, [{
      channel: 'maps:overviewProgress',
      payload: {
        sessionId: 'overview-session',
        phase: 'reading-maps',
        completed: 2,
        total: 5,
      },
    }]);
  });

  test('selects a PNG target in main and forwards export progress to the renderer', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const events: Array<{ channel: string; payload: unknown }> = [];
    const outputPath = path.join(os.tmpdir(), 'sample-map-overview.png');
    let defaultName = '';
    let startOptions: any = null;
    const scene = {
      requestId: 'export-1',
      project: PROJECT_PATH,
      projectName: 'Sample: Project',
      snapshotVersion: 'snapshot-v1',
      nodes: [],
      edges: [],
    };
    const status = {
      requestId: scene.requestId,
      project: PROJECT_PATH,
      phase: 'preflight',
      width: null,
      height: null,
      completed: 0,
      total: 0,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      outputPath: null,
      error: null,
      errorCode: null,
      canceled: false,
    };
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      listProjects: () => [{ path: PROJECT_PATH }],
      startExport: (options) => {
        startOptions = options;
        options.onStatus?.(status);
        return status;
      },
    }), ipcOptions({
      selectMapOverviewExportTarget: async (_event: unknown, name: string) => {
        defaultName = name;
        return outputPath;
      },
    }));

    const result = await handlers.get('maps:overviewExportStart')!({
      sender: { send: (channel: string, payload: unknown) => events.push({ channel, payload }) },
    }, scene);

    assert.equal(defaultName, 'Sample- Project-map-overview.png');
    assert.equal(startOptions.outputPath, outputPath);
    assert.equal(startOptions.project, PROJECT_PATH);
    assert.deepEqual(result, { canceled: false, status });
    assert.deepEqual(events, [{ channel: 'maps:overviewExportProgress', payload: status }]);
    assert.equal(handlers.has('maps:overviewExportReveal'), false);
  });

  test('rejects overview thumbnail requests for unregistered project paths', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    let called = false;
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      thumbnail: () => {
        called = true;
        return { ok: true };
      },
      listProjects: () => [{ path: path.join(os.tmpdir(), 'rpg-agent-mv-other-project') }],
    }), ipcOptions());

    await assert.rejects(
      async () => handlers.get('maps:overviewThumbnail')!({}, 7, '0123456789abcdefabcd', PROJECT_PATH, 'session-1'),
      /not registered/,
    );
    assert.equal(called, false);
  });

  test('confirms before importing an unsupported but recognizable MZ project', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    let registered = false;
    let confirmedAction = '';
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      register: () => {
        registered = true;
        return sampleProject();
      },
    }), ipcOptions({
      confirmProjectCompatibility: async (_event: unknown, warning: unknown, action: string) => {
        assert.deepEqual(warning, versionWarning());
        confirmedAction = action;
        return { confirmed: true, suppressFutureWarnings: false };
      },
    }));

    const result = await handlers.get('projects:add')!({}, PROJECT_PATH) as Record<string, unknown>;

    assert.equal(result.canceled, false);
    assert.equal(registered, true);
    assert.equal(confirmedAction, 'import');
  });

  test('cancels a staged write and persists suppression only after confirmation', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    let applied = false;
    let suppressionWrites = 0;
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      apply: () => {
        applied = true;
        return { success: true };
      },
    }), ipcOptions({
      confirmProjectCompatibility: async () => ({ confirmed: false, suppressFutureWarnings: true }),
      suppressProjectCompatibilityWarnings: () => { suppressionWrites += 1; },
    }));

    const result = await handlers.get('staging:applyProject')!({}, PROJECT_PATH, []) as Record<string, unknown>;

    assert.equal(result.canceled, true);
    assert.equal(applied, false);
    assert.equal(suppressionWrites, 0);
  });

  test('warns when importing encrypted resources but does not repeat that warning for staged writes', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    let confirmations = 0;
    let applied = false;
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      warning: encryptionWarning(),
      register: () => sampleProject(),
      apply: () => { applied = true; return { success: true }; },
    }), ipcOptions({
      confirmProjectCompatibility: async () => {
        confirmations += 1;
        return { confirmed: true, suppressFutureWarnings: false };
      },
    }));

    await handlers.get('projects:add')!({}, PROJECT_PATH);
    await handlers.get('staging:applyProject')!({}, PROJECT_PATH, []);

    assert.equal(confirmations, 1);
    assert.equal(applied, true);
  });
});

function registrar(handlers: Map<string, (...args: any[]) => unknown>) {
  return {
    handle(channel: string, listener: (...args: any[]) => unknown) { handlers.set(channel, listener); },
    removeHandler(channel: string) { handlers.delete(channel); },
  };
}

function desktop(overrides: {
  warning?: ReturnType<typeof versionWarning>;
  register?: () => unknown;
  apply?: () => unknown;
  thumbnail?: (...args: unknown[]) => unknown;
  overview?: (...args: unknown[]) => unknown;
  cancelThumbnailSession?: (sessionId: string) => unknown;
  validateWorkspaceSurface?: (...args: unknown[]) => unknown;
  listProjects?: () => Array<{ path: string }>;
  startExport?: (options: any) => unknown;
}) {
  return {
    project: {
      resolveProjectPath: (_root: string, value?: string) => value || PROJECT_PATH,
      getProjectCompatibilityWarning: () => overrides.warning || versionWarning(),
      registerExternalProject: () => overrides.register?.(),
      listProjects: () => overrides.listProjects?.() || [],
    },
    staging: {
      applyProjectStaging: () => overrides.apply?.(),
    },
    mapOverview: {
      buildMapOverviewSnapshot: (...args: unknown[]) => overrides.overview?.(...args),
      requestMapOverviewThumbnail: (...args: unknown[]) => overrides.thumbnail?.(...args),
      cancelMapOverviewThumbnailSession: (sessionId: string) => overrides.cancelThumbnailSession?.(sessionId),
      finalizeMapOverviewThumbnailCache: () => undefined,
    },
    mapOverviewExport: {
      startMapOverviewPngExport: (options: any) => overrides.startExport?.(options),
      getMapOverviewPngExportStatus: () => null,
      cancelMapOverviewPngExport: () => undefined,
    },
    workspaceSurfaces: {
      validateWorkspaceSurfaceVersion: (...args: unknown[]) => overrides.validateWorkspaceSurface?.(...args),
    },
    projectAssetBrowser: {
      invalidateProjectAssetBrowserCache() {},
    },
    projectManagement: {
      preflightProjectManagedStagingApply() {},
    },
  };
}

function versionWarning() {
  return {
    detectedVersion: '1.9.0',
    supportedVersion: '1.10.0',
    versionMismatch: true,
    encryptedResources: false,
    encryptedImages: false,
    encryptedAudio: false,
  };
}

describe('projectAssets IPC', () => {
  test('forwards copy requests to the asset management service', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    const facade = {
      ...desktop({}),
      assetManagement: {
        copyProjectAssets: (...args: unknown[]) => {
          calls.push(args);
          return { results: [] };
        },
      },
    };
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, facade, ipcOptions());

    const request = { targets: [{ category: 'pictures', name: 'Unused' }], targetCategory: 'pictures' };
    const result = await handlers.get('projectAssets:copy')!({}, request, PROJECT_PATH);

    assert.deepEqual(calls, [[WORKSPACE_PATH, PROJECT_PATH, request]]);
    assert.deepEqual(result, { results: [] });
  });

  test('reveals an in-project asset in the file manager and rejects path escapes', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const revealed: string[] = [];
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({}), ipcOptions({
      revealProjectAsset: (absolutePath: string) => revealed.push(absolutePath),
    }));

    const reveal = handlers.get('projectAssets:revealInFolder')!;
    const inside = await reveal({}, { relativePath: 'www/img/pictures/Unused.png' }, PROJECT_PATH);
    assert.deepEqual(inside, { ok: true });
    assert.deepEqual(revealed, [path.join(PROJECT_PATH, 'www', 'img', 'pictures', 'Unused.png')]);

    assert.throws(
      () => reveal({}, { relativePath: '../outside.txt' }, PROJECT_PATH),
      /outside the project/,
    );
    assert.equal(revealed.length, 1);
  });
});

function encryptionWarning() {
  return {
    detectedVersion: '1.10.0',
    supportedVersion: '1.10.0',
    versionMismatch: false,
    encryptedResources: true,
    encryptedImages: true,
    encryptedAudio: true,
  };
}

function sampleProject() {
  return {
    name: 'Sample',
    path: PROJECT_PATH,
    isDefault: false,
    engine: 'rpg-maker-mz',
    engineVersion: '1.9.0',
    engineVersionSupported: false,
    tileSize: 48,
    screenWidth: 816,
    screenHeight: 624,
    faceSize: 144,
    iconSize: 32,
  };
}
