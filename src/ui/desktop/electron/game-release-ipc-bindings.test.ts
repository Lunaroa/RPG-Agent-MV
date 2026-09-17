import assert from 'node:assert/strict';
import test from 'node:test';

import type { GameReleaseConfig, GameReleaseProjectSettings } from '../../../contract/game-release.ts';
import { registerGameReleaseIpcHandlers } from './game-release-ipc-bindings.ts';

const releaseConfig: GameReleaseConfig = {
  schemaVersion: 1,
  gameId: 'sample-game',
  version: '1.0.0',
  channel: 'stable',
  update: { enabled: true, indexUrl: 'https://updates.example.test/releases.json', checkOnStart: false, policy: 'optional' },
  saveCompatibility: { legacy: 'allow', older: 'allow', same: 'allow', newer: 'warn', differentChannel: 'warn' },
};

const settings: GameReleaseProjectSettings = {
  presets: [{
    id: 'web-release', name: 'Web', target: 'web', architecture: 'web', channel: 'stable',
    outputDirectory: 'builds', zip: false, packageType: 'full',
    processing: { images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'none', ui: 'none' },
  }],
  selectedPresetId: 'web-release',
};

test('saves manifest signing references before storing the private key', async () => {
  const calls: string[] = [];
  const fixture = createFixture(calls);
  registerGameReleaseIpcHandlers(fixture.ipc as never, fixture.dialog as never, fixture.shell as never, fixture.dependencies as never);
  const result = await fixture.invoke('gameBuild:createManifestSigningIdentity', {
    releaseConfig,
    releaseExpectedSourceHash: 'old-hash',
    settings,
  }, 'project') as any;
  assert.deepEqual(calls.slice(0, 3), ['save-release', 'save-settings', 'save-secret']);
  assert.equal(result.release.config.update.manifestSignature.enabled, true);
  assert.equal(result.settings.manifestSigningCredentialId, result.identity.credentialId);
});

test('rolls back release references and settings when secure key storage fails', async () => {
  const calls: string[] = [];
  const fixture = createFixture(calls, true);
  registerGameReleaseIpcHandlers(fixture.ipc as never, fixture.dialog as never, fixture.shell as never, fixture.dependencies as never);
  await assert.rejects(
    async () => fixture.invoke('gameBuild:createManifestSigningIdentity', {
      releaseConfig,
      releaseExpectedSourceHash: 'old-hash',
      settings,
    }, 'project'),
    /Could not save the manifest signing identity/,
  );
  assert.deepEqual(calls, [
    'save-release', 'save-settings', 'save-secret', 'forget-secret', 'rollback-settings', 'read-release', 'rollback-release',
  ]);
});

test('rejects a second packaging operation from the same renderer until the first settles', async () => {
  const calls: string[] = [];
  const fixture = createFixture(calls);
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  (fixture.dependencies.build as any).startGameBuildWorker = () => ({ result: pending, cancel() {} });
  registerGameReleaseIpcHandlers(fixture.ipc as never, fixture.dialog as never, fixture.shell as never, fixture.dependencies as never);
  const sender = {
    id: 7,
    isDestroyed: () => false,
    send() {},
    once() {},
    removeListener() {},
  };
  const first = fixture.invokeWithEvent({ sender }, 'gameBuild:build', {
    operationId: 'first-build', presetId: 'web-release', outputConflict: 'overwrite',
  }, 'project');
  await Promise.resolve();
  await assert.rejects(
    async () => fixture.invokeWithEvent({ sender }, 'gameBuild:build', {
      operationId: 'second-build', presetId: 'web-release', outputConflict: 'overwrite',
    }, 'project'),
    /already has a packaging operation/,
  );
  finish({ status: 'canceled', artifacts: [], warnings: [] });
  await first;
});

function createFixture(calls: string[], failSecret = false) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  let currentRelease = structuredClone(releaseConfig);
  let currentSettings = structuredClone(settings);
  let releaseSaveCount = 0;
  let settingsSaveCount = 0;
  const ipc = {
    handle(channel: string, handler: (...args: any[]) => unknown) { handlers.set(channel, handler); },
    removeHandler(channel: string) { handlers.delete(channel); },
  };
  const dependencies = {
    workflowRoot: 'workflow',
    resolveProject: () => 'project',
    release: {
      readGameReleaseStatus() {
        if (releaseSaveCount > 0) calls.push('read-release');
        return { config: structuredClone(currentRelease), sourceHash: releaseSaveCount ? 'new-hash' : 'old-hash' };
      },
      saveGameReleaseConfig(_root: string, _project: string, request: { config: GameReleaseConfig }) {
        releaseSaveCount += 1;
        calls.push(releaseSaveCount === 1 ? 'save-release' : 'rollback-release');
        currentRelease = structuredClone(request.config);
        return { config: structuredClone(currentRelease), sourceHash: releaseSaveCount === 1 ? 'new-hash' : 'restored-hash' };
      },
      async testGameReleaseUpdateIndex() { return { ok: true }; },
    },
    build: {
      readGameBuildSettings() { return structuredClone(currentSettings); },
      saveGameBuildSettings(_project: string, value: GameReleaseProjectSettings) {
        settingsSaveCount += 1;
        calls.push(settingsSaveCount === 1 ? 'save-settings' : 'rollback-settings');
        currentSettings = structuredClone(value);
        return structuredClone(value);
      },
      listAndroidIconCandidates() { return []; },
      preflightGameBuild() { return {}; },
      async buildGame() { return {}; },
      startGameBuildWorker() { throw new Error('not used'); },
    },
    encryption: {},
    publication: {},
    manifestSigning: {
      createGameManifestSigningIdentity(credentialId: string) {
        return { credentialId, algorithm: 'ECDSA-P256-SHA256', keyId: 'a'.repeat(64), publicKey: 'public', privateKey: 'private' };
      },
    },
    androidToolchain: {},
    credentials: {
      save() {
        calls.push('save-secret');
        if (failSecret) throw new Error('secure storage unavailable');
      },
      forget() { calls.push('forget-secret'); return true; },
      status() { return { available: true }; },
      read() { return null; },
    },
    serialize: <T>(value: T) => structuredClone(value),
    parentWindow: () => undefined,
  };
  return {
    ipc,
    dialog: {},
    shell: {},
    dependencies,
    invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler: ${channel}`);
      return handler({}, ...args);
    },
    invokeWithEvent(event: unknown, channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing handler: ${channel}`);
      return handler(event, ...args);
    },
  };
}
