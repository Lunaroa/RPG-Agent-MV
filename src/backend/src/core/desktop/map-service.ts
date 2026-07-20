import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  EventSearchOptions,
  EventSearchResult,
  MapIndex,
  MapMovePosition,
  MapPayload,
  RmmvAudioSettings,
  RmmvMapEncounter,
  RpgMakerEngine,
  RmmvSystemPosition,
  RmmvSystemPositionTarget,
  TilesetSummary,
  TileEdit,
} from '../../../../contract/types.ts';
import { readJson } from '../rmmv/json.ts';
import { validateEventCommandList } from '../rmmv/event-command-registry.ts';
import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import { applyBrushEdit } from '../workflow/map/map-brush-edit.ts';
import { projectAssetUrl } from './asset-service.ts';
import { getMapLibraryEntry, mapLibraryIndexPath } from './library-service.ts';
import { resolveMapLibraryFilePath } from './map-library-paths.ts';
import { resolveMapLibraryPackage } from './map-library-package.ts';
import { resolveLibraryAssetPath } from './map-library-asset-resolver.ts';
import {
  mapCriticalTilesetImageMissing,
  mapHasChildMaps,
  mapIdInvalid,
  mapImportFailed,
  mapInfoNotFound,
  mapInvalidSourceTilesetId,
  mapLibraryEntryNotFound,
  mapLibraryFileNotFound,
  mapNoAvailableId,
  mapNotFound,
  mapOptionalTilesetImageMissing,
  mapPackageTransferIdsRemapped,
  mapParallaxImageMissing,
  mapPositionTargetInvalid,
  mapProjectParallaxImageMissing,
  mapProjectTilesetImageMissing,
  mapSizeInvalid,
  mapSourceTilesetMissing,
  mapStartCoordinateInvalid,
  mapStartCoordinateOutOfBounds,
  mapSystemJsonMissing,
  mapTilesetPreimportFailed,
  mapUnsafeProjectPath,
} from './mapServiceLocalization.ts';
import { resolveLocalSourcePath } from './local-assets-service.ts';
import { prepareRmmvPlaytestPlan } from './runtime-deploy-service.ts';
import { buildMapPreviewStateCatalog } from './map-preview-state-references.ts';

interface LibraryImportContext {
  engine: RpgMakerEngine;
  mapInfos: any[];
  tilesets: any[];
  tilesetRegistry: Map<string, number>;
}
import {
  deleteStagedProjectFile,
  getMapFileForRead,
  getProjectFileForRead,
  getProjectStagingStatus,
  getStagingStatus,
  isInside,
  withStagedMapMutation,
  writeStagedProjectBuffer,
  writeStagedProjectJson,
} from './staging-service.ts';

export function buildMapIndex(workflowRoot: string, project: string): MapIndex {
  const file = getProjectFileForRead(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'));
  const infos = (file ? readJson(file) as any[] : []).filter(Boolean);
  const maps = infos
    .map((info) => ({
      id: Number(info.id),
      name: String(info.name || `Map${String(info.id).padStart(3, '0')}`),
      parentId: Number(info.parentId || 0),
      order: Number(info.order || 0),
      expanded: Boolean(info.expanded),
      mapFileExists: fs.existsSync(getMapFileForRead(workflowRoot, project, Number(info.id))),
    }))
    .sort((a, b) => a.order - b.order || a.id - b.id);
  return { project, blocks: maps.filter((map) => map.parentId === 0), maps };
}

export function buildTilesetIndex(workflowRoot: string, project: string): { project: string; tilesets: TilesetSummary[] } {
  const dataDir = resolveDataDir(project);
  const file = getProjectFileForRead(workflowRoot, project, projectDataRelativePath(project, 'Tilesets.json'))
    || path.join(dataDir, 'Tilesets.json');
  const tilesets = (readJson(file) as any[]).filter(Boolean).map((tileset) => ({
    id: Number(tileset.id),
    name: String(tileset.name || `Tileset ${tileset.id}`),
    mode: Number(tileset.mode || 1),
    tilesetNames: Array.isArray(tileset.tilesetNames) ? tileset.tilesetNames.map(String) : [],
  }));
  return { project, tilesets };
}

export function buildMapPayload(workflowRoot: string, project: string, mapId: number): MapPayload {
  const manifest = inspectRmmvProject(project);
  const dataDir = resolveDataDir(project);
  const mapInfosFile = getProjectFileForRead(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'))
    || path.join(dataDir, 'MapInfos.json');
  const tilesetsFile = getProjectFileForRead(workflowRoot, project, projectDataRelativePath(project, 'Tilesets.json'))
    || path.join(dataDir, 'Tilesets.json');
  const mapFile = getMapFileForRead(workflowRoot, project, mapId);
  if (!fs.existsSync(mapFile)) throw new Error(mapNotFound(mapId));
  const effectiveMapRevision = fileRevision(mapFile);
  const infos = fs.existsSync(mapInfosFile) ? readJson(mapInfosFile) as any[] : [];
  const map = readJson(mapFile) as any;
  const tilesets = fs.existsSync(tilesetsFile) ? readJson(tilesetsFile) as any[] : [];
  const systemPath = getProjectFileForRead(workflowRoot, project, projectDataRelativePath(project, 'System.json'))
    || path.join(dataDir, 'System.json');
  const system = fs.existsSync(systemPath) ? readJson(systemPath) as any : { switches: [], variables: [] };
  const info = infos[mapId] || { id: mapId, name: `Map${String(mapId).padStart(3, '0')}` };
  const tileset = tilesets[map.tilesetId] || null;
  const names = tileset && Array.isArray(tileset.tilesetNames) ? tileset.tilesetNames : [];
  const parallax = resolveProjectParallaxImage(workflowRoot, project, map);
  return {
    project,
    effectiveMapRevision,
    engine: manifest.engine,
    engineVersion: manifest.engineVersion,
    tileSize: manifest.tileSize,
    screenWidth: manifest.screenWidth,
    screenHeight: manifest.screenHeight,
    faceSize: manifest.faceSize,
    iconSize: manifest.iconSize,
    info,
    map: {
      ...map,
      width: Number(map.width),
      height: Number(map.height),
      tilesetId: Number(map.tilesetId),
      data: Array.isArray(map.data) ? map.data : [],
      events: Array.isArray(map.events) ? map.events : [],
    },
    parallaxImageUrl: parallax.url,
    resourceWarnings: parallax.warnings,
    tileset: tileset ? {
      id: Number(tileset.id),
      name: String(tileset.name || ''),
      mode: Number.isInteger(Number(tileset.mode)) ? Number(tileset.mode) : null,
      tilesetNames: names,
      flags: Array.isArray(tileset.flags) ? tileset.flags : [],
      imageUrls: names.map((name: string) => name ? projectTilesetImageUrl(workflowRoot, project, name) : null),
    } : null,
    system: {
      switches: Array.isArray(system.switches) ? system.switches : [],
      variables: Array.isArray(system.variables) ? system.variables : [],
      startPosition: systemPosition(system, 'player'),
      vehiclePositions: {
        boat: systemPosition(system, 'boat'),
        ship: systemPosition(system, 'ship'),
        airship: systemPosition(system, 'airship'),
      },
    },
    previewState: buildMapPreviewStateCatalog(workflowRoot, project, mapId),
    staging: getStagingStatus(workflowRoot, project, mapId),
  };
}

export function createMapDraft(workflowRoot: string, project: string, properties: Record<string, unknown>) {
  const context = readProjectData(workflowRoot, project);
  const mapId = nextMapId(context.mapInfos);
  const normalized = normalizeMapProperties(properties, context.tilesets, { name: `MAP${String(mapId).padStart(3, '0')}` });
  const map = applyExtendedMapProperties(createBlankMapData(normalized), properties);
  const info = createMapInfo(mapId, normalized, context.mapInfos);
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), upsertMapInfo(context.mapInfos, info));
  writeStagedProjectJson(workflowRoot, project, mapRelativePath(project, mapId), map);
  return { mapId, info, map, staging: getProjectStagingStatus(workflowRoot, project), warnings: [] };
}

