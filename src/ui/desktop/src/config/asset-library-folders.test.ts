/**
 * Run: node --experimental-strip-types --test src/config/asset-library-folders.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assetFolderLabel,
  buildAssetLibraryFolders,
  classifyAssetFolder,
  countAssetFolders,
  filterAssetByFolder,
} from './asset-library-folders.ts';
import type { AssetLibraryEntry } from '../api/client.ts';

function mapEntry(overrides: Record<string, unknown> = {}): AssetLibraryEntry {
  return {
    kind: 'map',
    assetId: 'map-a',
    category: 'maps',
    name: 'Map A',
    map: {
      assetId: 'map-a',
      title: 'Map A',
      engine: 'mv',
      tags: [],
      license: {},
      knownIssues: [],
      dependencies: {},
      source: { name: '' },
      packageId: 'pkg-a',
      packageLabel: 'Pack A',
      screenshotUrl: '',
      ...(overrides.map as object),
    },
    ...overrides,
  } as AssetLibraryEntry;
}

function fileEntry(overrides: Partial<AssetLibraryEntry & { sourceSlug: string }> = {}): AssetLibraryEntry {
  return {
    kind: 'file',
    assetId: 'file:a:img/tilesets/A.png',
    category: 'tilesets',
    subtype: 'tilesets',
    name: 'A',
    fileName: 'A.png',
    sourceSlug: 'pack-a',
    relativePath: 'img/tilesets/A.png',
    url: '',
    size: 1,
    format: 'png',
    ...overrides,
  } as AssetLibraryEntry;
}

describe('classifyAssetFolder', () => {
  it('groups maps by packageId', () => {
    assert.equal(classifyAssetFolder(mapEntry()), 'pkg-a');
  });

  it('groups files by sourceSlug', () => {
    assert.equal(classifyAssetFolder(fileEntry()), 'pack-a');
  });
});

describe('buildAssetLibraryFolders', () => {
  it('includes all and sorted source folders', () => {
    const folders = buildAssetLibraryFolders([
      mapEntry({ map: { packageId: 'b', packageLabel: 'Beta' } }),
      mapEntry({ assetId: 'map-b', map: { packageId: 'a', packageLabel: 'Alpha' } }),
    ]);
    assert.equal(folders[0]?.id, 'all');
    assert.deepEqual(
      folders.slice(1).map((folder) => folder.label),
      ['Alpha', 'Beta'],
    );
  });
});

describe('filterAssetByFolder', () => {
  it('filters maps by package folder', () => {
    const entries = [
      mapEntry(),
      mapEntry({ assetId: 'map-b', map: { packageId: 'pkg-b', packageLabel: 'B' } }),
    ];
    assert.equal(filterAssetByFolder(entries, 'pkg-a').length, 1);
    assert.equal(filterAssetByFolder(entries, 'all').length, 2);
  });
});

describe('countAssetFolders', () => {
  it('counts all and per-folder totals', () => {
    const counts = countAssetFolders([
      fileEntry(),
      fileEntry({ assetId: 'file:b', sourceSlug: 'pack-b' }),
      fileEntry({ assetId: 'file:c' }),
    ]);
    assert.equal(counts.all, 3);
    assert.equal(counts['pack-a'], 2);
    assert.equal(counts['pack-b'], 1);
  });
});

describe('assetFolderLabel', () => {
  it('uses map packageLabel when present', () => {
    assert.equal(assetFolderLabel(mapEntry()), 'Pack A');
  });
});
