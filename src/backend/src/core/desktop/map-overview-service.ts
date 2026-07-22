import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
  MapOverviewChunk,
  MapOverviewChunkLevel,
  MapOverviewEdge,
  MapOverviewIssue,
  MapOverviewNode,
  MapOverviewSnapshot,
  MapOverviewTransferSource,
} from '../../../../contract/types.ts';
import { readJson, writeJsonAtomic } from '../rmmv/json.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import { getConfiguredDatabasePath } from '../db/pool.ts';
import {
  decodePng,
  renderMapChunkToPng,
} from '../workflow/map/map-render.ts';
import { mapOverviewEdgeAggregateKey } from '../../../../contract/map-overview-edge-key.ts';
import { createProjectReadFileIndex, type ProjectReadFileIndex } from './staging-service.ts';

const SNAPSHOT_CACHE_SCHEMA_VERSION = 3;
const CHUNK_RENDERER_VERSION = 1;
const MAP_OVERVIEW_CHUNK_TILES = 16;
const MAP_OVERVIEW_TILE_PX = 48;
const MAP_OVERVIEW_CHUNK_LEVELS: readonly MapOverviewChunkLevel[] = [1, 2, 4, 8, 16, 32, 64, 128];

interface SnapshotDependency {
  logicalPath: string;
  resolvedPath: string | null;
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
}

interface SnapshotCacheDocument {
  schemaVersion: number;
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
  dependencies: Map<string, SnapshotDependency>;
}

interface MapSize {
  width: number;
  height: number;
}

export interface MapOverviewChunkWorkerRequest {
  requestId: number;
  workflowRoot: string;
  project: string;
  mapId: number;
  contentVersion: string;
  chunkX: number;
  chunkY: number;
  level: MapOverviewChunkLevel;
  databasePath: string;
}

export type MapOverviewChunkWorkerResponse =
  | { requestId: number; ok: true; chunk: MapOverviewChunk }
  | { requestId: number; ok: false; error: string };

export function isMapOverviewChunkLevel(value: unknown): value is MapOverviewChunkLevel {
  return typeof value === 'number' && (MAP_OVERVIEW_CHUNK_LEVELS as readonly number[]).includes(value);
}

export function mapOverviewChunkTileRect(
  mapWidth: number,
  mapHeight: number,
  chunkX: number,
  chunkY: number,
): { tileX: number; tileY: number; tileWidth: number; tileHeight: number } {
  if (!Number.isInteger(mapWidth) || !Number.isInteger(mapHeight) || mapWidth <= 0 || mapHeight <= 0) {
    throw new Error('Invalid map dimensions for overview chunk.');
  }
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || chunkX < 0 || chunkY < 0) {
    throw new Error('Invalid map overview chunk coordinates.');
  }
  const maxChunkX = Math.ceil(mapWidth / MAP_OVERVIEW_CHUNK_TILES) - 1;
  const maxChunkY = Math.ceil(mapHeight / MAP_OVERVIEW_CHUNK_TILES) - 1;
  if (chunkX > maxChunkX || chunkY > maxChunkY) throw new Error('Map overview chunk coordinates are out of range.');
  const tileX = chunkX * MAP_OVERVIEW_CHUNK_TILES;
  const tileY = chunkY * MAP_OVERVIEW_CHUNK_TILES;
  const tileWidth = Math.min(MAP_OVERVIEW_CHUNK_TILES, mapWidth - tileX);
  const tileHeight = Math.min(MAP_OVERVIEW_CHUNK_TILES, mapHeight - tileY);
  if (tileWidth <= 0 || tileHeight <= 0) throw new Error('Map overview chunk has no tiles.');
  return { tileX, tileY, tileWidth, tileHeight };
}

