import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadImageElement, type LoadableImage } from './imageLoading.ts';

class FakeImage implements LoadableImage {
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private value = '';

  get src(): string {
    return this.value;
  }

  set src(value: string) {
    this.value = value;
    this.onload?.();
  }
}

describe('image loading', () => {
  test('requests custom-scheme assets in CORS mode before assigning src', async () => {
    const image = new FakeImage();
    const loaded = await loadImageElement('rmmv-asset://project/image.png', () => image);

    assert.equal(loaded, image);
    assert.equal(image.crossOrigin, 'anonymous');
  });

  test('does not change the request mode for ordinary same-origin URLs', async () => {
    const image = new FakeImage();
    await loadImageElement('/image.png', () => image);

    assert.equal(image.crossOrigin, null);
  });
});
