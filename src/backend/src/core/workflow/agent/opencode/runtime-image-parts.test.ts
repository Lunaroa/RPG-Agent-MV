import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildOpencodePromptParts } from './runtime.ts';

test('buildOpencodePromptParts keeps text first and images in paste order', () => {
  const first = path.join(os.tmpdir(), 'first image.png');
  const second = path.join(os.tmpdir(), 'second.gif');
  const parts = buildOpencodePromptParts({
    prompt: 'Describe these images.',
    imageAttachments: [
      { filename: 'first.png', mime: 'image/png', filePath: first },
      { filename: 'second.gif', mime: 'image/gif', filePath: second },
    ],
  });
  assert.equal(parts[0]?.type, 'text');
  assert.equal(parts[1]?.filename, 'first.png');
  assert.equal(parts[2]?.filename, 'second.gif');
  assert.match(String(parts[1]?.url), /^file:\/\//);
  assert.equal(String(parts[1]?.url).includes(' '), false);
});
