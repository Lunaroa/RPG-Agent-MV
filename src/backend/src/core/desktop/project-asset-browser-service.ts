import fs from 'node:fs';
import path from 'node:path';

import {
  parseProjectAssetBrowserNodeId,
  PROJECT_ASSET_PICTURES_CATEGORY_ID,
  projectAssetBrowserAllowsPictureSubfolders,
  projectAssetBrowserNodeId,
} from '../../../../contract/project-asset-browser-nodes.ts';
import {
  resolveProjectAssetThumbnailSizeBucket,
} from '../../../../contract/project-asset-thumbnails.ts';
import type {
  ProjectAssetBrowseEntry,
  ProjectAssetBrowseVariant,
  ProjectAssetCategoryListing,
  ProjectAssetCategoryTree,
  ProjectAssetCategoryTreeNode,
} from '../../../../contract/types.ts';
import { resolveRmmvLayout, resourceRelativePath } from '../rmmv/rmmv-layout.ts';
import { RMMV_ASSET_CATEGORIES } from './asset-reference-graph-service.ts';
import { projectAssetThumbnailUrl, projectAssetUrl } from './asset-service.ts';
import {
  groupProjectAssetLogicalEntries,
  type ProjectAssetScannedFile,
} from './project-asset-logical-grouping.ts';
import { invalidateProjectAssetReferenceGraphCache } from './project-asset-reference-graph-cache-store.ts';

const BROWSER_CATEGORIES = RMMV_ASSET_CATEGORIES.filter((category) => category.id !== 'plugins');
const IMAGE_BROWSER_EXTENSIONS = BROWSER_CATEGORIES.find((category) => category.directory.startsWith('img/'))?.extensions ?? ['.png', '.jpg', '.jpeg', '.webp', '.rpgmvp'];

function projectAllowsPictureSubfolders(project: string): boolean {
  return projectAssetBrowserAllowsPictureSubfolders(
    resolveRmmvLayout(project).kind === 'data' ? 'rpg-maker-mz' : 'rpg-maker-mv',
  );
}

export type ProjectAssetDirectoryScanner = (
  absoluteDirectory: string,
) => Array<{ fileName: string; bytes: number; mtimeMs: number }>;

export type ProjectAssetSubdirectoryScanner = (absoluteDirectory: string) => string[];

export interface ProjectAssetBrowserDependencies {
  readDirectoryEntries?: ProjectAssetDirectoryScanner;
  readSubdirectories?: ProjectAssetSubdirectoryScanner;
  /** Selection-only view that exposes every directory under the game img root. */
  includeAllImageDirectories?: boolean;
}

interface ListingCacheEntry {
  revision: string;
  listing: ProjectAssetCategoryListing;
}

const listingCache = new Map<string, ListingCacheEntry>();

export function invalidateProjectAssetListingCache(project?: string): void {
  if (!project) {
    listingCache.clear();
    return;
  }
  const prefix = `${cacheProjectKey(project)}\0`;
  for (const key of listingCache.keys()) {
    if (key.startsWith(prefix)) listingCache.delete(key);
  }
}

export function invalidateProjectAssetBrowserCache(project?: string): void {
  invalidateProjectAssetReferenceGraphCache(project);
  invalidateProjectAssetListingCache(project);
}

/**
 * Watch the project's asset directories for file system changes and invoke
 * `onChange` after a short debounce. Scope is limited to the engine resource
 * buckets (img/audio/fonts/movies/effects) so app/session writes elsewhere
 * (save/ and data/) do not churn the asset browser.
 * Returns a cleanup function that stops all watchers.
 */
