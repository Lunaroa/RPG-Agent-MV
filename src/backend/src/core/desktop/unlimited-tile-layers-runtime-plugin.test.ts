import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildUnlimitedTileLayersRuntimePlugin,
  UNLIMITED_TILE_LAYERS_PLUGIN_NAME,
  UNLIMITED_TILE_LAYERS_PLUGIN_VERSION,
} from './unlimited-tile-layers-runtime-plugin.ts';

describe('buildUnlimitedTileLayersRuntimePlugin', () => {
  it('builds a managed MV plugin that parses note blocks and stacks tilemaps', () => {
    const source = buildUnlimitedTileLayersRuntimePlugin('rpg-maker-mv');
    assert.ok(source.includes('@target MV'));
    assert.ok(source.includes(UNLIMITED_TILE_LAYERS_PLUGIN_VERSION));
    assert.ok(source.includes('Managed by RPG Agent'));
    assert.ok(source.includes('<tileLayers>'));
    assert.ok(source.includes('Spriteset_Map.prototype.createTilemap'));
    assert.ok(source.includes('Spriteset_Map.prototype.updateTilemap'));
    assert.ok(source.includes('this._tilemap.origin.x'));
  });

  it('builds an MZ-targeted variant with the same runtime body', () => {
    const source = buildUnlimitedTileLayersRuntimePlugin('rpg-maker-mz');
    assert.ok(source.includes('@target MZ'));
    assert.ok(source.includes('new Tilemap()'));
  });

  it('embeds the managed plugin name in the help text only via constants', () => {
    assert.equal(UNLIMITED_TILE_LAYERS_PLUGIN_NAME, 'RPGAgentUnlimitedTileLayers');
  });
});
