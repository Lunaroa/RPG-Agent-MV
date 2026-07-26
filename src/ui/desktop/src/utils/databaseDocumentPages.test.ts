import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DATABASE_DOCUMENT_PAGES,
  clampTypeListSelection,
  databaseDocumentPageKey,
  databaseDocumentStorageGroup,
  isSharedSystemDocumentPage,
  normalizeTypeListCapacity,
  systemDocumentPageForField,
  typeListRemovedEntries,
} from './databaseDocumentPages';

describe('database document page mapping', () => {
  test('defines the four official-style document pages and shares System storage', () => {
    assert.deepEqual(DATABASE_DOCUMENT_PAGES, ['System1', 'System2', 'Types', 'Terms']);
    assert.equal(databaseDocumentStorageGroup('System1'), 'System');
    assert.equal(databaseDocumentStorageGroup('System2'), 'System');
    assert.equal(databaseDocumentStorageGroup('Types'), 'Types');
    assert.equal(databaseDocumentStorageGroup('Terms'), 'Terms');
    assert.equal(databaseDocumentPageKey('Actors'), null);
    assert.equal(isSharedSystemDocumentPage('System1'), true);
    assert.equal(isSharedSystemDocumentPage('Types'), false);
  });

  test('partitions schema roots without duplicating a System field between pages', () => {
    const system2Roots = [
      'tileSize',
      'faceSize',
      'iconSize',
      'menuCommands',
      'itemCategories',
      'magicSkills',
      'attackMotions',
      'advanced.screenWidth',
    ];
    for (const path of system2Roots) assert.equal(systemDocumentPageForField(path), 'System2', path);
    for (const path of ['gameTitle', 'partyMembers', 'boat', 'titleBgm.name', 'locale']) {
      assert.equal(systemDocumentPageForField(path), 'System1', path);
    }
  });
});

describe('official type-list capacity helpers', () => {
  test('keeps the hidden reserved slot and expands with empty slots', () => {
    assert.deepEqual(normalizeTypeListCapacity(['reserved', 'Fire'], 3), ['', 'Fire', '', '']);
    assert.equal(normalizeTypeListCapacity([], 9999).length, 5001);
    assert.equal(normalizeTypeListCapacity([], 0).length, 2);
  });

  test('reports the complete removed tail and clamps selection to an editable id', () => {
    assert.deepEqual(typeListRemovedEntries(['', 'One', '', 'Three'], 1), [
      { id: 2, name: '' },
      { id: 3, name: 'Three' },
    ]);
    assert.equal(clampTypeListSelection(['', 'One', 'Two'], 99), 2);
    assert.equal(clampTypeListSelection([''], 0), 1);
  });
});