export function startProjectAssetWatcher(
  project: string,
  onChange: () => void,
): () => void {
  const ASSET_DIRECTORIES = ['img', 'audio', 'fonts', 'movies', 'effects'];
  const watchers: fs.FSWatcher[] = [];
  const watchedDirectories = new Set<string>();
  let closed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleChange(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 300);
  }

  function watchDirectory(absolute: string, recursive: boolean, listener: () => void): void {
    if (closed || watchedDirectories.has(absolute) || !fs.existsSync(absolute)) return;
    try {
      const watcher = fs.watch(absolute, { recursive }, listener);
      watcher.on('error', () => { /* ignore */ });
      watcher.unref();
      watchers.push(watcher);
      watchedDirectories.add(absolute);
    } catch {
      // Watching may fail on some platforms or permission issues; degrade gracefully.
    }
  }

  try {
    const resourceRoot = resolveRmmvLayout(project).resourceRoot;
    const armAssetDirWatchers = (): void => {
      for (const dir of ASSET_DIRECTORIES) {
        watchDirectory(path.join(resourceRoot, dir), true, scheduleChange);
      }
    };
    armAssetDirWatchers();
    // Top-level watch (non-recursive) catches asset buckets created after start
    // (e.g. fonts/ added later) and re-arms their recursive watchers.
    watchDirectory(resourceRoot, false, () => {
      armAssetDirWatchers();
      scheduleChange();
    });
  } catch {
    // Layout unresolved (not an RMMV project yet); nothing to watch.
  }

  return () => {
    closed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    watchers.length = 0;
    watchedDirectories.clear();
  };
}

export function buildProjectAssetCategoryTree(
  workflowRoot: string,
  project: string,
  dependencies: ProjectAssetBrowserDependencies = {},
): ProjectAssetCategoryTree {
  const deps = dependencies;
  const layout = resolveRmmvLayout(project);
  const includeAllImageDirectories = dependencies.includeAllImageDirectories === true;
  const groups = new Map<string, {
    id: string;
    directory: string;
    children: ProjectAssetCategoryTreeNode[];
  }>();
  const leaves: ProjectAssetCategoryTreeNode[] = [];

  for (const category of BROWSER_CATEGORIES) {
    const relativeDirectory = resourceRelativePath(layout, category.directory);
    if (!projectRelativeDirectoryPresent(project, relativeDirectory)) continue;
    const imageCategory = category.directory.startsWith('img/');
    const recursiveImageCategory = imageCategory && (includeAllImageDirectories
      || (category.id === PROJECT_ASSET_PICTURES_CATEGORY_ID && projectAllowsPictureSubfolders(project)));
    const recursiveCount = recursiveImageCategory
      ? countCategoryFiles(
        workflowRoot,
        project,
        relativeDirectory,
        '',
        category.extensions,
        deps.readDirectoryEntries ?? defaultDirectoryScanner,
        true,
      )
      : listProjectAssetCategory(workflowRoot, project, category.id, undefined, deps).entries.length;
    const node: ProjectAssetCategoryTreeNode = {
      id: category.id,
      directory: relativeDirectory,
      entryCount: recursiveCount,
    };
    if (recursiveImageCategory) {
      const children = buildImageSubfolderNodes(
        workflowRoot,
        project,
        category.id,
        relativeDirectory,
        '',
        category.extensions,
        deps,
      );
      if (children.length > 0) node.children = children;
    }
    const slash = category.directory.indexOf('/');
    if (slash < 0) {
      leaves.push(node);
      continue;
    }
    const rootId = category.directory.slice(0, slash);
    const rootDirectory = resourceRelativePath(layout, rootId);
    let group = groups.get(rootId);
    if (!group) {
      group = { id: rootId, directory: rootDirectory, children: [] };
      groups.set(rootId, group);
    }
    group.children.push(node);
  }

  const imageGroup = groups.get('img');
  if (includeAllImageDirectories && imageGroup) {
    const standardImageDirectories = new Set(BROWSER_CATEGORIES
      .filter((category) => category.directory.startsWith('img/'))
      .map((category) => category.directory.slice('img/'.length).split('/')[0]));
    const customDirectories = projectAssetSubdirectories(project, imageGroup.directory, '', deps)
      .filter((name) => !standardImageDirectories.has(name));
    for (const name of customDirectories) {
      const children = buildImageSubfolderNodes(
        workflowRoot,
        project,
        'img',
        imageGroup.directory,
        name,
        IMAGE_BROWSER_EXTENSIONS,
        deps,
      );
      imageGroup.children.push({
        id: projectAssetBrowserNodeId('img', name),
        directory: `${imageGroup.directory}/${name}`,
        entryCount: countCategoryFiles(
          workflowRoot,
          project,
          imageGroup.directory,
          name,
          IMAGE_BROWSER_EXTENSIONS,
          deps.readDirectoryEntries ?? defaultDirectoryScanner,
          true,
        ),
        ...(children.length > 0 ? { children } : {}),
      });
    }
    imageGroup.children.sort((left, right) => left.directory.localeCompare(right.directory));
  }

  const nodes: ProjectAssetCategoryTreeNode[] = [];
  for (const group of groups.values()) {
    nodes.push({
      id: group.id,
      directory: group.directory,
      entryCount: group.children.reduce((sum, child) => sum + child.entryCount, 0),
      children: group.children,
    });
  }
  nodes.push(...leaves);

  return {
    project: path.resolve(project),
    nodes,
  };
}

