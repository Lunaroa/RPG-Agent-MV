import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { GameReleaseConfig } from '../../../../contract/game-release.ts';
import {
  createDefaultGameReleaseConfig,
  readGameReleaseStatus,
  saveGameReleaseConfig,
  testGameReleaseUpdateIndex,
  validateGameReleaseConfig,
} from './game-release-service.ts';
import { createGameManifestSigningIdentity } from './game-manifest-signing-service.ts';

test('strictly validates and normalizes the public release configuration', () => {
  const signing = createGameManifestSigningIdentity('manifest-signing-test');
  const config = validateGameReleaseConfig({
    schemaVersion: 1,
    gameId: 'sample-game',
    version: '01.002.3 -Beta.2',
    channel: 'stable',
    update: {
      enabled: true,
      indexUrl: 'https://updates.example.test/releases.json',
      checkOnStart: true,
      backgroundDownload: true,
      policy: 'optional',
      manifestSignature: {
        enabled: true,
        algorithm: signing.algorithm,
        keyId: signing.keyId,
        publicKey: signing.publicKey,
      },
    },
    saveCompatibility: {
      legacy: 'allow', older: 'allow', same: 'allow', newer: 'warn', differentChannel: 'warn',
    },
  });
  assert.equal(config.version, '01.002.3-Beta.2');
  assert.equal(config.update.backgroundDownload, true);
  assert.equal(config.update.manifestSignature?.keyId, signing.keyId);
  assert.throws(() => validateGameReleaseConfig({ ...config, unsupported: true }), /unsupported fields/);
  assert.throws(() => validateGameReleaseConfig({
    ...config,
    update: { ...config.update, enabled: true, indexUrl: '' },
  }), /indexUrl is required/);
  assert.throws(() => validateGameReleaseConfig({
    ...config,
    update: { ...config.update, indexUrl: 'file:///release.json' },
  }), /HTTP or HTTPS/);
  assert.throws(() => validateGameReleaseConfig({
    ...config,
    update: { ...config.update, enabled: false, indexUrl: '' },
  }), /cannot be enabled/);
  assert.throws(() => validateGameReleaseConfig({
    ...config,
    update: { ...config.update, checkOnStart: false, backgroundDownload: true },
  }), /requires update\.checkOnStart/);
});

test('writes release data and managed plugins atomically for a root data layout', () => {
  withFixture('data', ({ workflowRoot, project }) => {
    const initial = readGameReleaseStatus(workflowRoot, project);
    assert.equal(initial.exists, false);
    assert.equal(initial.relativePath, 'data/RPGAgentRelease.json');
    assert.equal(initial.runtimePluginsReady, false);

    const config: GameReleaseConfig = {
      ...createDefaultGameReleaseConfig(project),
      gameId: 'sample-game',
      version: '1.2.3 -rc.1',
    };
    const saved = saveGameReleaseConfig(workflowRoot, project, {
      config,
      expectedSourceHash: null,
      installRuntimePlugins: true,
    });
    assert.equal(saved.exists, true);
    assert.equal(saved.config.version, '1.2.3-rc.1');
    assert.equal(saved.runtimePluginsReady, true);
    assert.ok(saved.backupDirectory);
    assert.equal(fs.existsSync(path.join(project, 'js', 'plugins', 'RPGAgentVersion.js')), true);
    assert.equal(fs.existsSync(path.join(project, 'js', 'plugins', 'RPGAgentUpdater.js')), true);

    const configured = readPluginEntries(path.join(project, 'js', 'plugins.js'));
    assert.deepEqual(configured.slice(0, 3).map((entry) => [entry.name, entry.status]), [
      ['RPGAgentVersion', true],
      ['RPGAgentUpdater', false],
      ['ExistingPlugin', true],
    ]);
    const pluginsBackup = path.join(project, ...saved.backupDirectory!.split('/'), 'js', 'plugins.js');
    assert.equal(fs.existsSync(pluginsBackup), true);
  });
});

test('uses the engine-resolved www data layout and detects concurrent release edits', () => {
  withFixture('www-data', ({ workflowRoot, project }) => {
    const initial = readGameReleaseStatus(workflowRoot, project);
    const first = saveGameReleaseConfig(workflowRoot, project, {
      config: { ...initial.config, gameId: 'sample-game', version: '1.0.0' },
      expectedSourceHash: initial.sourceHash,
    });
    assert.equal(first.relativePath, 'www/data/RPGAgentRelease.json');
    assert.equal(fs.existsSync(path.join(project, 'www', 'js', 'plugins', 'RPGAgentVersion.js')), true);

    fs.writeFileSync(
      path.join(project, 'www', 'data', 'RPGAgentRelease.json'),
      `${JSON.stringify({ ...first.config, version: '1.0.1' }, null, 2)}\n`,
      'utf8',
    );
    assert.throws(() => saveGameReleaseConfig(workflowRoot, project, {
      config: { ...first.config, version: '1.0.2' },
      expectedSourceHash: first.sourceHash,
    }), /changed after it was read/);
  });
});

