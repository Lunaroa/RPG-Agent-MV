import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
  MapOverviewEdge,
  MapOverviewIssue,
  MapOverviewNode,
  MapOverviewSnapshot,
  MapOverviewThumbnail,
  MapOverviewThumbnailQuality,
  MapOverviewTransferSource,
} from '../../../../contract/types.ts';
import { readJson, writeJsonAtomic } from '../rmmv/json.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import { getConfiguredDatabasePath } from '../db/pool.ts';
import {
  blitImageScaled,
  decodePng,
  encodePng,
  fitMapToTarget,
  renderMapToFittedRgba,
  renderMapToPng,
  type DecodedPng,
  type FittedMapViewport,
} from '../workflow/map/map-render.ts';
import { createProjectReadFileIndex, type ProjectReadFileIndex } from './staging-service.ts';

const SNAPSHOT_CACHE_SCHEMA_VERSION = 2;
const THUMBNAIL_RENDERER_VERSION = 2;
const THUMBNAIL_SIZES: Record<MapOverviewThumbnailQuality, { width: number; height: number }> = {
  standard: { width: 240, height: 144 },
  high: { width: 480, height: 288 },
  ultra: { width: 720, height: 432 },
};

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

export interface MapOverviewThumbnailWorkerRequest {
  requestId: number;
  workflowRoot: string;
  project: string;
  mapId: number;
  expectedVersion?: string;
  quality: MapOverviewThumbnailQuality;
  databasePath: string;
}

export type MapOverviewThumbnailWorkerResponse =
  | { requestId: number; ok: true; thumbnail: MapOverviewThumbnail }
  | { requestId: number; ok: false; error: string };

export function buildMapOverviewSnapshot(workflowRoot: string, project: string): MapOverviewSnapshot {
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  const resolvedProject = path.resolve(project);
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
  const edgesByDirection = new Map<string, MapOverviewEdge>();
  const issues: MapOverviewIssue[] = [];
  let unresolvedTransferCount = 0;
  let invalidTargetCount = 0;

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

    let nodeUnresolved = 0;
    if (map) {
      nodeIssues.push(...collectResourceWarnings(context, mapId, map).map((message) => ({
        code: 'resource-missing' as const,
        mapId,
        message,
      })));
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
              nodeUnresolved += 1;
              return;
            }
            const targetMapId = positiveInteger(parameters[1]);
            if (targetMapId == null) {
              unresolvedTransferCount += 1;
              nodeUnresolved += 1;
              return;
            }
            if (!knownMapIds.has(targetMapId)) {
              invalidTargetCount += 1;
              const issue: MapOverviewIssue = {
                code: 'invalid-target',
                mapId,
                targetMapId,
                message: `Transfer targets missing map ${targetMapId}.`,
              };
              nodeIssues.push(issue);
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
              targetMapId,
              targetX: integer(parameters[2], 0),
              targetY: integer(parameters[3], 0),
              direction: integer(parameters[4], 0),
              fadeType: integer(parameters[5], 0),
            };
            const edgeId = `${mapId}->${targetMapId}`;
            const edge = edgesByDirection.get(edgeId) || {
              id: edgeId,
              sourceMapId: mapId,
              targetMapId,
              count: 0,
              sources: [],
            };
            edge.count += 1;
            edge.sources.push(source);
            edgesByDirection.set(edgeId, edge);
          });
        });
      }
    }

    const thumbnailVersion = map
      ? buildThumbnailVersion(context, mapId, mapFile, map)
      : null;
    issues.push(...nodeIssues);
    nodes.push({
      id: mapId,
      name,
      parentId: integer(info.parentId, 0),
      order: integer(info.order, 0),
      readState,
      width: map ? nullablePositiveInteger(map.width) : null,
      height: map ? nullablePositiveInteger(map.height) : null,
      thumbnailVersion,
      incomingCount: 0,
      outgoingCount: 0,
      unresolvedCount: nodeUnresolved,
      issues: nodeIssues,
    });
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = [...edgesByDirection.values()]
    .sort((left, right) => left.sourceMapId - right.sourceMapId || left.targetMapId - right.targetMapId);
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

