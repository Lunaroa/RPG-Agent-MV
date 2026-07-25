import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ProjectAssetBrowseEntry } from '@contract/types';
import {
  isProjectAssetSortDir,
  isProjectAssetSortKey,
  sortProjectAssetEntries,
} from './projectAssetSorting';

function makeEntry(name: string, bytes: number, mtimeMs: number): ProjectAssetBrowseEntry {
  return {
    id: `pictures:${name}`,
    name,
    variants: [],
    bytes,
    mtimeMs,
    encrypted: false,
    url: `rmmv-asset://project/img/pictures/${name}.png`,
    thumbnailUrl: null,
  } as ProjectAssetBrowseEntry;
}

describe('sortProjectAssetEntries', () => {
  test('sorts by name with number-aware, case-insensitive collation', () => {
    const entries = [makeEntry('b10', 0, 0), makeEntry('B2', 0, 0), makeEntry('a1', 0, 0)];
    const sorted = sortProjectAssetEntries(entries, 'name', 'asc');
    assert.deepEqual(sorted.map((entry) => entry.name), ['a1', 'B2', 'b10']);
  });

  test('sorts by bytes and mtimeMs numerically, desc reverses', () => {
    const entries = [makeEntry('a', 30, 300), makeEntry('b', 10, 100), makeEntry('c', 20, 200)];
    assert.deepEqual(
      sortProjectAssetEntries(entries, 'bytes', 'asc').map((entry) => entry.name),
      ['b', 'c', 'a'],
    );
    assert.deepEqual(
      sortProjectAssetEntries(entries, 'mtimeMs', 'desc').map((entry) => entry.name),
      ['a', 'c', 'b'],
    );
  });

  test('does not mutate the input array and keeps ties stable', () => {
    const entries = [makeEntry('x', 5, 1), makeEntry('y', 5, 2), makeEntry('z', 5, 3)];
    const snapshot = [...entries];
    const sorted = sortProjectAssetEntries(entries, 'bytes', 'asc');
    assert.deepEqual(entries, snapshot);
    assert.notEqual(sorted, entries);
    assert.deepEqual(sorted.map((entry) => entry.name), ['x', 'y', 'z']);
  });
});

describe('sort key/dir guards', () => {
  test('accepts only known values', () => {
    assert.equal(isProjectAssetSortKey('name'), true);
    assert.equal(isProjectAssetSortKey('bytes'), true);
    assert.equal(isProjectAssetSortKey('mtimeMs'), true);
    assert.equal(isProjectAssetSortKey('referenceCount'), false);
    assert.equal(isProjectAssetSortKey(1), false);
    assert.equal(isProjectAssetSortDir('asc'), true);
    assert.equal(isProjectAssetSortDir('desc'), true);
    assert.equal(isProjectAssetSortDir('up'), false);
  });
});
