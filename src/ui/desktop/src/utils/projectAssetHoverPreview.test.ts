import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeHoverPreviewPosition,
  projectAssetThumbnailUrlForBucket,
  PROJECT_ASSET_HOVER_PREVIEW_MAX_SIZE,
} from './projectAssetHoverPreview.ts';

describe('projectAssetThumbnailUrlForBucket', () => {
  it('swaps the bucket segment of a project thumbnail URL', () => {
    const url = 'rmmv-asset://project-thumbnail/dG9rZW4%3D/128/www%2Fimg%2Ffaces%2FActor1.png';
    assert.equal(
      projectAssetThumbnailUrlForBucket(url, 512),
      'rmmv-asset://project-thumbnail/dG9rZW4%3D/512/www%2Fimg%2Ffaces%2FActor1.png',
    );
  });

  it('returns null for non-thumbnail URLs', () => {
    assert.equal(projectAssetThumbnailUrlForBucket('rmmv-asset://project/abc/www/img/a.png', 256), null);
    assert.equal(projectAssetThumbnailUrlForBucket('https://example.com/a.png', 256), null);
    assert.equal(projectAssetThumbnailUrlForBucket('', 256), null);
  });
});

describe('computeHoverPreviewPosition', () => {
  it('places the preview right-below the cursor by default', () => {
    const pos = computeHoverPreviewPosition({
      mouseX: 100,
      mouseY: 100,
      viewportWidth: 1000,
      viewportHeight: 800,
    });
    assert.deepEqual(pos, { left: 116, top: 116 });
  });

  it('flips left when the box would overflow the right edge', () => {
    const pos = computeHoverPreviewPosition({
      mouseX: 950,
      mouseY: 100,
      viewportWidth: 1000,
      viewportHeight: 800,
    });
    assert.equal(pos.left, 950 - 16 - PROJECT_ASSET_HOVER_PREVIEW_MAX_SIZE);
  });

  it('flips above when the box would overflow the bottom edge', () => {
    const pos = computeHoverPreviewPosition({
      mouseX: 100,
      mouseY: 750,
      viewportWidth: 1000,
      viewportHeight: 800,
    });
    assert.equal(pos.top, 750 - 16 - PROJECT_ASSET_HOVER_PREVIEW_MAX_SIZE);
  });

  it('clamps into tiny viewports', () => {
    const pos = computeHoverPreviewPosition({
      mouseX: 180,
      mouseY: 180,
      viewportWidth: 150,
      viewportHeight: 120,
    });
    assert.deepEqual(pos, { left: 0, top: 0 });
  });
});
