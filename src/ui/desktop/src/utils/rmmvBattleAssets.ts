export type EnemyBattlerAssetKind = 'enemies' | 'svEnemies';

export function enemyBattlerAssetKind(sideView: boolean): EnemyBattlerAssetKind {
  return sideView ? 'svEnemies' : 'enemies';
}
