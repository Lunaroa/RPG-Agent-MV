import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getCachedProjectAssetAudioDuration,
  loadProjectAssetAudioDuration,
} from './projectAssetAudioDurations';

type FakeAudio = {
  preload: string;
  duration: number;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
  removeAttribute: (name: string) => void;
  load: () => void;
  src: string;
};

function installAudioDocument(
  durationFor: (url: string) => number,
): { created: string[]; restore: () => void } {
  const previous = (globalThis as { document?: unknown }).document;
  const created: string[] = [];
  const document = {
    createElement(tag: string): FakeAudio {
      assert.equal(tag, 'audio');
      let source = '';
      const element: FakeAudio = {
        preload: '',
        duration: Number.NaN,
        onloadedmetadata: null,
        onerror: null,
        removeAttribute: () => undefined,
        load: () => undefined,
        get src() { return source; },
        set src(value: string) {
          source = value;
          created.push(value);
          queueMicrotask(() => {
            element.duration = durationFor(value);
            if (Number.isFinite(element.duration)) element.onloadedmetadata?.();
            else element.onerror?.();
          });
        },
      };
      return element;
    },
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  });
  return {
    created,
    restore: () => {
      if (previous === undefined) delete (globalThis as { document?: unknown }).document;
      else Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
    },
  };
}

describe('projectAssetAudioDurations', () => {
  test('deduplicates concurrent metadata probes and caches the result', async () => {
    const fixture = installAudioDocument(() => 12.5);
    try {
      const url = 'rmmv-asset://project/audio-duration-cache';
      const first = loadProjectAssetAudioDuration(url);
      const second = loadProjectAssetAudioDuration(url);
      assert.strictEqual(first, second);
      assert.deepEqual(await Promise.all([first, second]), [12.5, 12.5]);
      assert.deepEqual(fixture.created, [url]);
      assert.equal(getCachedProjectAssetAudioDuration(url), 12.5);
    } finally {
      fixture.restore();
    }
  });

  test('caches unreadable audio as NaN instead of retrying every render', async () => {
    const fixture = installAudioDocument(() => Number.NaN);
    try {
      const url = 'rmmv-asset://project/audio-duration-invalid';
      assert.equal(Number.isNaN(await loadProjectAssetAudioDuration(url)), true);
      assert.equal(Number.isNaN(await loadProjectAssetAudioDuration(url)), true);
      assert.deepEqual(fixture.created, [url]);
      assert.equal(Number.isNaN(getCachedProjectAssetAudioDuration(url)), true);
    } finally {
      fixture.restore();
    }
  });
});
