export type EnemyBattlerAssetKind = 'enemies' | 'svEnemies';

export interface NamedEnemyBattlerAsset {
  name: string;
}

export function enemyBattlerAssetKind(sideView: boolean): EnemyBattlerAssetKind {
  return sideView ? 'svEnemies' : 'enemies';
}

/** Windows RPG Maker resolves asset paths case-insensitively. */
export function findEnemyBattlerAsset<T extends NamedEnemyBattlerAsset>(
  assets: readonly T[],
  battlerName: string,
): T | undefined {
  const exact = assets.find((entry) => entry.name === battlerName);
  if (exact) return exact;
  const normalized = normalizeAssetName(battlerName);
  return assets.find((entry) => normalizeAssetName(entry.name) === normalized);
}

function normalizeAssetName(value: string): string {
  return String(value || '').replace(/\\/g, '/').toLocaleLowerCase('en-US');
}