export function buildMapOverviewSnapshot(workflowRoot: string, project: string): MapOverviewSnapshot {
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  const resolvedProject = path.resolve(project);
  removeLegacyThumbnailCaches(resolvedWorkflowRoot);
  const cacheFile = snapshotCacheFile(resolvedWorkflowRoot, resolvedProject);
  removeLegacySnapshotCaches(cacheFile);
  const cached = readSnapshotCache(cacheFile, resolvedProject);
  if (cached && dependenciesMatch(createProjectReadFileIndex(resolvedWorkflowRoot, resolvedProject), cached.dependencies)) {
    return cached.snapshot;
  }

  const result = buildMapOverviewSnapshotFresh(resolvedWorkflowRoot, resolvedProject);
  const dependencies = [...result.context.dependencies.values()]
    .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  if (!dependenciesMatch(createProjectReadFileIndex(resolvedWorkflowRoot, resolvedProject), dependencies)) {
    throw new Error('Project content changed while the map overview was loading. Retry the operation.');
  }
  writeSnapshotCache(cacheFile, {
    schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION,
    project: resolvedProject,
    dependencies,
    snapshot: result.snapshot,
  });
  return result.snapshot;
}

function buildMapOverviewSnapshotFresh(
  workflowRoot: string,
  project: string,
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

  for (const info of context.mapInfos.filter(Boolean)) {
    const id = Number(info.id);
    if (Number.isInteger(id) && id > 0) knownMapIds.add(id);
  }

  for (const info of context.mapInfos.filter(Boolean)) {
    const mapId = Number(info.id);
    if (!Number.isInteger(mapId) || mapId <= 0) continue;
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
  }

  for (const loaded of loadedMaps) {
    const { mapId, name, map } = loaded;
    if (!map) continue;
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

  for (const loaded of loadedMaps) {
    const thumbnailVersion = loaded.map && loaded.mapFile
      ? buildChunkContentVersion(context, loaded.mapId, loaded.mapFile, loaded.map)
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
    String(unresolvedTransferCount),
  ]);
  return { snapshot: {
    project: path.resolve(project),
    snapshotVersion,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    unresolvedTransferCount,
    invalidTargetCount,
    issues,
  }, context };
}

export function buildMapOverviewChunk(
  workflowRoot: string,
  project: string,
  mapId: number,
  contentVersion: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
): MapOverviewChunk {
  const cached = readCachedMapOverviewChunk(workflowRoot, project, mapId, contentVersion, chunkX, chunkY, level);
  if (cached) return cached;
  validateChunkRequest(mapId, contentVersion, chunkX, chunkY, level);
  const resolvedProject = path.resolve(project);
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  removeLegacyThumbnailCaches(resolvedWorkflowRoot);
  const context = buildContext(resolvedWorkflowRoot, resolvedProject);
  const info = context.mapInfos.find((candidate) => Number(candidate?.id) === mapId);
  if (!info) throw new Error(`Map ${mapId} is not registered in MapInfos.json.`);
  const mapFile = resolveContextFile(context, mapRelativePath(context.dataRootRelative, mapId));
  if (!mapFile || !fs.existsSync(mapFile)) throw new Error(`Map file is missing for map ${mapId}.`);
  const map = readJson(mapFile) as MapDocument;
  const version = buildChunkContentVersion(context, mapId, mapFile, map);
  if (contentVersion !== version) {
    throw new Error('The map overview chunk version changed. Reload the map overview and try again.');
  }
  const width = positiveInteger(map.width);
  const height = positiveInteger(map.height);
  if (width == null || height == null || !Array.isArray(map.data)) {
    throw new Error(`Map ${mapId} has invalid dimensions or tile data.`);
  }
  const rect = mapOverviewChunkTileRect(width, height, chunkX, chunkY);
  const cacheDir = chunkCacheDir(resolvedWorkflowRoot, resolvedProject);
  const cacheFile = chunkCacheFile(resolvedWorkflowRoot, resolvedProject, mapId, version, chunkX, chunkY, level);
  const cacheHit = fs.existsSync(cacheFile);
  if (!cacheHit) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    removeStaleMapChunks(cacheDir, mapId, version);
    const rendered = renderChunk(context, mapId, map, rect, level);
    writeFileAtomic(cacheFile, rendered.png);
  }
  const logicalWidth = rect.tileWidth * MAP_OVERVIEW_TILE_PX;
  const logicalHeight = rect.tileHeight * MAP_OVERVIEW_TILE_PX;
  return {
    project: resolvedProject,
    mapId,
    version,
    chunkX,
    chunkY,
    level,
    logicalX: rect.tileX * MAP_OVERVIEW_TILE_PX,
    logicalY: rect.tileY * MAP_OVERVIEW_TILE_PX,
    logicalWidth,
    logicalHeight,
    outputWidth: Math.max(1, Math.ceil(logicalWidth / level)),
    outputHeight: Math.max(1, Math.ceil(logicalHeight / level)),
    mime: 'image/png',
    resourceUrl: mapOverviewChunkAssetUrl(resolvedProject, mapId, version, chunkX, chunkY, level),
    cacheHit,
    warnings: collectResourceWarnings(context, mapId, map),
  };
}