export function updateMapPropertiesDraft(workflowRoot: string, project: string, mapId: number, properties: Record<string, unknown>) {
  const context = readProjectData(workflowRoot, project);
  const mapFile = getMapFileForRead(workflowRoot, project, mapId);
  if (!fs.existsSync(mapFile)) throw new Error(mapNotFound(mapId));
  const original = readJson(mapFile) as any;
  const currentInfo = context.mapInfos[mapId] || { id: mapId, name: `Map${String(mapId).padStart(3, '0')}`, parentId: 0 };
  const normalized = normalizeMapProperties(properties, context.tilesets, { ...original, name: currentInfo.name, parentId: currentInfo.parentId });
  let map = applyExtendedMapProperties({ ...original, displayName: normalized.displayName, tilesetId: normalized.tilesetId, scrollType: normalized.scrollType, encounterStep: normalized.encounterStep, note: normalized.note }, properties);
  if (normalized.width !== map.width || normalized.height !== map.height) map = resizeMapData(map, normalized.width, normalized.height);
  const info = { ...currentInfo, id: mapId, name: normalized.name, parentId: normalized.parentId };
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), upsertMapInfo(context.mapInfos, info));
  writeStagedProjectJson(workflowRoot, project, mapRelativePath(project, mapId), map);
  return { mapId, info, staging: getProjectStagingStatus(workflowRoot, project) };
}

export function reparentMapDraft(workflowRoot: string, project: string, mapId: number, parentId: number) {
  const context = readProjectData(workflowRoot, project);
  const info = context.mapInfos[mapId];
  if (!info) throw new Error(mapInfoNotFound(mapId));
  const next = { ...info, parentId, order: nextMapOrder(context.mapInfos, parentId) };
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), upsertMapInfo(context.mapInfos, next));
  return { mapId, info: next, staging: getProjectStagingStatus(workflowRoot, project) };
}

export function moveMapDraft(
  workflowRoot: string,
  project: string,
  mapId: number,
  targetMapId: number,
  position: MapMovePosition,
) {
  if (!Number.isInteger(mapId) || mapId <= 0) throw new Error('mapId must be a positive integer');
  if (!Number.isInteger(targetMapId) || targetMapId <= 0) throw new Error('targetMapId must be a positive integer');
  if (!['before', 'after', 'inside'].includes(position)) throw new Error(`Unsupported map move position: ${String(position)}`);
  if (mapId === targetMapId) throw new Error('A map cannot be moved relative to itself');

  const context = readProjectData(workflowRoot, project);
  const source = context.mapInfos[mapId];
  const target = context.mapInfos[targetMapId];
  if (!source) throw new Error(mapInfoNotFound(mapId));
  if (!target) throw new Error(mapInfoNotFound(targetMapId));
  const oldParentId = Number(source.parentId || 0);
  const parentId = position === 'inside' ? targetMapId : Number(target.parentId || 0);
  assertMapParentDoesNotCreateCycle(context.mapInfos, mapId, parentId);

  const infos = context.mapInfos.slice();
  infos[mapId] = { ...source, parentId };
  const siblings = infos
    .filter(Boolean)
    .filter((info: any) => Number(info.parentId || 0) === parentId && Number(info.id) !== mapId)
    .sort(compareMapInfoOrder)
    .map((info: any) => Number(info.id));
  if (position === 'inside') {
    siblings.push(mapId);
  } else {
    const targetIndex = siblings.indexOf(targetMapId);
    if (targetIndex < 0) throw new Error('Map move target is not in the expected sibling group');
    siblings.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, mapId);
  }

  const ordered = normalizeMapTreeOrder(infos, new Map([[parentId, siblings]]));
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), ordered);
  return {
    mapId,
    targetMapId,
    position,
    oldParentId,
    parentId,
    maps: buildMapIndex(workflowRoot, project).maps,
    staging: getProjectStagingStatus(workflowRoot, project),
  };
}