/**
 * List files for a browser node id. Image categories accept arbitrary safe
 * subdirectories; `img/<path>` covers custom folders outside engine buckets.
 */
export function listProjectAssetCategory(
  workflowRoot: string,
  project: string,
  categoryIdOrNodeId: string,
  thumbnailSizeBucket?: number,
  dependencies: ProjectAssetBrowserDependencies = {},
): ProjectAssetCategoryListing {
  const { categoryId, subpath } = parseProjectAssetBrowserNodeId(categoryIdOrNodeId);
  const category = BROWSER_CATEGORIES.find((entry) => entry.id === categoryId);
  const genericImageCategory = categoryId === 'img';
  const includeAllImageDirectories = dependencies.includeAllImageDirectories === true;
  if (!category && !(genericImageCategory && includeAllImageDirectories)) {
    throw new Error(
      `Unknown project asset browser category: ${categoryId}. Use a category id from RMMV_ASSET_CATEGORIES excluding plugins.`,
    );
  }
  if (subpath) {
    const legacyPicturesSubfolder = categoryId === PROJECT_ASSET_PICTURES_CATEGORY_ID && projectAllowsPictureSubfolders(project);
    const extendedImageSubfolder = includeAllImageDirectories && (genericImageCategory || category?.directory.startsWith('img/'));
    if (!legacyPicturesSubfolder && !extendedImageSubfolder) {
      throw new Error(
        `Project asset subfolders are unavailable for this browser scope; got node id: ${categoryIdOrNodeId}`,
      );
    }
    assertSafeSubpath(subpath);
  }

  const sizeBucket = resolveProjectAssetThumbnailSizeBucket(thumbnailSizeBucket);
  const readDirectoryEntries = dependencies.readDirectoryEntries ?? defaultDirectoryScanner;
  const layout = resolveRmmvLayout(project);
  const categoryRelativeDirectory = resourceRelativePath(layout, genericImageCategory ? 'img' : category!.directory);
  const relativeDirectory = subpath
    ? `${categoryRelativeDirectory}/${subpath}`
    : categoryRelativeDirectory;
  const nodeId = projectAssetBrowserNodeId(categoryId, subpath);
  const revision = computeListingRevision(project, relativeDirectory);
  const cacheKey = `${cacheProjectKey(project)}\0${nodeId}\0${sizeBucket}`;
  const cached = listingCache.get(cacheKey);
  if (cached && cached.revision === revision) return cached.listing;

  const scanned = scanCategoryFiles(
    workflowRoot,
    project,
    categoryRelativeDirectory,
    subpath,
    genericImageCategory ? IMAGE_BROWSER_EXTENSIONS : category!.extensions,
    readDirectoryEntries,
  );
  const grouped = groupProjectAssetLogicalEntries(scanned, genericImageCategory ? IMAGE_BROWSER_EXTENSIONS : category!.extensions);
  const imageCategory = genericImageCategory || category!.directory.startsWith('img/');
  const entries: ProjectAssetBrowseEntry[] = grouped.map((entry) => {
    const variants: ProjectAssetBrowseVariant[] = entry.variants.map((variant) => ({
      relativePath: variant.relativePath,
      fileName: variant.fileName,
      extension: variant.extension,
      bytes: variant.bytes,
      mtimeMs: variant.mtimeMs,
      encrypted: variant.encrypted,
    }));
    return {
      id: `${categoryId}:${entry.name}`,
      name: entry.name,
      variants,
      bytes: entry.bytes,
      mtimeMs: entry.mtimeMs,
      encrypted: entry.encrypted,
      url: projectAssetUrl(project, entry.primary.relativePath),
      thumbnailUrl: imageCategory
        ? projectAssetThumbnailUrl(project, entry.primary.relativePath, sizeBucket)
        : null,
    };
  });

  const listing: ProjectAssetCategoryListing = {
    categoryId: nodeId,
    directory: relativeDirectory,
    entries,
  };
  listingCache.set(cacheKey, { revision, listing });
  return listing;
}

