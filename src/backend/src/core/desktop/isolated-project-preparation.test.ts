import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import {
  cleanupIsolatedProject,
  prepareIsolatedStagedProject,
  removeTemporaryProjectTreeSafely,
  verifyIsolatedSourceState,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts';
import { deleteStagedProjectFile, writeStagedProjectJson } from './staging-service.ts';

const FIXED_TIME = new Date('2026-01-02T03:04:05.678Z');

describe('isolated staged project preparation (junction + hybrid fingerprint)', { concurrency: false }, () => {
  let root: string;
  let project: string;
  let preparation: IsolatedProjectPreparation | null;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-isolated-prep-test-'));
    project = path.join(root, 'projects', 'sample');
    preparation = null;
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
    writeMZProject(project);
  });

  afterEach(() => {
    if (preparation && fs.existsSync(preparation.temporaryProject)) cleanupIsolatedProject(preparation);
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('junctions untouched asset trees and copies data/js physically', () => {
    preparation = prepareIsolatedStagedProject(root, project);
    const temp = preparation.temporaryProject;

    assert.equal(fs.lstatSync(path.join(temp, 'data')).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(path.join(temp, 'js')).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(path.join(temp, 'audio')).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(temp, 'img')).isSymbolicLink(), true);
    // Junctions stay readable like plain directories for the game runtime.
    assert.equal(fs.readFileSync(path.join(temp, 'audio', 'bgm', 'Theme.ogg'), 'utf8'), 'bgm-bytes');
    assert.equal(fs.readFileSync(path.join(temp, 'index.html'), 'utf8'), '<html></html>');
    assert.equal(fs.existsSync(path.join(temp, 'save')), false);
    assert.equal(preparation.savesExcluded, true);
    assert.deepEqual(verifyIsolatedSourceState(root, preparation), {
      sourceUnchanged: true,
      savesUnchanged: true,
      stagingUnchanged: true,
    });
  });

  test('materializes directories with staged overlays so writes never cross a junction', () => {
    writeStagedProjectJson(root, project, 'img/notes/pin.json', { staged: true });
    preparation = prepareIsolatedStagedProject(root, project);
    const temp = preparation.temporaryProject;

    assert.equal(fs.lstatSync(path.join(temp, 'img')).isSymbolicLink(), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp, 'img', 'notes', 'pin.json'), 'utf8')), { staged: true });
    assert.equal(fs.existsSync(path.join(project, 'img', 'notes', 'pin.json')), false);
    // Directories without staged files stay junctioned.
    assert.equal(fs.lstatSync(path.join(temp, 'audio')).isSymbolicLink(), true);
  });

  test('staged deletions materialize their directory and never delete source files', () => {
    deleteStagedProjectFile(root, project, 'audio/bgm/Theme.ogg');
    preparation = prepareIsolatedStagedProject(root, project);
    const temp = preparation.temporaryProject;

    assert.equal(fs.lstatSync(path.join(temp, 'audio')).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(temp, 'audio', 'bgm', 'Theme.ogg')), false);
    assert.equal(fs.readFileSync(path.join(project, 'audio', 'bgm', 'Theme.ogg'), 'utf8'), 'bgm-bytes');
  });

  test('cleanup removes junction links without reaching through to the source project', () => {
    preparation = prepareIsolatedStagedProject(root, project);
    const temp = preparation.temporaryProject;
    cleanupIsolatedProject(preparation);
    preparation = null;

    assert.equal(fs.existsSync(temp), false);
    assert.equal(fs.readFileSync(path.join(project, 'audio', 'bgm', 'Theme.ogg'), 'utf8'), 'bgm-bytes');
    assert.equal(fs.readFileSync(path.join(project, 'img', 'pictures', 'Hero.png'), 'utf8'), 'png-bytes');
  });

  test('safe tree removal detaches links via lstat instead of trusting recursive rm', () => {
    // Electron's bundled Node follows junctions inside fs.rmSync({ recursive: true })
    // and wipes the link target, so the remover must never delegate traversal to rm.
    const target = path.join(root, 'link-target');
    fs.mkdirSync(path.join(target, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(target, 'nested', 'asset.png'), 'asset-bytes', 'utf8');
    const doomed = path.join(root, 'doomed');
    fs.mkdirSync(path.join(doomed, 'plain'), { recursive: true });
    fs.writeFileSync(path.join(doomed, 'plain', 'file.txt'), 'file-bytes', 'utf8');
    fs.symlinkSync(target, path.join(doomed, 'junctioned'), 'junction');
    fs.symlinkSync(target, path.join(doomed, 'plain', 'nested-junction'), 'junction');

    removeTemporaryProjectTreeSafely(doomed);

    assert.equal(fs.existsSync(doomed), false);
    assert.equal(fs.readFileSync(path.join(target, 'nested', 'asset.png'), 'utf8'), 'asset-bytes');
  });

  test('hybrid fingerprint keeps byte evidence for data/js and metadata evidence for assets', () => {
    preparation = prepareIsolatedStagedProject(root, project);

    // Same-size data change with a restored mtime is still detected (content hash).
    const systemPath = path.join(project, 'data', 'System.json');
    const body = fs.readFileSync(systemPath, 'utf8');
    fs.writeFileSync(systemPath, body.replace('"A"', '"B"'), 'utf8');
    fs.utimesSync(systemPath, FIXED_TIME, FIXED_TIME);
    assert.equal(verifyIsolatedSourceState(root, preparation).sourceUnchanged, false);
    fs.writeFileSync(systemPath, body, 'utf8');
    fs.utimesSync(systemPath, FIXED_TIME, FIXED_TIME);
    assert.equal(verifyIsolatedSourceState(root, preparation).sourceUnchanged, true);

    // Asset content swapped in place with a preserved size + mtime is out of
    // fingerprint scope by design (metadata-only evidence for asset trees)...
    const assetPath = path.join(project, 'img', 'pictures', 'Hero.png');
    fs.writeFileSync(assetPath, 'png-bytez', 'utf8');
    fs.utimesSync(assetPath, FIXED_TIME, FIXED_TIME);
    assert.equal(verifyIsolatedSourceState(root, preparation).sourceUnchanged, true);

    // ...but any asset size or mtime drift is detected by the metadata scan.
    fs.utimesSync(assetPath, FIXED_TIME, new Date(FIXED_TIME.getTime() + 1234));
    assert.equal(verifyIsolatedSourceState(root, preparation).sourceUnchanged, false);
  });

  test('applies the same physical/junction split inside the MV www layout', () => {
    const mv = path.join(root, 'projects', 'mv-sample');
    writeMVProject(mv);
    preparation = prepareIsolatedStagedProject(root, mv);
    const temp = preparation.temporaryProject;

    assert.equal(fs.lstatSync(path.join(temp, 'www')).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(path.join(temp, 'www', 'data')).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(path.join(temp, 'www', 'js')).isSymbolicLink(), false);
    assert.equal(fs.lstatSync(path.join(temp, 'www', 'img')).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(temp, 'www', 'save')), false);
    assert.equal(fs.readFileSync(path.join(temp, 'Game.exe'), 'utf8'), 'mv-exe');
  });
});