export function searchProjectEvents(
  workflowRoot: string,
  project: string,
  rawQuery: string,
  options: EventSearchOptions = {},
): EventSearchResult {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Event search options must be an object');
  }
  const limit = options.limit ?? 200;
  const mapId = options.mapId;
  if (mapId !== undefined && (!Number.isInteger(mapId) || mapId <= 0)) {
    throw new Error(mapIdInvalid());
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Event search limit must be an integer from 1 to 1000');

  const mapIndex = buildMapIndex(workflowRoot, project);
  const maps = mapId === undefined
    ? mapIndex.maps
    : mapIndex.maps.filter((mapInfo) => mapInfo.id === mapId);
  if (mapId !== undefined && maps.length === 0) throw new Error(mapInfoNotFound(mapId));

  const query = String(rawQuery || '').trim();
  if (!query) return { project: path.resolve(project), query: '', hits: [], truncated: false };
  if (query.length > 200) throw new Error('Event search query must be 200 characters or fewer');
  const needle = query.toLocaleLowerCase();
  const idMatch = /^#?0*(\d+)$/.exec(query);
  const eventIdQuery = idMatch ? Number(idMatch[1]) : null;
  const hits: EventSearchResult['hits'] = [];
  let truncated = false;
  const add = (hit: EventSearchResult['hits'][number]): void => {
    if (hits.length >= limit) {
      truncated = true;
      return;
    }
    hits.push(hit);
  };

  for (const mapInfo of maps) {
    if (truncated) break;
    const mapFile = getMapFileForRead(workflowRoot, project, mapInfo.id);
    if (!mapFile || !fs.existsSync(mapFile)) {
      if (mapId !== undefined) throw new Error(mapNotFound(mapInfo.id));
      continue;
    }
    const map = readJson(mapFile) as { events?: unknown[] };
    for (const rawEvent of Array.isArray(map.events) ? map.events : []) {
      if (truncated) break;
      if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) continue;
      const event = rawEvent as Record<string, unknown>;
      const eventId = Number(event.id);
      if (!Number.isInteger(eventId) || eventId <= 0) continue;
      const eventName = String(event.name || `EV${String(eventId).padStart(3, '0')}`);
      const base = { mapId: mapInfo.id, mapName: mapInfo.name, eventId, eventName };
      if (eventIdQuery === eventId) add({ ...base, pageIndex: null, commandIndex: null, matchKind: 'id', text: `#${eventId}` });
      if (eventName.toLocaleLowerCase().includes(needle)) add({ ...base, pageIndex: null, commandIndex: null, matchKind: 'name', text: eventName });
      const note = String(event.note || '');
      if (note.toLocaleLowerCase().includes(needle)) add({ ...base, pageIndex: null, commandIndex: null, matchKind: 'note', text: summarizeSearchText(note) });
      const pages = Array.isArray(event.pages) ? event.pages : [];
      pages.forEach((rawPage, pageIndex) => {
        if (truncated || !rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) return;
        const list = Array.isArray((rawPage as Record<string, unknown>).list) ? (rawPage as Record<string, unknown>).list as unknown[] : [];
        list.forEach((rawCommand, commandIndex) => {
          if (truncated || !rawCommand || typeof rawCommand !== 'object' || Array.isArray(rawCommand)) return;
          const text = collectCommandSearchText((rawCommand as Record<string, unknown>).parameters);
          if (!text.toLocaleLowerCase().includes(needle)) return;
          add({ ...base, pageIndex, commandIndex, matchKind: 'command', text: summarizeSearchText(text) });
        });
      });
    }
  }
  return { project: path.resolve(project), query, hits, truncated };
}

export function duplicateMapDraft(workflowRoot: string, project: string, sourceMapId: number, parentId: number) {
  const context = readProjectData(workflowRoot, project);
  const sourceInfo = context.mapInfos[sourceMapId];
  const sourceFile = getMapFileForRead(workflowRoot, project, sourceMapId);
  if (!sourceInfo || !fs.existsSync(sourceFile)) throw new Error(mapNotFound(sourceMapId));
  const mapId = nextMapId(context.mapInfos);
  const map = readJson(sourceFile) as any;
  const info = createMapInfo(mapId, { ...map, name: `${sourceInfo.name || `Map${sourceMapId}`} Copy`, parentId }, context.mapInfos);
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), upsertMapInfo(context.mapInfos, info));
  writeStagedProjectJson(workflowRoot, project, mapRelativePath(project, mapId), map);
  return { mapId, sourceMapId, info, staging: getProjectStagingStatus(workflowRoot, project) };
}

export function deleteMapDraft(workflowRoot: string, project: string, mapId: number) {
  const context = readProjectData(workflowRoot, project);
  if (!context.mapInfos[mapId]) throw new Error(mapInfoNotFound(mapId));
  if (context.mapInfos.filter(Boolean).some((info: any) => info.parentId === mapId)) throw new Error(mapHasChildMaps());
  const infos = context.mapInfos.slice();
  infos[mapId] = null;
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), infos);
  deleteStagedProjectFile(workflowRoot, project, mapRelativePath(project, mapId));
  return { mapId, deleted: true, staging: getProjectStagingStatus(workflowRoot, project) };
}

export function postMapTiles(workflowRoot: string, project: string, mapId: number, edits: TileEdit[]) {
  const staged = withStagedMapMutation(
    workflowRoot,
    project,
    mapId,
    (target) => applyBrushEdit({ project: target.project, mapId, edits }),
  );
  return {
    ...staged.result,
    effectiveMapRevision: fileRevision(getMapFileForRead(workflowRoot, project, mapId)),
    staging: staged.staging,
  };
}

function fileRevision(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function setStartPositionDraft(workflowRoot: string, project: string, mapId: number, x: number, y: number) {
  return setSystemPositionDraft(workflowRoot, project, 'player', mapId, x, y);
}

export function setSystemPositionDraft(
  workflowRoot: string,
  project: string,
  target: RmmvSystemPositionTarget,
  mapId: number,
  x: number,
  y: number,
) {
  const positionTarget = validPositionTarget(target);
  const startMapId = validMapId(mapId);
  const mapFile = getMapFileForRead(workflowRoot, project, startMapId);
  if (!fs.existsSync(mapFile)) throw new Error(mapNotFound(startMapId));
  const map = readJson(mapFile) as { width?: unknown; height?: unknown };
  const width = Number(map.width);
  const height = Number(map.height);
  const startX = validCoordinate(x, width, 'x');
  const startY = validCoordinate(y, height, 'y');
  const systemRelativePath = projectDataRelativePath(project, 'System.json');
  const systemFile = getProjectFileForRead(workflowRoot, project, systemRelativePath);
  if (!systemFile) throw new Error(mapSystemJsonMissing());
  const system = readJson(systemFile) as Record<string, unknown>;
  const next = positionTarget === 'player'
    ? { ...system, startMapId, startX, startY }
    : {
        ...system,
        [positionTarget]: {
          ...(typeof system[positionTarget] === 'object' && system[positionTarget] !== null ? system[positionTarget] as Record<string, unknown> : {}),
          startMapId,
          startX,
          startY,
        },
      };
  writeStagedProjectJson(workflowRoot, project, systemRelativePath, next);
  return {
    target: positionTarget,
    mapId: startMapId,
    x: startX,
    y: startY,
    relativePath: systemRelativePath,
    staging: getProjectStagingStatus(workflowRoot, project),
  };
}

export interface PackageImportResult {
  mapIds: number[];
  idMap: Record<number, number>;
  failed: Array<{ assetId: string; message: string }>;
  warnings: string[];
  usedSourceHierarchy: boolean;
  staging: ReturnType<typeof getProjectStagingStatus>;
}

export function importMapDraftFromLibrary(workflowRoot: string, project: string, assetId: string, properties: Record<string, unknown> = {}) {
  const entry = getMapLibraryEntry(workflowRoot, assetId);
  const context = createLibraryImportContext(workflowRoot, project);
  const warnings: string[] = [];
  const result = importMapDraftEntry(workflowRoot, project, entry, context, properties, warnings);
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), context.mapInfos);
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'Tilesets.json'), context.tilesets);
  return {
    mapId: result.mapId,
    assetId: entry.assetId,
    info: result.info,
    map: { width: result.map.width, height: result.map.height, tilesetId: result.map.tilesetId },
    warnings,
    staging: getProjectStagingStatus(workflowRoot, project),
  };
}