export function readCachedMapOverviewChunk(
  workflowRoot: string,
  project: string,
  mapId: number,
  contentVersion: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
): MapOverviewChunk | null {
  validateChunkRequest(mapId, contentVersion, chunkX, chunkY, level);
  const resolvedProject = path.resolve(project);
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  const existing = chunkCacheFile(resolvedWorkflowRoot, resolvedProject, mapId, contentVersion, chunkX, chunkY, level);
  if (!fs.existsSync(existing) || !fs.statSync(existing).isFile()) return null;
  // Logical geometry requires map size; cache-hit path still needs dimensions for the response contract.
  const context = buildContext(resolvedWorkflowRoot, resolvedProject);
  const mapFile = resolveContextFile(context, mapRelativePath(context.dataRootRelative, mapId));
  if (!mapFile || !fs.existsSync(mapFile)) return null;
  const map = readJson(mapFile) as MapDocument;
  const width = positiveInteger(map.width);
  const height = positiveInteger(map.height);
  if (width == null || height == null) return null;
  const rect = mapOverviewChunkTileRect(width, height, chunkX, chunkY);
  const logicalWidth = rect.tileWidth * MAP_OVERVIEW_TILE_PX;
  const logicalHeight = rect.tileHeight * MAP_OVERVIEW_TILE_PX;
  return {
    project: resolvedProject,
    mapId,
    version: contentVersion,
    chunkX,
    chunkY,
    level,
    logicalX: rect.tileX * MAP_OVERVIEW_TILE_PX,
    logicalY: rect.tileY * MAP_OVERVIEW_TILE_PX,
    logicalWidth,
    logicalHeight,
    outputWidth: Math.max(1, Math.ceil(logicalWidth / level)),
    outputHeight: Math.max(1, Math.ceil(logicalHeight / level)),
    mime: 'image/png',
    resourceUrl: mapOverviewChunkAssetUrl(resolvedProject, mapId, contentVersion, chunkX, chunkY, level),
    cacheHit: true,
    warnings: [],
  };
}

export async function requestMapOverviewChunk(
  workflowRoot: string,
  project: string,
  mapId: number,
  contentVersion: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
  sessionId: string,
): Promise<MapOverviewChunk> {
  validateChunkRequest(mapId, contentVersion, chunkX, chunkY, level);
  const cached = readCachedMapOverviewChunk(workflowRoot, project, mapId, contentVersion, chunkX, chunkY, level);
  if (cached) return cached;
  const databasePath = getConfiguredDatabasePath();
  if (!databasePath) throw new Error('Map overview chunk worker requires a configured workspace database.');
  return chunkCoordinator.request({
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    mapId,
    contentVersion,
    chunkX,
    chunkY,
    level,
    databasePath,
  }, validateChunkSessionId(sessionId));
}

