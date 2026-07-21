import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(electronRoot, '..');
const productRoot = path.resolve(desktopRoot, '..', '..', '..');
const windowSource = fs.readFileSync(path.join(electronRoot, 'documentation-window.ts'), 'utf8');
const mainSource = fs.readFileSync(path.join(electronRoot, 'main.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(electronRoot, 'documentation-preload.ts'), 'utf8');
const viewSource = fs.readFileSync(path.join(desktopRoot, 'src', 'views', 'DocumentationView.vue'), 'utf8');
const documentationEntry = fs.readFileSync(path.join(desktopRoot, 'src', 'documentation-main.ts'), 'utf8');
const routerSource = fs.readFileSync(path.join(desktopRoot, 'src', 'router', 'index.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(productRoot, 'docs', 'navigation.json'), 'utf8')) as Record<string, Array<{ pages: Array<{ path: string }> }>>;

test('keeps one isolated documentation window with restricted rendering', () => {
  assert.match(windowSource, /if \(documentationWindow && !documentationWindow\.isDestroyed\(\)\)/);
  assert.match(windowSource, /contextIsolation: true/);
  assert.match(windowSource, /nodeIntegration: false/);
  assert.match(windowSource, /sandbox: true/);
  assert.doesNotMatch(preloadSource, /projects:|settings:|mapPreview:|sessions:/);
  assert.match(preloadSource, /documentation:bootstrap/);
  assert.match(preloadSource, /documentation:read/);
  assert.match(viewSource, /DOMPurify\.sanitize/);
  assert.match(viewSource, /FORBID_TAGS: \['script', 'style', 'iframe', 'object', 'embed', 'form'\]/);
  assert.match(viewSource, /window\.api\.window\.openExternalUrl\(href\)/);
  assert.match(documentationEntry, /DocumentationView/);
  assert.doesNotMatch(documentationEntry, /ElementPlus|pinia|router/);
  assert.doesNotMatch(routerSource, /DocumentationView|path: '\/docs'/);
  assert.match(mainSource, /documentation\.html/);
});

test('lists every localized documentation page explicitly and points to existing Markdown', () => {
  for (const language of ['zh-CN', 'en-US']) {
    assert.ok(manifest[language]?.length);
    for (const section of manifest[language]) {
      for (const page of section.pages) assert.equal(fs.existsSync(path.join(productRoot, 'docs', page.path)), true, page.path);
    }
  }
});
