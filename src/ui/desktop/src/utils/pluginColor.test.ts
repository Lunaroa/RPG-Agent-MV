import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_PLUGIN_COLOR, resolvePluginColor } from './pluginColor.ts';

describe('pluginColor', () => {
  describe('resolvePluginColor', () => {
    test('uses the override when a valid hex is provided', () => {
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '#ff0000' }), '#FF0000');
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '00ff00' }), '#00FF00');
    });

    test('uses white when no override is assigned', () => {
      assert.equal(resolvePluginColor('YEP_CoreEngine', {}), DEFAULT_PLUGIN_COLOR);
      assert.equal(resolvePluginColor('VisuMZ_1_Core'), DEFAULT_PLUGIN_COLOR);
    });

    test('ignores invalid overrides and uses white', () => {
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: 'nope' }), DEFAULT_PLUGIN_COLOR);
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '' }), DEFAULT_PLUGIN_COLOR);
      assert.equal(resolvePluginColor('YEP_CoreEngine', { YEP_CoreEngine: '#123' }), DEFAULT_PLUGIN_COLOR);
    });

    test('uses the same default for an empty plugin name', () => {
      assert.equal(resolvePluginColor(''), DEFAULT_PLUGIN_COLOR);
    });
  });
});
