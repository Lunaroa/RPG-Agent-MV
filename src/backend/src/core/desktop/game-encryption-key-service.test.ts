import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateGameEncryptionKey,
  importGameEncryptionKey,
  listGameEncryptionKeys,
  readGameEncryptionKey,
} from './game-encryption-key-service.ts';

test('generates, imports, and lists 256-bit project keys without returning key material', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-keys-'));
  try {
    const generated = generateGameEncryptionKey(project, 'release-1');
    assert.equal(generated.sha256.length, 64);
    const imported = importGameEncryptionKey(project, 'release-2', Buffer.alloc(32, 7).toString('base64'));
    assert.equal(imported.sha256.length, 64);
    const listed = listGameEncryptionKeys(project);
    assert.deepEqual(listed.map((item) => item.id), ['release-1', 'release-2']);
    assert.equal(JSON.stringify(listed).includes('keyBase64'), false);
    assert.equal(readGameEncryptionKey(project, 'release-2').key.equals(Buffer.alloc(32, 7)), true);
    assert.throws(() => generateGameEncryptionKey(project, 'release-1'), /already exists/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
