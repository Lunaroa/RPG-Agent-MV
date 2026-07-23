import crypto from 'node:crypto';
import fs from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
  MapOverviewEdge,
  MapOverviewIssue,
  MapOverviewNode,
  MapOverviewScanProgress,
  MapOverviewSnapshot,
  MapOverviewThumbnail,
  MapOverviewTransferSource,
  NamedCatalogEntry,
} from '../../../../contract/types.ts';
import { readJson, writeJsonAtomic } from '../rmmv/json.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import { getConfiguredDatabasePath } from '../db/pool.ts';
import {
  decodePng,
  encodePng,
  renderMapToFittedRgba,
} from '../workflow/map/map-render.ts';
import { mapOverviewEdgeAggregateKey } from '../../../../contract/map-overview-edge-key.ts';
import { createProjectReadFileIndex, type ProjectReadFileIndex } from './staging-service.ts';

const SNAPSHOT_CACHE_SCHEMA_VERSION = 5;
const THUMBNAIL_CACHE_SCHEMA_VERSION = 1;
const THUMBNAIL_RENDERER_VERSION = 2;
const THUMBNAIL_SCALE_DIVISOR = 4 as const;
const MAP_OVERVIEW_TILE_PX = 48;

interface SnapshotDependency {
  logicalPath: string;
  resolvedPath: string | null;
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
}

interface SnapshotCacheDocument {
  schemaVersion: number;
  thumbnailRendererVersion: number;
  project: string;
  dependencies: SnapshotDependency[];
  snapshot: MapOverviewSnapshot;
}

interface MapDocument {
  width?: unknown;
  height?: unknown;
  tilesetId?: unknown;
  data?: unknown;
  parallaxName?: unknown;
  parallaxShow?: unknown;
  events?: unknown;
}

interface TilesetDocument {
  tilesetNames?: unknown;
}

interface OverviewBuildContext {
  workflowRoot: string;
  project: string;
  dataRootRelative: string;
  resourceRoot: string;
  readIndex: ProjectReadFileIndex;
  mapInfos: any[];
  tilesets: any[];
  switches: NamedCatalogEntry[];
  variables: NamedCatalogEntry[];
  dependencies: Map<string, SnapshotDependency>;
}

interface MapSize {
  width: number;
  height: number;
}

export interface MapOverviewThumbnailWorkerRequest {
  requestId: number;
  workflowRoot: string;
  project: string;
  mapId: number;
  contentVersion: string;
  databasePath: string;
}

export type MapOverviewThumbnailWorkerResponse =
  | { requestId: number; ok: true; thumbnail: MapOverviewThumbnail }
  | { requestId: number; ok: false; error: string };

export function buildMapOverviewSnapshot(
  workflowRoot: string,
  project: string,
  reportProgress?: (progress: MapOverviewScanProgress) => void,
): MapOverviewSnapshot {
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  const resolvedProject = path.resolve(project);
  const cacheFile = snapshotCacheFile(resolvedWorkflowRoot, resolvedProject);
  removeLegacySnapshotCaches(cacheFile);
  const cached = readSnapshotCache(cacheFile, resolvedProject);
  if (cached && dependenciesMatch(
    createProjectReadFileIndex(resolvedWorkflowRoot, resolvedProject),
    cached.dependencies,
    progress => reportProgress?.({ phase: 'checking-cache', ...progress }),
  )) {
    return cached.snapshot;
  }

  const result = buildMapOverviewSnapshotFresh(resolvedWorkflowRoot, resolvedProject, reportProgress);
  const dependencies = [...result.context.dependencies.values()]
    .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  if (!dependenciesMatch(
    createProjectReadFileIndex(resolvedWorkflowRoot, resolvedProject),
    dependencies,
    progress => reportProgress?.({ phase: 'verifying-project', ...progress }),
  )) {
    throw new Error('Project content changed while the map overview was loading. Retry the operation.');
  }
  writeSnapshotCache(cacheFile, {
    schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION,
    thumbnailRendererVersion: THUMBNAIL_RENDERER_VERSION,
    project: resolvedProject,
    dependencies,
    snapshot: result.snapshot,
  });
  return result.snapshot;
}

