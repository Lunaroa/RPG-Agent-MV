import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertOutputLocation,
  collectDirectoryDigest,
  copyGameDirectory,
  gameArtifactBaseName,
  publishStagedDirectory,
  sanitizeArtifactSegment,
  sha256File,
  writeZipArchive,
} from './game-build-file-service.ts';

test('sanitizes stable artifact names and Windows-reserved segments', () => {
  assert.equal(sanitizeArtifactSegment(' My: Game? '), 'My-Game');
  assert.equal(sanitizeArtifactSegment('CON'), '_CON');
  assert.equal(gameArtifactBaseName('Sample Game', '1.2.3-beta', 'windows', 'x64'), 'Sample-Game-1.2.3-beta-windows-x64');
});

test('copies complete game content while excluding editor metadata and save data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-build-files-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  try {
    write(source, 'index.html', 'game');
    write(source, 'data/System.json', '{}');
    write(source, 'save/file1.rpgsave', 'private');
    write(source, '.luna_rpg/config.json', '{}');
    write(source, 'img/save/picture.png', 'asset');
    copyGameDirectory(source, target);
    assert.equal(fs.existsSync(path.join(target, 'index.html')), true);
    assert.equal(fs.existsSync(path.join(target, 'data', 'System.json')), true);
    assert.equal(fs.existsSync(path.join(target, 'save')), false);
    assert.equal(fs.existsSync(path.join(target, '.luna_rpg')), false);
    assert.equal(fs.existsSync(path.join(target, 'img', 'save', 'picture.png')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('produces a deterministic directory digest and a readable ZIP32 structure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-build-zip-'));
  const source = path.join(root, 'content');
  const zip = path.join(root, 'sample.zip');
  try {
    write(source, 'index.html', '<html></html>');
    write(source, 'data/System.json', '{"gameTitle":"Sample"}');
    const first = collectDirectoryDigest(source);
    const second = collectDirectoryDigest(source);
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(first.files.map((file) => file.path), ['data/System.json', 'index.html']);
    writeZipArchive(source, zip, 'Sample Game');
    const archive = fs.readFileSync(zip);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.equal(archive.readUInt32LE(archive.byteLength - 22), 0x06054b50);
    assert.equal(archive.readUInt16LE(archive.byteLength - 12), 2);
    assert.equal(sha256File(zip).length, 64);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishes through an explicit conflict choice and limits in-project outputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-publish-'));
  const project = path.join(root, 'project');
  const outputRoot = path.join(root, 'output');
  try {
    fs.mkdirSync(project, { recursive: true });
    const staged = path.join(outputRoot, '.stage');
    write(staged, 'version.txt', 'new');
    const destination = path.join(outputRoot, 'release');
    write(destination, 'version.txt', 'old');
    assert.equal(publishStagedDirectory(staged, destination, 'cancel'), null);
    assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'old');
    assert.equal(publishStagedDirectory(staged, destination, 'overwrite'), destination);
    assert.equal(fs.readFileSync(path.join(destination, 'version.txt'), 'utf8'), 'new');
    assert.doesNotThrow(() => assertOutputLocation(project, path.join(project, '.luna_rpg', 'builds')));
    assert.throws(() => assertOutputLocation(project, path.join(project, 'builds')), /only under .luna_rpg/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}
