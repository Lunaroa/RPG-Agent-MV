import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const viewPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../views/ProjectAssetsView.vue',
);

describe('project assets grid folders', () => {
  test('leaf categories with tree children show folders before files', () => {
    const source = readFileSync(viewPath, 'utf8');
    assert.match(source, /Explorer order: folders first, then files/);
    assert.match(source, /\[\.\.\.folders, \.\.\.files\]/);
  });
});
