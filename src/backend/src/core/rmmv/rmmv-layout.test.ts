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

  test('detects an RPG Maker MZ 1.10.0 project and canvas settings', () => {
    const root = tempRoot();
    try {
      writeMZProject(root, '1.10.0', 24, 1280, 720);

      const manifest = inspectRmmvProject(root);

      assert.equal(manifest.engine, 'rpg-maker-mz');
      assert.equal(manifest.engineVersion, '1.10.0');
      assert.equal(manifest.tileSize, 24);
      assert.equal(manifest.screenWidth, 1280);
      assert.equal(manifest.screenHeight, 720);
      assert.equal(manifest.projectMarker.gameRmmzProject, true);
      assert.equal(manifest.editable, true);
      assert.equal(manifest.runnableStructure, true);
    } finally {
      removeRoot(root);
    }
  });

  test('accepts a recognizable older RPG Maker MZ core and marks it unsupported', () => {
    const root = tempRoot();
    try {
      writeMZProject(root, '1.9.0', 48, 816, 624);
      const manifest = inspectRmmvProject(root);
      assert.equal(manifest.engineVersion, '1.9.0');
      assert.equal(manifest.engineVersionSupported, false);
    } finally {
      removeRoot(root);
    }
  });

  test('rejects an MZ core that does not report a recognizable version', () => {
    const root = tempRoot();
    try {
      writeMZProject(root, 'legacy', 48, 816, 624);
      assert.throws(() => inspectRmmvProject(root), /recognizable semantic version/);
    } finally {
      removeRoot(root);
    }
  });

  test('accepts an MZ project without an editor marker but still rejects mixed engines', () => {
    const deployedRoot = tempRoot();
    const mixedRoot = tempRoot();
    try {
      writeMZProject(deployedRoot, '1.10.0', 48, 816, 624);
      fs.rmSync(path.join(deployedRoot, 'game.rmmzproject'));
      const manifest = inspectRmmvProject(deployedRoot);
      assert.equal(manifest.engine, 'rpg-maker-mz');
      assert.equal(manifest.projectMarker.gameRmmzProject, false);
      assert.equal(manifest.editable, true);

      writeMZProject(mixedRoot, '1.10.0', 48, 816, 624);
      fs.writeFileSync(path.join(mixedRoot, 'Game.rpgproject'), 'RPGMV 1.6.2', 'utf8');
      assert.throws(() => inspectRmmvProject(mixedRoot), /Conflicting RPG Maker MV\/MZ/);
    } finally {
      removeRoot(deployedRoot);
      removeRoot(mixedRoot);
    }
  });

  test('records encrypted MZ resources and rejects conflicting data roots', () => {
    const encryptedRoot = tempRoot();
    const encryptedFileRoot = tempRoot();
    const mixedDataRoot = tempRoot();
    try {
      writeMZProject(encryptedRoot, '1.10.0', 48, 816, 624);
      const encryptedSystemFile = path.join(encryptedRoot, 'data', 'System.json');
      const encryptedSystem = JSON.parse(fs.readFileSync(encryptedSystemFile, 'utf8'));
      fs.writeFileSync(encryptedSystemFile, JSON.stringify({
        ...encryptedSystem,
        hasEncryptedImages: true,
        hasEncryptedAudio: true,
      }), 'utf8');
      const encryptedManifest = inspectRmmvProject(encryptedRoot);
      assert.equal(encryptedManifest.editable, true);
      assert.equal(encryptedManifest.encryptedResources, true);
      assert.equal(encryptedManifest.encryptedImages, true);
      assert.equal(encryptedManifest.encryptedAudio, true);

      writeMZProject(encryptedFileRoot, '1.10.0', 48, 816, 624);
      const encryptedAsset = path.join(encryptedFileRoot, 'img', 'pictures', 'nested', 'Sample.png_');
      fs.mkdirSync(path.dirname(encryptedAsset), { recursive: true });
      fs.writeFileSync(encryptedAsset, 'encrypted', 'utf8');
      const encryptedFileManifest = inspectRmmvProject(encryptedFileRoot);
      assert.equal(encryptedFileManifest.encryptedResources, true);
      assert.equal(encryptedFileManifest.encryptedImages, true);

      writeMZProject(mixedDataRoot, '1.10.0', 48, 816, 624);
      fs.mkdirSync(path.join(mixedDataRoot, 'www', 'data'), { recursive: true });
      assert.throws(() => inspectRmmvProject(mixedDataRoot), /Conflicting RPG Maker source\/deployment data folders/);
    } finally {
      removeRoot(encryptedRoot);
      removeRoot(encryptedFileRoot);
      removeRoot(mixedDataRoot);
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

function writeMZProject(
  root: string,
  version: string,
  tileSize: 16 | 24 | 32 | 48,
  screenWidth: number,
  screenHeight: number,
): void {
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'game.rmmzproject'), 'RPGMZ', 'utf8');
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>', 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), '{"main":"index.html"}', 'utf8');
  fs.mkdirSync(path.join(root, 'js', 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'js', 'rmmz_core.js'),
    `Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "${version}";\n`,
    'utf8',
  );
  for (const fileName of ['rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js', 'main.js']) {
    fs.writeFileSync(path.join(root, 'js', fileName), '', 'utf8');
  }
  fs.writeFileSync(path.join(root, 'js', 'plugins.js'), 'var $plugins = [];', 'utf8');
  for (const directory of ['audio', 'fonts', 'img', 'movies', 'effects']) fs.mkdirSync(path.join(root, directory), { recursive: true });
  for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
    fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(fileName === 'System.json'
      ? {
          switches: [null],
          variables: [null],
          gameTitle: 'MZ Layout Test',
          tileSize,
          faceSize: 144,
          iconSize: 32,
          advanced: { screenWidth, screenHeight },
        }
      : []), 'utf8');
  }
  fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Start' }]), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({ width: 17, height: 13, tilesetId: 1, data: [], events: [null] }), 'utf8');
}
