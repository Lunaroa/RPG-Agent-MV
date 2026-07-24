import type {
  EditorProjectCatalog,
  ProjectAssetEntry,
  ProjectRelativeDirectoryListResult,
  RpgMakerEngine,
} from '../api/client';

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

/** Known catalog buckets for media/kind hints; picker listing always reads disk live. */
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
      folders: string[];
    }
  | {
      ok: false;
      reason: 'missing-directory' | 'directory-not-found' | 'missing-catalog' | 'invalid-directory';
      directory: string;
    };

/** MZ plugin file pickers may nest under @dir; MV's editor only lists the @dir folder itself. */
export function pluginFileParameterAllowsSubdirectories(
  engine: RpgMakerEngine | null | undefined,
): boolean {
  return engine === 'rpg-maker-mz';
}

export function filterPluginFileAssetsForEngine(
  assets: PluginFileAssetOption[],
  engine: RpgMakerEngine | null | undefined,
): PluginFileAssetOption[] {
  if (pluginFileParameterAllowsSubdirectories(engine)) return assets;
  return assets.filter((asset) => !String(asset.name || '').includes('/'));
}

export function filterPluginFileFoldersForEngine(
  folders: string[],
  engine: RpgMakerEngine | null | undefined,
): string[] {
  const unique = new Set<string>();
  for (const folder of folders) {
    const normalized = String(folder || '').replace(/\\/g, '/');
    if (!normalized || normalized.includes('..')) continue;
    if (!pluginFileParameterAllowsSubdirectories(engine) && normalized.includes('/')) continue;
    unique.add(normalized);
  }
  return [...unique].sort((left, right) => left.localeCompare(right));
}

export function normalizePluginFileDirectory(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function inferPluginFileMediaKind(directory: string): PluginFileMediaKind {
  const normalized = normalizePluginFileDirectory(directory);
  // Exact `img` / `audio` roots (MZ nested @dir) as well as `img/...` / `audio/...`.
  if (normalized === 'img' || normalized.startsWith('img/')) return 'image';
  if (normalized === 'audio' || normalized.startsWith('audio/')) return 'audio';
  if (normalized === 'movies' || normalized.startsWith('movies/')) return 'movie';
  return 'other';
}

/**
 * Sync catalog snapshot for quick checks. Prefer `resolvePluginParameterFileAssets`
 * when opening the picker so folders/files reflect the live project disk.
 */
export function resolvePluginParameterFileAssetsFromCatalog(
  catalog: EditorProjectCatalog | null | undefined,
  directory: unknown,
): PluginFileAssetResolution | { ok: 'needs-list'; directory: string; media: PluginFileMediaKind } {
  const normalized = normalizePluginFileDirectory(directory);
  if (!normalized) {
    return { ok: false, reason: 'missing-directory', directory: '' };
  }
  if (!catalog) {
    return { ok: false, reason: 'missing-catalog', directory: normalized };
  }

  const match = matchDirectoryBucket(normalized);
  if (!match) {
    return {
      ok: 'needs-list',
      directory: normalized,
      media: inferPluginFileMediaKind(normalized),
    };
  }

  const bucketAssets = catalog.assets[match.bucket.key] || [];
  const relativePrefix = match.relativePrefix;
  const assets = filterPluginFileAssetsForEngine(
    bucketAssets
      .map((asset) => toRelativeOption(asset, relativePrefix))
      .filter((asset): asset is PluginFileAssetOption => Boolean(asset))
      .sort((left, right) => left.name.localeCompare(right.name)),
    catalog.engine,
  );
  const folders = filterPluginFileFoldersForEngine(
    foldersFromAssetNames(assets.map((asset) => asset.name)),
    catalog.engine,
  );

  return {
    ok: true,
    directory: normalized,
    bucketDirectory: match.bucket.directory,
    media: match.bucket.media,
    assets,
    folders,
  };
}

/** Always lists from disk so newly created (including empty) folders appear immediately. */
export async function resolvePluginParameterFileAssets(
  catalog: EditorProjectCatalog | null | undefined,
  directory: unknown,
  listRelativeDirectory: (
    relativeDirectory: string,
    options: { recursive: boolean },
  ) => Promise<ProjectRelativeDirectoryListResult>,
): Promise<PluginFileAssetResolution> {
  const normalized = normalizePluginFileDirectory(directory);
  if (!normalized) {
    return { ok: false, reason: 'missing-directory', directory: '' };
  }
  if (!catalog) {
    return { ok: false, reason: 'missing-catalog', directory: normalized };
  }

  const match = matchDirectoryBucket(normalized);
  const media = match?.bucket.media || inferPluginFileMediaKind(normalized);
  const recursive = pluginFileParameterAllowsSubdirectories(catalog.engine);

  let listed: ProjectRelativeDirectoryListResult;
  try {
    listed = await listRelativeDirectory(normalized, { recursive });
  } catch {
    return {
      ok: false,
      reason: 'invalid-directory',
      directory: normalized,
    };
  }

  if (!listed.ok) {
    return {
      ok: false,
      reason: 'directory-not-found',
      directory: listed.directory || normalized,
    };
  }

  const assets = filterPluginFileAssetsForEngine(
    listed.assets
      .map((asset) => ({
        name: String(asset.name || '').replace(/\\/g, '/'),
        fileName: asset.fileName,
        url: asset.url,
      }))
      .filter((asset) => asset.name && !asset.name.includes('..'))
      .sort((left, right) => left.name.localeCompare(right.name)),
    catalog.engine,
  );
  const folders = filterPluginFileFoldersForEngine(
    [
      ...(listed.folders || []),
      ...foldersFromAssetNames(assets.map((asset) => asset.name)),
    ],
    catalog.engine,
  );

  return {
    ok: true,
    directory: listed.directory || normalized,
    bucketDirectory: match?.bucket.directory || listed.directory || normalized,
    media,
    assets,
    folders,
  };
}

export function foldersFromAssetNames(names: string[]): string[] {
  const folders = new Set<string>();
  for (const name of names) {
    const normalized = String(name || '').replace(/\\/g, '/');
    if (!normalized.includes('/')) continue;
    const parts = normalized.split('/').filter(Boolean);
    let cursor = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor = cursor ? `${cursor}/${parts[index]}` : parts[index]!;
      folders.add(cursor);
    }
  }
  return [...folders];
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
