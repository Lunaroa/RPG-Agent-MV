import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { clearLocalAssetsCache } from './local-assets-service.ts';
import { resolveLibraryAssetPath } from './map-library-asset-resolver.ts';

function setupLocalTileset(workflowRoot: string, slug: string, tileName: string): string {
  const localRoot = path.join(workflowRoot, 'data', 'assets');
  const rel = `sources/${slug}/img/tilesets/${tileName}.png`;
  const abs = path.join(localRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from('png'));
  const manifestPath = path.join(localRoot, 'manifest.json');
  const manifest = {
    version: 1,
    sources: {
      [slug]: {
        originalPath: `/external/not-used/${slug}`,
        tilesetImages: { [tileName]: rel },
        parallaxes: {},
      },
    },
    pathMapping: {},
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  clearLocalAssetsCache();
  return abs;
}

describe('resolveLibraryAssetPath', () => {
  it('resolves tilesets only from workspace local assets', () => {
    const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-asset-resolver-'));
    const expected = setupLocalTileset(workflowRoot, 'demo-pack', 'Outside_A1');
    const entry = {
      importBatch: { sourceSlug: 'demo-pack', sourceProject: 'C:/game/sample' },
      dependencies: { tilesetImages: [] },
    };
    assert.equal(
      resolveLibraryAssetPath(entry, 'tilesets', 'Outside_A1', workflowRoot),
      expected,
    );
  });

  it('does not read sourceProject paths outside workflowRoot', () => {
    const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-asset-resolver-'));
    const outerProject = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-outer-'));
    const outerTile = path.join(outerProject, 'img', 'tilesets', 'Outside_A1.png');
    fs.mkdirSync(path.dirname(outerTile), { recursive: true });
    fs.writeFileSync(outerTile, Buffer.from('png'));

    const entry = {
      source: { originalProjectPath: outerProject },
      dependencies: { tilesetImages: [] },
    };
    assert.equal(resolveLibraryAssetPath(entry, 'tilesets', 'Outside_A1', workflowRoot), null);
    assert.equal(resolveLibraryAssetPath(entry, 'tilesets', 'Outside_A1'), null);
  });
});