export function buildMapOverviewThumbnail(
  workflowRoot: string,
  project: string,
  mapId: number,
  expectedVersion?: string,
  quality: MapOverviewThumbnailQuality = 'high',
): MapOverviewThumbnail {
  const cached = readCachedMapOverviewThumbnail(workflowRoot, project, mapId, expectedVersion, quality);
  if (cached) return cached;
  const size = thumbnailSize(quality);
  const resolvedProject = path.resolve(project);
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 999) throw new Error('Invalid map overview thumbnail map id.');
  if (expectedVersion && !/^[a-f0-9]{20}$/.test(expectedVersion)) throw new Error('Invalid map overview thumbnail version.');
  const context = buildContext(workflowRoot, project);
  const info = context.mapInfos.find((candidate) => Number(candidate?.id) === mapId);
  if (!info) throw new Error(`Map ${mapId} is not registered in MapInfos.json.`);
  const mapFile = resolveContextFile(context, mapRelativePath(context.dataRootRelative, mapId));
  if (!mapFile || !fs.existsSync(mapFile)) throw new Error(`Map file is missing for map ${mapId}.`);
  const map = readJson(mapFile) as MapDocument;
  const version = buildThumbnailVersion(context, mapId, mapFile, map);
  if (expectedVersion && expectedVersion !== version) {
    throw new Error('The map thumbnail version changed. Reload the map overview and try again.');
  }

  const cacheDir = thumbnailCacheDir(workflowRoot, project);
  const cacheFile = thumbnailCacheFile(workflowRoot, project, mapId, version, quality);
  const cacheHit = fs.existsSync(cacheFile);
  if (!fs.existsSync(cacheFile)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    removeStaleMapThumbnails(cacheDir, mapId, version);
    const rendered = renderThumbnail(context, mapId, map, size.width, size.height);
    writeFileAtomic(cacheFile, rendered.png);
  }
  return {
    project: resolvedProject,
    mapId,
    version,
    quality,
    mime: 'image/png',
    width: size.width,
    height: size.height,
    resourceUrl: mapOverviewThumbnailAssetUrl(resolvedProject, mapId, version, quality),
    cacheHit,
    warnings: collectResourceWarnings(context, mapId, map),
  };
}

export function readCachedMapOverviewThumbnail(
  workflowRoot: string,
  project: string,
  mapId: number,
  expectedVersion?: string,
  quality: MapOverviewThumbnailQuality = 'high',
): MapOverviewThumbnail | null {
  const size = thumbnailSize(quality);
  const resolvedProject = path.resolve(project);
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 999) throw new Error('Invalid map overview thumbnail map id.');
  if (expectedVersion && !/^[a-f0-9]{20}$/.test(expectedVersion)) throw new Error('Invalid map overview thumbnail version.');
  if (!expectedVersion) return null;
  const existing = thumbnailCacheFile(workflowRoot, resolvedProject, mapId, expectedVersion, quality);
  if (!fs.existsSync(existing) || !fs.statSync(existing).isFile()) return null;
  return {
    project: resolvedProject,
    mapId,
    version: expectedVersion,
    quality,
    mime: 'image/png',
    width: size.width,
    height: size.height,
    resourceUrl: mapOverviewThumbnailAssetUrl(resolvedProject, mapId, expectedVersion, quality),
    cacheHit: true,
    warnings: [],
  };
}

export async function requestMapOverviewThumbnail(
  workflowRoot: string,
  project: string,
  mapId: number,
  expectedVersion: string | undefined,
  quality: MapOverviewThumbnailQuality,
  sessionId: string,
): Promise<MapOverviewThumbnail> {
  const cached = readCachedMapOverviewThumbnail(workflowRoot, project, mapId, expectedVersion, quality);
  if (cached) return cached;
  const databasePath = getConfiguredDatabasePath();
  if (!databasePath) throw new Error('Map overview thumbnail worker requires a configured workspace database.');
  return thumbnailCoordinator.request({
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    mapId,
    expectedVersion,
    quality,
    databasePath,
  }, validateThumbnailSessionId(sessionId));
}

