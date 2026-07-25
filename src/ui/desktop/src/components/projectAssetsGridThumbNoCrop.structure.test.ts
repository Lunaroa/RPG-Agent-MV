import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const viewPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../views/ProjectAssetsView.vue',
);

describe('project assets grid thumb no-crop', () => {
  test('grid thumb img fills the square with contain letterbox, not cover crop', () => {
    const source = readFileSync(viewPath, 'utf8');
    const imgBlock = source.match(/\.project-assets-thumb img\s*\{[^}]+\}/);
    assert.ok(imgBlock, 'expected .project-assets-thumb img rule');
    assert.match(imgBlock[0], /width:\s*100%/);
    assert.match(imgBlock[0], /height:\s*100%/);
    assert.match(imgBlock[0], /object-fit:\s*contain/);
    assert.doesNotMatch(imgBlock[0], /object-fit:\s*cover/);
    assert.doesNotMatch(imgBlock[0], /width:\s*auto/);
    assert.doesNotMatch(imgBlock[0], /height:\s*auto/);
  });
});
