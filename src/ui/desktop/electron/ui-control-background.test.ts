import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assertBackgroundWindowState,
  captureBackgroundPage,
  validateBackgroundCapture,
  type BackgroundCaptureImage,
} from './ui-control-background.ts';

describe('background UI capture', () => {
  test('captures without making the window visible or focused', async () => {
    const calls: unknown[][] = [];
    let invalidations = 0;
    let subscription: (() => void) | null = null;
    let subscriptionEnds = 0;
    const win = {
      isDestroyed: () => false,
      isVisible: () => false,
      isFocused: () => false,
      webContents: {
        beginFrameSubscription: (callback: () => void) => { subscription = callback },
        endFrameSubscription: () => { subscriptionEnds += 1 },
        invalidate: () => {
          invalidations += 1;
          subscription?.();
        },
      },
      capturePage: async (...args: unknown[]) => {
        calls.push(args);
        return image([0, 0, 0, 255]);
      },
    };

    const captured = await captureBackgroundPage(win);
    assert.equal(invalidations, 1);
    assert.equal(subscriptionEnds, 1);
    assert.deepEqual(calls, [[undefined, { stayHidden: true }]]);
    assert.deepEqual([...captured.png], [1, 2, 3]);
  });

  test('refuses visible, focused, and destroyed windows before any interaction', () => {
    const base = {
      webContents: {
        beginFrameSubscription: () => undefined,
        endFrameSubscription: () => undefined,
        invalidate: () => undefined,
      },
      capturePage: async () => image([0, 0, 0, 255]),
    };
    assert.throws(() => assertBackgroundWindowState({ ...base, isDestroyed: () => true, isVisible: () => false, isFocused: () => false }), /not available/);
    assert.throws(() => assertBackgroundWindowState({ ...base, isDestroyed: () => false, isVisible: () => true, isFocused: () => false }), /visible Electron window/);
    assert.throws(() => assertBackgroundWindowState({ ...base, isDestroyed: () => false, isVisible: () => false, isFocused: () => true }), /focused Electron window/);
  });

  test('rejects empty and fully transparent captures without a foreground fallback', () => {
    assert.throws(() => validateBackgroundCapture(image([], true)), /empty image/);
    assert.throws(() => validateBackgroundCapture(image([0, 0, 0, 0])), /fully transparent/);
  });
});

function image(bitmap: number[], empty = false): BackgroundCaptureImage {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width: 1, height: 1 }),
    toBitmap: () => Buffer.from(bitmap),
    toPNG: () => Buffer.from([1, 2, 3]),
  };
}
