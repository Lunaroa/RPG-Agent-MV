import fs from 'node:fs';
import path from 'node:path';

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

export type ProjectAssetDirectoryScanner = (
  absoluteDirectory: string,
) => Array<{ fileName: string; bytes: number; mtimeMs: number }>;

type ProjectStagingStatus = ReturnType<typeof getProjectStagingStatus>;

export interface ProjectAssetBrowserDependencies {
  readDirectoryEntries?: ProjectAssetDirectoryScanner;
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
  const groups = new Map<string, {
    id: string;
    directory: string;
    children: ProjectAssetCategoryTreeNode[];
  }>();
  const leaves: ProjectAssetCategoryTreeNode[] = [];

  for (const category of BROWSER_CATEGORIES) {
    const relativeDirectory = resourceRelativePath(layout, category.directory);
    if (!projectRelativeDirectoryPresent(project, relativeDirectory, stagingStatus)) continue;
    const listing = listProjectAssetCategory(workflowRoot, project, category.id, undefined, deps);
    const node: ProjectAssetCategoryTreeNode = {
      id: category.id,
      directory: relativeDirectory,
      entryCount: listing.entries.length,
    };
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

export function listProjectAssetCategory(
  workflowRoot: string,
  project: string,
  categoryId: string,
  thumbnailSizeBucket?: number,
  dependencies: ProjectAssetBrowserDependencies = {},
): ProjectAssetCategoryListing {
  const category = BROWSER_CATEGORIES.find((entry) => entry.id === categoryId);
  if (!category) {
    throw new Error(
      `Unknown project asset browser category: ${categoryId}. Use a category id from RMMV_ASSET_CATEGORIES excluding plugins.`,
    );
  }

  const sizeBucket = resolveProjectAssetThumbnailSizeBucket(thumbnailSizeBucket);
  const stagingStatus = dependencies.stagingStatus ?? getProjectStagingStatus(workflowRoot, project);
  const readDirectoryEntries = dependencies.readDirectoryEntries ?? defaultDirectoryScanner;
  const layout = resolveRmmvLayout(project);
  const relativeDirectory = resourceRelativePath(layout, category.directory);
  const revision = computeListingRevision(project, relativeDirectory, stagingStatus);
  const cacheKey = `${cacheProjectKey(project)}\0${category.id}\0${sizeBucket}`;
  const cached = listingCache.get(cacheKey);
  if (cached && cached.revision === revision) return cached.listing;

  const scanned = scanCategoryFiles(
    workflowRoot,
    project,
    relativeDirectory,
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
    categoryId: category.id,
    directory: relativeDirectory,
    entries,
  };
  listingCache.set(cacheKey, { revision, listing });
  return listing;
}

function scanCategoryFiles(
  workflowRoot: string,
  project: string,
  relativeDirectory: string,
  extensions: readonly string[],
  stagingStatus: ProjectStagingStatus,
  readDirectoryEntries: ProjectAssetDirectoryScanner,
): ProjectAssetScannedFile[] {
  const accepted = new Set(extensions.map((extension) => extension.toLowerCase()));
  const files = new Map<string, ProjectAssetScannedFile>();
  const absoluteDirectory = path.join(project, ...relativeDirectory.split('/'));
  if (fs.existsSync(absoluteDirectory) && fs.statSync(absoluteDirectory).isDirectory()) {
    for (const entry of readDirectoryEntries(absoluteDirectory)) {
      const extension = path.extname(entry.fileName).toLowerCase();
      if (!accepted.has(extension)) continue;
      files.set(entry.fileName, {
        fileName: entry.fileName,
        relativePath: `${relativeDirectory}/${entry.fileName}`,
        bytes: entry.bytes,
        mtimeMs: entry.mtimeMs,
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
    });
  }

  return [...files.values()];
}

function computeListingRevision(
  project: string,
  relativeDirectory: string,
  stagingStatus: ProjectStagingStatus,
): string {
  const absoluteDirectory = path.join(project, ...relativeDirectory.split('/'));
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
  const absolute = path.join(project, ...relativeDirectory.split('/'));
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

function cacheProjectKey(project: string): string {
  return path.resolve(project).toLocaleLowerCase();
}
