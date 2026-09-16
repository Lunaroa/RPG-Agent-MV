import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { GameReleaseConfig } from '../../../../contract/game-release.ts';
import {
  createDefaultGameReleaseConfig,
  readGameReleaseStatus,
  saveGameReleaseConfig,
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