export function cancelMapOverviewThumbnailSession(sessionId: string): void {
  thumbnailCoordinator.cancel(validateThumbnailSessionId(sessionId));
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

function buildThumbnailVersion(
  context: OverviewBuildContext,
  mapId: number,
  mapFile: string,
  map: MapDocument,
): string {
  const tileset = context.tilesets[integer(map.tilesetId, 0)] as TilesetDocument | undefined;
  const resources = thumbnailResourcePaths(context, map, tileset);
  return digest([
    Buffer.from(`renderer:${THUMBNAIL_RENDERER_VERSION}`),
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
  for (const name of array(tileset?.tilesetNames).map(String).filter(Boolean)) {
    paths.push(resolveResourceFile(context, 'img', 'tilesets', `${name}.png`));
  }
  const parallaxName = String(map.parallaxName || '');
  if (parallaxName) paths.push(resolveResourceFile(context, 'img', 'parallaxes', `${parallaxName}.png`));
  const characterNames = new Set<string>();
  for (const rawEvent of array(map.events)) {
    if (!record(rawEvent)) continue;
    const firstPage = array(rawEvent.pages)[0];
    if (!record(firstPage) || !record(firstPage.image)) continue;
    const name = String(firstPage.image.characterName || '');
    if (name) characterNames.add(name);
  }
  for (const name of characterNames) {
    paths.push(resolveResourceFile(context, 'img', 'characters', `${name}.png`));
  }
  return paths;
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
  targetWidth: number,
  targetHeight: number,
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
  const viewport = fitMapToTarget(width, height, targetWidth, targetHeight);
  const composite = Buffer.alloc(targetWidth * targetHeight * 4);
  drawThumbnailParallax(context, map, viewport, composite, targetWidth, targetHeight);
  renderMapToFittedRgba(mapData, bitmaps, targetWidth, targetHeight, composite);
  drawThumbnailEvents(context, map, bitmaps, viewport, composite, targetWidth, targetHeight);
  return { png: encodePng(targetWidth, targetHeight, composite) };
}

function drawThumbnailParallax(
  context: OverviewBuildContext,
  map: MapDocument,
  viewport: FittedMapViewport,
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
): void {
  if (!map.parallaxShow) return;
  const name = String(map.parallaxName || '');
  if (!name) return;
  const file = resolveResourceFile(context, 'img', 'parallaxes', `${name}.png`);
  if (!fs.existsSync(file)) return;
  const image = decodePng(fs.readFileSync(file));
  const right = Math.min(targetWidth, viewport.offsetX + viewport.contentWidth);
  const bottom = Math.min(targetHeight, viewport.offsetY + viewport.contentHeight);
  for (let y = Math.max(0, viewport.offsetY); y < bottom; y += 1) {
    const sourceY = Math.floor((y - viewport.offsetY) / viewport.scale) % image.height;
    for (let x = Math.max(0, viewport.offsetX); x < right; x += 1) {
      const sourceX = Math.floor((x - viewport.offsetX) / viewport.scale) % image.width;
      compositeRgbaPixel(image.rgba, (sourceY * image.width + sourceX) * 4, target, (y * targetWidth + x) * 4);
    }
  }
}

function compositeRgbaPixel(source: Buffer, sourceOffset: number, target: Buffer, targetOffset: number): void {
  const sourceAlpha = source[sourceOffset + 3] / 255;
  if (sourceAlpha <= 0) return;
  const targetAlpha = target[targetOffset + 3] / 255;
  const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    target[targetOffset + channel] = Math.round(
      (source[sourceOffset + channel] * sourceAlpha
        + target[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)) / outputAlpha,
    );
  }
  target[targetOffset + 3] = Math.round(outputAlpha * 255);
}

function drawThumbnailEvents(
  context: OverviewBuildContext,
  map: MapDocument,
  bitmaps: Array<DecodedPng | null>,
  viewport: FittedMapViewport,
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
): void {
  for (const rawEvent of array(map.events)) {
    if (!record(rawEvent)) continue;
    const firstPage = array(rawEvent.pages)[0];
    if (!record(firstPage) || !record(firstPage.image)) continue;
    const image = firstPage.image;
    const eventX = integer(rawEvent.x, 0);
    const eventY = integer(rawEvent.y, 0);
    const tileId = integer(image.tileId, 0);
    if (tileId > 0) {
      const data = [tileId, 0, 0, 0, 0, 0];
      const rendered = renderMapToPng({ width: 1, height: 1, tilesetId: integer(map.tilesetId, 0), data }, bitmaps, 1, 48, { transparent: true });
      const decoded = decodePng(rendered.png);
      blitMapGraphic(decoded, 0, 0, decoded.width, decoded.height, eventX * 48, eventY * 48, 48, 48, viewport, target, targetWidth, targetHeight);
      continue;
    }
    const characterName = String(image.characterName || '');
    if (!characterName) continue;
    const file = resolveResourceFile(context, 'img', 'characters', `${characterName}.png`);
    if (!fs.existsSync(file)) continue;
    const character = decodePng(fs.readFileSync(file));
    const single = characterName.includes('$');
    const frameWidth = Math.floor(character.width / (single ? 3 : 12));
    const frameHeight = Math.floor(character.height / (single ? 4 : 8));
    const characterIndex = Math.max(0, Math.min(7, integer(image.characterIndex, 0)));
    const pattern = Math.max(0, Math.min(2, integer(image.pattern, 1)));
    const direction = [2, 4, 6, 8].includes(integer(image.direction, 2)) ? integer(image.direction, 2) : 2;
    const groupColumn = single ? 0 : characterIndex % 4;
    const groupRow = single ? 0 : Math.floor(characterIndex / 4);
    const sourceX = (groupColumn * 3 + pattern) * frameWidth;
    const sourceY = (groupRow * 4 + (direction - 2) / 2) * frameHeight;
    blitMapGraphic(
      character,
      sourceX,
      sourceY,
      frameWidth,
      frameHeight,
      Math.round(eventX * 48 + (48 - frameWidth) / 2),
      Math.round((eventY + 1) * 48 - frameHeight),
      frameWidth,
      frameHeight,
      viewport,
      target,
      targetWidth,
      targetHeight,
    );
  }
}

function blitMapGraphic(
  source: DecodedPng,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  mapX: number,
  mapY: number,
  mapWidth: number,
  mapHeight: number,
  viewport: FittedMapViewport,
  target: Buffer,
  targetWidth: number,
  targetHeight: number,
): void {
  const left = viewport.offsetX + Math.round(mapX * viewport.scale);
  const top = viewport.offsetY + Math.round(mapY * viewport.scale);
  const right = viewport.offsetX + Math.round((mapX + mapWidth) * viewport.scale);
  const bottom = viewport.offsetY + Math.round((mapY + mapHeight) * viewport.scale);
  if (right <= left || bottom <= top) return;
  blitImageScaled(
    source.rgba,
    source.width,
    source.height,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    target,
    targetWidth,
    targetHeight,
    left,
    top,
    right - left,
    bottom - top,
  );
}

function removeStaleMapThumbnails(cacheDir: string, mapId: number, currentVersion: string): void {
  const prefix = `Map${String(mapId).padStart(3, '0')}-`;
  const currentPrefix = `${prefix}${currentVersion}-`;
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
    const candidate = path.join(cacheDir, entry.name);
    if (!entry.name.startsWith(currentPrefix)) fs.rmSync(candidate, { force: true });
  }
}

function projectCacheKey(project: string): string {
  return crypto.createHash('sha256').update(path.resolve(project).toLocaleLowerCase()).digest('hex').slice(0, 20);
}

export function mapOverviewThumbnailAssetUrl(
  project: string,
  mapId: number,
  version: string,
  quality: MapOverviewThumbnailQuality,
): string {
  thumbnailSize(quality);
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 999) throw new Error('Invalid map overview thumbnail map id.');
  if (!/^[a-f0-9]{20}$/.test(version)) throw new Error('Invalid map overview thumbnail version.');
  const token = Buffer.from(path.resolve(project), 'utf8').toString('base64url');
  return `rmmv-asset://overview/${token}/${mapId}/${version}/${quality}.png`;
}

