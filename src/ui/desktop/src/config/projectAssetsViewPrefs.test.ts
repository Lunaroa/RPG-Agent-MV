import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clampProjectAssetThumbSize,
  loadProjectAssetSortPreference,
  loadProjectAssetThumbSize,
  PROJECT_ASSET_SORT_DEFAULT,
  PROJECT_ASSET_THUMB_SIZE_DEFAULT,
  PROJECT_ASSETS_VIEW_PREFS_PREFIX,
  saveProjectAssetSortPreference,
  saveProjectAssetThumbSize,
} from './projectAssetsViewPrefs';

/** Deterministic in-memory localStorage so the suite does not depend on host web-storage flags. */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });

function clearPrefs() {
  memoryStorage.clear();
}

describe('projectAssetsViewPrefs sort', () => {
  test('returns default when nothing stored', () => {
    clearPrefs();
    assert.deepEqual(loadProjectAssetSortPreference(), PROJECT_ASSET_SORT_DEFAULT);
  });

  test('round-trips a saved preference', () => {
    clearPrefs();
    saveProjectAssetSortPreference({ key: 'bytes', dir: 'desc' });
    assert.deepEqual(loadProjectAssetSortPreference(), { key: 'bytes', dir: 'desc' });
  });

  test('falls back to default on corrupted JSON or illegal enum', () => {
    clearPrefs();
    localStorage.setItem(`${PROJECT_ASSETS_VIEW_PREFS_PREFIX}.sort`, 'not-json');
    assert.deepEqual(loadProjectAssetSortPreference(), PROJECT_ASSET_SORT_DEFAULT);
    localStorage.setItem(`${PROJECT_ASSETS_VIEW_PREFS_PREFIX}.sort`, JSON.stringify({ key: 'referenceCount', dir: 'asc' }));
    assert.deepEqual(loadProjectAssetSortPreference(), PROJECT_ASSET_SORT_DEFAULT);
  });
});

describe('projectAssetsViewPrefs thumbSize', () => {
  test('clamps into the 48-512 range and falls back on non-numbers', () => {
    assert.equal(clampProjectAssetThumbSize(10), 48);
    assert.equal(clampProjectAssetThumbSize(9999), 512);
    assert.equal(clampProjectAssetThumbSize(200.6), 201);
    assert.equal(clampProjectAssetThumbSize(Number.NaN), PROJECT_ASSET_THUMB_SIZE_DEFAULT);
    assert.equal(clampProjectAssetThumbSize('abc'), PROJECT_ASSET_THUMB_SIZE_DEFAULT);
  });

  test('returns default when nothing stored; round-trips clamped value', () => {
    clearPrefs();
    assert.equal(loadProjectAssetThumbSize(), PROJECT_ASSET_THUMB_SIZE_DEFAULT);
    saveProjectAssetThumbSize(600);
    assert.equal(loadProjectAssetThumbSize(), 512);
    saveProjectAssetThumbSize(120);
    assert.equal(loadProjectAssetThumbSize(), 120);
  });
});
