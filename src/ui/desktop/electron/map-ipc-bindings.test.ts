import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { registerMapIpcHandlers } from './map-ipc-bindings.ts';

const WORKSPACE_PATH = path.join(os.tmpdir(), 'rpg-agent-mv-workspace');
const PROJECT_PATH = path.join(os.tmpdir(), 'rpg-agent-mv-project');

describe('map IPC project compatibility warnings', () => {
  test('forwards the restricted workspace surface validation request', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      validateWorkspaceSurface: (...args: unknown[]) => {
        calls.push(args);
        return { version: 'version' };
      },
    }), { withProductLanguage: (_language, fn) => fn() });

    const request = { surface: 'editor', loadedVersion: 'previous', mapId: 3 };
    await handlers.get('workspaceSurfaces:validate')!({}, request, PROJECT_PATH);

    assert.deepEqual(calls, [[WORKSPACE_PATH, PROJECT_PATH, request]]);
  });

  test('forwards thumbnail quality after the expected content version', async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const calls: unknown[][] = [];
    const canceled: string[] = [];
    registerMapIpcHandlers(registrar(handlers), WORKSPACE_PATH, desktop({
      thumbnail: (...args: unknown[]) => {
        calls.push(args);
        return { ok: true };
      },
      cancelThumbnailSession: sessionId => canceled.push(sessionId),
    }), { withProductLanguage: (_language, fn) => fn() });

    await handlers.get('maps:overviewThumbnail')!({}, 7, '0123456789abcdefabcd', 'ultra', PROJECT_PATH, 'session-1');
    await handlers.get('maps:cancelOverviewThumbnails')!({}, 'session-1');

    assert.deepEqual(calls, [[WORKSPACE_PATH, PROJECT_PATH, 7, '0123456789abcdefabcd', 'ultra', 'session-1']]);
    assert.deepEqual(canceled, ['session-1']);
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
    }), {
      withProductLanguage: (_language, fn) => fn(),
      confirmProjectCompatibility: async (_event, warning, action) => {
        assert.deepEqual(warning, versionWarning());
        confirmedAction = action;
        return { confirmed: true, suppressFutureWarnings: false };
      },
    });

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
    }), {
      withProductLanguage: (_language, fn) => fn(),
      confirmProjectCompatibility: async () => ({ confirmed: false, suppressFutureWarnings: true }),
      suppressProjectCompatibilityWarnings: () => { suppressionWrites += 1; },
    });

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
    }), {
      withProductLanguage: (_language, fn) => fn(),
      confirmProjectCompatibility: async () => {
        confirmations += 1;
        return { confirmed: true, suppressFutureWarnings: false };
      },
    });

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
  cancelThumbnailSession?: (sessionId: string) => unknown;
  validateWorkspaceSurface?: (...args: unknown[]) => unknown;
}) {
  return {
    project: {
      resolveProjectPath: (_root: string, value?: string) => value || PROJECT_PATH,
      getProjectCompatibilityWarning: () => overrides.warning || versionWarning(),
      registerExternalProject: () => overrides.register?.(),
      listProjects: () => [],
    },
    staging: {
      applyProjectStaging: () => overrides.apply?.(),
    },
    mapOverview: {
      requestMapOverviewThumbnail: (...args: unknown[]) => overrides.thumbnail?.(...args),
      cancelMapOverviewThumbnailSession: (sessionId: string) => overrides.cancelThumbnailSession?.(sessionId),
    },
    workspaceSurfaces: {
      validateWorkspaceSurfaceVersion: (...args: unknown[]) => overrides.validateWorkspaceSurface?.(...args),
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
