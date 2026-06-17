import { resolveLocalAssetPath } from './local-assets-service.ts';

type AssetCategory = 'tilesets' | 'parallaxes';

/** 仅从 workflow 内本地资产库（data/assets）解析 img 资源；不访问工程外路径。 */
export function resolveLibraryAssetPath(
  entry: Record<string, unknown>,
  category: AssetCategory,
  assetName: string,
  workflowRoot?: string,
): string | null {
  if (!workflowRoot) return null;
  return resolveLocalAssetPath(workflowRoot, entry, category, assetName);
}