/** Batch-imports a map package while preserving source MapInfos hierarchy and deduplicating tilesets. */
export function importMapPackageFromLibrary(
  workflowRoot: string,
  project: string,
  assetIds: string[],
  anchorParentId: number,
  properties: Record<string, unknown> = {},
) {
  const warnings: string[] = [];
  const failed: PackageImportResult['failed'] = [];
  const mapIds: number[] = [];
  const idMap = new Map<number, number>();

  const items: Array<{ assetId: string; entry: Record<string, any> }> = [];
  for (const assetId of assetIds) {
    try {
      items.push({ assetId, entry: getMapLibraryEntry(workflowRoot, assetId) });
    } catch (error) {
      failed.push({ assetId, message: (error as Error).message || mapLibraryEntryNotFound() });
    }
  }

  items.sort((a, b) => {
    const aId = Number(a.entry.map?.mapId) || 99999;
    const bId = Number(b.entry.map?.mapId) || 99999;
    return aId - bId || String(a.assetId).localeCompare(String(b.assetId));
  });

  const sourceInfos = readSourceMapInfos(items[0]?.entry, workflowRoot);
  const context = createLibraryImportContext(workflowRoot, project);
  const includeEvents = shouldIncludeMapEvents(properties);
  if (includeEvents) {
    for (const { entry } of items) {
      validateImportedMapEvents(
        readJson(firstLibraryMapFile(workflowRoot, entry)),
        context.engine,
      );
    }
  }
  const mergedDependencies = mergePackageDependencies(items.map((item) => item.entry), workflowRoot);

  const uniqueSourceTilesets = new Map<number, { entry: Record<string, any>; sourceMap: any }>();
  for (const { entry } of items) {
    try {
      const sourceMap = readJson(firstLibraryMapFile(workflowRoot, entry)) as any;
      const sourceTilesetId = Number(sourceMap.tilesetId);
      if (!Number.isFinite(sourceTilesetId) || sourceTilesetId <= 0) continue;
      if (!uniqueSourceTilesets.has(sourceTilesetId)) {
        uniqueSourceTilesets.set(sourceTilesetId, { entry, sourceMap });
      }
    } catch {
      /* per-map import will surface missing files */
    }
  }
  const dependencyHost = items[0]?.entry
    ? { ...items[0].entry, dependencies: mergedDependencies }
    : null;
  if (dependencyHost) {
    for (const { entry, sourceMap } of uniqueSourceTilesets.values()) {
      try {
        ensureImportedTileset(workflowRoot, project, context, entry, sourceMap, warnings, dependencyHost);
      } catch (error) {
        warnings.push(mapTilesetPreimportFailed(sourceMap.tilesetId, (error as Error).message));
      }
    }
    writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'Tilesets.json'), context.tilesets);
  }

  for (const { entry } of items) {
    const sourceMapId = Number(entry.map?.mapId);
    if (!sourceMapId || idMap.has(sourceMapId)) continue;
    const newId = nextMapId(context.mapInfos);
    idMap.set(sourceMapId, newId);
    context.mapInfos = upsertMapInfo(context.mapInfos, {
      id: newId,
      expanded: true,
      name: `__reserved_${sourceMapId}`,
      order: 0,
      parentId: 0,
      scrollX: 0,
      scrollY: 0,
    });
  }

  for (const { assetId, entry } of items) {
    try {
      const sourceMapId = Number(entry.map?.mapId) || 0;
      let mapId = sourceMapId ? idMap.get(sourceMapId) : undefined;
      if (!mapId) {
        mapId = nextMapId(context.mapInfos);
        if (sourceMapId) idMap.set(sourceMapId, mapId);
      }
      const parentId = sourceMapId && sourceInfos
        ? resolvePackageParentId(sourceMapId, sourceInfos, idMap, anchorParentId)
        : anchorParentId;
      const importNote = String(properties.note || '');
      const perMapProps = {
        ...properties,
        parentId,
        name: entry.title || entry.assetId,
        note: `Imported from ${entry.assetId}${importNote ? `\n${importNote}` : ''}`,
      };
      const imported = importMapDraftEntry(
        workflowRoot,
        project,
        entry,
        context,
        perMapProps,
        warnings,
        mapId,
        dependencyHost || undefined,
      );
      mapIds.push(imported.mapId);
    } catch (error) {
      failed.push({ assetId, message: (error as Error).message || mapImportFailed() });
    }
  }

  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json'), context.mapInfos);
  writeStagedProjectJson(workflowRoot, project, projectDataRelativePath(project, 'Tilesets.json'), context.tilesets);

  if (includeEvents && idMap.size > 0) {
    let remapped = false;
    for (const mapId of mapIds) {
      if (remapTransferMapIdsInStagedMap(workflowRoot, project, mapId, idMap)) remapped = true;
    }
    if (remapped) warnings.push(mapPackageTransferIdsRemapped());
  }

  return {
    mapIds,
    idMap: Object.fromEntries(idMap),
    failed,
    warnings,
    usedSourceHierarchy: Boolean(sourceInfos),
    staging: getProjectStagingStatus(workflowRoot, project),
  };
}

function importMapDraftEntry(
  workflowRoot: string,
  project: string,
  entry: Record<string, any>,
  context: LibraryImportContext,
  properties: Record<string, unknown>,
  warnings: string[],
  assignedMapId?: number,
  dependencyHost?: Record<string, any>,
) {
  const sourceMap = readJson(firstLibraryMapFile(workflowRoot, entry)) as any;
  const includeEvents = shouldIncludeMapEvents(properties);
  if (includeEvents) validateImportedMapEvents(sourceMap, context.engine);
  const tilesetId = ensureImportedTileset(
    workflowRoot,
    project,
    context,
    entry,
    sourceMap,
    warnings,
    dependencyHost,
  );
  const mapId = assignedMapId ?? nextMapId(context.mapInfos);
  // The active tilesetId must be the ID resolved inside this project. The UI can
  // pass the source asset's old ID, which would point at an unrelated tileset here.
  const normalized = normalizeMapProperties({ ...properties, tilesetId }, context.tilesets, {
    ...sourceMap,
    name: String(properties.name ?? entry.title ?? `Imported ${mapId}`),
    tilesetId,
  });
  let map = applyExtendedMapProperties({
    ...sourceMap,
    tilesetId: normalized.tilesetId,
    displayName: normalized.displayName,
    scrollType: normalized.scrollType,
    encounterStep: normalized.encounterStep,
    note: normalized.note,
  }, properties);
  if (normalized.width !== map.width || normalized.height !== map.height) {
    map = resizeMapData(map, normalized.width, normalized.height);
  }
  if (!includeEvents) map = { ...map, events: blankMapEvents() };
  copyParallaxIfAvailable(workflowRoot, project, entry, map, warnings);
  const info = createMapInfo(mapId, normalized, context.mapInfos);
  context.mapInfos = upsertMapInfo(context.mapInfos, info);
  writeStagedProjectJson(workflowRoot, project, mapRelativePath(project, mapId), map);
  return { mapId, info, map };
}