export function resolveMapOverviewThumbnailFile(
  workflowRoot: string,
  project: string,
  mapId: number,
  version: string,
  quality: MapOverviewThumbnailQuality,
): string {
  thumbnailSize(quality);
  if (!Number.isInteger(mapId) || mapId <= 0 || mapId > 999) throw new Error('Invalid map overview thumbnail map id.');
  if (!/^[a-f0-9]{20}$/.test(version)) throw new Error('Invalid map overview thumbnail version.');
  const cacheDir = thumbnailCacheDir(workflowRoot, project);
  const file = thumbnailCacheFile(workflowRoot, project, mapId, version, quality);
  const relative = path.relative(cacheDir, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Thumbnail path is outside allowed cache root.');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Map overview thumbnail not found.');
  return file;
}

function thumbnailSize(quality: MapOverviewThumbnailQuality): { width: number; height: number } {
  const size = THUMBNAIL_SIZES[quality];
  if (!size) throw new Error('Invalid map overview thumbnail quality.');
  return size;
}

function thumbnailCacheDir(workflowRoot: string, project: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-thumbnails', projectCacheKey(project));
}

function thumbnailCacheFile(
  workflowRoot: string,
  project: string,
  mapId: number,
  version: string,
  quality: MapOverviewThumbnailQuality,
): string {
  return path.join(
    thumbnailCacheDir(workflowRoot, project),
    `Map${String(mapId).padStart(3, '0')}-${version}-${quality}.png`,
  );
}

