import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import type { GameReleaseRecord } from '../../../../../contract/game-release.ts';
import {
  createGameManifestSigningIdentity,
  signGameReleaseManifest,
} from '../game-manifest-signing-service.ts';

const pluginSource = fs.readFileSync(new URL('./RPGAgentUpdater.js', import.meta.url), 'utf8');

test('uses the channel latest pointer and offers same-version repair only for a different release id', async () => {
  const index = {
    schemaVersion: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    games: {
      'sample-game': {
        channels: {
          stable: {
            latestReleaseId: 'release-current-repair',
            latestReleaseIds: { 'web/web': 'release-current-repair' },
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
  loadPlugin(context);
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

test('release audit: updater selects only the explicit current platform release', async () => {
  const web = release('web-current', '1.2.4');
  const windows = release('windows-current', '1.2.5');
  windows.packages[0]!.platform = 'windows';
  windows.packages[0]!.architecture = 'x64';
  const channel = { latestReleaseId: windows.releaseId,
    latestReleaseIds: { 'web/web': web.releaseId, 'windows/x64': windows.releaseId } as Record<string, string>,
    maintenance: null, releases: [web, windows, release('unpromoted-web', '9.0.0')] };
  const context = updaterContext({ schemaVersion: 2, generatedAt: new Date(0).toISOString(),
    games: { 'sample-game': { channels: { stable: channel } } } }, undefined);
  loadPlugin(context);
  assert.equal((await context.RPGAgentUpdater.check({ show: false })).release.releaseId, web.releaseId);
  channel.latestReleaseIds['web/web'] = 'missing-release';
  assert.equal((await context.RPGAgentUpdater.check({ show: false })).status, 'error');
  delete channel.latestReleaseIds['web/web'];
  assert.equal((await context.RPGAgentUpdater.check({ show: false })).status, 'current');
  delete (channel as { latestReleaseIds?: unknown }).latestReleaseIds;
  assert.match((await context.RPGAgentUpdater.check({ show: false })).error, /regenerate/);
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
        latestReleaseIds: { 'web/web': 'release-signed' },
        maintenance: null,
        releases: [release('release-signed', '1.2.4')],
      },
    },
  };
  const signedGame = { ...game, signature: signGameReleaseManifest('sample-game', game, signatureConfig, identity.privateKey) };
  const index = {
    schemaVersion: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    games: { 'sample-game': signedGame },
  };
  const context = updaterContext(index, signatureConfig);
  loadPlugin(context);
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
      schemaVersion: 2,
      generatedAt: '2026-01-01T00:00:00.000Z',
      games: {
        'sample-game': {
          channels: {
            stable: { latestReleaseId: candidate.releaseId, latestReleaseIds: { 'windows/x64': candidate.releaseId }, maintenance: null, releases: [candidate] },
          },
        },
      },
    };
    const scheduled: Array<() => unknown> = [];
    const launches: string[][] = [];
    let exited = false;
    const dom = createDocument();
    function SceneBoot(this: unknown) {}
    SceneBoot.prototype.start = function() {};
    const runtimeRequire = (specifier: string) => {
      if (specifier === 'fs') return fs;
      if (specifier === 'path') return path;
      if (specifier === 'os') return { ...os, tmpdir: () => temporaryRoot };
      if (specifier === 'crypto') return { createHash };
      if (specifier === 'child_process') return {
        spawn: (_executable: string, args: string[]) => {
          launches.push(Array.from(args));
          return { unref() {} };
        },
      };
      if (specifier === path.join(temporaryRoot, '.rpg-agent', 'updater', 'filesystem.cjs')) {
        return createRequire(import.meta.url)('../game-windows-updater-runtime/filesystem.cjs');
      }
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
      nw: { App: { argv: [], quit() { exited = true; } } },
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
    loadPlugin(context);
    context.Scene_Boot.prototype.start();
    assert.equal(scheduled.length, 1);
    await scheduled[0]!();

    const state = context.RPGAgentUpdater.getState();
    assert.equal(state.downloading, false);
    assert.equal(state.available.release.releaseId, 'release-background');
    assert.equal(state.progress.received, fileContent.byteLength, JSON.stringify(state));
    assert.equal(dom.document.getElementById('rpg-agent-updater-background'), null);
    assert.ok(dom.document.getElementById('rpg-agent-updater-overlay'));
    assert.equal(launches.length, 0);
    assert.equal(exited, false);
    const helperDirectory = path.join(temporaryRoot, '.rpg-agent', 'updater');
    fs.mkdirSync(helperDirectory, { recursive: true });
    fs.writeFileSync(path.join(helperDirectory, 'launcher.js'), 'test launcher', 'utf8');
    fs.writeFileSync(path.join(temporaryRoot, 'Game.exe'), 'test executable', 'utf8');
    const button = allElements(dom.document.body).find(element => element.tag === 'button' && /Full update/.test(element.textContent));
    assert.ok(button);
    await button.onclick?.();
    assert.equal(launches.length, 1);
    assert.equal(launches[0]![0], path.join(helperDirectory, 'launcher.js'));
    assert.equal(path.basename(launches[0]![1]!), 'plan.json');
    assert.equal(exited, true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('uses the game locale and offers reload instead of an impossible Web self-update', async () => {
  const candidate = release('release-web', '1.2.4');
  const index = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    games: {
      'sample-game': {
        channels: { stable: { latestReleaseId: candidate.releaseId, latestReleaseIds: { 'web/web': candidate.releaseId }, maintenance: null, releases: [candidate] } },
      },
    },
  };
  const dom = createDocument();
  let reloads = 0;
  function SceneBoot(this: unknown) {}
  SceneBoot.prototype.start = function() {};
  const context = vm.createContext({
    console,
    URL,
    document: dom.document,
    location: { reload() { reloads += 1; } },
    navigator: { language: 'en-US' },
    $dataSystem: { locale: 'zh-CN' },
    Scene_Boot: SceneBoot,
    SceneManager: { exit() {} },
    setTimeout,
    localStorage: { getItem: () => '', setItem: () => undefined },
    fetch: async () => ({ ok: true, json: async () => index }),
    RPGAgentVersion: { getVersion: () => '1.2.3', compare: (value: string) => compare('1.2.3', value) },
    $dataRPGAgentRelease: {
      schemaVersion: 1,
      gameId: 'sample-game',
      version: '1.2.3',
      channel: 'stable',
      update: { enabled: true, indexUrl: 'https://updates.invalid/releases.json', checkOnStart: false, policy: 'optional' },
    },
  }) as vm.Context & Record<string, any>;
  loadPlugin(context);
  assert.equal((await context.RPGAgentUpdater.check({ show: true })).status, 'available');
  const buttons = allElements(dom.document.body).filter((element) => element.tag === 'button');
  assert.deepEqual(buttons.map((button) => button.textContent), ['稍后再说', '重新载入']);
  assert.match(allElements(dom.document.body).map((element) => element.textContent).join('\n'), /站点维护者/);
  await buttons[1]!.onclick?.();
  assert.equal(reloads, 1);
});

test('keeps Android progress active until a native callback and enables retry after failure', async () => {
  const candidate = release('release-android', '1.2.4');
  candidate.packages = [{
    ...candidate.packages[0],
    packageId: 'release-android-content',
    platform: 'android',
    architecture: 'universal',
    delivery: 'content',
  }];
  const index = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    games: {
      'sample-game': {
        channels: { stable: { latestReleaseId: candidate.releaseId, latestReleaseIds: { 'android/arm64-v8a': candidate.releaseId }, maintenance: null, releases: [candidate] } },
      },
    },
  };
  const dom = createDocument();
  let handoffs = 0;
  function SceneBoot(this: unknown) {}
  SceneBoot.prototype.start = function() {};
  const context = vm.createContext({
    console,
    URL,
    document: dom.document,
    navigator: { language: 'en-US' },
    Scene_Boot: SceneBoot,
    setTimeout,
    fetch: async () => ({ ok: true, json: async () => index }),
    RPGAgentAndroid: {
      getAbi: () => 'arm64-v8a',
      getCurrentReleaseId: () => 'release-old',
      installContentUpdate: () => { handoffs += 1; return true; },
    },
    RPGAgentVersion: { getVersion: () => '1.2.3', compare: (value: string) => compare('1.2.3', value) },
    $dataRPGAgentRelease: {
      schemaVersion: 1,
      gameId: 'sample-game',
      version: '1.2.3',
      channel: 'stable',
      update: { enabled: true, indexUrl: 'https://updates.invalid/releases.json', checkOnStart: false, policy: 'optional' },
    },
  }) as vm.Context & Record<string, any>;
  loadPlugin(context);
  await context.RPGAgentUpdater.check({ show: true });
  const button = allElements(dom.document.body).find((element) => element.tag === 'button' && /Full update/.test(element.textContent));
  assert.ok(button);
  let gameTouches = 0;
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel',
    'mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
    dom.document.body.addEventListener(type, (event) => {
      gameTouches += 1;
      event.preventDefault();
    });
    const event = button!.dispatchBubbling(type);
    assert.equal(event.defaultPrevented, false, 'The browser must still generate the button click.');
    assert.equal(event.propagationStopped, true, 'Touches must not reach the game input handler.');
  }
  assert.equal(gameTouches, 0);
  await button!.onclick?.();
  assert.equal(handoffs, 1);
  assert.equal(context.RPGAgentUpdater.getState().downloading, true);
  assert.equal(button!.disabled, true);
  assert.equal(context.RPGAgentUpdater.handleNativeEvent({
    stage: 'downloading', received: 25, total: 100, bytesPerSecond: 10,
  }), true);
  assert.equal(context.RPGAgentUpdater.getState().progress.received, 25);
  assert.equal(context.RPGAgentUpdater.handleNativeEvent({ stage: 'error', message: 'Network unavailable' }), true);
  assert.equal(context.RPGAgentUpdater.getState().downloading, false);
  assert.equal(button!.disabled, false);
  await button!.onclick?.();
  assert.equal(handoffs, 2);
  assert.equal(context.RPGAgentUpdater.getState().lastError, null);
});

function loadPlugin(context: vm.Context & Record<string, any>): void {
  context.window = context;
  context.globalThis = undefined;
  vm.runInContext(pluginSource, context, { filename: 'RPGAgentUpdater.js' });
}

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

function release(releaseId: string, version: string): GameReleaseRecord {
  const [core, suffix = ''] = version.split('-');
  const [major, minor, patch] = core!.split('.');
  return {
    releaseId,
    version,
    versionCore: [major!, minor!, patch!],
    suffix,
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
    tag: string;
    id = '';
    type = '';
    textContent = '';
    disabled = false;
    onclick: null | (() => unknown) = null;
    parent: Element | null = null;
    children: Element[] = [];
    style = { cssText: '' };
    listeners = new Map<string, Array<(event: { stopPropagation(): void; preventDefault(): void }) => void>>();

    constructor(tag = '') {
      this.tag = tag;
    }

    addEventListener(type: string, listener: (event: { stopPropagation(): void; preventDefault(): void }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }

    dispatchBubbling(type: string) {
      const event = {
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
      };
      let current: Element | null = this;
      while (current) {
        for (const listener of current.listeners.get(type) || []) listener(event);
        if (event.propagationStopped) break;
        current = current.parent;
      }
      return event;
    }

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
      createElement: (tag: string) => new Element(tag),
      getElementById: (id: string) => find(body, id),
    },
  };
}

function allElements(root: any): any[] {
  return [root, ...root.children.flatMap((child: any) => allElements(child))];
}