function buildMapOverviewSnapshotFresh(
  workflowRoot: string,
  project: string,
  reportProgress?: (progress: MapOverviewScanProgress) => void,
): { snapshot: MapOverviewSnapshot; context: OverviewBuildContext } {
  const context = buildContext(workflowRoot, project);
  const knownMapIds = new Set<number>();
  const nodes: MapOverviewNode[] = [];
  const edgesByKey = new Map<string, MapOverviewEdge>();
  const issues: MapOverviewIssue[] = [];
  let unresolvedTransferCount = 0;
  let invalidTargetCount = 0;
  const mapSizes = new Map<number, MapSize>();
  const loadedMaps: Array<{
    mapId: number;
    name: string;
    info: any;
    map: MapDocument | null;
    mapFile: string | null;
    readState: MapOverviewNode['readState'];
    nodeIssues: MapOverviewIssue[];
    nodeUnresolved: number;
  }> = [];

  const mapInfos = context.mapInfos.filter(Boolean);
  for (const info of mapInfos) {
    const id = Number(info.id);
    if (Number.isInteger(id) && id > 0) knownMapIds.add(id);
  }

  reportProgress?.({ phase: 'reading-maps', completed: 0, total: mapInfos.length });
  let completedMaps = 0;
  for (const info of mapInfos) {
    const mapId = Number(info.id);
    if (!Number.isInteger(mapId) || mapId <= 0) {
      completedMaps += 1;
      reportProgress?.({ phase: 'reading-maps', completed: completedMaps, total: mapInfos.length });
      continue;
    }
    const name = String(info.name || `Map${String(mapId).padStart(3, '0')}`);
    const mapLogicalPath = mapRelativePath(context.dataRootRelative, mapId);
    const mapFile = resolveContextFile(context, mapLogicalPath);
    const nodeIssues: MapOverviewIssue[] = [];
    let map: MapDocument | null = null;
    let readState: MapOverviewNode['readState'] = 'ready';

    if (!mapFile || !fs.existsSync(mapFile)) {
      readState = 'missing';
      nodeIssues.push({
        code: 'map-missing',
        mapId,
        relativePath: mapRelativePath(context.dataRootRelative, mapId),
        message: `Map file is missing for Map${String(mapId).padStart(3, '0')}.`,
      });
    } else {
      try {
        map = readJson(mapFile) as MapDocument;
      } catch (error) {
        readState = 'invalid';
        nodeIssues.push({
          code: 'map-invalid',
          mapId,
          relativePath: mapRelativePath(context.dataRootRelative, mapId),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (map) {
      const width = nullablePositiveInteger(map.width);
      const height = nullablePositiveInteger(map.height);
      if (width != null && height != null) mapSizes.set(mapId, { width, height });
      nodeIssues.push(...collectResourceWarnings(context, mapId, map).map((message) => ({
        code: 'resource-missing' as const,
        mapId,
        message,
      })));
    }

    loadedMaps.push({
      mapId,
      name,
      info,
      map,
      mapFile,
      readState,
      nodeIssues,
      nodeUnresolved: 0,
    });
    completedMaps += 1;
    reportProgress?.({ phase: 'reading-maps', completed: completedMaps, total: mapInfos.length });
  }

  reportProgress?.({ phase: 'scanning-relations', completed: 0, total: loadedMaps.length });
  completedMaps = 0;
  for (const loaded of loadedMaps) {
    const { mapId, name, map } = loaded;
    if (map) {
      const sourceSize = mapSizes.get(mapId);
      for (const rawEvent of array(map.events)) {
        if (!record(rawEvent)) continue;
        const eventId = positiveInteger(rawEvent.id);
        if (eventId == null) continue;
        const eventName = String(rawEvent.name || `EV${String(eventId).padStart(3, '0')}`);
        array(rawEvent.pages).forEach((rawPage, pageIndex) => {
          if (!record(rawPage)) return;
          array(rawPage.list).forEach((rawCommand, commandIndex) => {
            if (!record(rawCommand) || Number(rawCommand.code) !== 201) return;
            const parameters = array(rawCommand.parameters);
            if (Number(parameters[0]) !== 0) {
              unresolvedTransferCount += 1;
              loaded.nodeUnresolved += 1;
              return;
            }
            const targetMapId = positiveInteger(parameters[1]);
            if (targetMapId == null) {
              unresolvedTransferCount += 1;
              loaded.nodeUnresolved += 1;
              return;
            }
            if (!knownMapIds.has(targetMapId)) {
              invalidTargetCount += 1;
              loaded.nodeIssues.push({
                code: 'invalid-target',
                mapId,
                targetMapId,
                message: `Transfer targets missing map ${targetMapId}.`,
              });
              return;
            }

            const sourceX = integerCoord(rawEvent.x);
            const sourceY = integerCoord(rawEvent.y);
            const targetX = integerCoord(parameters[2]);
            const targetY = integerCoord(parameters[3]);
            const pushInvalidCoords = (partial: Partial<MapOverviewIssue> = {}) => {
              loaded.nodeIssues.push({
                code: 'invalid-coordinate',
                mapId,
                targetMapId,
                eventId,
                eventName,
                pageIndex,
                commandIndex,
                ...(sourceX != null ? { sourceX } : {}),
                ...(sourceY != null ? { sourceY } : {}),
                ...(targetX != null ? { targetX } : {}),
                ...(targetY != null ? { targetY } : {}),
                ...partial,
                message: `Transfer coordinates are invalid for event ${eventName} on map ${mapId}.`,
              });
            };

            if (sourceX == null || sourceY == null || targetX == null || targetY == null) {
              pushInvalidCoords();
              return;
            }
            if (!sourceSize || !inMapBounds(sourceX, sourceY, sourceSize)) {
              pushInvalidCoords({ sourceX, sourceY, targetX, targetY });
              return;
            }
            const targetSize = mapSizes.get(targetMapId);
            if (!targetSize || !inMapBounds(targetX, targetY, targetSize)) {
              pushInvalidCoords({ sourceX, sourceY, targetX, targetY });
              return;
            }

            const source: MapOverviewTransferSource = {
              sourceMapId: mapId,
              sourceMapName: name,
              eventId,
              eventName,
              pageIndex,
              pageConditions: record(rawPage.conditions) ? structuredClone(rawPage.conditions) : {},
              commandIndex,
              sourceX,
              sourceY,
              targetMapId,
              targetX,
              targetY,
              direction: integer(parameters[4], 0),
              fadeType: integer(parameters[5], 0),
            };
            const edgeKey = mapOverviewEdgeAggregateKey({
              sourceMapId: mapId,
              sourceX,
              sourceY,
              targetMapId,
              targetX,
              targetY,
            });
            const edge = edgesByKey.get(edgeKey) || {
              id: edgeKey,
              sourceMapId: mapId,
              sourceX,
              sourceY,
              targetMapId,
              targetX,
              targetY,
              count: 0,
              sources: [],
            };
            edge.count += 1;
            edge.sources.push(source);
            edgesByKey.set(edgeKey, edge);
          });
        });
      }
    }
    completedMaps += 1;
    reportProgress?.({ phase: 'scanning-relations', completed: completedMaps, total: loadedMaps.length });
  }

  reportProgress?.({ phase: 'preparing-images', completed: 0, total: loadedMaps.length });
  completedMaps = 0;
  for (const loaded of loadedMaps) {
    const thumbnailVersion = loaded.map && loaded.mapFile
      ? buildThumbnailContentVersion(context, loaded.mapId, loaded.mapFile, loaded.map)
      : null;
    issues.push(...loaded.nodeIssues);
    nodes.push({
      id: loaded.mapId,
      name: loaded.name,
      parentId: integer(loaded.info.parentId, 0),
      order: integer(loaded.info.order, 0),
      readState: loaded.readState,
      width: loaded.map ? nullablePositiveInteger(loaded.map.width) : null,
      height: loaded.map ? nullablePositiveInteger(loaded.map.height) : null,
      thumbnailVersion,
      incomingCount: 0,
      outgoingCount: 0,
      unresolvedCount: loaded.nodeUnresolved,
      issues: loaded.nodeIssues,
    });
    completedMaps += 1;
    reportProgress?.({ phase: 'preparing-images', completed: completedMaps, total: loadedMaps.length });
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = [...edgesByKey.values()].sort((left, right) =>
    left.sourceMapId - right.sourceMapId
    || left.sourceX - right.sourceX
    || left.sourceY - right.sourceY
    || left.targetMapId - right.targetMapId
    || left.targetX - right.targetX
    || left.targetY - right.targetY);
  for (const edge of edges) {
    const source = nodeById.get(edge.sourceMapId);
    const target = nodeById.get(edge.targetMapId);
    if (source) source.outgoingCount += edge.count;
    if (target) target.incomingCount += edge.count;
  }
  nodes.sort((left, right) => left.order - right.order || left.id - right.id);

  const snapshotVersion = digest([
    JSON.stringify(nodes.map((node) => ({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      readState: node.readState,
      thumbnailVersion: node.thumbnailVersion,
      issues: node.issues,
    }))),
    JSON.stringify(edges),
    JSON.stringify(context.switches),
    JSON.stringify(context.variables),
    String(unresolvedTransferCount),
  ]);
  return { snapshot: {
    project: path.resolve(project),
    snapshotVersion,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    switches: context.switches,
    variables: context.variables,
    unresolvedTransferCount,
    invalidTargetCount,
    issues,
  }, context };
}

interface ThumbnailCacheDocument {
  schemaVersion: number;
  project: string;
  mapId: number;
  version: string;
  scaleDivisor: 4;
  width: number;
  height: number;
  mime: 'image/png';
  dataUrl: string;
  warnings: string[];
}

export function buildMapOverviewThumbnail(
  workflowRoot: string,
  project: string,
  mapId: number,
  contentVersion: string,
): MapOverviewThumbnail {
  const cached = readCachedMapOverviewThumbnail(workflowRoot, project, mapId, contentVersion);
  if (cached) return cached;
  validateThumbnailRequest(mapId, contentVersion);
  const resolvedProject = path.resolve(project);
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  const context = buildContext(resolvedWorkflowRoot, resolvedProject);
  const info = context.mapInfos.find((candidate) => Number(candidate?.id) === mapId);
  if (!info) throw new Error(`Map ${mapId} is not registered in MapInfos.json.`);
  const mapFile = resolveContextFile(context, mapRelativePath(context.dataRootRelative, mapId));
  if (!mapFile || !fs.existsSync(mapFile)) throw new Error(`Map file is missing for map ${mapId}.`);
  const map = readJson(mapFile) as MapDocument;
  const version = buildThumbnailContentVersion(context, mapId, mapFile, map);
  if (contentVersion !== version) {
    throw new Error('The map overview thumbnail version changed. Reload the map overview and try again.');
  }
  const width = positiveInteger(map.width);
  const height = positiveInteger(map.height);
  if (width == null || height == null || !Array.isArray(map.data)) {
    throw new Error(`Map ${mapId} has invalid dimensions or tile data.`);
  }
  const rendered = renderThumbnail(context, mapId, map);
  const document: ThumbnailCacheDocument = {
    schemaVersion: THUMBNAIL_CACHE_SCHEMA_VERSION,
    project: resolvedProject,
    mapId,
    version,
    scaleDivisor: THUMBNAIL_SCALE_DIVISOR,
    width: rendered.width,
    height: rendered.height,
    mime: 'image/png',
    dataUrl: `data:image/png;base64,${rendered.png.toString('base64')}`,
    warnings: collectResourceWarnings(context, mapId, map),
  };
  const cacheFile = thumbnailCacheFile(resolvedWorkflowRoot, resolvedProject, mapId, version);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeThumbnailCacheAtomic(cacheFile, document);
  removeStaleMapThumbnails(thumbnailMapCacheDir(resolvedWorkflowRoot, resolvedProject, mapId), version);
  return thumbnailFromCacheDocument(document, false);
}

export function readCachedMapOverviewThumbnail(
  workflowRoot: string,
  project: string,
  mapId: number,
  contentVersion: string,
): MapOverviewThumbnail | null {
  validateThumbnailRequest(mapId, contentVersion);
  const resolvedProject = path.resolve(project);
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  const existing = thumbnailCacheFile(resolvedWorkflowRoot, resolvedProject, mapId, contentVersion);
  if (!fs.existsSync(existing) || !fs.statSync(existing).isFile()) return null;
  try {
    const document = readJson(existing) as Partial<ThumbnailCacheDocument>;
    if (!isThumbnailCacheDocument(document, resolvedProject, mapId, contentVersion)) {
      fs.rmSync(existing, { force: true });
      return null;
    }
    removeStaleMapThumbnails(thumbnailMapCacheDir(resolvedWorkflowRoot, resolvedProject, mapId), contentVersion);
    return thumbnailFromCacheDocument(document as ThumbnailCacheDocument, true);
  } catch {
    fs.rmSync(existing, { force: true });
    return null;
  }
}

export async function requestMapOverviewThumbnail(
  workflowRoot: string,
  project: string,
  mapId: number,
  contentVersion: string,
  sessionId: string,
): Promise<MapOverviewThumbnail> {
  validateThumbnailRequest(mapId, contentVersion);
  const cached = readCachedMapOverviewThumbnail(workflowRoot, project, mapId, contentVersion);
  if (cached) return cached;
  const databasePath = getConfiguredDatabasePath();
  if (!databasePath) throw new Error('Map overview thumbnail worker requires a configured workspace database.');
  return thumbnailCoordinator.request({
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    mapId,
    contentVersion,
    databasePath,
  }, validateThumbnailSessionId(sessionId));
}

export function cancelMapOverviewThumbnailSession(sessionId: string): void {
  thumbnailCoordinator.cancel(validateThumbnailSessionId(sessionId));
}

export function finalizeMapOverviewThumbnailCache(workflowRoot: string, project: string): void {
  const legacy = path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-chunks', projectCacheKey(project));
  if (fs.existsSync(legacy)) {
    fs.rmSync(legacy, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

function buildContext(workflowRoot: string, project: string): OverviewBuildContext {
  const manifest = inspectRmmvProject(project);
  const readIndex = createProjectReadFileIndex(workflowRoot, project);
  const dependencies = new Map<string, SnapshotDependency>();
  const baseContext = {
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    dataRootRelative: manifest.dataRootRelative,
    resourceRoot: manifest.resourceRoot,
    readIndex,
    dependencies,
  };
  const mapInfosFile = resolveContextFile(baseContext, `${manifest.dataRootRelative}/MapInfos.json`)
    || path.join(manifest.dataDir, 'MapInfos.json');
  const tilesetsFile = resolveContextFile(baseContext, `${manifest.dataRootRelative}/Tilesets.json`)
    || path.join(manifest.dataDir, 'Tilesets.json');
  const systemFile = resolveContextFile(baseContext, `${manifest.dataRootRelative}/System.json`)
    || path.join(manifest.dataDir, 'System.json');
  const mapInfos = readJson(mapInfosFile) as any[];
  if (!Array.isArray(mapInfos)) throw new Error('MapInfos.json must contain an array.');
  const tilesets = fs.existsSync(tilesetsFile) ? readJson(tilesetsFile) as any[] : [];
  const system = fs.existsSync(systemFile) ? readJson(systemFile) as Record<string, unknown> : {};
  return {
    ...baseContext,
    mapInfos,
    tilesets: Array.isArray(tilesets) ? tilesets : [],
    switches: namedRemarkList(system.switches),
    variables: namedRemarkList(system.variables),
  };
}

function namedRemarkList(value: unknown): NamedCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((name, id) => {
    if (id <= 0 || typeof name !== 'string') return [];
    const trimmed = name.trim();
    if (!trimmed) return [];
    return [{ id, name: trimmed }];
  });
}

function buildThumbnailContentVersion(
  context: OverviewBuildContext,
  mapId: number,
  mapFile: string,
  map: MapDocument,
): string {
  const tileset = context.tilesets[integer(map.tilesetId, 0)] as TilesetDocument | undefined;
  const resources = thumbnailResourcePaths(context, map, tileset);
  return digest([
    Buffer.from(`renderer:${THUMBNAIL_RENDERER_VERSION}:scale:${THUMBNAIL_SCALE_DIVISOR}`),
    fs.readFileSync(mapFile),
    Buffer.from(JSON.stringify(tileset || null)),
    ...resources.map(fileVersion),
    Buffer.from(String(mapId)),
  ]).slice(0, 20);
}

function thumbnailResourcePaths(
  context: OverviewBuildContext,
  map: MapDocument,
  tileset?: TilesetDocument,
): string[] {
  const paths: string[] = [];
  const names = array(tileset?.tilesetNames).map(String);
  for (const slot of usedTilesetSlots(map)) {
    const name = names[slot];
    if (!name) continue;
    paths.push(resolveResourceFile(context, 'img', 'tilesets', `${name}.png`));
  }
  return paths;
}

function usedTilesetSlots(map: MapDocument): number[] {
  const width = positiveInteger(map.width) || 0;
  const height = positiveInteger(map.height) || 0;
  const tileCount = width * height * 4;
  const slots = new Set<number>();
  for (const rawTileId of array(map.data).slice(0, tileCount)) {
    const tileId = integer(rawTileId, 0);
    if (tileId <= 0) continue;
    if (tileId < 2048) slots.add(tileId >= 1536 ? 4 : 5 + Math.floor(tileId / 256));
    else if (tileId < 2816) slots.add(0);
    else if (tileId < 4352) slots.add(1);
    else if (tileId < 5888) slots.add(2);
    else if (tileId < 8192) slots.add(3);
  }
  return [...slots].sort((left, right) => left - right);
}

function collectResourceWarnings(context: OverviewBuildContext, mapId: number, map: MapDocument): string[] {
  const tileset = context.tilesets[integer(map.tilesetId, 0)] as TilesetDocument | undefined;
  return thumbnailResourcePaths(context, map, tileset)
    .filter((file) => !fs.existsSync(file))
    .map((file) => `Map ${mapId} resource is missing: ${path.relative(context.project, file).replaceAll('\\', '/')}`);
}

function renderThumbnail(
  context: OverviewBuildContext,
  mapId: number,
  map: MapDocument,
): { png: Buffer; width: number; height: number } {
  const width = positiveInteger(map.width);
  const height = positiveInteger(map.height);
  if (width == null || height == null || !Array.isArray(map.data)) {
    throw new Error(`Map ${mapId} has invalid dimensions or tile data.`);
  }
  const tileset = context.tilesets[integer(map.tilesetId, 0)] as TilesetDocument | undefined;
  if (!tileset) throw new Error(`Tileset ${String(map.tilesetId)} does not exist.`);
  const bitmaps = array(tileset.tilesetNames).map((rawName) => {
    const name = String(rawName || '');
    if (!name) return null;
    const file = resolveResourceFile(context, 'img', 'tilesets', `${name}.png`);
    return fs.existsSync(file) ? decodePng(fs.readFileSync(file)) : null;
  });
  const mapData = {
    width,
    height,
    tilesetId: integer(map.tilesetId, 0),
    data: map.data.map((value) => integer(value, 0)),
  };
  const outputWidth = width * (MAP_OVERVIEW_TILE_PX / THUMBNAIL_SCALE_DIVISOR);
  const outputHeight = height * (MAP_OVERVIEW_TILE_PX / THUMBNAIL_SCALE_DIVISOR);
  const rgba = Buffer.alloc(outputWidth * outputHeight * 4);
  for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
  const rendered = renderMapToFittedRgba(mapData, bitmaps, outputWidth, outputHeight, rgba);
  return {
    png: encodePng(outputWidth, outputHeight, rendered.rgba),
    width: outputWidth,
    height: outputHeight,
  };
}

function removeStaleMapThumbnails(mapDir: string, currentVersion: string): void {
  if (!fs.existsSync(mapDir)) return;
  for (const entry of fs.readdirSync(mapDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === `${currentVersion}.json`) continue;
    fs.rmSync(path.join(mapDir, entry.name), { recursive: entry.isDirectory(), force: true });
  }
}

function isThumbnailCacheDocument(
  value: Partial<ThumbnailCacheDocument>,
  project: string,
  mapId: number,
  version: string,
): value is ThumbnailCacheDocument {
  return value.schemaVersion === THUMBNAIL_CACHE_SCHEMA_VERSION
    && path.resolve(String(value.project || '')).toLocaleLowerCase() === path.resolve(project).toLocaleLowerCase()
    && value.mapId === mapId
    && value.version === version
    && value.scaleDivisor === THUMBNAIL_SCALE_DIVISOR
    && Number.isInteger(value.width) && Number(value.width) > 0
    && Number.isInteger(value.height) && Number(value.height) > 0
    && value.mime === 'image/png'
    && typeof value.dataUrl === 'string'
    && value.dataUrl.startsWith('data:image/png;base64,')
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === 'string')
    && isValidCachedThumbnailPng(value);
}

function thumbnailFromCacheDocument(document: ThumbnailCacheDocument, cacheHit: boolean): MapOverviewThumbnail {
  return {
    project: document.project,
    mapId: document.mapId,
    version: document.version,
    scaleDivisor: document.scaleDivisor,
    width: document.width,
    height: document.height,
    mime: document.mime,
    dataUrl: document.dataUrl,
    cacheHit,
    warnings: document.warnings,
  };
}

function isValidCachedThumbnailPng(value: Partial<ThumbnailCacheDocument>): boolean {
  try {
    const encoded = String(value.dataUrl).slice('data:image/png;base64,'.length);
    const decoded = decodePng(Buffer.from(encoded, 'base64'));
    return decoded.width === value.width && decoded.height === value.height;
  } catch {
    return false;
  }
}

function projectCacheKey(project: string): string {
  return crypto.createHash('sha256').update(path.resolve(project).toLocaleLowerCase()).digest('hex').slice(0, 20);
}

function validateThumbnailRequest(mapId: number, version: string): void {
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 999) throw new Error('Invalid map overview thumbnail map id.');
  if (!/^[a-f0-9]{20}$/.test(version)) throw new Error('Invalid map overview thumbnail version.');
}

function thumbnailCacheDir(workflowRoot: string, project: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-thumbnails', projectCacheKey(project));
}

function thumbnailMapCacheDir(workflowRoot: string, project: string, mapId: number): string {
  return path.join(thumbnailCacheDir(workflowRoot, project), `Map${String(mapId).padStart(3, '0')}`);
}

function thumbnailCacheFile(
  workflowRoot: string,
  project: string,
  mapId: number,
  version: string,
): string {
  return path.join(thumbnailMapCacheDir(workflowRoot, project, mapId), `${version}.json`);
}

function writeThumbnailCacheAtomic(file: string, document: ThumbnailCacheDocument): void {
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const temporary = `${file}.tmp.${nonce}`;
  const previous = `${file}.previous.${nonce}`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  let previousMoved = false;
  try {
    if (fs.existsSync(file)) {
      fs.renameSync(file, previous);
      previousMoved = true;
    }
    fs.renameSync(temporary, file);
    if (previousMoved) fs.rmSync(previous, { force: true });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (previousMoved && !fs.existsSync(file) && fs.existsSync(previous)) fs.renameSync(previous, file);
    throw error;
  }
}

function snapshotCacheFile(workflowRoot: string, project: string): string {
  return path.join(
    path.resolve(workflowRoot),
    'runtime',
    'map-overview-cache',
    projectCacheKey(project),
    `snapshot-v${SNAPSHOT_CACHE_SCHEMA_VERSION}.json`,
  );
}

interface ThumbnailJobInput {
  workflowRoot: string;
  project: string;
  mapId: number;
  contentVersion: string;
  databasePath: string;
}

interface ThumbnailSubscriber {
  promise: Promise<MapOverviewThumbnail>;
  resolve: (value: MapOverviewThumbnail) => void;
  reject: (error: Error) => void;
}

interface ThumbnailJob {
  key: string;
  requestId: number;
  input: ThumbnailJobInput;
  subscribers: Map<string, ThumbnailSubscriber>;
}

const THUMBNAIL_WORKER_FILE = import.meta.url.endsWith('.ts')
  ? './map-overview-thumbnail-worker.ts'
  : './map-overview-thumbnail-worker.js';
const THUMBNAIL_WORKER_URL = new URL(THUMBNAIL_WORKER_FILE, import.meta.url);
const THUMBNAIL_WORKER_EXEC_ARGV = ['--experimental-strip-types', '--experimental-transform-types'];

interface ThumbnailWorkerSlot {
  worker: Worker;
  job: ThumbnailJob | null;
}

export function mapOverviewThumbnailWorkerConcurrency(parallelism = availableParallelism()): number {
  return Math.max(1, Math.min(4, parallelism - 1));
}

class MapOverviewThumbnailCoordinator {
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly slots: ThumbnailWorkerSlot[] = [];
  private readonly queued: ThumbnailJob[] = [];
  private readonly jobsByKey = new Map<string, ThumbnailJob>();
  private nextRequestId = 1;
  private readonly concurrency = mapOverviewThumbnailWorkerConcurrency();

  request(input: ThumbnailJobInput, sessionId: string): Promise<MapOverviewThumbnail> {
    const key = thumbnailJobKey(input);
    let job = this.jobsByKey.get(key);
    if (!job) {
      job = { key, requestId: this.nextRequestId++, input, subscribers: new Map() };
      this.jobsByKey.set(key, job);
      this.queued.push(job);
    }
    const existing = job.subscribers.get(sessionId);
    if (existing) return existing.promise;
    let resolve!: (value: MapOverviewThumbnail) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<MapOverviewThumbnail>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    job.subscribers.set(sessionId, { promise, resolve, reject });
    this.pump();
    return promise;
  }

  cancel(sessionId: string): void {
    const cancellation = thumbnailCancellationError();
    for (const job of [...this.jobsByKey.values()]) {
      const subscriber = job.subscribers.get(sessionId);
      if (!subscriber) continue;
      job.subscribers.delete(sessionId);
      subscriber.reject(cancellation);
      if (job.subscribers.size > 0) continue;
      this.jobsByKey.delete(job.key);
      const queueIndex = this.queued.indexOf(job);
      if (queueIndex >= 0) this.queued.splice(queueIndex, 1);
      const slot = this.slots.find(candidate => candidate.job === job);
      if (slot) this.abortSlot(slot);
    }
    this.pump();
    this.scheduleIdleShutdown();
  }

  private pump(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    while (true) {
      let next = this.queued.shift() || null;
      while (next && next.subscribers.size === 0) next = this.queued.shift() || null;
      if (!next) return;
      let slot = this.slots.find(candidate => candidate.job == null);
      if (!slot && this.slots.length < this.concurrency) slot = this.createSlot();
      if (!slot) {
        this.queued.unshift(next);
        return;
      }
      slot.job = next;
      slot.worker.postMessage({ requestId: next.requestId, ...next.input } satisfies MapOverviewThumbnailWorkerRequest);
    }
  }

  private createSlot(): ThumbnailWorkerSlot {
    const worker = new Worker(THUMBNAIL_WORKER_URL, { execArgv: THUMBNAIL_WORKER_EXEC_ARGV });
    worker.unref();
    const slot: ThumbnailWorkerSlot = { worker, job: null };
    worker.on('message', (message: MapOverviewThumbnailWorkerResponse) => this.handleMessage(slot, message));
    worker.on('error', error => this.handleWorkerFailure(slot, error));
    worker.on('exit', code => {
      if (!this.slots.includes(slot)) return;
      const job = slot.job;
      this.removeSlot(slot);
      if (job) {
        this.rejectJob(job, new Error(`Map overview thumbnail worker exited before completing the request (code ${code}).`));
      }
      this.pump();
    });
    this.slots.push(slot);
    return slot;
  }

  private handleMessage(slot: ThumbnailWorkerSlot, message: MapOverviewThumbnailWorkerResponse): void {
    const job = slot.job;
    if (!job || message.requestId !== job.requestId) return;
    slot.job = null;
    this.jobsByKey.delete(job.key);
    if (message.ok) {
      for (const subscriber of job.subscribers.values()) subscriber.resolve(message.thumbnail);
    } else {
      const error = new Error(message.error);
      for (const subscriber of job.subscribers.values()) subscriber.reject(error);
    }
    this.pump();
    this.scheduleIdleShutdown();
  }

  private handleWorkerFailure(slot: ThumbnailWorkerSlot, error: Error): void {
    const job = slot.job;
    this.abortSlot(slot);
    if (job) this.rejectJob(job, error);
    this.pump();
    this.scheduleIdleShutdown();
  }

  private rejectJob(job: ThumbnailJob, error: Error): void {
    this.jobsByKey.delete(job.key);
    for (const subscriber of job.subscribers.values()) subscriber.reject(error);
  }

  private abortSlot(slot: ThumbnailWorkerSlot): void {
    this.removeSlot(slot);
    slot.worker.removeAllListeners();
    void slot.worker.terminate();
  }

  private removeSlot(slot: ThumbnailWorkerSlot): void {
    const index = this.slots.indexOf(slot);
    if (index >= 0) this.slots.splice(index, 1);
    slot.job = null;
  }

  private scheduleIdleShutdown(): void {
    if (this.slots.some(slot => slot.job) || this.queued.length || !this.slots.length || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.slots.some(slot => slot.job) || this.queued.length) return;
      for (const slot of [...this.slots]) this.abortSlot(slot);
    }, 1_000);
  }
}

const thumbnailCoordinator = new MapOverviewThumbnailCoordinator();

function thumbnailJobKey(input: ThumbnailJobInput): string {
  return [
    input.workflowRoot,
    input.project,
    String(input.mapId),
    input.contentVersion,
  ].join('\0');
}

function validateThumbnailSessionId(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Invalid map overview thumbnail session id.');
  }
  return value;
}

function thumbnailCancellationError(): Error {
  const error = new Error('Map overview thumbnail request was canceled.');
  error.name = 'AbortError';
  return error;
}

function inMapBounds(x: number, y: number, size: MapSize): boolean {
  return x >= 0 && y >= 0 && x < size.width && y < size.height;
}

function readSnapshotCache(cacheFile: string, project: string): SnapshotCacheDocument | null {
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const value = readJson(cacheFile) as Partial<SnapshotCacheDocument>;
    if (!isSnapshotCacheDocument(value, project)) {
      fs.rmSync(cacheFile, { force: true });
      return null;
    }
    return value as SnapshotCacheDocument;
  } catch {
    fs.rmSync(cacheFile, { force: true });
    return null;
  }
}

function removeLegacySnapshotCaches(currentCacheFile: string): void {
  const cacheDir = path.dirname(currentCacheFile);
  if (!fs.existsSync(cacheDir)) return;
  const currentName = path.basename(currentCacheFile);
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === currentName || !/^snapshot-v\d+\.json$/.test(entry.name)) continue;
    fs.rmSync(path.join(cacheDir, entry.name), { force: true });
  }
}