function snapshotCacheFile(workflowRoot: string, project: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-cache', projectCacheKey(project), 'snapshot-v2.json');
}

interface ThumbnailJobInput {
  workflowRoot: string;
  project: string;
  mapId: number;
  expectedVersion?: string;
  quality: MapOverviewThumbnailQuality;
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

class MapOverviewThumbnailCoordinator {
  private worker: Worker | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private current: ThumbnailJob | null = null;
  private readonly queued: ThumbnailJob[] = [];
  private readonly jobsByKey = new Map<string, ThumbnailJob>();
  private nextRequestId = 1;

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
      if (this.current === job) this.abortCurrentWorker();
    }
  }

  private pump(): void {
    if (this.current) return;
    let next = this.queued.shift() || null;
    while (next && next.subscribers.size === 0) next = this.queued.shift() || null;
    if (!next) return;
    this.current = next;
    this.ensureWorker().postMessage({ requestId: next.requestId, ...next.input } satisfies MapOverviewThumbnailWorkerRequest);
  }

  private ensureWorker(): Worker {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.worker) return this.worker;
    const worker = new Worker(THUMBNAIL_WORKER_URL, { execArgv: THUMBNAIL_WORKER_EXEC_ARGV });
    worker.unref();
    worker.on('message', (message: MapOverviewThumbnailWorkerResponse) => this.handleMessage(message));
    worker.on('error', error => this.handleWorkerFailure(error));
    worker.on('exit', code => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (code !== 0) this.handleWorkerFailure(new Error(`Map overview thumbnail worker exited with code ${code}.`));
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: MapOverviewThumbnailWorkerResponse): void {
    const job = this.current;
    if (!job || message.requestId !== job.requestId) return;
    this.current = null;
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

const thumbnailCoordinator = new MapOverviewThumbnailCoordinator();

function thumbnailJobKey(input: ThumbnailJobInput): string {
  return [input.workflowRoot, input.project, String(input.mapId), input.expectedVersion || '', input.quality].join('\0');
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
