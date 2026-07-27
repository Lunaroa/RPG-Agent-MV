import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { patchProjectConfig, readProjectConfig } from './project-config-service.ts';

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-rpg-config-'));
const configPath = path.join(projectRoot, '.luna_rpg', 'config.json');

after(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('luna_rpg project config', () => {
  test('returns an empty config when the file does not exist', () => {
    assert.deepEqual(readProjectConfig(projectRoot), {});
  });

  test('persists preview-disabled plugins under .luna_rpg/config.json', () => {
    const result = patchProjectConfig(projectRoot, { previewDisabledPlugins: ['PluginA', 'PluginB'] });
    assert.deepEqual(result.previewDisabledPlugins, ['PluginA', 'PluginB']);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), {
      previewDisabledPlugins: ['PluginA', 'PluginB'],
    });
    assert.deepEqual(readProjectConfig(projectRoot), result);
  });

  test('clearing the last field removes the config file and empty folder', () => {
    patchProjectConfig(projectRoot, { previewDisabledPlugins: [] });
    assert.equal(fs.existsSync(configPath), false);
    assert.equal(fs.existsSync(path.join(projectRoot, '.luna_rpg')), false);
  });

  test('drops non-string entries instead of persisting junk', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ previewDisabledPlugins: ['Real', 42, ' '] }), 'utf8');
    assert.deepEqual(readProjectConfig(projectRoot).previewDisabledPlugins, ['Real']);
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
  });

  test('surfaces a corrupt config instead of silently replacing it', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{ not json', 'utf8');
    assert.throws(() => readProjectConfig(projectRoot));
    assert.throws(() => patchProjectConfig(projectRoot, { previewDisabledPlugins: ['X'] }));
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
  });
});