export function createPlaytestArtifact(workflowRoot: string, project: string, mapId: number, startX = 0, startY = 0) {
  return prepareRmmvPlaytestPlan(workflowRoot, project, { mapId, startX, startY });
}

function readProjectData(workflowRoot: string, project: string) {
  const dataDir = resolveDataDir(project);
  const infos = getProjectFileForRead(workflowRoot, project, projectDataRelativePath(project, 'MapInfos.json')) || path.join(dataDir, 'MapInfos.json');
  const tilesets = getProjectFileForRead(workflowRoot, project, projectDataRelativePath(project, 'Tilesets.json')) || path.join(dataDir, 'Tilesets.json');
  return { mapInfos: readJson(infos) as any[], tilesets: readJson(tilesets) as any[] };
}

function createLibraryImportContext(workflowRoot: string, project: string): LibraryImportContext {
  const data = readProjectData(workflowRoot, project);
  return { engine: inspectRmmvProject(project).engine, ...data, tilesetRegistry: new Map() };
}

function validateImportedMapEvents(map: unknown, engine: RpgMakerEngine): void {
  if (!map || typeof map !== 'object') return;
  const events = Array.isArray((map as { events?: unknown }).events)
    ? (map as { events: unknown[] }).events
    : [];
  events.forEach((event, eventIndex) => {
    if (!event || typeof event !== 'object') return;
    const pages = Array.isArray((event as { pages?: unknown }).pages)
      ? (event as { pages: unknown[] }).pages
      : [];
    pages.forEach((page, pageIndex) => {
      if (!page || typeof page !== 'object') return;
      const list = (page as { list?: unknown }).list;
      if (!Array.isArray(list)) return;
      validateEventCommandList(
        list,
        `map.events[${eventIndex}].pages[${pageIndex}].list`,
        engine,
      );
    });
  });
}

function normalizeMapProperties(properties: Record<string, any>, tilesets: any[], defaults: Record<string, any> = {}) {
  return {
    name: String(properties.name ?? defaults.name ?? 'New Map').trim() || 'New Map',
    displayName: String(properties.displayName ?? defaults.displayName ?? ''),
    parentId: Math.max(0, Number(properties.parentId ?? defaults.parentId ?? 0) || 0),
    tilesetId: Number(properties.tilesetId ?? defaults.tilesetId) || firstTilesetId(tilesets),
    width: clampInt(properties.width ?? defaults.width, 1, 256, 17),
    height: clampInt(properties.height ?? defaults.height, 1, 256, 13),
    scrollType: clampInt(properties.scrollType ?? defaults.scrollType, 0, 3, 0),
    encounterStep: clampInt(properties.encounterStep ?? defaults.encounterStep, 1, 999, 30),
    note: String(properties.note ?? defaults.note ?? ''),
  };
}

function createBlankMapData(properties: Record<string, any>) {
  return { ...defaultMapProperties(properties), height: properties.height, tilesetId: properties.tilesetId, width: properties.width, data: Array(properties.width * properties.height * 6).fill(0), events: [null] };
}

function applyExtendedMapProperties(map: Record<string, any>, properties: Record<string, any>): any {
  const bool = (key: string) => properties[key] === undefined ? Boolean(map[key]) : Boolean(properties[key]);
  return {
    ...map,
    displayName: String(properties.displayName ?? map.displayName ?? ''),
    scrollType: clampInt(properties.scrollType ?? map.scrollType, 0, 3, 0),
    disableDashing: bool('disableDashing'),
    encounterList: normalizeEncounterList(properties.encounterList, map.encounterList),
    encounterStep: clampInt(properties.encounterStep ?? map.encounterStep, 1, 999, 30),
    note: String(properties.note ?? map.note ?? ''),
    autoplayBgm: bool('autoplayBgm'),
    autoplayBgs: bool('autoplayBgs'),
    bgm: normalizeAudio(properties.bgm, map.bgm, {
      name: properties.bgmName,
      volume: properties.bgmVolume,
      pitch: properties.bgmPitch,
      pan: properties.bgmPan,
    }),
    bgs: normalizeAudio(properties.bgs, map.bgs, {
      name: properties.bgsName,
      volume: properties.bgsVolume,
      pitch: properties.bgsPitch,
      pan: properties.bgsPan,
    }),
    specifyBattleback: bool('specifyBattleback'),
    battleback1Name: String(properties.battleback1Name ?? map.battleback1Name ?? ''),
    battleback2Name: String(properties.battleback2Name ?? map.battleback2Name ?? ''),
    parallaxName: String(properties.parallaxName ?? map.parallaxName ?? ''),
    parallaxShow: bool('parallaxShow'),
    parallaxLoopX: bool('parallaxLoopX'),
    parallaxLoopY: bool('parallaxLoopY'),
    parallaxSx: clampInt(properties.parallaxSx ?? map.parallaxSx, -32, 32, 0),
    parallaxSy: clampInt(properties.parallaxSy ?? map.parallaxSy, -32, 32, 0),
  };
}

function defaultMapProperties(properties: Record<string, any>) {
  return {
    autoplayBgm: false,
    autoplayBgs: false,
    battleback1Name: '',
    battleback2Name: '',
    bgm: audioObject(''),
    bgs: audioObject(''),
    disableDashing: false,
    displayName: properties.displayName,
    encounterList: [],
    encounterStep: properties.encounterStep,
    note: properties.note,
    parallaxLoopX: false,
    parallaxLoopY: false,
    parallaxName: '',
    parallaxShow: false,
    parallaxSx: 0,
    parallaxSy: 0,
    scrollType: properties.scrollType,
    specifyBattleback: false,
  };
}

function normalizeEncounterList(value: unknown, fallback: unknown): RmmvMapEncounter[] {
  const list = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return list
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({
      ...entry,
      troopId: clampInt(entry.troopId, 1, 9999, 1),
      weight: clampInt(entry.weight, 1, 999, 10),
      regionSet: Array.isArray(entry.regionSet)
        ? entry.regionSet.map((region) => clampInt(region, 1, 255, 1)).filter((region, index, regions) => regions.indexOf(region) === index)
        : [],
    }));
}

function normalizeAudio(value: unknown, fallback: unknown, overrides: Record<string, unknown> = {}): RmmvAudioSettings {
  const source = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : typeof fallback === 'object' && fallback !== null
      ? fallback as Record<string, unknown>
      : {};
  return {
    name: String(overrides.name ?? source.name ?? ''),
    volume: clampInt(overrides.volume ?? source.volume, 0, 100, 90),
    pitch: clampInt(overrides.pitch ?? source.pitch, 50, 150, 100),
    pan: clampInt(overrides.pan ?? source.pan, -100, 100, 0),
  };
}

