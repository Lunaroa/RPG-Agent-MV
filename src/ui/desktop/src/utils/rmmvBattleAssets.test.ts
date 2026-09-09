import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { enemyBattlerAssetKind, findEnemyBattlerAsset } from './rmmvBattleAssets.ts';

describe('RMMV battle assets', () => {
  test('selects side-view enemy graphics only for side-view projects', () => {
    assert.equal(enemyBattlerAssetKind(true), 'svEnemies');
    assert.equal(enemyBattlerAssetKind(false), 'enemies');
  });

  test('matches Windows battler paths without changing the selected asset bucket', () => {
    const assets = [{ name: 'Folder/Number4', url: 'asset-a' }];
    assert.equal(findEnemyBattlerAsset(assets, 'folder\\number4')?.url, 'asset-a');
    assert.equal(findEnemyBattlerAsset(assets, 'Other'), undefined);
  });
});
