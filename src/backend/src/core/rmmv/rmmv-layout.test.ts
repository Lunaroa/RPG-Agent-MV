import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  assetBucketRelativePath,
  dataRelativePath,
  inspectRmmvProject,
  resolveRmmvLayout,
  RMMV_STANDARD_DATABASE_FILES,
} from './rmmv-layout.ts';

describe('RMMV layout resolver', () => {
  test('resolves www/data layout and resource root', () => {
    const root = tempRoot();
    try {
      writeProject(root, 'www-data');

      const layout = resolveRmmvLayout(root);

      assert.equal(layout.kind, 'www-data');
      assert.equal(layout.dataRootRelative, 'www/data');
      assert.equal(layout.resourceRoot, path.join(root, 'www'));
      assert.equal(dataRelativePath(layout, 'System.json'), 'www/data/System.json');
      assert.equal(assetBucketRelativePath(layout, 'characters'), 'www/img/characters');
    } finally {
      removeRoot(root);
    }
  });

  test('resolves editor data layout and keeps assets at project root', () => {
    const root = tempRoot();
    try {
      writeProject(root, 'data');

      const layout = resolveRmmvLayout(root);

      assert.equal(layout.kind, 'data');
      assert.equal(layout.dataRootRelative, 'data');
      assert.equal(layout.resourceRoot, root);
      assert.equal(dataRelativePath(layout, 'System.json'), 'data/System.json');
      assert.equal(assetBucketRelativePath(layout, 'characters'), 'img/characters');
    } finally {
      removeRoot(root);
    }
  });

  test('inspectRmmvProject reports database, engine and resource structure', () => {
    const root = tempRoot();
    try {
      writeProject(root, 'data');

      const manifest = inspectRmmvProject(root);

      assert.equal(manifest.editable, true);
      assert.equal(manifest.runnableStructure, true);
      assert.equal(manifest.mapFiles.length, 1);
      assert.equal(manifest.mapFiles[0].exists, true);
      for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
        assert.equal(manifest.databaseFiles[fileName], true, `${fileName} should be present`);
      }
      assert.deepEqual(manifest.missingRequired, []);
    } finally {
      removeRoot(root);
    }
  });

  test('inspectRmmvProject fails editable when MapInfos references missing map file', () => {
    const root = tempRoot();
    try {
      writeProject(root, 'data');
      fs.rmSync(path.join(root, 'data', 'Map001.json'));

      const manifest = inspectRmmvProject(root);

      assert.equal(manifest.editable, false);
      assert(manifest.missingRequired.includes('data/Map001.json'));
    } finally {
      removeRoot(root);
    }
  });
});

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rpg-layout-'));
}

function removeRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeProject(root: string, layout: 'www-data' | 'data'): void {
  const resourceRoot = layout === 'www-data' ? path.join(root, 'www') : root;
  const dataDir = path.join(resourceRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'Game.rpgproject'), 'RPGMV 1.6.2', 'utf8');
  fs.writeFileSync(path.join(resourceRoot, 'index.html'), '<!doctype html>', 'utf8');
  fs.writeFileSync(path.join(resourceRoot, 'package.json'), '{"main":"index.html"}', 'utf8');
  fs.mkdirSync(path.join(resourceRoot, 'js', 'plugins'), { recursive: true });
  for (const fileName of ['rpg_core.js', 'rpg_managers.js', 'rpg_objects.js', 'rpg_scenes.js', 'rpg_sprites.js', 'rpg_windows.js', 'main.js']) {
    fs.writeFileSync(path.join(resourceRoot, 'js', fileName), '', 'utf8');
  }
  fs.writeFileSync(path.join(resourceRoot, 'js', 'plugins.js'), 'var $plugins = [];', 'utf8');
  for (const directory of ['audio', 'fonts', 'img', 'movies']) fs.mkdirSync(path.join(resourceRoot, directory), { recursive: true });
  for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
    fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(fileName === 'System.json'
      ? { switches: [null], variables: [null], gameTitle: 'Layout Test' }
      : []), 'utf8');
  }
  fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Start' }]), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({ width: 17, height: 13, tilesetId: 1, data: [], events: [null] }), 'utf8');
}
