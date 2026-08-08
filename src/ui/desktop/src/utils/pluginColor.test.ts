import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hashPluginName, pluginColorHex, resolvePluginColor } from './pluginColor.ts';

describe('pluginColor', () => {
  describe('hashPluginName', () => {
    test('is stable across calls (same name → same hash)', () => {
      assert.equal(hashPluginName('VisuMZ_1_Core'), hashPluginName('VisuMZ_1_Core'));
    });

    test('different names hash to different values', () => {
      assert.notEqual(hashPluginName('YEP_CoreEngine'), hashPluginName('VisuMZ_1_Core'));
    });

    test('returns a non-negative integer for any input', () => {
      assert.ok(Number.isInteger(hashPluginName('')));
      assert.ok(hashPluginName('') >= 0);
      assert.ok(hashPluginName('插件') >= 0);
    });
  });

  describe('pluginColorHex', () => {
    test('produces a #rrggbb string', () => {
      assert.match(pluginColorHex('YEP_CoreEngine'), /^#[0-9a-f]{6}$/);
      assert.match(pluginColorHex(''), /^#[0-9a-f]{6}$/);
    });

    test('is deterministic for the same name', () => {
      assert.equal(pluginColorHex('YEP_CoreEngine'), pluginColorHex('YEP_CoreEngine'));
    });

    test('spreads distinct names across hues', () => {
      const hues = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Plugin1', 'Plugin2'].map(pluginColorHex));
      // Not all ten should collapse to one color.
      assert.ok(hues.size > 1);
    });
  });

  describe('resolvePluginColor', () => {
    test('uses the override when a valid hex is provided', () => {
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '#ff0000' }), '#FF0000');
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '00ff00' }), '#00FF00');
    });

    test('falls back to hash color when override is absent', () => {
      assert.equal(resolvePluginColor('YEP_CoreEngine', {}), pluginColorHex('YEP_CoreEngine'));
      assert.equal(resolvePluginColor('YEP_CoreEngine'), pluginColorHex('YEP_CoreEngine'));
    });

    test('ignores invalid overrides and falls back to hash color', () => {
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: 'nope' }), pluginColorHex('YEP_CoreEngine'));
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '' }), pluginColorHex('YEP_CoreEngine'));
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '#123' }), pluginColorHex('YEP_CoreEngine'));
    });

    test('still returns a color for an empty plugin name', () => {
      assert.match(resolvePluginColor(''), /^#[0-9a-f]{6}$/);
    });
  });
});
