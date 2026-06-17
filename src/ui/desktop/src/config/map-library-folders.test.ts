/**
 * Run: node --experimental-strip-types --test src/config/map-library-folders.test.ts
 * (from RPG-Agent-MV/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyMapFolder,
  filterByFolder,
  countByFolder,
  buildLibraryFolders,
  isValidFolderId,
} from './map-library-folders.ts';
import type { MapLibraryEntry } from '../api/client.ts';

function entry(overrides: Partial<MapLibraryEntry> = {}): MapLibraryEntry {
  return {
    assetId: 'test-a',
    title: 'Test',
    engine: 'mv',
    tags: [],
    license: {},
    knownIssues: [],
    dependencies: {},
    source: { name: '' },
    packageId: 'pkg-a',
    packageLabel: 'Pack A',
    screenshotUrl: '',
    ...overrides,
  };
}

describe('classifyMapFolder', () => {
  it('uses packageId from entry', () => {
    assert.equal(classifyMapFolder(entry({ packageId: 'dlc-foo' })), 'dlc-foo');
    assert.equal(classifyMapFolder(entry({ packageId: '' })), 'ungrouped');
  });
});

describe('buildLibraryFolders', () => {
  it('includes all and sorted package folders', () => {
    const folders = buildLibraryFolders([
      entry({ packageId: 'b', packageLabel: 'Beta Pack' }),
      entry({ assetId: 'test-b', packageId: 'a', packageLabel: 'Alpha Pack' }),
    ]);
    assert.equal(folders[0]?.id, 'all');
    assert.deepEqual(
      folders.slice(1).map((f) => f.label),
      ['Alpha Pack', 'Beta Pack'],
    );
  });
});

describe('filterByFolder', () => {
  it('returns all for all folder', () => {
    const entries = [
      entry({ packageId: 'a' }),
      entry({ assetId: 'test-b', packageId: 'b' }),
    ];
    assert.equal(filterByFolder(entries, 'all').length, 2);
  });

  it('filters by package folder', () => {
    const entries = [
      entry({ packageId: 'a' }),
      entry({ assetId: 'test-b', packageId: 'b' }),
    ];
    assert.equal(filterByFolder(entries, 'a').length, 1);
    assert.equal(filterByFolder(entries, 'a')[0]?.packageId, 'a');
  });
});

describe('countByFolder', () => {
  it('includes all and per-package counts', () => {
    const counts = countByFolder([
      entry({ packageId: 'a' }),
      entry({ assetId: 'test-b', packageId: 'b' }),
      entry({ assetId: 'test-c', packageId: 'a' }),
    ]);
    assert.equal(counts.all, 3);
    assert.equal(counts.a, 2);
    assert.equal(counts.b, 1);
  });
});

describe('isValidFolderId', () => {
  it('accepts ids present in folder list', () => {
    const folders = buildLibraryFolders([entry()]);
    assert.equal(isValidFolderId('all', folders), true);
    assert.equal(isValidFolderId('forest', folders), false);
  });
});
