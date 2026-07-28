/**
 * Shared thumbnail size-bucket contract for project asset browsing.
 * Backend listing URLs and Electron cache generation both read this set.
 */

export const PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS = [64, 128, 256, 512] as const;
export type ProjectAssetThumbnailSizeBucket = (typeof PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS)[number];

export const DEFAULT_PROJECT_ASSET_THUMBNAIL_SIZE_BUCKET: ProjectAssetThumbnailSizeBucket = 128;

export const PROJECT_ASSET_THUMBNAIL_SCHEMA_VERSION = 1;

/**
 * Independent version for effect (.efkefc) representative-frame thumbnails.
 * Bump to invalidate every cached effect thumbnail when the offscreen capture
 * pipeline changes (frame count, resolution handling, cropping, etc.).
 */
export const PROJECT_EFFECT_THUMBNAIL_SCHEMA_VERSION = 1;

export function assertProjectAssetThumbnailSizeBucket(
  sizeBucket: number,
): asserts sizeBucket is ProjectAssetThumbnailSizeBucket {
  if (!(PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS as readonly number[]).includes(sizeBucket)) {
    throw new Error(
      `Unsupported project asset thumbnail size bucket: ${sizeBucket}. Allowed buckets: ${PROJECT_ASSET_THUMBNAIL_SIZE_BUCKETS.join(', ')}.`,
    );
  }
}

export function resolveProjectAssetThumbnailSizeBucket(
  sizeBucket?: number,
): ProjectAssetThumbnailSizeBucket {
  if (sizeBucket === undefined) return DEFAULT_PROJECT_ASSET_THUMBNAIL_SIZE_BUCKET;
  assertProjectAssetThumbnailSizeBucket(sizeBucket);
  return sizeBucket;
}
