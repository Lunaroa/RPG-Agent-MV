import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startGameToolInstall } from './game-tool-install-service.ts';

test('tool worker cancels before downloading and records its terminal error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-worker-'));
  try {
    assert.throws(() => startGameToolInstall(root, 'media', { acceptLicense: false }, () => {}), /Accept the tool license/);
    const operation = startGameToolInstall(root, 'media', { operationId: 'sample-cancel', acceptLicense: true }, () => {});
    operation.cancel();
    await assert.rejects(operation.result, /canceled/);
    const log = fs.readFileSync(path.join(root, 'runtime/game-build/logs/sample-cancel.jsonl'), 'utf8');
    assert.match(log, /canceled/);
    assert.equal(fs.existsSync(path.join(root, 'runtime/game-build/tools/ffmpeg/ffmpeg.exe')), false);
    assert.deepEqual(fs.readdirSync(path.join(root, 'runtime/game-build/tools')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
