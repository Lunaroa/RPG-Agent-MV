import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  asParticleAnimationPreview,
  readPluginAnimationClassicPreview,
  resolvePluginAnimationPreviewKind,
} from './pluginParameterAnimationPreview.ts';

describe('pluginParameterAnimationPreview', () => {
  test('classifies MZ particle records by effectName', () => {
    assert.equal(resolvePluginAnimationPreviewKind(null), 'none');
    assert.equal(resolvePluginAnimationPreviewKind({ frames: [] }), 'classic');
    assert.equal(
      resolvePluginAnimationPreviewKind({ effectName: '  ', frames: [] }),
      'classic',
    );
    assert.equal(
      resolvePluginAnimationPreviewKind({ effectName: 'fx/Spark', frames: [] }),
      'particle',
    );
  });

  test('reads classic frame sheet fields', () => {
    const classic = readPluginAnimationClassicPreview({
      animation1Name: 'Hit',
      animation1Hue: 30,
      animation2Name: 'Hit2',
      animation2Hue: 10,
      frames: [[[0, 0, 0, 100, 0, 0, 255, 0]]],
    });
    assert.deepEqual(classic, {
      frames: [[[0, 0, 0, 100, 0, 0, 255, 0]]],
      animation1Name: 'Hit',
      animation1Hue: 30,
      animation2Name: 'Hit2',
      animation2Hue: 10,
    });
    assert.equal(asParticleAnimationPreview(classic), null);
  });

  test('exposes particle records for playtest', () => {
    const record = {
      displayType: 0,
      effectName: 'fx/Spark',
      scale: 100,
      speed: 100,
      offsetX: 0,
      offsetY: 0,
      rotation: { x: 0, y: 0, z: 0 },
      alignBottom: false,
      flashTimings: [],
      soundTimings: [],
    };
    assert.equal(asParticleAnimationPreview(record)?.effectName, 'fx/Spark');
  });
});
