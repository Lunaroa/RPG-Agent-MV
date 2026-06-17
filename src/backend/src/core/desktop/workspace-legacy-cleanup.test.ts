import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pruneWorkspaceLegacyArtifacts } from './workspace-legacy-cleanup.ts';

function mkP3Root(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'config', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'agents', 'registry.yaml'), 'agents: []\n');
  fs.mkdirSync(path.join(root, 'src', 'backend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'backend', 'src', 'cli.ts'), '// cli\n');
  return root;
}

test('pruneWorkspaceLegacyArtifacts removes empty ui/desktop shell', () => {
  const root = mkP3Root('rmmv-ws-cleanup-ui-');
  fs.mkdirSync(path.join(root, 'ui', 'desktop'), { recursive: true });

  const result = pruneWorkspaceLegacyArtifacts(root);
  assert.ok(result.removed.includes('ui'));
  assert.ok(!fs.existsSync(path.join(root, 'ui')));
});

test('pruneWorkspaceLegacyArtifacts removes top-level agents when config registry exists', () => {
  const root = mkP3Root('rmmv-ws-cleanup-agents-');
  fs.mkdirSync(path.join(root, 'agents', 'rmmv-director'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'rmmv-director', 'agent.yaml'), 'id: rmmv-director\n');

  const result = pruneWorkspaceLegacyArtifacts(root);
  assert.ok(result.removed.includes('agents'));
  assert.ok(!fs.existsSync(path.join(root, 'agents')));
  assert.ok(fs.existsSync(path.join(root, 'config', 'agents', 'registry.yaml')));
});

test('pruneWorkspaceLegacyArtifacts does not remove backend without P3 markers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-ws-cleanup-no-p3-'));
  fs.mkdirSync(path.join(root, 'backend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'src', 'cli.ts'), '// legacy\n');

  const result = pruneWorkspaceLegacyArtifacts(root);
  assert.deepEqual(result.removed, []);
  assert.ok(fs.existsSync(path.join(root, 'backend')));
});

test('pruneWorkspaceLegacyArtifacts removes src/data when top-level data exists', () => {
  const root = mkP3Root('rmmv-ws-cleanup-srcdata-');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'rmmv.db'), 'sqlite');
  fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'data', 'rmmv.db'), 'wrong-layer');

  const result = pruneWorkspaceLegacyArtifacts(root);
  assert.ok(result.removed.includes('src/data'));
  assert.ok(!fs.existsSync(path.join(root, 'src', 'data')));
  assert.ok(fs.existsSync(path.join(root, 'data', 'rmmv.db')));
});

test('pruneWorkspaceLegacyArtifacts dryRun does not write to disk', () => {
  const root = mkP3Root('rmmv-ws-cleanup-dry-');
  fs.mkdirSync(path.join(root, 'ui', 'desktop'), { recursive: true });

  const result = pruneWorkspaceLegacyArtifacts(root, { dryRun: true });
  assert.ok(result.removed.includes('ui'));
  assert.ok(fs.existsSync(path.join(root, 'ui')));
});

test('pruneWorkspaceLegacyArtifacts removes empty top-level out after runtime/out exists', () => {
  const root = mkP3Root('rmmv-ws-cleanup-out-');
  fs.mkdirSync(path.join(root, 'runtime', 'out'), { recursive: true });
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });

  pruneWorkspaceLegacyArtifacts(root);
  assert.ok(!fs.existsSync(path.join(root, 'out')));
  assert.ok(fs.existsSync(path.join(root, 'runtime', 'out')));
});

test('pruneWorkspaceLegacyArtifacts removes tools when only README remains', () => {
  const root = mkP3Root('rmmv-ws-cleanup-tools-');
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'README.md'), '# tools\n');

  const result = pruneWorkspaceLegacyArtifacts(root);
  assert.ok(result.removed.includes('tools'));
  assert.ok(!fs.existsSync(path.join(root, 'tools')));
});
