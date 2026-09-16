import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  createGameManifestSigningIdentity,
  signGameReleaseManifest,
} from '../game-manifest-signing-service.ts';

const pluginSource = fs.readFileSync(new URL('./RPGAgentUpdater.js', import.meta.url), 'utf8');

test('uses the channel latest pointer and offers same-version repair only for a different release id', async () => {
  const index = {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    games: {
      'sample-game': {
        channels: {
          stable: {
            latestReleaseId: 'release-current-repair',
            maintenance: null,
            releases: [
              release('release-newer-history', '9.0.0'),
              release('release-current-repair', '1.2.3'),
            ],
          },
        },
      },
    },
  };
  const storage = new Map([['rpgAgentReleaseId', 'release-old']]);
  function SceneBoot(this: unknown) {}
  SceneBoot.prototype.start = function() {};
  const currentVersion = '1.2.3';
  const context = vm.createContext({
    console,
    URL,
    Scene_Boot: SceneBoot,
    setTimeout,
    navigator: { language: 'en-US' },
    localStorage: {
      getItem(key: string) { return storage.get(key) || null; },
      setItem(key: string, value: string) { storage.set(key, value); },
    },
    fetch: async () => ({ ok: true, json: async () => index }),
    RPGAgentVersion: {
      getVersion: () => currentVersion,
      compare(value: string) { return compare(currentVersion, value); },
    },
    $dataRPGAgentRelease: {
      schemaVersion: 1,
      gameId: 'sample-game',
      version: currentVersion,
      channel: 'stable',
      update: { enabled: true, indexUrl: 'https://updates.invalid/releases.json', checkOnStart: false, policy: 'optional' },
    },
  }) as vm.Context & Record<string, any>;
  vm.runInContext(pluginSource, context, { filename: 'RPGAgentUpdater.js' });
  const result = await context.RPGAgentUpdater.check({ show: false });
  assert.equal(result.status, 'available');
  assert.equal(result.release.releaseId, 'release-current-repair');
  assert.equal(result.packages.length, 1);

  const automatic = await context.RPGAgentUpdater.check({ show: false, manual: false });
  assert.equal(automatic.status, 'current');

  storage.set('rpgAgentReleaseId', 'release-current-repair');
  const current = await context.RPGAgentUpdater.check({ show: false });
  assert.equal(current.status, 'current');
});

test('accepts an authentic game manifest and rejects a changed signed channel', async () => {
  const identity = createGameManifestSigningIdentity('manifest-signing-runtime-test');
  const signatureConfig = {
    enabled: true,
    algorithm: identity.algorithm,
    keyId: identity.keyId,
    publicKey: identity.publicKey,
  };
  const game = {
    channels: {
      stable: {
        latestReleaseId: 'release-signed',
        maintenance: null,
        releases: [release('release-signed', '1.2.4')],
      },
    },
  };
  const signedGame = { ...game, signature: signGameReleaseManifest('sample-game', game, signatureConfig, identity.privateKey) };
  const index = {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    games: { 'sample-game': signedGame },
  };
  const context = updaterContext(index, signatureConfig);
  vm.runInContext(pluginSource, context, { filename: 'RPGAgentUpdater.js' });
  assert.equal((await context.RPGAgentUpdater.check({ show: false })).status, 'available');

  signedGame.channels.stable.latestReleaseId = 'changed-release';
  const rejected = await context.RPGAgentUpdater.check({ show: false });
  assert.equal(rejected.status, 'error');
  assert.match(rejected.error, /payload has been changed|verification failed/);
});

