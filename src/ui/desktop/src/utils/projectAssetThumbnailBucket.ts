import {
  PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS,
  type ProjectAssetThumbnailSizeBucket,
} from '../../../../contract/project-asset-thumbnails.ts';

/**
 * Pick the smallest allowed thumbnail bucket that covers cellSize × devicePixelRatio.
 * If the needed size exceeds every bucket, returns the largest bucket.
 */
export function selectProjectAssetThumbnailBucket(
  cellSizePx: number,
  devicePixelRatio: number,
): ProjectAssetThumbnailSizeBucket {
  const cell = Number.isFinite(cellSizePx) ? Math.max(0, cellSizePx) : 0;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const needed = cell * dpr;
  for (const bucket of PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS) {
    if (bucket >= needed) return bucket;
  }
  return PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS[PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS.length - 1];
}
