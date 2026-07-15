import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { enemyBattlerAssetKind } from './rmmvBattleAssets.ts';

describe('RMMV battle assets', () => {
  test('selects side-view enemy graphics only for side-view projects', () => {
    assert.equal(enemyBattlerAssetKind(true), 'svEnemies');
    assert.equal(enemyBattlerAssetKind(false), 'enemies');
  });
});