function isSnapshotCacheDocument(value: Partial<SnapshotCacheDocument>, project: string): value is SnapshotCacheDocument {
  const snapshot = value.snapshot as Partial<MapOverviewSnapshot> | undefined;
  return value.schemaVersion === SNAPSHOT_CACHE_SCHEMA_VERSION
    && value.thumbnailRendererVersion === THUMBNAIL_RENDERER_VERSION
    && path.resolve(String(value.project || '')).toLocaleLowerCase() === path.resolve(project).toLocaleLowerCase()
    && Array.isArray(value.dependencies)
    && value.dependencies.every((dependency) => Boolean(dependency)
      && typeof dependency.logicalPath === 'string'
      && (dependency.resolvedPath == null || typeof dependency.resolvedPath === 'string')
      && typeof dependency.exists === 'boolean'
      && (dependency.size == null || typeof dependency.size === 'number')
      && (dependency.mtimeMs == null || typeof dependency.mtimeMs === 'number'))
    && Boolean(snapshot)
    && snapshot?.project === path.resolve(project)
    && typeof snapshot.snapshotVersion === 'string'
    && typeof snapshot.generatedAt === 'string'
    && Array.isArray(snapshot.nodes)
    && Array.isArray(snapshot.edges)
    && Array.isArray(snapshot.switches)
    && Array.isArray(snapshot.variables)
    && snapshot.edges.every((edge) => Boolean(edge)
      && typeof edge.sourceMapId === 'number'
      && typeof edge.sourceX === 'number'
      && typeof edge.sourceY === 'number'
      && typeof edge.targetMapId === 'number'
      && typeof edge.targetX === 'number'
      && typeof edge.targetY === 'number')
    && Array.isArray(snapshot.issues)
    && typeof snapshot.unresolvedTransferCount === 'number'
    && typeof snapshot.invalidTargetCount === 'number';
}

