import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';

import { resolveDocumentationPath, resolveDocumentationRoot } from './documentation-policy.ts';

test('uses the product docs in development and appPath docs after packaging', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'documentation-root-'));
  try {
    const installRoot = path.join(root, 'workspace');
    const appPath = path.join(root, 'resources', 'app');
    assert.equal(resolveDocumentationRoot({ packaged: false, appPath, installRoot }), path.join(installRoot, 'docs'));
    assert.equal(resolveDocumentationRoot({ packaged: true, appPath, installRoot }), path.join(appPath, 'docs'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps documentation reads inside the documentation root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-docs-'));
  try {
    const page = path.join(root, 'en', 'getting-started', 'introduction.md');
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, '# Documentation', 'utf8');
    assert.equal(resolveDocumentationPath(root, 'en/getting-started/introduction.md', ['.md']), fs.realpathSync.native(page));
    assert.throws(() => resolveDocumentationPath(root, '../private.md', ['.md']), /leaves/);
    assert.throws(() => resolveDocumentationPath(root, path.resolve(root, 'page.md'), ['.md']), /relative/);
    assert.throws(() => resolveDocumentationPath(root, 'assets/run.js', ['.png']), /not allowed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