function writeMZProject(project: string): void {
  writeProjectFile(project, 'index.html', '<html></html>');
  writeProjectFile(project, 'game.rmmzproject', 'RPGMZ 1.0.0');
  writeProjectFile(project, 'data/System.json', '{"gameTitle":"A"}');
  writeProjectFile(project, 'data/Map001.json', '{"width":1,"height":1}');
  writeProjectFile(project, 'js/main.js', 'const scriptUrls = ["js/plugins.js"];');
  writeProjectFile(project, 'audio/bgm/Theme.ogg', 'bgm-bytes');
  writeProjectFile(project, 'img/pictures/Hero.png', 'png-bytes');
  writeProjectFile(project, 'save/file1.rmmzsave', 'private-save');
  freezeTimes(project);
}

function writeMVProject(project: string): void {
  writeProjectFile(project, 'Game.exe', 'mv-exe');
  writeProjectFile(project, 'Game.rpgproject', 'RPGMV 1.6.1');
  writeProjectFile(project, 'www/index.html', '<html></html>');
  writeProjectFile(project, 'www/data/System.json', '{"gameTitle":"A"}');
  writeProjectFile(project, 'www/js/main.js', 'PluginManager.setup($plugins);');
  writeProjectFile(project, 'www/img/pictures/Hero.png', 'png-bytes');
  writeProjectFile(project, 'www/save/file1.rpgsave', 'private-save');
  freezeTimes(project);
}

function writeProjectFile(project: string, relative: string, body: string): void {
  const target = path.join(project, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
}

function freezeTimes(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else fs.utimesSync(absolute, FIXED_TIME, FIXED_TIME);
    }
  };
  visit(root);
}
