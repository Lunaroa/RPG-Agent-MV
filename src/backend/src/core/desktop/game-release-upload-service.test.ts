import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { uploadStaticRelease } from './game-release-upload-service.ts';

test('uploads package files before the top-level release index and keeps credentials transient', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-upload-'));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string; authorization: string | null }> = [];
  try {
    write(root, 'games/sample/stable/release/game.zip', 'package');
    write(root, 'releases.json', '{}');
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        method: init?.method || 'GET',
        url: String(input),
        authorization: headers.get('authorization'),
      });
      return new Response(null, { status: init?.method === 'MKCOL' ? 201 : 200 });
    };

    const uploaded = await uploadStaticRelease(
      root,
      ['games/sample/stable/release/game.zip'],
      'releases.json',
      {
        enabled: true,
        adapter: 'webdav',
        baseUrl: 'https://updates.invalid/root/',
        authorization: 'bearer',
      },
      { token: 'transient-test-token' },
    );

    assert.deepEqual(uploaded, ['games/sample/stable/release/game.zip', 'releases.json']);
    const puts = requests.filter((request) => request.method === 'PUT');
    assert.match(puts[0]!.url, /game\.zip$/);
    assert.match(puts[1]!.url, /releases\.json$/);
    assert.equal(puts.every((request) => request.authorization === 'Bearer transient-test-token'), true);
    assert.equal(fs.readFileSync(path.join(root, 'releases.json'), 'utf8').includes('transient-test-token'), false);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