export function cancelMapOverviewChunkSession(sessionId: string): void {
  chunkCoordinator.cancel(validateChunkSessionId(sessionId));
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
  const mapInfos = readJson(mapInfosFile) as any[];
  if (!Array.isArray(mapInfos)) throw new Error('MapInfos.json must contain an array.');
  const tilesets = fs.existsSync(tilesetsFile) ? readJson(tilesetsFile) as any[] : [];
  return {
    ...baseContext,
    mapInfos,
    tilesets: Array.isArray(tilesets) ? tilesets : [],
  };
}

function buildChunkContentVersion(
  context: OverviewBuildContext,
  mapId: number,
  mapFile: string,
  map: MapDocument,
): string {
  const tileset = context.tilesets[integer(map.tilesetId, 0)] as TilesetDocument | undefined;
  const resources = chunkResourcePaths(context, tileset);
  return digest([
    Buffer.from(`renderer:${CHUNK_RENDERER_VERSION}`),
    fs.readFileSync(mapFile),
    Buffer.from(JSON.stringify(tileset || null)),
    ...resources.map(fileVersion),
    Buffer.from(String(mapId)),
  ]).slice(0, 20);
}

function chunkResourcePaths(
  context: OverviewBuildContext,
  tileset?: TilesetDocument,
): string[] {
  const paths: string[] = [];
  for (const name of array(tileset?.tilesetNames).map(String).filter(Boolean)) {
    paths.push(resolveResourceFile(context, 'img', 'tilesets', `${name}.png`));
  }
  return paths;
}

function collectResourceWarnings(context: OverviewBuildContext, mapId: number, map: MapDocument): string[] {
  const tileset = context.tilesets[integer(map.tilesetId, 0)] as TilesetDocument | undefined;
  return chunkResourcePaths(context, tileset)
    .filter((file) => !fs.existsSync(file))
    .map((file) => `Map ${mapId} resource is missing: ${path.relative(context.project, file).replaceAll('\\', '/')}`);
}

function renderChunk(
  context: OverviewBuildContext,
  mapId: number,
  map: MapDocument,
  rect: { tileX: number; tileY: number; tileWidth: number; tileHeight: number },
  level: MapOverviewChunkLevel,
): { png: Buffer } {
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
  return renderMapChunkToPng(mapData, bitmaps, rect.tileX, rect.tileY, rect.tileWidth, rect.tileHeight, level);
}

function removeStaleMapChunks(cacheDir: string, mapId: number, currentVersion: string): void {
  const mapDir = path.join(cacheDir, `Map${String(mapId).padStart(3, '0')}`);
  if (!fs.existsSync(mapDir)) return;
  for (const entry of fs.readdirSync(mapDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      fs.rmSync(path.join(mapDir, entry.name), { force: true });
      continue;
    }
    if (entry.name === currentVersion) continue;
    fs.rmSync(path.join(mapDir, entry.name), { recursive: true, force: true });
  }
}

function removeLegacyThumbnailCaches(workflowRoot: string): void {
  const legacy = path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-thumbnails');
  if (fs.existsSync(legacy)) fs.rmSync(legacy, { recursive: true, force: true });
}

function projectCacheKey(project: string): string {
  return crypto.createHash('sha256').update(path.resolve(project).toLocaleLowerCase()).digest('hex').slice(0, 20);
}

export function mapOverviewChunkAssetUrl(
  project: string,
  mapId: number,
  version: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
): string {
  validateChunkRequest(mapId, version, chunkX, chunkY, level);
  const token = Buffer.from(path.resolve(project), 'utf8').toString('base64url');
  return `rmmv-asset://overview/${token}/${mapId}/${version}/${chunkX}/${chunkY}/${level}.png`;
}