test('downloads a Windows startup update in the background and asks before installation', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-updater-background-'));
  try {
    const fileContent = Buffer.from('x');
    const fileSha256 = createHash('sha256').update(fileContent).digest('hex');
    const packageSha256 = createHash('sha256')
      .update(`game.dat\0${fileContent.byteLength}\0${fileSha256}\n`, 'utf8')
      .digest('hex');
    const candidate = release('release-background', '1.2.4');
    candidate.packages = [{
      packageId: 'release-background-windows',
      platform: 'windows',
      architecture: 'x64',
      delivery: 'content',
      packageType: 'full',
      url: 'games/sample/stable/release-background/windows/',
      bytes: fileContent.byteLength,
      sha256: packageSha256,
      packageFiles: [{ path: 'game.dat', bytes: fileContent.byteLength, sha256: fileSha256, processing: 'none' }],
      deletedFiles: [],
      targetFiles: [{ path: 'game.dat', bytes: fileContent.byteLength, sha256: fileSha256, processing: 'none' }],
    }];
    const index = {
      schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      games: {
        'sample-game': {
          channels: {
            stable: { latestReleaseId: candidate.releaseId, maintenance: null, releases: [candidate] },
          },
        },
      },
    };
    const scheduled: Array<() => unknown> = [];
    const dom = createDocument();
    function SceneBoot(this: unknown) {}
    SceneBoot.prototype.start = function() {};
    const runtimeRequire = (specifier: string) => {
      if (specifier === 'node:fs') return fs;
      if (specifier === 'node:path') return path;
      if (specifier === 'node:os') return { ...os, tmpdir: () => temporaryRoot };
      if (specifier === 'node:crypto') return { createHash };
      throw new Error(`Unexpected runtime module: ${specifier}`);
    };
    const context = vm.createContext({
      Buffer,
      console,
      crypto: webcrypto,
      document: dom.document,
      navigator: { language: 'en-US' },
      URL,
      process: {
        arch: 'x64',
        argv: [],
        execPath: path.join(temporaryRoot, 'Game.exe'),
        pid: 123,
        versions: { nw: 'test' },
      },
      require: runtimeRequire,
      Scene_Boot: SceneBoot,
      setTimeout(callback: () => unknown) { scheduled.push(callback); return 1; },
      fetch: async (url: string) => {
        if (String(url).endsWith('releases.json')) return { ok: true, json: async () => index };
        let delivered = false;
        return {
          ok: true,
          headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? String(fileContent.byteLength) : null },
          body: {
            getReader: () => ({
              async read() {
                if (delivered) return { done: true };
                delivered = true;
                return { done: false, value: new Uint8Array(fileContent) };
              },
            }),
          },
        };
      },
      RPGAgentVersion: {
        getVersion: () => '1.2.3',
        compare(value: string) { return compare('1.2.3', value); },
      },
      $dataRPGAgentRelease: {
        schemaVersion: 1,
        gameId: 'sample-game',
        version: '1.2.3',
        channel: 'stable',
        update: {
          enabled: true,
          indexUrl: 'https://updates.invalid/releases.json',
          checkOnStart: true,
          backgroundDownload: true,
          policy: 'optional',
        },
      },
    }) as vm.Context & Record<string, any>;
    vm.runInContext(pluginSource, context, { filename: 'RPGAgentUpdater.js' });
    context.Scene_Boot.prototype.start();
    assert.equal(scheduled.length, 1);
    await scheduled[0]!();

    const state = context.RPGAgentUpdater.getState();
    assert.equal(state.downloading, false);
    assert.equal(state.available.release.releaseId, 'release-background');
    assert.equal(state.progress.received, fileContent.byteLength, JSON.stringify(state));
    assert.equal(dom.document.getElementById('rpg-agent-updater-background'), null);
    assert.ok(dom.document.getElementById('rpg-agent-updater-overlay'));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function updaterContext(index: unknown, manifestSignature: unknown): vm.Context & Record<string, any> {
  function SceneBoot(this: unknown) {}
  SceneBoot.prototype.start = function() {};
  return vm.createContext({
    console,
    URL,
    TextEncoder,
    crypto: webcrypto,
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    Scene_Boot: SceneBoot,
    setTimeout,
    navigator: { language: 'en-US' },
    localStorage: { getItem: () => '', setItem: () => undefined },
    fetch: async () => ({ ok: true, json: async () => index }),
    RPGAgentVersion: { getVersion: () => '1.2.3', compare: () => 0 },
    $dataRPGAgentRelease: {
      schemaVersion: 1,
      gameId: 'sample-game',
      version: '1.2.3',
      channel: 'stable',
      update: {
        enabled: true,
        indexUrl: 'https://updates.invalid/releases.json',
        checkOnStart: false,
        policy: 'optional',
        manifestSignature,
      },
    },
  }) as vm.Context & Record<string, any>;
}

function release(releaseId: string, version: string) {
  return {
    releaseId,
    version,
    versionCore: version.split('.'),
    suffix: '',
    channel: 'stable',
    publishedAt: '2026-01-01T00:00:00.000Z',
    title: { 'en-US': 'Update' },
    summary: { 'en-US': 'Summary' },
    defaultLanguage: 'en-US',
    required: false,
    maintenance: null,
    packages: [{
      packageId: `${releaseId}-web`,
      platform: 'web',
      architecture: 'web',
      delivery: 'content',
      packageType: 'full',
      url: `games/sample/stable/${releaseId}/web/`,
      bytes: 1,
      sha256: 'a'.repeat(64),
      packageFiles: [{ path: 'index.html', bytes: 1, sha256: 'b'.repeat(64), processing: 'none' }],
      deletedFiles: [],
      targetFiles: [{ path: 'index.html', bytes: 1, sha256: 'b'.repeat(64), processing: 'none' }],
    }],
  };
}

function compare(left: string, right: string): number {
  const a = left.split('-')[0]!.split('.').map((value) => BigInt(value));
  const b = right.split('-')[0]!.split('.').map((value) => BigInt(value));
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! < b[index]!) return -1;
    if (a[index]! > b[index]!) return 1;
  }
  return 0;
}

function createDocument() {
  class Element {
    id = '';
    type = '';
    textContent = '';
    disabled = false;
    onclick: null | (() => unknown) = null;
    parent: Element | null = null;
    children: Element[] = [];
    style = { cssText: '' };

    append(...children: Element[]) {
      for (const child of children) this.appendChild(child);
    }

    appendChild(child: Element) {
      child.parent = this;
      this.children.push(child);
      return child;
    }

    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }

  const body = new Element();
  const find = (node: Element, id: string): Element | null => {
    if (node.id === id) return node;
    for (const child of node.children) {
      const match = find(child, id);
      if (match) return match;
    }
    return null;
  };
  return {
    document: {
      body,
      createElement: () => new Element(),
      getElementById: (id: string) => find(body, id),
    },
  };
}
