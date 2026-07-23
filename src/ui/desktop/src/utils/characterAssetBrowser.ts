import type { ProjectAssetEntry } from '../api/client';

export type CharacterAssetViewMode = 'list' | 'gallery';

let runtimeCharacterAssetViewMode: CharacterAssetViewMode = 'list';

export function characterAssetMatches(asset: ProjectAssetEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return asset.name.toLowerCase().includes(normalized)
    || asset.fileName.toLowerCase().includes(normalized);
}

export function getRuntimeCharacterAssetViewMode(): CharacterAssetViewMode {
  return runtimeCharacterAssetViewMode;
}

export function setRuntimeCharacterAssetViewMode(mode: CharacterAssetViewMode): void {
  runtimeCharacterAssetViewMode = mode;
}
