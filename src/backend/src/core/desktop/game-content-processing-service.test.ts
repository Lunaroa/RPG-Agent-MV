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
  preflightContentProcessing,
} from './game-content-processing-service.ts';

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
