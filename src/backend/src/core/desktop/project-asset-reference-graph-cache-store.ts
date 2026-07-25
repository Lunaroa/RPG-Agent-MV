import path from 'node:path';

import type { RmmvAssetReferenceGraph } from './asset-reference-graph-service.ts';

const projectAssetReferenceGraphCache = new Map<string, RmmvAssetReferenceGraph>();

export function readProjectAssetReferenceGraphCache(project: string): RmmvAssetReferenceGraph | undefined {
  return projectAssetReferenceGraphCache.get(cacheProjectKey(project));
}

export function writeProjectAssetReferenceGraphCache(
  project: string,
  graph: RmmvAssetReferenceGraph,
): void {
  projectAssetReferenceGraphCache.set(cacheProjectKey(project), graph);
}

export function invalidateProjectAssetReferenceGraphCache(project?: string): void {
  if (!project) {
    projectAssetReferenceGraphCache.clear();
    return;
  }
  projectAssetReferenceGraphCache.delete(cacheProjectKey(project));
}

function cacheProjectKey(project: string): string {
  return path.resolve(project);
}