export function resolveMapOverviewChunkFile(
  workflowRoot: string,
  project: string,
  mapId: number,
  version: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
): string {
  validateChunkRequest(mapId, version, chunkX, chunkY, level);
  const cacheDir = chunkCacheDir(workflowRoot, project);
  const file = chunkCacheFile(workflowRoot, project, mapId, version, chunkX, chunkY, level);
  const relative = path.relative(cacheDir, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Chunk path is outside allowed cache root.');
  }
  if (relative.split(path.sep).includes('..')) throw new Error('Chunk path is outside allowed cache root.');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Map overview chunk not found.');
  return file;
}

function validateChunkRequest(
  mapId: number,
  version: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
): void {
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 999) throw new Error('Invalid map overview chunk map id.');
  if (!/^[a-f0-9]{20}$/.test(version)) throw new Error('Invalid map overview chunk version.');
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY) || chunkX < 0 || chunkY < 0) {
    throw new Error('Invalid map overview chunk coordinates.');
  }
  if (!isMapOverviewChunkLevel(level)) throw new Error('Invalid map overview chunk level.');
}

function chunkCacheDir(workflowRoot: string, project: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-chunks', projectCacheKey(project));
}

function chunkCacheFile(
  workflowRoot: string,
  project: string,
  mapId: number,
  version: string,
  chunkX: number,
  chunkY: number,
  level: MapOverviewChunkLevel,
): string {
  return path.join(
    chunkCacheDir(workflowRoot, project),
    `Map${String(mapId).padStart(3, '0')}`,
    version,
    `${chunkX}_${chunkY}_${level}.png`,
  );
}

function snapshotCacheFile(workflowRoot: string, project: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-cache', projectCacheKey(project), 'snapshot-v3.json');
}

interface ChunkJobInput {
  workflowRoot: string;
  project: string;
  mapId: number;
  contentVersion: string;
  chunkX: number;
  chunkY: number;
  level: MapOverviewChunkLevel;
  databasePath: string;
}

interface ChunkSubscriber {
  promise: Promise<MapOverviewChunk>;
  resolve: (value: MapOverviewChunk) => void;
  reject: (error: Error) => void;
}

interface ChunkJob {
  key: string;
  requestId: number;
  input: ChunkJobInput;
  subscribers: Map<string, ChunkSubscriber>;
}

const CHUNK_WORKER_FILE = import.meta.url.endsWith('.ts')
  ? './map-overview-thumbnail-worker.ts'
  : './map-overview-thumbnail-worker.js';
const CHUNK_WORKER_URL = new URL(CHUNK_WORKER_FILE, import.meta.url);
const CHUNK_WORKER_EXEC_ARGV = ['--experimental-strip-types', '--experimental-transform-types'];

class MapOverviewChunkCoordinator {
  private worker: Worker | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private current: ChunkJob | null = null;
  private readonly queued: ChunkJob[] = [];
  private readonly jobsByKey = new Map<string, ChunkJob>();
  private nextRequestId = 1;

  request(input: ChunkJobInput, sessionId: string): Promise<MapOverviewChunk> {
    const key = chunkJobKey(input);
    let job = this.jobsByKey.get(key);
    if (!job) {
      job = { key, requestId: this.nextRequestId++, input, subscribers: new Map() };
      this.jobsByKey.set(key, job);
      this.queued.push(job);
    }
    const existing = job.subscribers.get(sessionId);
    if (existing) return existing.promise;
    let resolve!: (value: MapOverviewChunk) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<MapOverviewChunk>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    job.subscribers.set(sessionId, { promise, resolve, reject });
    this.pump();
    return promise;
  }

  cancel(sessionId: string): void {
    const cancellation = chunkCancellationError();
    for (const job of [...this.jobsByKey.values()]) {
      const subscriber = job.subscribers.get(sessionId);
      if (!subscriber) continue;
      job.subscribers.delete(sessionId);
      subscriber.reject(cancellation);
      if (job.subscribers.size > 0) continue;
      this.jobsByKey.delete(job.key);
      const queueIndex = this.queued.indexOf(job);
      if (queueIndex >= 0) this.queued.splice(queueIndex, 1);
      if (this.current === job) this.abortCurrentWorker();
    }
  }

