import type { PluginFileAssetOption } from './pluginParameterFileAssets';

export type PluginFileBrowserViewMode = 'list' | 'gallery';

export type PluginFileTreeNode =
  | {
      kind: 'folder';
      id: string;
      label: string;
      children: PluginFileTreeNode[];
    }
  | {
      kind: 'file';
      id: string;
      label: string;
      asset: PluginFileAssetOption;
    };

export type PluginFileGalleryEntry =
  | { kind: 'parent'; id: '..'; label: string }
  | { kind: 'folder'; id: string; label: string; path: string; previewUrls: string[] }
  | { kind: 'file'; id: string; label: string; asset: PluginFileAssetOption };

let runtimePluginFileBrowserViewMode: PluginFileBrowserViewMode = 'gallery';

export function getRuntimePluginFileBrowserViewMode(): PluginFileBrowserViewMode {
  return runtimePluginFileBrowserViewMode;
}

export function setRuntimePluginFileBrowserViewMode(mode: PluginFileBrowserViewMode): void {
  runtimePluginFileBrowserViewMode = mode;
}

export function normalizePluginFileBrowsePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function folderPathOfAssetName(name: string): string {
  const normalized = normalizePluginFileBrowsePath(name);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

export function basenameOfAssetName(name: string): string {
  const normalized = normalizePluginFileBrowsePath(name);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? normalized : normalized.slice(slash + 1);
}

export function joinPluginFileBrowsePath(...parts: string[]): string {
  return parts
    .map((part) => normalizePluginFileBrowsePath(part))
    .filter(Boolean)
    .join('/');
}

export function parentPluginFileBrowsePath(path: string): string {
  return folderPathOfAssetName(path);
}

export function filterPluginFileAssetsByQuery(
  assets: PluginFileAssetOption[],
  query: string,
): PluginFileAssetOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return assets;
  return assets.filter((asset) => {
    const name = String(asset.name || '').toLowerCase();
    const fileName = String(asset.fileName || '').toLowerCase();
    return name.includes(normalized) || fileName.includes(normalized);
  });
}

export function buildPluginFileTree(
  assets: PluginFileAssetOption[],
  folders: string[] = [],
): PluginFileTreeNode[] {
  type MutableFolder = {
    kind: 'folder';
    id: string;
    label: string;
    folders: Map<string, MutableFolder>;
    files: PluginFileTreeNode[];
  };

  const root: MutableFolder = {
    kind: 'folder',
    id: '',
    label: '',
    folders: new Map(),
    files: [],
  };

  for (const folderPath of folders) {
    ensureFolder(root, normalizePluginFileBrowsePath(folderPath));
  }

  for (const asset of assets) {
    const name = normalizePluginFileBrowsePath(asset.name);
    if (!name || name.includes('..')) continue;
    const segments = name.split('/').filter(Boolean);
    if (!segments.length) continue;

    let cursor = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const label = segments[index]!;
      const id = joinPluginFileBrowsePath(cursor.id, label);
      let next = cursor.folders.get(label);
      if (!next) {
        next = { kind: 'folder', id, label, folders: new Map(), files: [] };
        cursor.folders.set(label, next);
      }
      cursor = next;
    }

    const label = segments[segments.length - 1]!;
    cursor.files.push({
      kind: 'file',
      id: name,
      label,
      asset: { ...asset, name },
    });
  }

  return freezeFolder(root);

  function ensureFolder(rootFolder: MutableFolder, folderPath: string): void {
    const normalized = normalizePluginFileBrowsePath(folderPath);
    if (!normalized || normalized.includes('..')) return;
    let cursor = rootFolder;
    for (const label of normalized.split('/').filter(Boolean)) {
      const id = joinPluginFileBrowsePath(cursor.id, label);
      let next = cursor.folders.get(label);
      if (!next) {
        next = { kind: 'folder', id, label, folders: new Map(), files: [] };
        cursor.folders.set(label, next);
      }
      cursor = next;
    }
  }

  function freezeFolder(folder: MutableFolder): PluginFileTreeNode[] {
    const children: PluginFileTreeNode[] = [
      ...[...folder.folders.values()]
        .sort((left, right) => left.label.localeCompare(right.label))
        .map((child) => ({
          kind: 'folder' as const,
          id: child.id,
          label: child.label,
          children: freezeFolder(child),
        })),
      ...folder.files.sort((left, right) => left.label.localeCompare(right.label)),
    ];
    return children;
  }
}

