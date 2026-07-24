import type { EditorProjectCatalog, ProjectAssetEntry } from '../api/client';

export type PluginFileMediaKind = 'image' | 'audio' | 'movie' | 'other';

export type PluginFileAssetOption = {
  name: string;
  fileName: string;
  url: string;
};

type CatalogAssetKey = keyof EditorProjectCatalog['assets'];

type DirectoryBucket = {
  directory: string;
  key: CatalogAssetKey;
  media: PluginFileMediaKind;
};

/** Canonical project-relative @dir roots that the editor catalog can list. */
export const PLUGIN_FILE_DIRECTORY_BUCKETS: readonly DirectoryBucket[] = [
  { directory: 'img/animations', key: 'animations', media: 'image' },
  { directory: 'img/battlebacks1', key: 'battlebacks1', media: 'image' },
  { directory: 'img/battlebacks2', key: 'battlebacks2', media: 'image' },
  { directory: 'img/characters', key: 'characters', media: 'image' },
  { directory: 'img/enemies', key: 'enemies', media: 'image' },
  { directory: 'img/faces', key: 'faces', media: 'image' },
  { directory: 'img/parallaxes', key: 'parallaxes', media: 'image' },
  { directory: 'img/pictures', key: 'pictures', media: 'image' },
  { directory: 'img/sv_actors', key: 'svActors', media: 'image' },
  { directory: 'img/sv_enemies', key: 'svEnemies', media: 'image' },
  { directory: 'img/system', key: 'system', media: 'image' },
  { directory: 'img/tilesets', key: 'tilesets', media: 'image' },
  { directory: 'img/titles1', key: 'titles1', media: 'image' },
  { directory: 'img/titles2', key: 'titles2', media: 'image' },
  { directory: 'audio/bgm', key: 'bgm', media: 'audio' },
  { directory: 'audio/bgs', key: 'bgs', media: 'audio' },
  { directory: 'audio/me', key: 'me', media: 'audio' },
  { directory: 'audio/se', key: 'se', media: 'audio' },
  { directory: 'effects', key: 'effects', media: 'other' },
  { directory: 'movies', key: 'movies', media: 'movie' },
] as const;

export type PluginFileAssetResolution =
  | {
      ok: true;
      directory: string;
      bucketDirectory: string;
      media: PluginFileMediaKind;
      assets: PluginFileAssetOption[];
    }
  | {
      ok: false;
      reason: 'missing-directory' | 'unsupported-directory' | 'missing-catalog';
      directory: string;
    };

export function normalizePluginFileDirectory(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function resolvePluginParameterFileAssets(
  catalog: EditorProjectCatalog | null | undefined,
  directory: unknown,
): PluginFileAssetResolution {
  const normalized = normalizePluginFileDirectory(directory);
  if (!normalized) {
    return { ok: false, reason: 'missing-directory', directory: '' };
  }
  if (!catalog) {
    return { ok: false, reason: 'missing-catalog', directory: normalized };
  }

  const match = matchDirectoryBucket(normalized);
  if (!match) {
    return { ok: false, reason: 'unsupported-directory', directory: normalized };
  }

  const bucketAssets = catalog.assets[match.bucket.key] || [];
  const relativePrefix = match.relativePrefix;
  const assets = bucketAssets
    .map((asset) => toRelativeOption(asset, relativePrefix))
    .filter((asset): asset is PluginFileAssetOption => Boolean(asset))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    ok: true,
    directory: normalized,
    bucketDirectory: match.bucket.directory,
    media: match.bucket.media,
    assets,
  };
}

function matchDirectoryBucket(directory: string): {
  bucket: DirectoryBucket;
  relativePrefix: string;
} | null {
  const ranked = [...PLUGIN_FILE_DIRECTORY_BUCKETS]
    .map((bucket) => ({ bucket, relativePrefix: relativePrefixFor(directory, bucket.directory) }))
    .filter((entry) => entry.relativePrefix !== null)
    .sort((left, right) => right.bucket.directory.length - left.bucket.directory.length);
  const best = ranked[0];
  if (!best || best.relativePrefix === null) return null;
  return { bucket: best.bucket, relativePrefix: best.relativePrefix };
}

function relativePrefixFor(directory: string, bucketDirectory: string): string | null {
  if (directory === bucketDirectory) return '';
  const prefix = `${bucketDirectory}/`;
  if (!directory.startsWith(prefix)) return null;
  return directory.slice(prefix.length);
}

function toRelativeOption(
  asset: ProjectAssetEntry,
  relativePrefix: string,
): PluginFileAssetOption | null {
  const assetName = String(asset.name || '').replace(/\\/g, '/');
  if (!relativePrefix) {
    return {
      name: assetName,
      fileName: asset.fileName,
      url: asset.url,
    };
  }
  const prefix = `${relativePrefix}/`;
  if (assetName === relativePrefix) {
    return null;
  }
  if (!assetName.startsWith(prefix)) return null;
  const name = assetName.slice(prefix.length);
  if (!name || name.includes('..')) return null;
  return {
    name,
    fileName: asset.fileName,
    url: asset.url,
  };
}
