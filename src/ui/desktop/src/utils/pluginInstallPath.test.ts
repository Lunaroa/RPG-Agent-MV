import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { derivePluginInstallNameFromSourcePath } from './pluginInstallPath';

describe('pluginInstallPath', () => {
  test('keeps nested path under js/plugins and falls back to basename', () => {
    assert.equal(
      derivePluginInstallNameFromSourcePath('C:/game/js/plugins/tools/SamplePlugin.js'),
      'tools/SamplePlugin',
    );
    assert.equal(
      derivePluginInstallNameFromSourcePath('D:/proj/www/js/plugins/ui/Hud.js'),
      'ui/Hud',
    );
    assert.equal(
      derivePluginInstallNameFromSourcePath('C:/downloads/LoosePlugin.js'),
      'LoosePlugin',
    );
    assert.equal(
      derivePluginInstallNameFromSourcePath('C:\\game\\js\\plugins\\pack\\A.js'),
      'pack/A',
    );
  });
});