test('release audit: previews the current version draft without writing the project', () => {
  withFixture('data', ({ workflowRoot, project }) => {
    const initial = readGameReleaseStatus(workflowRoot, project);
    const saved = saveGameReleaseConfig(workflowRoot, project, { config: initial.config, expectedSourceHash: null });
    assert.deepEqual(saved.managedChanges, []);
    const draft = { ...saved.config, version: '2.0.0', update: { ...saved.config.update, enabled: true,
      indexUrl: 'https://updates.example.test/releases.json' } };
    const preview = readGameReleaseStatus(workflowRoot, project, draft);
    assert.deepEqual(preview.managedChanges.map((change) => change.relativePath).sort(), ['data/RPGAgentRelease.json', 'js/plugins.js']);
    assert.ok(preview.managedChanges.every((change) => change.kind === 'update'));
    assert.equal(preview.sourceHash, saved.sourceHash);
    assert.equal(readGameReleaseStatus(workflowRoot, project).config.version, saved.config.version);
  });
});

test('enables the updater entry only when online updates are configured', () => {
  withFixture('data', ({ workflowRoot, project }) => {
    const initial = readGameReleaseStatus(workflowRoot, project);
    saveGameReleaseConfig(workflowRoot, project, {
      config: {
        ...initial.config,
        gameId: 'sample-game',
        update: {
          enabled: true,
          indexUrl: 'https://updates.example.test/releases.json',
          checkOnStart: false,
          policy: 'required',
        },
      },
      expectedSourceHash: initial.sourceHash,
    });
    const configured = readPluginEntries(path.join(project, 'js', 'plugins.js'));
    assert.equal(configured.find((entry) => entry.name === 'RPGAgentUpdater')?.status, true);
  });
});

test('tests the configured update index and resolves the selected channel latest release', async () => {
  const index = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    games: {
      'sample-game': {
        channels: {
          stable: {
            latestReleaseId: 'release-2',
            latestReleaseIds: { 'web/web': 'release-2' },
            maintenance: null,
            releases: [
              updateRelease('release-1', '1.0.0'),
              updateRelease('release-2', '1.1.0-beta.1'),
            ],
          },
        },
      },
    },
  };
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(index));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not open a TCP port.');
    const config = createDefaultGameReleaseConfig('sample-game');
    config.gameId = 'sample-game';
    config.update = {
      enabled: true,
      indexUrl: `http://localhost:${address.port}/releases.json`,
      checkOnStart: false,
      backgroundDownload: false,
      policy: 'optional',
    };
    const result = await testGameReleaseUpdateIndex(config);
    assert.deepEqual(result, {
      ok: true,
      latestVersion: '1.1.0-beta.1',
      latestReleaseId: 'release-2',
      releaseCount: 2,
      signed: false,
    });
    index.games['sample-game'].channels.stable.latestReleaseId = 'missing';
    await assert.rejects(testGameReleaseUpdateIndex(config), /latestReleaseId/);
    index.games['sample-game'].channels.stable.latestReleaseId = 'release-2';
    (index.games['sample-game'].channels.stable.releases[1] as any).summary = {};
    await assert.rejects(testGameReleaseUpdateIndex(config), /summary\.en-US/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function updateRelease(releaseId: string, version: string) {
  const [core, suffix = ''] = version.split('-');
  return {
    releaseId,
    version,
    versionCore: core!.split('.'),
    suffix,
    channel: 'stable',
    publishedAt: new Date(0).toISOString(),
    title: { 'en-US': 'Sample update' },
    summary: { 'en-US': 'Sample release notes' },
    defaultLanguage: 'en-US',
    required: false,
    maintenance: null,
    packages: [{
      packageId: `${releaseId}-web`,
      platform: 'web',
      architecture: 'web',
      delivery: 'content',
      packageType: 'full',
      url: `games/sample-game/stable/${releaseId}/sample.zip`,
      bytes: 1,
      sha256: 'a'.repeat(64),
      deletedFiles: [],
      targetFiles: [],
    }],
  };
}

function withFixture(
  layout: 'data' | 'www-data',
  run: (fixture: { workflowRoot: string; project: string }) => void,
): void {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-release-test-'));
  const project = path.join(workflowRoot, 'projects', 'sample-game');
  const resourceRoot = layout === 'www-data' ? path.join(project, 'www') : project;
  try {
    fs.mkdirSync(path.join(resourceRoot, 'data'), { recursive: true });
    fs.mkdirSync(path.join(resourceRoot, 'js', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(resourceRoot, 'data', 'System.json'), '{"gameTitle":"Sample Game"}\n', 'utf8');
    fs.writeFileSync(path.join(resourceRoot, 'js', 'plugins.js'), `var $plugins =\n${JSON.stringify([{
      name: 'ExistingPlugin', status: true, description: 'Existing', parameters: {},
    }], null, 2)};\n`, 'utf8');
    run({ workflowRoot, project });
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
}

function readPluginEntries(file: string): Array<{ name: string; status: boolean }> {
  const source = fs.readFileSync(file, 'utf8');
  return JSON.parse(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1));
}