  private pump(): void {
    if (this.current) return;
    let next = this.queued.shift() || null;
    while (next && next.subscribers.size === 0) next = this.queued.shift() || null;
    if (!next) return;
    this.current = next;
    this.ensureWorker().postMessage({ requestId: next.requestId, ...next.input } satisfies MapOverviewChunkWorkerRequest);
  }

  private ensureWorker(): Worker {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.worker) return this.worker;
    const worker = new Worker(CHUNK_WORKER_URL, { execArgv: CHUNK_WORKER_EXEC_ARGV });
    worker.unref();
    worker.on('message', (message: MapOverviewChunkWorkerResponse) => this.handleMessage(message));
    worker.on('error', error => this.handleWorkerFailure(error));
    worker.on('exit', code => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (code !== 0) this.handleWorkerFailure(new Error(`Map overview chunk worker exited with code ${code}.`));
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: MapOverviewChunkWorkerResponse): void {
    const job = this.current;
    if (!job || message.requestId !== job.requestId) return;
    this.current = null;
    this.jobsByKey.delete(job.key);
    if (message.ok) {
      for (const subscriber of job.subscribers.values()) subscriber.resolve(message.chunk);
    } else {
      const error = new Error(message.error);
      for (const subscriber of job.subscribers.values()) subscriber.reject(error);
    }
    this.pump();
    this.scheduleIdleShutdown();
  }

  private handleWorkerFailure(error: Error): void {
    const worker = this.worker;
    if (worker) {
      worker.removeAllListeners();
      void worker.terminate();
      this.worker = null;
    }
    const job = this.current;
    this.current = null;
    if (job) {
      this.jobsByKey.delete(job.key);
      for (const subscriber of job.subscribers.values()) subscriber.reject(error);
    }
    this.pump();
    this.scheduleIdleShutdown();
  }

  private abortCurrentWorker(): void {
    const job = this.current;
    if (job) {
      this.current = null;
      this.jobsByKey.delete(job.key);
    }
    const worker = this.worker;
    if (worker) {
      worker.removeAllListeners();
      void worker.terminate();
      this.worker = null;
    }
    this.pump();
    this.scheduleIdleShutdown();
  }

  private scheduleIdleShutdown(): void {
    if (this.current || this.queued.length || !this.worker || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.current || this.queued.length) return;
      const worker = this.worker;
      if (!worker) return;
      worker.removeAllListeners();
      void worker.terminate();
      this.worker = null;
    }, 1_000);
  }
}

const chunkCoordinator = new MapOverviewChunkCoordinator();

function chunkJobKey(input: ChunkJobInput): string {
  return [
    input.workflowRoot,
    input.project,
    String(input.mapId),
    input.contentVersion,
    String(input.chunkX),
    String(input.chunkY),
    String(input.level),
  ].join('\0');
}

function validateChunkSessionId(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Invalid map overview chunk session id.');
  }
  return value;
}

function chunkCancellationError(): Error {
  const error = new Error('Map overview chunk request was canceled.');
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

function dependenciesMatch(readIndex: ProjectReadFileIndex, dependencies: SnapshotDependency[]): boolean {
  try {
    return dependencies.every((dependency) => {
      const currentFile = readIndex.resolve(dependency.logicalPath);
      const current = dependencyRecord(dependency.logicalPath, currentFile);
      return pathIdentity(current.resolvedPath) === pathIdentity(dependency.resolvedPath)
        && current.exists === dependency.exists
        && current.size === dependency.size
        && current.mtimeMs === dependency.mtimeMs;
    });
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

function writeFileAtomic(file: string, content: Buffer): void {
  const temporary = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(temporary, content);
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.copyFileSync(temporary, file);
      fs.rmSync(temporary, { force: true });
    } catch {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }
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
