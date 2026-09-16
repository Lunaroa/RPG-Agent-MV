import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeZipArchive } from './game-build-file-service.ts';
import { extractZipArchive } from './zip-extraction-service.ts';

test('extracts verified store and deflate ZIP entries without allowing path escape', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-extract-'));
  const source = path.join(root, 'source');
  const archive = path.join(root, 'archive.zip');
  const destination = path.join(root, 'destination');
  try {
    write(source, 'bin/tool.exe', 'x'.repeat(4096));
    write(source, 'NOTICE.txt', 'notice');
    writeZipArchive(source, archive, 'managed-tool');
    const files = extractZipArchive(archive, destination);
    assert.deepEqual(files, ['managed-tool/bin/tool.exe', 'managed-tool/NOTICE.txt']);
    assert.equal(fs.readFileSync(path.join(destination, 'managed-tool', 'bin', 'tool.exe'), 'utf8'), 'x'.repeat(4096));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
