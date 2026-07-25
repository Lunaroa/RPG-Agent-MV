import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { selectProjectAssetThumbnailBucket } from './projectAssetThumbnailBucket';

describe('selectProjectAssetThumbnailBucket', () => {
  test('picks the smallest bucket that covers cell size at 1x', () => {
    assert.equal(selectProjectAssetThumbnailBucket(96, 1), 128);
    assert.equal(selectProjectAssetThumbnailBucket(64, 1), 64);
    assert.equal(selectProjectAssetThumbnailBucket(65, 1), 128);
  });

  test('scales by device pixel ratio before clamping', () => {
    assert.equal(selectProjectAssetThumbnailBucket(96, 2), 256);
    assert.equal(selectProjectAssetThumbnailBucket(112, 1.5), 256);
    assert.equal(selectProjectAssetThumbnailBucket(200, 3), 512);
  });

  test('falls back to the largest bucket when needed size exceeds all', () => {
    assert.equal(selectProjectAssetThumbnailBucket(400, 2), 512);
  });
});
