import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeMapPreviewProtocolKey,
  resolveConfinedMapPreviewResource,
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
