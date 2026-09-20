import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { downloadVerifiedTool } from './game-tool-download.ts';
import { escapeJavaProperty } from './game-tool-install-context.ts';

test('tool download reports bytes, validates hashes, times out and cancels stalled transfers', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-download-'));
  const payload = Buffer.from('tool download fixture');
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const server = http.createServer((request, response) => {
    if (request.url === '/stall') { response.writeHead(200); response.flushHeaders(); return; }
    response.writeHead(200, { 'content-length': payload.length });
    response.end(payload);
  });
  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const url = `http://localhost:${address.port}`;
  const target = path.join(root, '组件.zip');
  try {
    const progress: number[] = [];
    await downloadVerifiedTool(url, target, hash, { onProgress: bytes => progress.push(bytes) });
    assert.deepEqual(fs.readFileSync(target), payload);
    assert.equal(progress.at(-1), payload.length);
    const other = path.join(root, 'rejected.zip');
    await assert.rejects(downloadVerifiedTool(url, other, '0'.repeat(64)), /SHA-256/);
    assert.equal(fs.existsSync(other), false);
    await assert.rejects(downloadVerifiedTool(`${url}/stall`, other, hash, { idleTimeoutMs: 80 }), /timed out/);
    let canceled = false;
    const timer = setTimeout(() => { canceled = true; }, 80);
    try { await assert.rejects(downloadVerifiedTool(`${url}/stall`, other, hash, { isCanceled: () => canceled }), /canceled/); }
    finally { clearTimeout(timer); }
    assert.deepEqual(fs.readdirSync(root), ['组件.zip']);
    const remove = fs.rmSync;
    const cleanupFailure = t.mock.method(fs, 'rmSync', (filePath: fs.PathLike, options?: fs.RmOptions) => {
      if (String(filePath).endsWith('.tmp')) throw new Error('Temporary file is locked');
      return remove(filePath, options);
    });
    try {
      await assert.rejects(downloadVerifiedTool(url, other, '0'.repeat(64)), error => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /SHA-256/);
        assert.match(error.message, /Temporary file is locked/);
        return true;
      });
    } finally { cleanupFailure.mock.restore(); }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Android properties preserve Chinese, spaces and supplementary Unicode without locale-dependent bytes', () => {
  const input = path.join(os.tmpdir(), '工具 ※ 空格 😀', 'sdk');
  const escaped = escapeJavaProperty(input);
  assert.match(escaped, /\\u5de5\\u5177/);
  assert.doesNotMatch(escaped, /[^\x00-\x7f]/);
  const decoded = escaped.replace(/\\u([a-f0-9]{4})|\\(.)/g, (_match, hex, character) => hex ? String.fromCharCode(parseInt(hex, 16)) : character);
  assert.equal(decoded, input);
});