function createMapInfo(id: number, properties: Record<string, any>, infos: any[]) {
  return { id, expanded: true, name: properties.name, order: nextMapOrder(infos, properties.parentId), parentId: properties.parentId || 0, scrollX: 0, scrollY: 0 };
}
function upsertMapInfo(infos: any[], info: any) { const next = infos.slice(); next[info.id] = info; return next; }
function nextMapId(infos: any[]) { for (let id = 1; id < 10000; id += 1) if (!infos[id]) return id; throw new Error(mapNoAvailableId()); }
function nextMapOrder(infos: any[], parentId: number) { return Math.max(0, ...infos.filter(Boolean).filter((info) => Number(info.parentId || 0) === Number(parentId || 0)).map((info) => Number(info.order) || 0)) + 1; }

function compareMapInfoOrder(left: any, right: any): number {
  return Number(left.order || 0) - Number(right.order || 0) || Number(left.id) - Number(right.id);
}

function assertMapParentDoesNotCreateCycle(infos: any[], mapId: number, parentId: number): void {
  if (parentId === 0) return;
  const seen = new Set<number>();
  let cursor = parentId;
  while (cursor !== 0) {
    if (cursor === mapId) throw new Error('Map move would create a parent-child cycle');
    if (seen.has(cursor)) throw new Error('MapInfos already contains a parent-child cycle');
    seen.add(cursor);
    const info = infos[cursor];
    if (!info) throw new Error(mapInfoNotFound(cursor));
    cursor = Number(info.parentId || 0);
  }
}

function normalizeMapTreeOrder(infos: any[], overrides: Map<number, number[]>): any[] {
  const next = infos.map((info) => info ? { ...info } : info);
  const groups = new Map<number, number[]>();
  for (const info of next.filter(Boolean)) {
    const parentId = Number(info.parentId || 0);
    const group = groups.get(parentId) || [];
    group.push(Number(info.id));
    groups.set(parentId, group);
  }
  for (const [parentId, ids] of groups) {
    ids.sort((left, right) => compareMapInfoOrder(next[left], next[right]));
    const override = overrides.get(parentId);
    if (!override) continue;
    if (override.length !== ids.length || new Set(override).size !== ids.length || override.some((id) => !ids.includes(id))) {
      throw new Error('Map sibling order does not contain exactly the expected maps');
    }
    groups.set(parentId, [...override]);
  }

  let order = 1;
  const visited = new Set<number>();
  const visit = (parentId: number): void => {
    for (const id of groups.get(parentId) || []) {
      if (visited.has(id)) throw new Error('MapInfos contains a parent-child cycle');
      visited.add(id);
      next[id] = { ...next[id], order: order++ };
      visit(id);
    }
  };
  visit(0);
  if (visited.size !== next.filter(Boolean).length) throw new Error('MapInfos contains an orphaned map or parent-child cycle');
  return next;
}

function collectCommandSearchText(value: unknown): string {
  const values: string[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      if (item.trim()) values.push(item.trim());
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== 'object') return;
    Object.values(item as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return values.join(' · ');
}

function summarizeSearchText(value: string): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}
function firstTilesetId(tilesets: any[]) { return tilesets.find(Boolean)?.id || 1; }
function audioObject(name: unknown): RmmvAudioSettings { return { name: String(name || ''), volume: 90, pitch: 100, pan: 0 }; }
function clampInt(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback; }
function validPositionTarget(value: unknown): RmmvSystemPositionTarget {
  if (value === 'player' || value === 'boat' || value === 'ship' || value === 'airship') return value;
  throw new Error(mapPositionTargetInvalid());
}
function validMapId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(mapIdInvalid());
  return id;
}
function validCoordinate(value: unknown, limit: number, label: 'x' | 'y'): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(mapStartCoordinateInvalid(label));
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(mapSizeInvalid());
  if (number >= limit) throw new Error(mapStartCoordinateOutOfBounds(label, number));
  return number;
}
function systemPosition(system: Record<string, unknown>, target: RmmvSystemPositionTarget): RmmvSystemPosition {
  const source = target === 'player'
    ? system
    : typeof system[target] === 'object' && system[target] !== null
      ? system[target] as Record<string, unknown>
      : {};
  return {
    target,
    mapId: Number(source.startMapId) || 0,
    x: Number(source.startX) || 0,
    y: Number(source.startY) || 0,
  };
}
function mapRelativePath(project: string, mapId: number) {
  return projectRelativePath(project, path.join(resolveDataDir(project), `Map${String(mapId).padStart(3, '0')}.json`));
}

function projectDataRelativePath(project: string, fileName: string): string {
  return projectRelativePath(project, path.join(resolveDataDir(project), fileName));
}

function projectTilesetImageUrl(workflowRoot: string, project: string, name: string): string {
  const relative = projectTilesetImageRelativePath(workflowRoot, project, name);
  if (!relative) {
    throw new Error(mapProjectTilesetImageMissing(name));
  }
  return projectAssetUrl(project, relative);
}

function resolveProjectParallaxImage(
  workflowRoot: string,
  project: string,
  map: Record<string, unknown>,
): { url: string | null; warnings: string[] } {
  const name = typeof map.parallaxName === 'string' ? map.parallaxName.trim() : '';
  if (!name || !map.parallaxShow) return { url: null, warnings: [] };
  const relative = projectImageRelativePath(workflowRoot, project, 'parallaxes', name);
  if (!relative) return { url: null, warnings: [mapProjectParallaxImageMissing(name)] };
  return { url: projectAssetUrl(project, relative), warnings: [] };
}

function projectImageRelativePath(
  workflowRoot: string,
  project: string,
  directory: 'parallaxes',
  name: string,
): string | null {
  for (const relative of projectImageCandidates(project, directory, name)) {
    if (getProjectFileForRead(workflowRoot, project, relative)) return relative;
  }
  return null;
}

function projectImageCandidates(project: string, directory: 'parallaxes', name: string): string[] {
  const fileName = `${name}.png`;
  const dataRelative = path.relative(path.resolve(project), resolveDataDir(project)).replace(/\\/g, '/');
  const primary = dataRelative.startsWith('www/') ? `www/img/${directory}/${fileName}` : `img/${directory}/${fileName}`;
  const fallback = primary.startsWith('www/') ? `img/${directory}/${fileName}` : `www/img/${directory}/${fileName}`;
  return primary === fallback ? [primary] : [primary, fallback];
}

function projectTilesetImageRelativePath(workflowRoot: string, project: string, name: string): string | null {
  for (const relative of projectTilesetImageCandidates(project, name)) {
    if (getProjectFileForRead(workflowRoot, project, relative)) return relative;
  }
  return null;
}

function projectTilesetImageCandidates(project: string, name: string): string[] {
  const fileName = `${name}.png`;
  const dataRelative = path.relative(path.resolve(project), resolveDataDir(project)).replace(/\\/g, '/');
  const primary = dataRelative.startsWith('www/') ? `www/img/tilesets/${fileName}` : `img/tilesets/${fileName}`;
  const fallback = primary.startsWith('www/') ? `img/tilesets/${fileName}` : `www/img/tilesets/${fileName}`;
  return primary === fallback ? [primary] : [primary, fallback];
}

