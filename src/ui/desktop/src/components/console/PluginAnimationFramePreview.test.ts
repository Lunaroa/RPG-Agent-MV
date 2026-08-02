import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const classicSource = readFileSync(new URL('./PluginAnimationFramePreview.vue', import.meta.url), 'utf8');
const valueDialogSource = readFileSync(new URL('./PluginParameterValueDialog.vue', import.meta.url), 'utf8');
const particleFrameSource = readFileSync(new URL('../ParticleAnimationPreviewFrame.vue', import.meta.url), 'utf8');

describe('animation preview playback policy', () => {
  test('auto-starts only after a complete classic render and stops at the last frame', () => {
    assert.match(classicSource, /autoPlayOnReady\?: boolean/);
    assert.match(classicSource, /const autoPlayIntent = \+\+playbackIntentToken/);
    assert.match(classicSource, /void renderCanvas\(true, autoPlayIntent\)/);
    assert.match(classicSource, /autoPlayIntent === playbackIntentToken/);
    assert.match(classicSource, /function startPlayback\(\)[\s\S]+if \(playTimer\)[\s\S]+clearInterval\(playTimer\)/);
    assert.match(classicSource, /if \(next >= total\)/);
    assert.doesNotMatch(classicSource, /\(frameIndex\.value \+ 1\) % total/);
  });

  test('starts MZ particle previews after current data mounts and guards stale playback', () => {
    assert.match(valueDialogSource, /await nextTick\(\);[\s\S]+startParticlePreview\(\{ force: true \}\)/);
    assert.match(valueDialogSource, /let particlePreviewRequestId = 0/);
    assert.match(valueDialogSource, /requestId === particlePreviewRequestId/);
    assert.match(valueDialogSource, /particleFrameRef\.value\?\.play\(\{ \.\.\.preview \}\)/);
    assert.match(particleFrameSource, /let requestSeq = 0/);
    assert.match(particleFrameSource, /const seq = \+\+requestSeq/);
    assert.match(particleFrameSource, /if \(seq !== requestSeq\)/);
    assert.match(particleFrameSource, /particlePreview\.dispose\(session\.key\)/);
  });
});
