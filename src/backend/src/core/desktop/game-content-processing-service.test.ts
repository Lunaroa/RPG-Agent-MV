import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import type { GameContentProcessingConfig } from '../../../../contract/game-release.ts';
import { generateGameEncryptionKey, readGameEncryptionKey } from './game-encryption-key-service.ts';
import {
  applyContentProcessing,
  contentCategory,
  preflightAndroidAudio,
  preflightContentProcessing,
} from './game-content-processing-service.ts';

test('Android MV audio preflight rejects missing mobile pairs without modifying source files', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-mobile-audio-'));
  try {
    write(project, 'www/data/System.json', '{}');
    write(project, 'www/audio/se/Sample.ogg', 'audio fixture');
    assert.match(preflightAndroidAudio(project, 'rpg-maker-mv', false).join(), /1 mobile audio.*audio\/se\/Sample\.m4a/);
    assert.equal(fs.existsSync(path.join(project, 'www/audio/se/Sample.m4a')), false);
    assert.deepEqual(preflightAndroidAudio(project, 'rpg-maker-mz', false), []);
    write(project, 'www/audio/se/Sample.m4a', '');
    assert.equal(preflightAndroidAudio(project, 'rpg-maker-mv', false).length, 1);
    write(project, 'www/audio/se/Sample.m4a', 'mobile audio fixture');
    assert.deepEqual(preflightAndroidAudio(project, 'rpg-maker-mv', false), []);
    assert.equal(fs.readFileSync(path.join(project, 'www/audio/se/Sample.ogg'), 'utf8'), 'audio fixture');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Android MV audio preflight checks encrypted mobile files in root-layout projects', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-mobile-encrypted-audio-'));
  try {
    write(project, 'data/System.json', '{}');
    write(project, 'audio/bgm/Sample.rpgmvo', 'encrypted audio fixture');
    write(project, 'audio/bgm/Sample.m4a', 'plain audio fixture');
    assert.match(preflightAndroidAudio(project, 'rpg-maker-mv', true).join(), /Sample\.rpgmvm/);
    write(project, 'audio/bgm/Sample.rpgmvm', 'encrypted mobile audio fixture');
    assert.deepEqual(preflightAndroidAudio(project, 'rpg-maker-mv', true), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('classifies root and www-layout game content without treating runtime files as content', () => {
  assert.equal(contentCategory('data/Map001.json'), 'data');
  assert.equal(contentCategory('www/data/ui-scenes/Scene_Map.mzui'), 'ui');
  assert.equal(contentCategory('www/js/plugins/Sample.js'), 'javascript');
  assert.equal(contentCategory('Game.exe'), null);
});

test('encrypts and obfuscates a build copy and injects a syntactically valid first-party loader', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-content-'));
  const project = path.join(root, 'project');
  const build = path.join(root, 'build');
  try {
    fs.mkdirSync(project, { recursive: true });
    generateGameEncryptionKey(project, 'release-key');
    write(build, 'index.html', '<script src="js/rpg_core.js"></script>\n<script src="js/plugins.js"></script>\n<script src="js/main.js"></script>');
    write(build, 'js/rpg_core.js', 'var core = true;');
    write(build, 'js/plugins.js', 'var $plugins = [];');
    write(build, 'js/main.js', 'var main = true;');
    write(build, 'js/plugins/Sample.js', 'globalThis.samplePlugin = true;');
    write(build, 'data/System.json', '{"gameTitle":"Sample"}');
    write(build, 'data/ui-scenes/Scene_Map.mzui', '{"meta":{"sceneName":"Scene_Map"}}');
    const config: GameContentProcessingConfig = {
      images: 'none', audio: 'none', video: 'none', data: 'encrypt', javascript: 'encrypt', ui: 'obfuscate',
      encryptionKeyId: 'release-key',
    };
    const processed = await applyContentProcessing(root, project, build, config, 'rpg-maker-mv');
    assert.equal(fs.existsSync(path.join(build, 'data', 'System.json')), false);
    assert.equal(fs.existsSync(path.join(build, 'data', 'System.json.rpgagent')), true);
    assert.equal(fs.existsSync(path.join(build, 'js', 'plugins', 'Sample.js')), false);
    assert.equal(fs.existsSync(path.join(build, 'js', 'rpg_core.js')), true);
    assert.equal(fs.existsSync(path.join(build, 'data', 'ui-scenes', 'Scene_Map.mzui.rpgagent')), true);
    assert.equal(processed.records.length, 3);
    const index = fs.readFileSync(path.join(build, 'index.html'), 'utf8');
    assert.ok(index.indexOf('RPGAgentContentLoader.js') < index.indexOf('js/plugins.js'));
    const loader = fs.readFileSync(path.join(build, 'js', 'RPGAgentContentLoader.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(loader));
    const encrypted = fs.readFileSync(path.join(build, 'data', 'System.json.rpgagent'));
    const key = readGameEncryptionKey(project, 'release-key').key;
    assert.equal(decrypt(encrypted, key).toString('utf8'), '{"gameTitle":"Sample"}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release audit: encrypted JavaScript keeps startup libraries executable before the loader', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-startup-content-'));
  const project = path.join(root, 'project');
  const build = path.join(root, 'build');
  try {
    fs.mkdirSync(project, { recursive: true });
    generateGameEncryptionKey(project, 'sample-key');
    write(build, 'index.html', '<script src="js/libs/SampleRenderer.js"></script><script src="js/rpg_core.js"></script><script src="js/plugins.js"></script><script src="js/main.js"></script>');
    write(build, 'js/libs/SampleRenderer.js', 'globalThis.SampleRenderer = { ready: true };');
    write(build, 'js/rpg_core.js', 'if (!SampleRenderer.ready) throw new Error("Missing renderer");');
    write(build, 'js/plugins.js', 'var $plugins = [];');
    write(build, 'js/main.js', 'globalThis.started = SampleRenderer.ready;');
    write(build, 'js/plugins/Sample.js', 'globalThis.samplePlugin = true;');
    await applyContentProcessing(root, project, build, { images: 'none', audio: 'none', video: 'none',
      data: 'none', javascript: 'encrypt', ui: 'none', encryptionKeyId: 'sample-key' }, 'rpg-maker-mv');
    const context = vm.createContext({ fetch: async () => new Response(''), console,
      document: { addEventListener() {}, removeEventListener() {} } });
    const index = fs.readFileSync(path.join(build, 'index.html'), 'utf8');
    for (const match of index.matchAll(/<script src="([^"]+)"><\/script>/g)) {
      const script = path.join(build, match[1]!);
      assert.ok(fs.existsSync(script), `Missing startup dependency: ${match[1]}`);
      vm.runInContext(fs.readFileSync(script, 'utf8'), context);
    }
    assert.equal(context.started, true);
    assert.ok(fs.existsSync(path.join(build, 'js/plugins/Sample.js.rpgagent')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('minifies JSON compression and fails preflight when a selected key is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-content-compress-'));
  const project = path.join(root, 'project');
  const build = path.join(root, 'build');
  try {
    fs.mkdirSync(project, { recursive: true });
    write(build, 'data/Map001.json', '{\n  "displayName": "Start"\n}\n');
    const config: GameContentProcessingConfig = {
      images: 'none', audio: 'none', video: 'none', data: 'compress', javascript: 'none', ui: 'none',
    };
    await applyContentProcessing(root, project, build, config, 'rpg-maker-mv');
    assert.equal(fs.readFileSync(path.join(build, 'data', 'Map001.json'), 'utf8'), '{"displayName":"Start"}');
    const missing: GameContentProcessingConfig = { ...config, data: 'encrypt', encryptionKeyId: 'missing' };
    assert.match(preflightContentProcessing(root, project, missing).blockers.join('\n'), /does not exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const delayedEngine of [false, true]) {
test(delayedEngine ? 'release audit: installs encrypted plugin hooks after MZ engine scripts load'
  : 'loads encrypted and plain plugins sequentially before starting the game', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-plugin-order-'));
  const project = path.join(root, 'project');
  const build = path.join(root, 'build');
  try {
    fs.mkdirSync(project, { recursive: true });
    generateGameEncryptionKey(project, 'release-key');
    write(build, 'index.html', '<script src="js/plugins.js"></script>\n<script src="js/main.js"></script>');
    write(build, 'js/plugins.js', 'var $plugins = [];');
    write(build, 'js/main.js', 'var main = true;');
    write(build, 'js/plugins/Encrypted.js', 'globalThis.encryptedPlugin = true;');
    await applyContentProcessing(root, project, build, {
      images: 'none', audio: 'none', video: 'none', data: 'none', javascript: 'encrypt', ui: 'none',
      encryptionKeyId: 'release-key',
    }, 'rpg-maker-mv');
    const loader = fs.readFileSync(path.join(build, 'js', 'RPGAgentContentLoader.js'), 'utf8');
    const encrypted = fs.readFileSync(path.join(build, 'js', 'plugins', 'Encrypted.js.rpgagent'));
    const order: string[] = [];
    let engineLoad: (() => void) | undefined;
    const engine = {
      PluginManager: { _path: 'js/plugins/', _errorUrls: [] as string[], loadScript() {} },
      SceneManager: { run() { order.push('run'); } },
    };
    const context = vm.createContext({
      URL,
      Blob,
      Response,
      TextDecoder,
      Uint8Array,
      atob,
      crypto: crypto.webcrypto,
      location: { href: 'https://example.test/game/index.html' },
      console,
      setTimeout,
      fetch: async (input: unknown) => {
        if (String(input).endsWith('Encrypted.js.rpgagent')) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return new Response(encrypted, { status: 200 });
        }
        return new Response('', { status: 200 });
      },
      document: {
        addEventListener(_type: string, handler: () => void) { engineLoad = handler; },
        removeEventListener() { engineLoad = undefined; },
        createElement: () => ({ type: '', async: true, src: '', onload: null as null | (() => void), onerror: null }),
        body: {
          appendChild: (script: { src: string; onload: null | (() => void) }) => {
            order.push(script.src.startsWith('blob:') ? 'encrypted' : 'plain');
            setTimeout(() => script.onload?.(), 0);
          },
        },
      },
      ...(delayedEngine ? {} : engine),
    });
    vm.runInContext(loader, context);
    if (delayedEngine) {
      assert.ok(engineLoad, 'MZ bootstrap must wait for engine scripts');
      Object.assign(context, engine);
      engineLoad();
    }
    assert.equal(engineLoad, undefined, 'completed engine hooks must remove the load listener');
    vm.runInContext("PluginManager.loadScript('Encrypted.js'); PluginManager.loadScript('Plain.js'); SceneManager.run('Boot');", context);
    await vm.runInContext('RPGAgentContent.pluginsReady()', context);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(order, ['encrypted', 'plain', 'run']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
}

function decrypt(content: Buffer, key: Buffer): Buffer {
  const magic = Buffer.from('RPGAGENTENC1\n', 'ascii');
  assert.equal(content.subarray(0, magic.length).equals(magic), true);
  const iv = content.subarray(magic.length, magic.length + 12);
  const tag = content.subarray(magic.length + 12, magic.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(content.subarray(magic.length + 28)), decipher.final()]);
}

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