export function listPluginFileGalleryEntries(
  assets: PluginFileAssetOption[],
  currentPath: string,
  options: { parentLabel?: string; folders?: string[] } = {},
): PluginFileGalleryEntry[] {
  const path = normalizePluginFileBrowsePath(currentPath);
  const prefix = path ? `${path}/` : '';
  const folders = new Map<string, string>();
  const files: PluginFileAssetOption[] = [];

  for (const folderPath of options.folders || []) {
    const normalized = normalizePluginFileBrowsePath(folderPath);
    if (!normalized || normalized.includes('..')) continue;
    if (path) {
      if (normalized === path || !normalized.startsWith(prefix)) continue;
      const rest = normalized.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      folders.set(normalized, rest);
      continue;
    }
    if (normalized.includes('/')) continue;
    folders.set(normalized, normalized);
  }

  for (const asset of assets) {
    const name = normalizePluginFileBrowsePath(asset.name);
    if (!name || name.includes('..')) continue;
    if (path) {
      if (name === path || !name.startsWith(prefix)) continue;
    }

    const rest = path ? name.slice(prefix.length) : name;
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const label = rest.slice(0, slash);
      const folderPath = joinPluginFileBrowsePath(path, label);
      if (!folders.has(folderPath)) folders.set(folderPath, label);
      continue;
    }
    files.push({ ...asset, name });
  }

  const entries: PluginFileGalleryEntry[] = [];
  if (path) {
    entries.push({
      kind: 'parent',
      id: '..',
      label: options.parentLabel || '..',
    });
  }

  for (const [folderPath, label] of [...folders.entries()].sort((left, right) =>
    left[1].localeCompare(right[1]),
  )) {
    entries.push({
      kind: 'folder',
      id: folderPath,
      label,
      path: folderPath,
      previewUrls: imagePreviewsUnder(assets, folderPath, 3),
    });
  }

  for (const asset of files.sort((left, right) => left.name.localeCompare(right.name))) {
    entries.push({
      kind: 'file',
      id: asset.name,
      label: basenameOfAssetName(asset.name),
      asset,
    });
  }

  return entries;
}

/** Synthetic id for the gallery "none" card (always first in nav order). */
export const PLUGIN_FILE_GALLERY_NONE_ID = '__none__';

export function buildPluginFileGalleryNavIds(entries: PluginFileGalleryEntry[]): string[] {
  return [PLUGIN_FILE_GALLERY_NONE_ID, ...entries.map((entry) => entry.id)];
}

/** Column count must match `.file-gallery` CSS breakpoints. */
export function resolvePluginFileGalleryColumnCount(viewportWidth: number): number {
  if (viewportWidth <= 1100) return 3;
  if (viewportWidth <= 1300) return 4;
  return 5;
}

export function movePluginFileGalleryNavIndex(
  index: number,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  columnCount: number,
  length: number,
): number {
  if (length <= 0) return 0;
  const columns = Math.max(1, Math.floor(columnCount));
  let next = index;
  if (key === 'ArrowLeft') next = index - 1;
  else if (key === 'ArrowRight') next = index + 1;
  else if (key === 'ArrowUp') next = index - columns;
  else if (key === 'ArrowDown') next = index + columns;
  if (next < 0 || next >= length) return index;
  return next;
}

export function resolvePluginFileGalleryFocusId(
  selectedName: string,
  entries: PluginFileGalleryEntry[],
): string {
  const normalized = normalizePluginFileBrowsePath(selectedName);
  if (!normalized) return PLUGIN_FILE_GALLERY_NONE_ID;
  const match = entries.find((entry) => entry.kind === 'file' && entry.asset.name === normalized);
  return match?.id || PLUGIN_FILE_GALLERY_NONE_ID;
}

export type PluginFileTreeNavItem =
  | { kind: 'none'; navId: 'none' }
  | { kind: 'folder'; navId: string; id: string }
  | { kind: 'file'; navId: string; name: string };

/** Visible list-view rows in display order (respecting expanded folders). */
export function listPluginFileTreeNavItems(
  nodes: PluginFileTreeNode[],
  expandedIds: ReadonlySet<string>,
): PluginFileTreeNavItem[] {
  const items: PluginFileTreeNavItem[] = [{ kind: 'none', navId: 'none' }];

  function walk(list: PluginFileTreeNode[]): void {
    for (const node of list) {
      if (node.kind === 'folder') {
        items.push({ kind: 'folder', navId: `folder:${node.id}`, id: node.id });
        if (expandedIds.has(node.id)) walk(node.children);
        continue;
      }
      items.push({ kind: 'file', navId: `file:${node.id}`, name: node.id });
    }
  }

  walk(nodes);
  return items;
}

export function resolvePluginFileTreeNavIndex(
  items: PluginFileTreeNavItem[],
  selectedName: string,
  currentPath: string,
): number {
  const normalizedName = normalizePluginFileBrowsePath(selectedName);
  if (normalizedName) {
    const fileIndex = items.findIndex((item) => item.kind === 'file' && item.name === normalizedName);
    if (fileIndex >= 0) return fileIndex;
  }
  const normalizedPath = normalizePluginFileBrowsePath(currentPath);
  if (normalizedPath) {
    const folderIndex = items.findIndex((item) => item.kind === 'folder' && item.id === normalizedPath);
    if (folderIndex >= 0) return folderIndex;
  }
  return 0;
}

export function ancestorPluginFileFolderPaths(assetName: string): string[] {
  const folder = folderPathOfAssetName(assetName);
  if (!folder) return [];
  const segments = folder.split('/').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    paths.push(segments.slice(0, index + 1).join('/'));
  }
  return paths;
}

function imagePreviewsUnder(
  assets: PluginFileAssetOption[],
  folderPath: string,
  limit: number,
): string[] {
  const prefix = `${normalizePluginFileBrowsePath(folderPath)}/`;
  const urls: string[] = [];
  for (const asset of assets) {
    const name = normalizePluginFileBrowsePath(asset.name);
    if (!name.startsWith(prefix) || !asset.url) continue;
    const fileName = String(asset.fileName || asset.name);
    if (!/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(fileName)) continue;
    urls.push(asset.url);
    if (urls.length >= limit) break;
  }
  return urls;
}
