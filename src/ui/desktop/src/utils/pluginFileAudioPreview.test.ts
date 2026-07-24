import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatPluginAudioClock,
  getRememberedPluginAudioVolume,
  pluginAudioProgressRatio,
  readFiniteAudioDuration,
  rememberPluginAudioVolume,
} from './pluginFileAudioPreview';

describe('pluginFileAudioPreview', () => {
  test('formats clocks and progress from known duration', () => {
    assert.equal(formatPluginAudioClock(0), '0:00');
    assert.equal(formatPluginAudioClock(2), '0:02');
    assert.equal(formatPluginAudioClock(65), '1:05');
    assert.equal(formatPluginAudioClock(3723), '1:02:03');
    assert.equal(formatPluginAudioClock(Number.NaN), '--:--');
    assert.equal(formatPluginAudioClock(Number.POSITIVE_INFINITY), '--:--');

    assert.equal(pluginAudioProgressRatio(2, 10), 0.2);
    assert.equal(pluginAudioProgressRatio(0, 10), 0);
    assert.equal(pluginAudioProgressRatio(10, 10), 1);
    assert.equal(pluginAudioProgressRatio(5, 0), 0);
    assert.equal(pluginAudioProgressRatio(5, Number.NaN), 0);

    assert.equal(readFiniteAudioDuration(12.5), 12.5);
    assert.equal(Number.isNaN(readFiniteAudioDuration(Number.POSITIVE_INFINITY)), true);
    assert.equal(Number.isNaN(readFiniteAudioDuration(0)), true);
  });

  test('remembers preview volume outside component setup so remounts keep it', () => {
    rememberPluginAudioVolume(100, false);
    rememberPluginAudioVolume(35, false);
    assert.deepEqual(getRememberedPluginAudioVolume(), { volumePercent: 35, muted: false });
    rememberPluginAudioVolume(0, false);
    assert.deepEqual(getRememberedPluginAudioVolume(), { volumePercent: 0, muted: true });
    rememberPluginAudioVolume(100, false);
  });
});