function writeSnapshotCache(cacheFile: string, document: SnapshotCacheDocument): void {
  writeJsonAtomic(cacheFile, document);
}

function dependenciesMatch(
  readIndex: ProjectReadFileIndex,
  dependencies: SnapshotDependency[],
  reportProgress?: (progress: Pick<MapOverviewScanProgress, 'completed' | 'total'>) => void,
): boolean {
  try {
    reportProgress?.({ completed: 0, total: dependencies.length });
    for (let index = 0; index < dependencies.length; index += 1) {
      const dependency = dependencies[index];
      const currentFile = readIndex.resolve(dependency.logicalPath);
      const current = dependencyRecord(dependency.logicalPath, currentFile);
      const matches = pathIdentity(current.resolvedPath) === pathIdentity(dependency.resolvedPath)
        && current.exists === dependency.exists
        && current.size === dependency.size
        && current.mtimeMs === dependency.mtimeMs;
      reportProgress?.({ completed: index + 1, total: dependencies.length });
      if (!matches) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveContextFile(
  context: Pick<OverviewBuildContext, 'project' | 'readIndex' | 'dependencies'>,
  logicalPath: string,
): string | null {
  const normalized = normalizeLogicalPath(logicalPath);
  const resolved = context.readIndex.resolve(normalized);
  context.dependencies.set(normalized, dependencyRecord(normalized, resolved));
  return resolved;
}

function resolveResourceFile(context: OverviewBuildContext, ...parts: string[]): string {
  const source = path.join(context.resourceRoot, ...parts);
  const logical = normalizeLogicalPath(path.relative(context.project, source));
  return resolveContextFile(context, logical) || source;
}

function dependencyRecord(logicalPath: string, resolvedPath: string | null): SnapshotDependency {
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { logicalPath, resolvedPath, exists: false, size: null, mtimeMs: null };
  }
  const stat = fs.statSync(resolvedPath);
  return {
    logicalPath,
    resolvedPath: path.resolve(resolvedPath),
    exists: stat.isFile(),
    size: stat.isFile() ? stat.size : null,
    mtimeMs: stat.isFile() ? stat.mtimeMs : null,
  };
}

function normalizeLogicalPath(value: string): string {
  const relative = value.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!relative || path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`Unsafe map overview dependency path: ${value}`);
  }
  return relative;
}

function pathIdentity(value: string | null): string | null {
  return value ? path.resolve(value).toLocaleLowerCase() : null;
}

function mapRelativePath(dataRootRelative: string, mapId: number): string {
  return `${dataRootRelative}/Map${String(mapId).padStart(3, '0')}.json`;
}

function fileVersion(file: string): Buffer {
  if (!fs.existsSync(file)) return Buffer.from(`missing:${file}`);
  const stat = fs.statSync(file);
  return Buffer.from(`${file}:${stat.size}:${stat.mtimeMs}`);
}

function digest(parts: Array<string | Buffer>): string {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nullablePositiveInteger(value: unknown): number | null {
  return positiveInteger(value);
}

function integer(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function integerCoord(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
