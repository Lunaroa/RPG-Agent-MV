import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import type { SessionImageAttachmentInput } from '../../../../contract/types.ts';
import { resolveAssetRequest } from './asset-service.ts';
import { storeSessionImageAttachments } from './session-image-attachments.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-chat-image-'));
  roots.push(root);
  return root;
}

function imageInput(mime: string, bytes: number[], filename = 'pasted-image.png'): SessionImageAttachmentInput {
  const buffer = Buffer.from(bytes);
  return { filename, mime, dataBase64: buffer.toString('base64'), sizeBytes: buffer.byteLength };
}

const png = imageInput('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('stores verified images and resolves only the registered session resource', async () => {
  const workflowRoot = tempRoot();
  const sessionId = 'session_test';
  const outDir = path.join(workflowRoot, 'runtime', 'sessions', sessionId, 'agent-console');
  const stored = await storeSessionImageAttachments(outDir, sessionId, [png], 'en-US');
  assert.equal(stored.length, 1);
  const publicAttachment = stored.map(({ filePath: _filePath, ...attachment }) => attachment);
  fs.writeFileSync(path.join(outDir, 'session-meta.json'), JSON.stringify({ id: sessionId, imageAttachments: publicAttachment }), 'utf8');

  assert.equal(resolveAssetRequest(workflowRoot, stored[0]!.url), stored[0]!.filePath);
  assert.throws(
    () => resolveAssetRequest(workflowRoot, `rmmv-asset://session/${sessionId}/unknown`),
    /not registered/i,
  );
});

test('rejects forged MIME and leaves no attachment directory', async () => {
  const workflowRoot = tempRoot();
  const outDir = path.join(workflowRoot, 'runtime', 'sessions', 'session_test', 'agent-console');
  const forged = { ...png, mime: 'image/jpeg' };
  await assert.rejects(
    storeSessionImageAttachments(outDir, 'session_test', [forged], 'en-US'),
    /actual format/i,
  );
  assert.equal(fs.existsSync(path.join(outDir, 'attachments')), false);
});

test('accepts the four supported image signatures in input order', async () => {
  const workflowRoot = tempRoot();
  const outDir = path.join(workflowRoot, 'runtime', 'sessions', 'session_test', 'agent-console');
  const inputs = [
    png,
    imageInput('image/jpeg', [0xff, 0xd8, 0xff, 0x00], 'two.jpg'),
    imageInput('image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')], 'three.webp'),
    imageInput('image/gif', [...Buffer.from('GIF89a')], 'four.gif'),
  ];
  const stored = await storeSessionImageAttachments(outDir, 'session_test', inputs, 'en-US');
  assert.deepEqual(stored.map((item) => item.filename), inputs.map((item) => item.filename));
});
