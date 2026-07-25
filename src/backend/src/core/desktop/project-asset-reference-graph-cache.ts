import path from 'node:path';

import {
  expectedRelativePathsForLayout,
  type RmmvAssetCategory,
  type RmmvAssetReference,
  type RmmvAssetReferenceGraph,
  type RmmvMissingAssetReference,
  type RmmvProjectAsset,
} from './asset-reference-graph-service.ts';

/**
 * Pure incremental updates for a cached project asset reference graph.
 * Returns null when the cache cannot be updated safely (caller must invalidate).
 *
 * Delete semantics match full rebuild: reference rows stay in `references` and
 * also appear in `missingReferences` once the asset is gone.
 */

export function applyProjectAssetReferenceGraphDelete(
  graph: RmmvAssetReferenceGraph,
  category: RmmvAssetCategory,
  name: string,
): RmmvAssetReferenceGraph | null {
  const assets = graph.assets.filter((asset) => !(asset.category === category && asset.name === name));
  if (assets.length === graph.assets.length) return null;

  const movedReferences = graph.references.filter(
    (reference) => reference.category === category && reference.name === name,
  );
  const layout = { dataRelativeDir: graph.dataRelativeDir, gameRootRelative: graph.gameRootRelative };
  const missingFromMoved: RmmvMissingAssetReference[] = movedReferences.map((reference) => ({
    ...reference,
    expectedRelativePaths: expectedRelativePathsForLayout(layout, category, name),
  }));
  const retainedMissing = graph.missingReferences.filter(
    (reference) => !(reference.category === category && reference.name === name),
  );
  const missingReferences = [...retainedMissing, ...missingFromMoved];
  const referencedKeys = new Set(graph.references.map((reference) => assetKey(reference.category, reference.name)));
  const unusedAssets = assets.filter((asset) => !referencedKeys.has(assetKey(asset.category, asset.name)));

  return {
    ...graph,
    generatedAt: new Date().toISOString(),
    assets,
    references: graph.references,
    missingReferences,
    unusedAssets,
    summary: {
      assets: assets.length,
      references: graph.references.length,
      missingReferences: missingReferences.length,
      unusedAssets: unusedAssets.length,
    },
  };
}

export function applyProjectAssetReferenceGraphRename(
  graph: RmmvAssetReferenceGraph,
  category: RmmvAssetCategory,
  before: string,
  after: string,
  rewrittenReferences: readonly RmmvAssetReference[],
): RmmvAssetReferenceGraph | null {
  const matchingAssets = graph.assets.filter((asset) => asset.category === category && asset.name === before);
  if (!matchingAssets.length) return null;

  const occupied = graph.assets.some((asset) => asset.category === category && asset.name === after);
  if (occupied) return null;

  const existingRefs = graph.references.filter(
    (reference) => reference.category === category && reference.name === before,
  );
  if (existingRefs.length !== rewrittenReferences.length) return null;
  const existingKeys = new Set(existingRefs.map(referenceIdentity));
  for (const reference of rewrittenReferences) {
    if (reference.category !== category || reference.name !== before) return null;
    if (!existingKeys.has(referenceIdentity(reference))) return null;
  }

  const renamedAssets: RmmvProjectAsset[] = matchingAssets.map((asset) => {
    const extension = path.posix.extname(asset.fileName);
    const nextFileName = `${after}${extension}`;
    const relativeDir = asset.relativePath.slice(0, asset.relativePath.length - asset.fileName.length);
    return {
      ...asset,
      name: after,
      fileName: nextFileName,
      relativePath: `${relativeDir}${nextFileName}`,
    };
  });
  const assets = [
    ...graph.assets.filter((asset) => !(asset.category === category && asset.name === before)),
    ...renamedAssets,
  ].sort((left, right) => left.category.localeCompare(right.category) || left.relativePath.localeCompare(right.relativePath));

  const rewrittenKeys = new Set(rewrittenReferences.map(referenceIdentity));
  const references: RmmvAssetReference[] = graph.references.map((reference) => {
    if (reference.category === category && reference.name === before && rewrittenKeys.has(referenceIdentity(reference))) {
      return { ...reference, name: after };
    }
    return reference;
  });

  const layout = { dataRelativeDir: graph.dataRelativeDir, gameRootRelative: graph.gameRootRelative };
  const assetKeys = new Set(assets.map((asset) => assetKey(asset.category, asset.name)));
  const missingReferences = references
    .filter((reference) => !assetKeys.has(assetKey(reference.category, reference.name)))
    .map((reference) => ({
      ...reference,
      expectedRelativePaths: expectedRelativePathsForLayout(layout, reference.category, reference.name),
    }));
  const referencedKeys = new Set(references.map((reference) => assetKey(reference.category, reference.name)));
  const unusedAssets = assets.filter((asset) => !referencedKeys.has(assetKey(asset.category, asset.name)));

  return {
    ...graph,
    generatedAt: new Date().toISOString(),
    assets,
    references,
    missingReferences,
    unusedAssets,
    summary: {
      assets: assets.length,
      references: references.length,
      missingReferences: missingReferences.length,
      unusedAssets: unusedAssets.length,
    },
  };
}

function assetKey(category: string, name: string): string {
  return `${category}\0${name}`;
}

function referenceIdentity(reference: RmmvAssetReference): string {
  return `${reference.category}\0${reference.name}\0${reference.file}\0${reference.path}\0${reference.source}`;
}