function projectAssetSubdirectories(
  project: string,
  categoryRelativeDirectory: string,
  parentSubpath: string,
  dependencies: ProjectAssetBrowserDependencies,
): string[] {
  const readSubdirectories = dependencies.readSubdirectories ?? defaultSubdirectoryScanner;
  const absoluteDirectory = absoluteProjectPath(
    project,
    parentSubpath ? `${categoryRelativeDirectory}/${parentSubpath}` : categoryRelativeDirectory,
  );
  const names = new Set<string>();
  if (fs.existsSync(absoluteDirectory) && fs.statSync(absoluteDirectory).isDirectory()) {
    for (const name of readSubdirectories(absoluteDirectory)) names.add(name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function buildImageSubfolderNodes(
  workflowRoot: string,
  project: string,
  categoryId: string,
  categoryRelativeDirectory: string,
  parentSubpath: string,
  extensions: readonly string[],
  dependencies: ProjectAssetBrowserDependencies,
): ProjectAssetCategoryTreeNode[] {
  const readDirectoryEntries = dependencies.readDirectoryEntries ?? defaultDirectoryScanner;
  const names = projectAssetSubdirectories(project, categoryRelativeDirectory, parentSubpath, dependencies);

  const nodes: ProjectAssetCategoryTreeNode[] = [];
  for (const name of names) {
    assertSafeSubpathSegment(name);
    const childSubpath = parentSubpath ? `${parentSubpath}/${name}` : name;
    const childDirectory = `${categoryRelativeDirectory}/${childSubpath}`;
    const children = buildImageSubfolderNodes(
      workflowRoot,
      project,
      categoryId,
      categoryRelativeDirectory,
      childSubpath,
      extensions,
      dependencies,
    );
    const entryCount = countCategoryFiles(
      workflowRoot,
      project,
      categoryRelativeDirectory,
      childSubpath,
      extensions,
      readDirectoryEntries,
      true,
    );
    nodes.push({
      id: projectAssetBrowserNodeId(categoryId, childSubpath),
      directory: childDirectory,
      entryCount,
      ...(children.length > 0 ? { children } : {}),
    });
  }
  return nodes;
}

function scanCategoryFiles(
  _workflowRoot: string,
  project: string,
  categoryRelativeDirectory: string,
  subpath: string,
  extensions: readonly string[],
  readDirectoryEntries: ProjectAssetDirectoryScanner,
): ProjectAssetScannedFile[] {
  const accepted = new Set(extensions.map((extension) => extension.toLowerCase()));
  const relativeDirectory = subpath
    ? `${categoryRelativeDirectory}/${subpath}`
    : categoryRelativeDirectory;
  const files = new Map<string, ProjectAssetScannedFile>();
  const absoluteDirectory = absoluteProjectPath(project, relativeDirectory);
  if (fs.existsSync(absoluteDirectory) && fs.statSync(absoluteDirectory).isDirectory()) {
    for (const entry of readDirectoryEntries(absoluteDirectory)) {
      const extension = path.extname(entry.fileName).toLowerCase();
      if (!accepted.has(extension)) continue;
      const logicalName = logicalNameForFile(subpath, entry.fileName);
      files.set(entry.fileName, {
        fileName: entry.fileName,
        relativePath: `${relativeDirectory}/${entry.fileName}`,
        bytes: entry.bytes,
        mtimeMs: entry.mtimeMs,
        logicalName,
      });
    }
  }

  return [...files.values()];
}

function countCategoryFiles(
  _workflowRoot: string,
  project: string,
  categoryRelativeDirectory: string,
  subpath: string,
  extensions: readonly string[],
  readDirectoryEntries: ProjectAssetDirectoryScanner,
  recursive: boolean,
): number {
  const accepted = new Set(extensions.map((extension) => extension.toLowerCase()));
  const relativeDirectory = subpath
    ? `${categoryRelativeDirectory}/${subpath}`
    : categoryRelativeDirectory;
  const counted = new Set<string>();
  const absoluteDirectory = absoluteProjectPath(project, relativeDirectory);

  const walk = (absolute: string, relative: string) => {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (!accepted.has(extension)) continue;
        counted.add(`${relative}/${entry.name}`);
        continue;
      }
      if (recursive && entry.isDirectory()) {
        walk(path.join(absolute, entry.name), `${relative}/${entry.name}`);
      }
    }
  };
  walk(absoluteDirectory, relativeDirectory);

  // Prefer scanned files when a custom scanner is injected (tests).
  if (fs.existsSync(absoluteDirectory) && fs.statSync(absoluteDirectory).isDirectory()) {
    for (const entry of readDirectoryEntries(absoluteDirectory)) {
      const extension = path.extname(entry.fileName).toLowerCase();
      if (!accepted.has(extension)) continue;
      counted.add(`${relativeDirectory}/${entry.fileName}`);
    }
  }

  return counted.size;
}

function logicalNameForFile(subpath: string, fileName: string): string {
  const extension = path.extname(fileName);
  const base = extension ? fileName.slice(0, -extension.length) : fileName;
  return subpath ? `${subpath}/${base}` : base;
}

function computeListingRevision(
  project: string,
  relativeDirectory: string,
): string {
  const absoluteDirectory = absoluteProjectPath(project, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return 'missing';
  const stat = fs.statSync(absoluteDirectory);
  if (!stat.isDirectory()) {
    throw new Error(`Project asset category path is not a directory: ${relativeDirectory}`);
  }
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .map((entry) => {
      const file = path.join(absoluteDirectory, entry.name);
      const entryStat = fs.statSync(file);
      return `${entry.name}:${entry.isDirectory() ? 'd' : 'f'}:${entryStat.size}:${entryStat.mtimeMs}`;
    })
    .sort();
  return `${stat.mtimeMs}|${entries.join('|')}`;
}

function projectRelativeDirectoryPresent(
  project: string,
  relativeDirectory: string,
): boolean {
  const absolute = absoluteProjectPath(project, relativeDirectory);
  return fs.existsSync(absolute) && fs.statSync(absolute).isDirectory();
}

function defaultDirectoryScanner(
  absoluteDirectory: string,
): Array<{ fileName: string; bytes: number; mtimeMs: number }> {
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = path.join(absoluteDirectory, entry.name);
      const stat = fs.statSync(absolute);
      return { fileName: entry.name, bytes: stat.size, mtimeMs: stat.mtimeMs };
    });
}

function defaultSubdirectoryScanner(absoluteDirectory: string): string[] {
  if (!fs.existsSync(absoluteDirectory) || !fs.statSync(absoluteDirectory).isDirectory()) {
    return [];
  }
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== '.' && name !== '..')
    .sort((left, right) => left.localeCompare(right));
}

function absoluteProjectPath(project: string, relativeDirectory: string): string {
  return path.join(project, ...relativeDirectory.split('/').filter(Boolean));
}

function assertSafeSubpath(subpath: string): void {
  for (const segment of subpath.split('/')) {
    assertSafeSubpathSegment(segment);
  }
}

function assertSafeSubpathSegment(segment: string): void {
  if (!segment || segment === '.' || segment === '..' || segment.includes('\\')) {
    throw new Error(`Invalid project asset subfolder segment: ${segment}`);
  }
}

function cacheProjectKey(project: string): string {
  return path.resolve(project).toLocaleLowerCase();
}
