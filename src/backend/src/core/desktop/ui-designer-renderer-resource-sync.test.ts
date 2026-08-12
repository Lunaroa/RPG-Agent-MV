import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { projectAssetChangeManifestFromMutations } from '../../../../contract/ui-designer-resources.ts';
import { syncUiDesignerRendererResources } from './ui-designer-renderer-resource-sync.ts';

test('renderer resource sync copies new paths, removes old paths and never writes its source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-resource-sync-'));
  const sourceProject = path.join(root, 'source');
  const temporaryProject = path.join(root, 'isolated');
  const nextRelative = 'img/pictures/menu/new.png';
  const oldRelative = 'img/pictures/menu/old.png';
  fs.mkdirSync(path.join(sourceProject, 'img', 'pictures', 'menu'), { recursive: true });
  fs.mkdirSync(path.join(temporaryProject, 'img', 'pictures', 'menu'), { recursive: true });
  fs.writeFileSync(path.join(sourceProject, ...nextRelative.split('/')), 'next', 'utf8');
  fs.writeFileSync(path.join(temporaryProject, ...oldRelative.split('/')), 'old', 'utf8');
  let ownershipChecks = 0;

  const receipt = syncUiDesignerRendererResources({
    sourceProject,
    temporaryProject,
    sessionId: 'session',
    generation: 4,
    resourceRevision: 7,
    assertOwned: () => { ownershipChecks += 1; },
  }, projectAssetChangeManifestFromMutations([
    { relativePath: oldRelative, delete: true },
    { relativePath: nextRelative },
  ]));

  assert.equal(fs.readFileSync(path.join(sourceProject, ...nextRelative.split('/')), 'utf8'), 'next');
  assert.equal(fs.existsSync(path.join(sourceProject, ...oldRelative.split('/'))), false);
  assert.equal(fs.readFileSync(path.join(temporaryProject, ...nextRelative.split('/')), 'utf8'), 'next');
  assert.equal(fs.existsSync(path.join(temporaryProject, ...oldRelative.split('/'))), false);
  assert.equal(receipt.resourceRevision, 8);
  assert.equal(ownershipChecks, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('renderer resource sync rejects absolute and traversal paths before filesystem writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-resource-sync-invalid-'));
  assert.throws(() => syncUiDesignerRendererResources({
    sourceProject: path.join(root, 'source'),
    temporaryProject: path.join(root, 'isolated'),
    sessionId: 'session',
    generation: 1,
    resourceRevision: 0,
    assertOwned: () => {},
  }, {
    schemaVersion: '1.0.0',
    upsertRelativePaths: ['../outside.png'],
    deleteRelativePaths: [],
  }), /must not escape/);
  fs.rmSync(root, { recursive: true, force: true });
});
