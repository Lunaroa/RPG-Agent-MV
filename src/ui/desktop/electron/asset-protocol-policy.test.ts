import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  RMMV_ASSET_SCHEME,
  contentTypeForAssetPath,
  withAssetCanvasCors,
} from './asset-protocol-policy.ts';

describe('asset protocol policy', () => {
  test('registers the asset scheme for canvas reads and media streaming', () => {
    assert.equal(RMMV_ASSET_SCHEME.privileges.corsEnabled, true);
    assert.equal(RMMV_ASSET_SCHEME.privileges.secure, true);
    assert.equal(RMMV_ASSET_SCHEME.privileges.standard, true);
    assert.equal(RMMV_ASSET_SCHEME.privileges.stream, true);
    assert.equal(RMMV_ASSET_SCHEME.privileges.supportFetchAPI, true);
  });

  test('maps common media extensions to browser-friendly content types', () => {
    assert.equal(contentTypeForAssetPath('audio/se/Click.ogg'), 'audio/ogg');
    assert.equal(contentTypeForAssetPath('audio/bgm/Theme.m4a'), 'audio/mp4');
    assert.equal(contentTypeForAssetPath('img/pictures/A.png'), 'image/png');
    assert.equal(contentTypeForAssetPath('movies/Intro.webm'), 'video/webm');
    assert.equal(contentTypeForAssetPath('readme.txt'), null);
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

  test('fills missing or generic content types for short audio assets', async () => {
    const response = withAssetCanvasCors(new Response('ogg-bytes', {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    }), { filePath: 'C:/project/audio/se/Short.ogg' });

    assert.equal(response.headers.get('Content-Type'), 'audio/ogg');
    assert.equal(await response.text(), 'ogg-bytes');
  });
});
