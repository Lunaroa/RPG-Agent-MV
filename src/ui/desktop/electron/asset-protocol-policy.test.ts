import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RMMV_ASSET_SCHEME, withAssetCanvasCors } from './asset-protocol-policy.ts';

describe('asset protocol policy', () => {
  test('registers the asset scheme as CORS-enabled for canvas reads', () => {
    assert.equal(RMMV_ASSET_SCHEME.privileges.corsEnabled, true);
    assert.equal(RMMV_ASSET_SCHEME.privileges.secure, true);
    assert.equal(RMMV_ASSET_SCHEME.privileges.standard, true);
  });

  test('allows renderer origins to consume asset responses without tainting canvas', async () => {
    const response = withAssetCanvasCors(new Response('image-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));

    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.equal(await response.text(), 'image-bytes');
  });
});
