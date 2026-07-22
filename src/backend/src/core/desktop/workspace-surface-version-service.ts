import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  WorkspaceSurfaceId,
  WorkspaceSurfaceVersionRequest,
  WorkspaceSurfaceVersionResult,
} from '../../../../contract/types.ts';
import { StagingManifestDao } from '../db/dao/staging-manifest-dao.ts';
import { resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { projectHash } from './staging-service.ts';

const SURFACES = new Set<WorkspaceSurfaceId>(['editor', 'projectManagement', 'mapOverview']);
const MAP_FILE_PATTERN = /^Map\d{3}\.json$/i;
const WATCH_CACHE_ENABLED = process.platform === 'win32' && !process.env.NODE_TEST_CONTEXT;

interface ProjectVersionCache {
  generation: number;
  versions: Map<string, { generation: number; version: string }>;
  watchers: fs.FSWatcher[];
  reliable: boolean;
}

const projectVersionCaches = new Map<string, ProjectVersionCache>();

interface MetadataEntry {
  relativePath: string;
  kind: 'file' | 'directory' | 'missing';
  size: number | null;
  mtimeMs: number | null;
}

export function validateWorkspaceSurfaceVersion(
  workflowRoot: string,
  project: string,
  request: WorkspaceSurfaceVersionRequest,
): WorkspaceSurfaceVersionResult {
  if (!SURFACES.has(request.surface)) throw new Error('Unknown workspace surface.');
  if (request.mapId != null && (!Number.isInteger(request.mapId) || request.mapId <= 0)) {
    throw new Error('Workspace surface map id must be a positive integer.');
  }
  const resolvedProject = fs.realpathSync.native(path.resolve(project));
  const version = cachedWorkspaceSurfaceVersion(workflowRoot, resolvedProject, request.surface, request.mapId);
  return {
    project: resolvedProject,
    surface: request.surface,
    version,
    unchanged: typeof request.loadedVersion === 'string' && request.loadedVersion === version,
  };
}

function cachedWorkspaceSurfaceVersion(
  workflowRoot: string,
  project: string,
  surface: WorkspaceSurfaceId,
  mapId?: number,
): string {
  if (!WATCH_CACHE_ENABLED) return computeWorkspaceSurfaceVersion(workflowRoot, project, surface, mapId);
  const cache = ensureProjectVersionCache(workflowRoot, project);
  if (!cache.reliable) return computeWorkspaceSurfaceVersion(workflowRoot, project, surface, mapId);
  const key = `${surface}:${mapId || 0}`;
  const current = cache.versions.get(key);
  if (current?.generation === cache.generation) return current.version;
  const generation = cache.generation;
  const version = computeWorkspaceSurfaceVersion(workflowRoot, project, surface, mapId);
  if (generation === cache.generation) cache.versions.set(key, { generation, version });
  return version;
}

function ensureProjectVersionCache(workflowRoot: string, project: string): ProjectVersionCache {
  const identity = path.resolve(project).toLocaleLowerCase();
  const existing = projectVersionCaches.get(identity);
  if (existing) return existing;
  for (const [cachedIdentity, cachedProject] of projectVersionCaches) {
    if (cachedIdentity === identity) continue;
    for (const watcher of cachedProject.watchers) watcher.close();
    projectVersionCaches.delete(cachedIdentity);
  }
  const cache: ProjectVersionCache = { generation: 0, versions: new Map(), watchers: [], reliable: true };
  const invalidate = () => {
    cache.generation += 1;
    cache.versions.clear();
  };
  const runtimeRoot = path.join(path.resolve(workflowRoot), 'runtime');
  const stagingRoot = path.join(runtimeRoot, 'agent-console-staging');
  const watchTargets = [
    { target: project, recursive: true },
    fs.existsSync(stagingRoot)
      ? { target: stagingRoot, recursive: true }
      : { target: runtimeRoot, recursive: false },
  ];
  for (const { target, recursive } of watchTargets) {
    if (!fs.existsSync(target)) {
      cache.reliable = false;
      break;
    }
    try {
      const watcher = fs.watch(target, { recursive }, invalidate);
      watcher.on('error', invalidate);
      watcher.unref();
      cache.watchers.push(watcher);
    } catch {
      for (const watcher of cache.watchers) watcher.close();
      cache.watchers = [];
      cache.generation += 1;
      cache.reliable = false;
      break;
    }
  }
  projectVersionCaches.set(identity, cache);
  return cache;
}

export function computeWorkspaceSurfaceVersion(
  workflowRoot: string,
  project: string,
  surface: WorkspaceSurfaceId,
  mapId?: number,
): string {
  const layout = resolveRmmvLayout(project);
  const entries = surfaceDependencies(layout.projectRoot, layout.dataDir, layout.resourceRoot, surface, mapId);
  const stagingId = projectHash(layout.projectRoot);
  const stagingMetadata = StagingManifestDao.getLatestMetadataByProject(stagingId);
  const stagingRoot = path.join(path.resolve(workflowRoot), 'runtime', 'agent-console-staging', stagingId, 'draft');
  collectPathMetadata(stagingRoot, stagingRoot, entries, true, undefined, 'staging');
  const digest = crypto.createHash('sha256');
  digest.update(`workspace-surface:v1:${surface}\n`);
  digest.update(`staging:${stagingMetadata?.id || 0}:${stagingMetadata?.updated_at || ''}\n`);
  for (const entry of [...entries.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    digest.update(`${entry.relativePath}\0${entry.kind}\0${entry.size ?? ''}\0${entry.mtimeMs ?? ''}\n`);
  }
  return digest.digest('hex').slice(0, 24);
}

function surfaceDependencies(
  projectRoot: string,
  dataDir: string,
  resourceRoot: string,
  surface: WorkspaceSurfaceId,
  mapId?: number,
): Map<string, MetadataEntry> {
  const entries = new Map<string, MetadataEntry>();
  if (surface === 'editor') {
    for (const name of ['MapInfos.json', 'Tilesets.json', 'System.json']) {
      collectPathMetadata(projectRoot, path.join(dataDir, name), entries, false);
    }
    if (mapId != null) collectPathMetadata(projectRoot, path.join(dataDir, `Map${String(mapId).padStart(3, '0')}.json`), entries, false);
    for (const relative of ['img/tilesets', 'img/characters', 'img/parallaxes']) {
      collectPathMetadata(projectRoot, path.join(resourceRoot, ...relative.split('/')), entries, true);
    }
    return entries;
  }
  collectPathMetadata(projectRoot, dataDir, entries, true, surface === 'mapOverview' ? MAP_FILE_PATTERN : undefined);
  const resourceDirectories = surface === 'mapOverview'
    ? ['img/tilesets', 'img/characters', 'img/parallaxes']
    : ['img', 'audio', 'movies', 'fonts'];
  for (const relative of resourceDirectories) {
    collectPathMetadata(projectRoot, path.join(resourceRoot, ...relative.split('/')), entries, true);
  }
  return entries;
}

function collectPathMetadata(
  identityRoot: string,
  target: string,
  entries: Map<string, MetadataEntry>,
  recursive: boolean,
  fileFilter?: RegExp,
  prefix = '',
): void {
  const relativePath = normalizedRelative(identityRoot, target, prefix);
  if (!fs.existsSync(target)) {
    entries.set(relativePath, { relativePath, kind: 'missing', size: null, mtimeMs: null });
    return;
  }
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (!fileFilter || fileFilter.test(path.basename(target)) || ['MapInfos.json', 'Tilesets.json'].includes(path.basename(target))) {
      entries.set(relativePath, { relativePath, kind: 'file', size: stat.size, mtimeMs: stat.mtimeMs });
    }
    return;
  }
  if (!stat.isDirectory()) return;
  entries.set(relativePath, { relativePath, kind: 'directory', size: null, mtimeMs: stat.mtimeMs });
  for (const child of fs.readdirSync(target, { withFileTypes: true })) {
    const childPath = path.join(target, child.name);
    if (child.isDirectory() && !recursive) continue;
    collectPathMetadata(identityRoot, childPath, entries, recursive, fileFilter, prefix);
  }
}

function normalizedRelative(identityRoot: string, target: string, prefix: string): string {
  const relative = path.relative(identityRoot, target).replaceAll('\\', '/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Workspace dependency escapes its root.');
  return [prefix, relative].filter(Boolean).join('/') || '.';
}
