import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  characterAssetMatches,
  getRuntimeCharacterAssetViewMode,
  setRuntimeCharacterAssetViewMode,
} from './characterAssetBrowser';

const asset = {
  name: 'Actor One',
  fileName: 'Actor1.png',
  url: 'rpg-agent-preview://asset/actor1',
};

describe('character asset browser', () => {
  test('matches both display names and file names case-insensitively', () => {
    assert.equal(characterAssetMatches(asset, 'actor one'), true);
    assert.equal(characterAssetMatches(asset, 'ACTOR1.PNG'), true);
    assert.equal(characterAssetMatches(asset, 'missing'), false);
  });

  test('defaults to list and remembers changes only in module runtime state', () => {
    assert.equal(getRuntimeCharacterAssetViewMode(), 'list');
    setRuntimeCharacterAssetViewMode('gallery');
    assert.equal(getRuntimeCharacterAssetViewMode(), 'gallery');
    setRuntimeCharacterAssetViewMode('list');
  });
});
