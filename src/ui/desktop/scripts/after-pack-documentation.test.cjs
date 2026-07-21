const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verifyPackagedDocumentation } = require('./after-pack-documentation.cjs');

function makePackagedApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-docs-'));
  const docs = path.join(root, 'docs');
  fs.mkdirSync(path.join(docs, 'en'), { recursive: true });
  fs.mkdirSync(path.join(docs, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'ui', 'desktop', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'ui', 'desktop', 'dist-electron'), { recursive: true });
  const navigation = {
    'zh-CN': [{ title: '开始', pages: [{ title: '首页', path: 'index.md' }] }],
    'en-US': [{ title: 'Start', pages: [{ title: 'Home', path: 'en/index.md' }] }],
  };
  fs.writeFileSync(path.join(docs, 'navigation.json'), JSON.stringify(navigation), 'utf8');
  fs.writeFileSync(path.join(docs, 'index.md'), '# 首页\n![示例](assets/example.png)', 'utf8');
  fs.writeFileSync(path.join(docs, 'en', 'index.md'), '# Home\n[中文](../index.md)', 'utf8');
  fs.writeFileSync(path.join(docs, 'assets', 'example.png'), 'image', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'ui', 'desktop', 'dist', 'documentation.html'), '<div id="app"></div>', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'ui', 'desktop', 'dist-electron', 'documentation-preload.js'), 'export {};', 'utf8');
  return root;
}

test('accepts a complete packaged documentation tree', async () => {
  const root = makePackagedApp();
  try { await assert.doesNotReject(() => verifyPackagedDocumentation(root)); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects a missing navigation page', async () => {
  const root = makePackagedApp();
  try {
    fs.rmSync(path.join(root, 'docs', 'en', 'index.md'));
    await assert.rejects(() => verifyPackagedDocumentation(root), /missing en-US page/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects a missing relative image', async () => {
  const root = makePackagedApp();
  try {
    fs.rmSync(path.join(root, 'docs', 'assets', 'example.png'));
    await assert.rejects(() => verifyPackagedDocumentation(root), /resource referenced/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