function projectTilesetImageWritePath(project: string, name: string): string {
  return projectTilesetImageCandidates(project, name)[0];
}

function projectRelativePath(project: string, filePath: string): string {
  const relative = path.relative(path.resolve(project), path.resolve(filePath)).replace(/\\/g, '/');
  if (!relative || relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error(mapUnsafeProjectPath(filePath));
  return relative;
}

function resizeMapData(map: any, width: number, height: number) {
  const data = Array(width * height * 6).fill(0);
  for (let z = 0; z < 6; z += 1) for (let y = 0; y < Math.min(map.height, height); y += 1) for (let x = 0; x < Math.min(map.width, width); x += 1) data[(z * height + y) * width + x] = map.data[(z * map.height + y) * map.width + x] || 0;
  return { ...map, width, height, data, events: (map.events || []).map((event: any) => !event || event.x >= width || event.y >= height ? null : event) };
}

const TRANSFER_EVENT_CODES = new Set([201, 202]);

function readSourceMapInfos(entry: Record<string, any> | undefined, workflowRoot?: string): any[] | null {
  if (!entry) return null;
  if (!workflowRoot) return null;

  const projectPath = resolveLocalSourcePath(workflowRoot, entry);
  if (!projectPath) return null;
  let file: string;
  try {
    file = path.join(resolveDataDir(projectPath), 'MapInfos.json');
  } catch {
    return null;
  }
  if (!fs.existsSync(file)) return null;
  return readJson(file) as any[];
}

function resolvePackageParentId(
  sourceMapId: number,
  sourceInfos: any[],
  idMap: Map<number, number>,
  anchorParentId: number,
): number {
  const info = sourceInfos[sourceMapId];
  const sourceParent = info ? Number(info.parentId || 0) : 0;
  if (!sourceParent) return anchorParentId;
  const mapped = idMap.get(sourceParent);
  return mapped == null ? anchorParentId : mapped;
}

function remapTransferMapIdsInStagedMap(
  workflowRoot: string,
  project: string,
  mapId: number,
  idMap: Map<number, number>,
): boolean {
  const mapFile = getMapFileForRead(workflowRoot, project, mapId);
  if (!mapFile || !fs.existsSync(mapFile)) return false;
  const map = readJson(mapFile) as any;
  const next = remapTransferMapIdsInMapData(map, idMap);
  if (next === map) return false;
  writeStagedProjectJson(workflowRoot, project, mapRelativePath(project, mapId), next);
  return true;
}

function remapTransferMapIdsInMapData(map: any, idMap: Map<number, number>): any {
  if (!Array.isArray(map.events)) return map;
  let changed = false;
  const events = map.events.map((event: any) => {
    if (!event?.pages) return event;
    const pages = event.pages.map((page: any) => {
      const list = (page.list || []).map((cmd: any) => {
        if (!TRANSFER_EVENT_CODES.has(Number(cmd.code))) return cmd;
        const params = Array.isArray(cmd.parameters) ? [...cmd.parameters] : [];
        const oldId = Number(params[0]);
        if (!idMap.has(oldId)) return cmd;
        params[0] = idMap.get(oldId);
        changed = true;
        return { ...cmd, parameters: params };
      });
      return { ...page, list };
    });
    return { ...event, pages };
  });
  return changed ? { ...map, events } : map;
}

function firstLibraryMapFile(workflowRoot: string, entry: Record<string, any>): string {
  const value = Array.isArray(entry.mapFiles) ? entry.mapFiles[0] : null;
  const file = value ? resolveMapLibraryFilePath(workflowRoot, String(value)) : '';
  if (!file || !isInside(path.dirname(mapLibraryIndexPath(workflowRoot)), file) || !fs.existsSync(file)) throw new Error(mapLibraryFileNotFound(entry.assetId));
  return file;
}

function sourceTilesetKey(entry: Record<string, any>, sourceTilesetId: number, workflowRoot?: string): string {
  const batch = entry.importBatch as Record<string, unknown> | undefined;
  const source = entry.source as Record<string, unknown> | undefined;
  const projectPath = String(source?.localPath && workflowRoot ? path.join(workflowRoot, String(source.localPath), 'source') : '') ||
    String(batch?.sourceProject || source?.originalProjectPath || '');
  const slug = packageSlugFromEntry(entry);
  if (projectPath) return `${projectPath}::tileset:${sourceTilesetId}`;
  // Use the fallback path as the registry key as well to keep deduplication stable.
  const fallback = sourceProjectPath(entry, workflowRoot);
  return fallback
    ? `${fallback}::tileset:${sourceTilesetId}`
    : `${slug}::tileset:${sourceTilesetId}`;
}

function packageSlugFromEntry(entry: Record<string, any>): string {
  const batch = entry.importBatch as Record<string, unknown> | undefined;
  const fromBatch = batch?.sourceSlug ? String(batch.sourceSlug) : '';
  if (fromBatch) return sanitizePackageSlug(fromBatch);
  return sanitizePackageSlug(resolveMapLibraryPackage(entry).packageId || String(entry.assetId || 'library'));
}

function sanitizePackageSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'library';
}

