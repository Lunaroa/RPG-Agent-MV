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
import { getProjectFileForRead, getProjectStagingStatus } from './staging-service.ts';

const BROWSER_CATEGORIES = RMMV_ASSET_CATEGORIES.filter((category) => category.id !== 'plugins');

/**
 * MZ projects use the `data` layout (no `www/`); MV uses `www-data`.
 * Prefer layout over full engine inspect so incomplete test skeletons still browse.
 */
function projectAllowsPictureSubfolders(project: string): boolean {
  return projectAssetBrowserAllowsPictureSubfolders(
    resolveRmmvLayout(project).kind === 'data' ? 'rpg-maker-mz' : 'rpg-maker-mv',
  );
}

export type ProjectAssetDirectoryScanner = (
  absoluteDirectory: string,
) => Array<{ fileName: string; bytes: number; mtimeMs: number }>;

export type ProjectAssetSubdirectoryScanner = (absoluteDirectory: string) => string[];

type ProjectStagingStatus = ReturnType<typeof getProjectStagingStatus>;

export interface ProjectAssetBrowserDependencies {
  readDirectoryEntries?: ProjectAssetDirectoryScanner;
  readSubdirectories?: ProjectAssetSubdirectoryScanner;
  stagingStatus?: ProjectStagingStatus;
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

export function buildProjectAssetCategoryTree(
  workflowRoot: string,
  project: string,
  dependencies: ProjectAssetBrowserDependencies = {},
): ProjectAssetCategoryTree {
  const stagingStatus = dependencies.stagingStatus ?? getProjectStagingStatus(workflowRoot, project);
  const deps: ProjectAssetBrowserDependencies = { ...dependencies, stagingStatus };
  const layout = resolveRmmvLayout(project);
  const allowPictureSubfolders = projectAllowsPictureSubfolders(project);
  const groups = new Map<string, {
    id: string;
    directory: string;
    children: ProjectAssetCategoryTreeNode[];
  }>();
  const leaves: ProjectAssetCategoryTreeNode[] = [];

  for (const category of BROWSER_CATEGORIES) {
    const relativeDirectory = resourceRelativePath(layout, category.directory);
    if (!projectRelativeDirectoryPresent(project, relativeDirectory, stagingStatus)) continue;
    const recursiveCount = allowPictureSubfolders && category.id === PROJECT_ASSET_PICTURES_CATEGORY_ID
      ? countCategoryFiles(
        workflowRoot,
        project,
        relativeDirectory,
        '',
        category.extensions,
        stagingStatus,
        deps.readDirectoryEntries ?? defaultDirectoryScanner,
        true,
      )
      : listProjectAssetCategory(workflowRoot, project, category.id, undefined, deps).entries.length;
    const node: ProjectAssetCategoryTreeNode = {
      id: category.id,
      directory: relativeDirectory,
      entryCount: recursiveCount,
    };
    if (allowPictureSubfolders && category.id === PROJECT_ASSET_PICTURES_CATEGORY_ID) {
      const children = buildPictureSubfolderNodes(
        workflowRoot,
        project,
        relativeDirectory,
        '',
        category.extensions,
        stagingStatus,
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
 * List files for a browser node id. Accepts engine category ids (`pictures`) or
 * MZ picture subfolder ids (`pictures/ui`).
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
  if (!category) {
    throw new Error(
      `Unknown project asset browser category: ${categoryId}. Use a category id from RMMV_ASSET_CATEGORIES excluding plugins.`,
    );
  }
  if (subpath) {
    if (
      categoryId !== PROJECT_ASSET_PICTURES_CATEGORY_ID
      || !projectAllowsPictureSubfolders(project)
    ) {
      throw new Error(
        `Project asset subfolders are only supported for MZ pictures; got node id: ${categoryIdOrNodeId}`,
      );
    }
    assertSafeSubpath(subpath);
  }

  const sizeBucket = resolveProjectAssetThumbnailSizeBucket(thumbnailSizeBucket);
  const stagingStatus = dependencies.stagingStatus ?? getProjectStagingStatus(workflowRoot, project);
  const readDirectoryEntries = dependencies.readDirectoryEntries ?? defaultDirectoryScanner;
  const layout = resolveRmmvLayout(project);
  const categoryRelativeDirectory = resourceRelativePath(layout, category.directory);
  const relativeDirectory = subpath
    ? `${categoryRelativeDirectory}/${subpath}`
    : categoryRelativeDirectory;
  const nodeId = projectAssetBrowserNodeId(categoryId, subpath);
  const revision = computeListingRevision(project, relativeDirectory, stagingStatus);
  const cacheKey = `${cacheProjectKey(project)}\0${nodeId}\0${sizeBucket}`;
  const cached = listingCache.get(cacheKey);
  if (cached && cached.revision === revision) return cached.listing;

  const scanned = scanCategoryFiles(
    workflowRoot,
    project,
    categoryRelativeDirectory,
    subpath,
    category.extensions,
    stagingStatus,
    readDirectoryEntries,
  );
  const grouped = groupProjectAssetLogicalEntries(scanned, category.extensions);
  const imageCategory = category.directory.startsWith('img/');
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
      id: `${category.id}:${entry.name}`,
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

function buildPictureSubfolderNodes(
  workflowRoot: string,
  project: string,
  categoryRelativeDirectory: string,
  parentSubpath: string,
  extensions: readonly string[],
  stagingStatus: ProjectStagingStatus,
  dependencies: ProjectAssetBrowserDependencies,
): ProjectAssetCategoryTreeNode[] {
  const readSubdirectories = dependencies.readSubdirectories ?? defaultSubdirectoryScanner;
  const readDirectoryEntries = dependencies.readDirectoryEntries ?? defaultDirectoryScanner;
  const absoluteDirectory = absoluteProjectPath(
    project,
    parentSubpath ? `${categoryRelativeDirectory}/${parentSubpath}` : categoryRelativeDirectory,
  );
  const names = new Set<string>();
  if (fs.existsSync(absoluteDirectory) && fs.statSync(absoluteDirectory).isDirectory()) {
    for (const name of readSubdirectories(absoluteDirectory)) names.add(name);
  }
  const prefix = `${categoryRelativeDirectory}/${parentSubpath ? `${parentSubpath}/` : ''}`;
  for (const staged of stagingStatus.files) {
    if (staged.delete || !staged.relativePath.startsWith(prefix)) continue;
    const remainder = staged.relativePath.slice(prefix.length);
    const slash = remainder.indexOf('/');
    if (slash <= 0) continue;
    names.add(remainder.slice(0, slash));
  }

  const nodes: ProjectAssetCategoryTreeNode[] = [];
  for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
    assertSafeSubpathSegment(name);
    const childSubpath = parentSubpath ? `${parentSubpath}/${name}` : name;
    const childDirectory = `${categoryRelativeDirectory}/${childSubpath}`;
    const children = buildPictureSubfolderNodes(
      workflowRoot,
      project,
      categoryRelativeDirectory,
      childSubpath,
      extensions,
      stagingStatus,
      dependencies,
    );
    const entryCount = countCategoryFiles(
      workflowRoot,
      project,
      categoryRelativeDirectory,
      childSubpath,
      extensions,
      stagingStatus,
      readDirectoryEntries,
      true,
    );
    nodes.push({
      id: projectAssetBrowserNodeId(PROJECT_ASSET_PICTURES_CATEGORY_ID, childSubpath),
      directory: childDirectory,
      entryCount,
      ...(children.length > 0 ? { children } : {}),
    });
  }
  return nodes;
}

function scanCategoryFiles(
  workflowRoot: string,
  project: string,
  categoryRelativeDirectory: string,
  subpath: string,
  extensions: readonly string[],
  stagingStatus: ProjectStagingStatus,
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

  const prefix = `${relativeDirectory}/`;
  for (const staged of stagingStatus.files) {
    if (!staged.relativePath.startsWith(prefix)) continue;
    const fileName = staged.relativePath.slice(prefix.length);
    if (!fileName || fileName.includes('/')) continue;
    const extension = path.extname(fileName).toLowerCase();
    if (!accepted.has(extension)) continue;
    if (staged.delete) {
      files.delete(fileName);
      continue;
    }
    const absolute = getProjectFileForRead(workflowRoot, project, staged.relativePath);
    if (!absolute || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
      throw new Error(
        `Staged project asset is missing or not a file: ${staged.relativePath}. Re-stage the file or discard the staging entry.`,
      );
    }
    const stat = fs.statSync(absolute);
    files.set(fileName, {
      fileName,
      relativePath: staged.relativePath,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      logicalName: logicalNameForFile(subpath, fileName),
    });
  }

  return [...files.values()];
}

function countCategoryFiles(
  workflowRoot: string,
  project: string,
  categoryRelativeDirectory: string,
  subpath: string,
  extensions: readonly string[],
  stagingStatus: ProjectStagingStatus,
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

  // Prefer scanned files when a custom scanner is injected (tests); still union staging.
  if (fs.existsSync(absoluteDirectory) && fs.statSync(absoluteDirectory).isDirectory()) {
    for (const entry of readDirectoryEntries(absoluteDirectory)) {
      const extension = path.extname(entry.fileName).toLowerCase();
      if (!accepted.has(extension)) continue;
      counted.add(`${relativeDirectory}/${entry.fileName}`);
    }
  }

  const prefix = `${relativeDirectory}/`;
  for (const staged of stagingStatus.files) {
    if (!staged.relativePath.startsWith(prefix)) continue;
    const remainder = staged.relativePath.slice(prefix.length);
    if (!remainder) continue;
    if (!recursive && remainder.includes('/')) continue;
    const extension = path.extname(remainder).toLowerCase();
    if (!accepted.has(extension)) continue;
    if (staged.delete) {
      counted.delete(staged.relativePath);
      continue;
    }
    counted.add(staged.relativePath);
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
  stagingStatus: ProjectStagingStatus,
): string {
  const absoluteDirectory = absoluteProjectPath(project, relativeDirectory);
  let directoryMtime = 0;
  if (fs.existsSync(absoluteDirectory)) {
    const stat = fs.statSync(absoluteDirectory);
    if (!stat.isDirectory()) {
      throw new Error(
        `Project asset category path is not a directory: ${relativeDirectory}`,
      );
    }
    directoryMtime = stat.mtimeMs;
  }
  const stagingRevision = stagingStatus.files.length === 0
    ? 'unstaged'
    : stagingStatus.files
      .map((file) => `${file.relativePath}:${file.updatedAt}:${file.delete ? 'D' : 'A'}`)
      .sort()
      .join('|');
  return `${directoryMtime}|${stagingStatus.projectHash}|${stagingRevision}`;
}

function projectRelativeDirectoryPresent(
  project: string,
  relativeDirectory: string,
  stagingStatus: ProjectStagingStatus,
): boolean {
  const absolute = absoluteProjectPath(project, relativeDirectory);
  if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) return true;
  const prefix = `${relativeDirectory}/`;
  return stagingStatus.files.some((entry) => (
    !entry.delete && entry.relativePath.startsWith(prefix)
  ));
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
