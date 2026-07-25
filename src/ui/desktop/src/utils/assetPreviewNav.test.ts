import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveAssetPreviewNavIndex } from './assetPreviewNav';

describe('resolveAssetPreviewNavIndex', () => {
  test('wraps forward and backward at both ends', () => {
    assert.equal(resolveAssetPreviewNavIndex(0, -1, 3), 2);
    assert.equal(resolveAssetPreviewNavIndex(2, 1, 3), 0);
    assert.equal(resolveAssetPreviewNavIndex(1, 1, 3), 2);
    assert.equal(resolveAssetPreviewNavIndex(1, -1, 3), 0);
  });

  test('single-item list stays at 0', () => {
    assert.equal(resolveAssetPreviewNavIndex(0, 1, 1), 0);
    assert.equal(resolveAssetPreviewNavIndex(0, -1, 1), 0);
  });

  test('empty list returns -1', () => {
    assert.equal(resolveAssetPreviewNavIndex(0, 1, 0), -1);
    assert.equal(resolveAssetPreviewNavIndex(-1, -1, 0), -1);
  });

  test('normalizes out-of-range currentIndex before wrapping', () => {
    assert.equal(resolveAssetPreviewNavIndex(5, 1, 3), 0);
    assert.equal(resolveAssetPreviewNavIndex(-1, -1, 3), 1);
  });
});