function stripNamespacedTileName(name: string, packageSlug: string): string {
  const prefix = `${sanitizePackageSlug(packageSlug)}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function tilesetFingerprint(tileset: Record<string, any>, packageSlug = ''): string {
  const names = Array.isArray(tileset.tilesetNames)
    ? tileset.tilesetNames.map((name) => stripNamespacedTileName(String(name), packageSlug)).join('\0')
    : '';
  const flagsLen = Array.isArray(tileset.flags) ? tileset.flags.length : 0;
  const slug = packageSlug ? sanitizePackageSlug(packageSlug) : '';
  return `${slug}::${names}::${flagsLen}`;
}

function findCompatibleImportedTileset(
  context: LibraryImportContext,
  fingerprint: string,
  packageSlug: string,
): number | null {
  for (const tileset of context.tilesets) {
    if (!tileset) continue;
    if (tilesetFingerprint(tileset, packageSlug) === fingerprint) return Number(tileset.id);
  }
  return null;
}

function enrichEntryForAssets(workflowRoot: string, entry: Record<string, any>): Record<string, any> {
  return { ...entry, dependencies: mergePackageDependencies([entry], workflowRoot) };
}

function namespacedTileName(packageSlug: string, originalName: string): string {
  if (!originalName) return '';
  const prefix = `${sanitizePackageSlug(packageSlug)}__`;
  return originalName.startsWith(prefix) ? originalName : `${prefix}${originalName}`;
}

function buildNamespacedTileset(source: Record<string, any>, packageSlug: string): Record<string, any> {
  const tilesetNames = (Array.isArray(source.tilesetNames) ? source.tilesetNames : []).map((name: string) =>
    name ? namespacedTileName(packageSlug, String(name)) : '',
  );
  return { ...source, tilesetNames };
}

function mergePackageDependencies(entries: Record<string, any>[], workflowRoot?: string): Record<string, unknown> {
  const tilesetImages = new Map<string, Record<string, unknown>>();
  const parallaxes = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const dependencySources: Array<Record<string, unknown> | undefined> = [entry.dependencies as Record<string, unknown> | undefined];
    if (workflowRoot && entry.source?.localPath) {
      const sourceJsonPath = path.join(workflowRoot, String(entry.source.localPath), 'source', 'source.json');
      if (fs.existsSync(sourceJsonPath)) {
        try {
          const sourceJson = readJson(sourceJsonPath) as Record<string, any>;
          if (sourceJson.dependencies) dependencySources.push(sourceJson.dependencies as Record<string, unknown>);
        } catch {
          /* ignore malformed source.json */
        }
      }
    }
    for (const dependencies of dependencySources) {
      if (!dependencies) continue;
    for (const image of (dependencies.tilesetImages as Array<Record<string, unknown>>) || []) {
      const originalPath = String(image?.originalPath || '');
      const key = originalPath
        ? path.basename(originalPath, path.extname(originalPath))
        : String(image?.name || '');
      if (key && !tilesetImages.has(key)) tilesetImages.set(key, image);
    }
    for (const image of (dependencies.parallaxes as Array<Record<string, unknown>>) || []) {
      const originalPath = String(image?.originalPath || '');
      const key = originalPath
        ? path.basename(originalPath, path.extname(originalPath))
        : String(image?.name || '');
      if (key && !parallaxes.has(key)) parallaxes.set(key, image);
    }
    }
  }
  return {
    tilesetImages: [...tilesetImages.values()],
    parallaxes: [...parallaxes.values()],
  };
}

function sourceProjectPath(entry: Record<string, any>, workflowRoot?: string): string {
  if (workflowRoot) {
    const localPath = resolveLocalSourcePath(workflowRoot, entry);
    if (localPath) return localPath;
  }
  return '';
}

function ensureImportedTileset(
  workflowRoot: string,
  project: string,
  context: LibraryImportContext,
  entry: Record<string, any>,
  sourceMap: any,
  warnings: string[],
  dependencyHost?: Record<string, any>,
): number {
  const sourceTilesetId = Number(sourceMap.tilesetId);
  if (!Number.isFinite(sourceTilesetId) || sourceTilesetId <= 0) {
    throw new Error(mapInvalidSourceTilesetId(entry.assetId));
  }

  const registryKey = sourceTilesetKey(entry, sourceTilesetId, workflowRoot);
  const cached = context.tilesetRegistry.get(registryKey);
  if (cached != null) return cached;

  const source = readSourceTileset(entry, sourceMap, workflowRoot);
  if (!source) {
    throw new Error(mapSourceTilesetMissing(entry.assetId, sourceTilesetId, sourceProjectPath(entry, workflowRoot)));
  }

  const packageSlug = packageSlugFromEntry(entry);
  const fingerprint = tilesetFingerprint(source, packageSlug);
  const entryForAssets = dependencyHost || enrichEntryForAssets(workflowRoot, entry);
  const originalNames = Array.isArray(source.tilesetNames) ? source.tilesetNames.map(String) : [];
  const compatible = findCompatibleImportedTileset(context, fingerprint, packageSlug);
  if (compatible != null) {
    const existing = context.tilesets[compatible];
    if (existing) {
      copyTilesetImages(workflowRoot, project, entryForAssets, existing, originalNames, warnings);
    }
    context.tilesetRegistry.set(registryKey, compatible);
    return compatible;
  }

  const id = nextMapId(context.tilesets);
  const imported = {
    ...buildNamespacedTileset(source, packageSlug),
    id,
    name: String(source.name || entry.map?.tilesetName || `Imported Tileset ${id}`),
  };
  copyTilesetImages(workflowRoot, project, entryForAssets, imported, originalNames, warnings);
  context.tilesets = context.tilesets.slice();
  context.tilesets[id] = imported;
  context.tilesetRegistry.set(registryKey, id);
  return id;
}

function readSourceTileset(entry: Record<string, any>, sourceMap: any, workflowRoot?: string) {
  const projectPath = sourceProjectPath(entry, workflowRoot);
  const file = projectPath ? path.join(projectPath, 'data', 'Tilesets.json') : '';
  if (!file || !fs.existsSync(file)) return null;
  const tilesets = readJson(file) as any[];
  const byId = tilesets[Number(sourceMap.tilesetId)];
  if (byId) return byId;
  const name = entry.map?.tilesetName || entry.tileset?.name;
  return name ? tilesets.find((tileset) => tileset?.name === name) || null : null;
}

const CRITICAL_TILESET_SLOTS = [0, 1, 2, 3];

function copyTilesetImages(
  workflowRoot: string,
  project: string,
  entry: Record<string, any>,
  tileset: Record<string, any>,
  originalNames: string[],
  warnings: string[],
) {
  const destNames = Array.isArray(tileset.tilesetNames) ? tileset.tilesetNames : [];
  for (let index = 0; index < destNames.length; index += 1) {
    const destName = destNames[index];
    if (!destName) continue;
    const originalName = originalNames[index] || String(destName).replace(/^[^_]+__/, '');
    const relative = projectTilesetImageWritePath(project, destName);
    const source = resolveLibraryAssetPath(entry, 'tilesets', originalName, workflowRoot);
    if (source) {
      writeStagedProjectBuffer(workflowRoot, project, relative, fs.readFileSync(source));
    } else if (CRITICAL_TILESET_SLOTS.includes(index)) {
      throw new Error(mapCriticalTilesetImageMissing(originalName));
    } else {
      warnings.push(mapOptionalTilesetImageMissing(originalName));
    }
  }
}

function shouldIncludeMapEvents(properties: Record<string, unknown>): boolean {
  return properties.includeEvents === true;
}

function blankMapEvents(): null[] {
  return [null];
}

function copyParallaxIfAvailable(workflowRoot: string, project: string, entry: Record<string, any>, map: any, warnings: string[]) {
  if (!map.parallaxName) return;
  const gameRoot = inspectRmmvProject(project).resourceRootRelative;
  const relative = `${gameRoot ? `${gameRoot}/` : ''}img/parallaxes/${map.parallaxName}.png`;
  if (getProjectFileForRead(workflowRoot, project, relative)) return;
  const source = resolveLibraryAssetPath(entry, 'parallaxes', map.parallaxName, workflowRoot);
  if (source) writeStagedProjectBuffer(workflowRoot, project, relative, fs.readFileSync(source));
  else warnings.push(mapParallaxImageMissing(map.parallaxName));
}
