import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeMapPreviewProtocolKey,
  resolveConfinedMapPreviewResource,
  resolveMapPreviewResource,
} from './map-preview-protocol-policy.ts';

test('normalizes opaque preview hosts without accepting arbitrary names', () => {
  assert.equal(normalizeMapPreviewProtocolKey(` ${'A'.repeat(32)} `), 'a'.repeat(32));
  assert.throws(() => normalizeMapPreviewProtocolKey('preview-session'), /Invalid map preview protocol key/);
  assert.throws(() => normalizeMapPreviewProtocolKey('a'.repeat(31)), /Invalid map preview protocol key/);
});

test('confines preview resources to the registered isolated root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-protocol-'));
  try {
    const scripts = path.join(root, 'js');
    fs.mkdirSync(scripts);
    const entry = path.join(scripts, 'main.js');
    fs.writeFileSync(entry, 'void 0;', 'utf8');

    assert.equal(resolveConfinedMapPreviewResource(root, 'js/main.js'), fs.realpathSync.native(entry));
    assert.equal(resolveConfinedMapPreviewResource(root, 'img/missing.png'), path.join(fs.realpathSync.native(root), 'img', 'missing.png'));
    assert.throws(() => resolveConfinedMapPreviewResource(root, '../outside.txt'), /escaped its isolated root/);
    assert.throws(() => resolveConfinedMapPreviewResource(root, path.resolve(root, 'index.html')), /Invalid map preview resource path/);
    assert.throws(() => resolveConfinedMapPreviewResource(root, 'js/\0main.js'), /Invalid map preview resource path/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('serves app files first, falls through allow-listed prefixes, and 404s denied paths', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-resolution-'));
  try {
    const appRoot = path.join(base, 'app');
    const projectRoot = path.join(base, 'project');
    fs.mkdirSync(path.join(appRoot, 'data'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'data'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'save'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'data', 'Map001.json'), '{"width":21}', 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'data', 'Map001.json'), '{"width":17}', 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'img', 'tile.png'), 'png', 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'save', 'file1.rmmzsave'), 'save', 'utf8');

    const entry = {
      resourceRoot: appRoot,
      fallback: { root: projectRoot, prefixes: [''] as const },
      denied: { exact: new Set(['data/map002.json']), prefixes: ['save/', '.git/'] as const },
    };

    // The generated app overlay wins over the project copy of the same file.
    assert.equal(
      resolveMapPreviewResource(entry, 'data/Map001.json'),
      path.join(fs.realpathSync.native(appRoot), 'data', 'Map001.json'),
    );
    // Anything missing from the app directory is read straight from the project.
    assert.equal(
      resolveMapPreviewResource(entry, 'img/tile.png'),
      path.join(fs.realpathSync.native(projectRoot), 'img', 'tile.png'),
    );
    // Staged deletions and private trees 404 even when the source file exists.
    assert.equal(resolveMapPreviewResource(entry, 'data/Map002.json'), null);
    assert.equal(resolveMapPreviewResource(entry, 'DATA\\Map002.json'), null);
    assert.equal(resolveMapPreviewResource(entry, 'save/file1.rmmzsave'), null);
    assert.equal(resolveMapPreviewResource(entry, '.git/config'), null);

    // Without a matching fallback prefix, the miss stays confined to the app root.
    const confined = {
      resourceRoot: appRoot,
      fallback: { root: projectRoot, prefixes: ['audio/'] as const },
    };
    assert.equal(
      resolveMapPreviewResource(confined, 'img/tile.png'),
      path.join(fs.realpathSync.native(appRoot), 'img', 'tile.png'),
    );
    assert.equal(
      resolveMapPreviewResource({ resourceRoot: appRoot }, 'img/tile.png'),
      path.join(fs.realpathSync.native(appRoot), 'img', 'tile.png'),
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
