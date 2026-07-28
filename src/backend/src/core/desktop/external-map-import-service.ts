import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  ExternalMapImportApplyRequest,
  ExternalMapImportApplyResult,
  ExternalMapImportMapPreview,
  ExternalMapImportResourceRow,
  ExternalMapImportScanRequest,
  ExternalMapImportScanResult,
  ExternalMapImportTilesetRow,
  ExternalMapImportWarning,
  ExternalMapResourceAction,
  ExternalMapResourceResolution,
  ExternalMapResourceStatus,
  ExternalMapReplaceApplyRequest,
  ExternalMapReplaceScanRequest,
  ExternalMapTilesetResolution,
  ExternalProjectBrowseResult,
  RpgMakerEngine,
} from '../../../../contract/types.ts';
import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { readJson } from '../rmmv/json.ts';
import { inspectRmmvProject, resourceRelativePath } from '../rmmv/rmmv-layout.ts';
import { validateRmmvProjectDirectory } from './project-service.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  writeStagedProjectBuffer,
  writeStagedProjectJson,
} from './staging-service.ts';
import {
  collectMapAssetReferences,
  collectMapTilesetImageNames,
  getProjectAssetReferenceGraph,
  RMMV_ASSET_CATEGORIES,
  type RmmvAssetCategory,
  type RmmvAssetReferenceGraph,
} from './asset-reference-graph-service.ts';
import {
  externalImportEventsNotValidated,
  externalImportNoMaps,
  externalImportResourceSourceMissing,
  externalImportSourceEncrypted,
  externalImportSourceInvalid,
  externalImportSourceMapMissing,
  externalImportSourceTilesetMissing,
  externalImportTilesetTargetRequired,
  externalImportUnmappedReferences,
  externalReplaceOutOfBoundsEvents,
  externalReplaceTargetMapMissing,
} from './externalMapImportLocalization.ts';

const CATEGORY_BY_ID = new Map(RMMV_ASSET_CATEGORIES.map((category) => [category.id, category]));

interface ProjectLayout {
  resourceRootRelative: 'www' | '';
  dataDir: string;
}

interface InternalResourceRow extends ExternalMapImportResourceRow {
  category: RmmvAssetCategory;
  /** Absolute path to the source file, or null when it could not be found. */
  sourceAbs: string | null;
  /** Actual extension of the source file (e.g. ".png"), '' when missing. */
  sourceExt: string;
}

interface InternalScan {
  engine: RpgMakerEngine;
  maps: ExternalMapImportMapPreview[];
  resources: InternalResourceRow[];
  tilesets: ExternalMapImportTilesetRow[];
  warnings: ExternalMapImportWarning[];
  srcMaps: Map<number, Record<string, unknown>>;
  srcTilesets: unknown[];
  srcMapInfos: unknown[];
  targetMapInfos: unknown[];
  idMap: Map<number, number>;
  srcLayout: ProjectLayout;
  tgtLayout: ProjectLayout;
  sourceProjectPath: string;
  /** Present only in replace mode: the target map's preserved fields. */
  replaceTarget?: {
    width: number;
    height: number;
    displayName: string;
    tilesetId: number;
    events: unknown[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function padMapId(id: number): string {
  return String(id).padStart(3, '0');
}

function categoryDefinition(category: RmmvAssetCategory) {
  const definition = CATEGORY_BY_ID.get(category);
  if (!definition) throw new Error(`Unsupported asset category: ${category}`);
  return definition;
}

function projectLayout(project: string): ProjectLayout {
  const manifest = inspectRmmvProject(project);
  return { resourceRootRelative: manifest.resourceRootRelative, dataDir: manifest.dataDir };
}

function dataRelative(layout: ProjectLayout, project: string, fileName: string): string {
  const relative = path.relative(path.resolve(project), layout.dataDir).replace(/\\/g, '/');
  return relative ? `${relative}/${fileName}` : fileName;
}

function mapRelative(layout: ProjectLayout, project: string, mapId: number): string {
  return dataRelative(layout, project, `Map${padMapId(mapId)}.json`);
}

function assetRelative(layout: ProjectLayout, category: RmmvAssetCategory, name: string, ext: string): string {
  return resourceRelativePath(
    { resourceRootRelative: layout.resourceRootRelative },
    `${categoryDefinition(category).directory}/${name}${ext}`,
  );
}

function readJsonArray(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  const value = readJson(file);
  return Array.isArray(value) ? value : [];
}

function readTargetJsonArray(workflowRoot: string, project: string, layout: ProjectLayout, fileName: string): unknown[] {
  const relative = dataRelative(layout, project, fileName);
  const file = getProjectFileForRead(workflowRoot, project, relative) || path.join(layout.dataDir, fileName);
  return readJsonArray(file);
}

function nextFreeIndex(entries: unknown[]): number {
  for (let id = 1; id < 100000; id += 1) if (!entries[id]) return id;
  throw new Error('No free id slot is available.');
}

/** "_2"/"_3" suffixing, matching the project's existing copy-name convention. */
function nextAvailableName(
  graph: RmmvAssetReferenceGraph,
  category: RmmvAssetCategory,
  baseName: string,
  claimed: Set<string>,
): string {
  const isTaken = (candidate: string): boolean =>
    claimed.has(candidate) || graph.assets.some((asset) => asset.category === category && asset.name === candidate);
  if (!isTaken(baseName)) return baseName;
  let suffix = 2;
  let candidate = `${baseName}_${suffix}`;
  while (isTaken(candidate)) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }
  return candidate;
}

function validateSource(sourceProjectPath: string, language?: ProductLanguage | null) {
  let validation;
  try {
    validation = validateRmmvProjectDirectory(sourceProjectPath);
  } catch (error) {
    throw new Error(externalImportSourceInvalid((error as Error).message, language));
  }
  const manifest = validation.manifest;
  if (manifest.encryptedImages || manifest.encryptedAudio || manifest.encryptedResources) {
    throw new Error(externalImportSourceEncrypted(validation.gameTitle || path.basename(validation.projectPath), language));
  }
  return validation;
}

/**
 * Validates an external project directory and lists its maps for the import
 * dialog. Encrypted or invalid projects surface a `blocked` reason instead of
 * throwing so the dialog can render a clear message.
 */
export function inspectExternalProjectForImport(
  sourceProjectPath: string,
  language?: ProductLanguage | null,
): Omit<ExternalProjectBrowseResult, 'canceled'> {
  let validation;
  try {
    validation = validateRmmvProjectDirectory(sourceProjectPath);
  } catch (error) {
    return {
      sourceProjectPath: path.resolve(sourceProjectPath),
      name: null,
      engine: null,
      maps: [],
      blocked: { reason: 'invalid', message: externalImportSourceInvalid((error as Error).message, language) },
    };
  }
  const manifest = validation.manifest;
  const name = validation.gameTitle || path.basename(validation.projectPath);
  if (manifest.encryptedImages || manifest.encryptedAudio || manifest.encryptedResources) {
    return {
      sourceProjectPath: validation.projectPath,
      name,
      engine: manifest.engine,
      maps: [],
      blocked: { reason: 'encrypted', message: externalImportSourceEncrypted(name, language) },
    };
  }
  const infos = readJsonArray(path.join(validation.dataDir, 'MapInfos.json'));
  const maps = infos
    .filter((info): info is Record<string, unknown> => isRecord(info) && Number.isInteger(Number(info.id)))
    .map((info) => ({
      id: Number(info.id),
      name: String(info.name || `Map${padMapId(Number(info.id))}`),
      parentId: Number(info.parentId || 0),
      order: Number(info.order || 0),
    }))
    .sort((left, right) => left.order - right.order || left.id - right.id);
  return { sourceProjectPath: validation.projectPath, name, engine: manifest.engine, maps };
}

function countUnmappedIds(map: Record<string, unknown>, includeEvents: boolean): number {
  if (!includeEvents) return 0;
  const events = Array.isArray(map.events) ? map.events : [];
  let count = 0;
  for (const event of events) {
    if (!isRecord(event) || !Array.isArray(event.pages)) continue;
    for (const page of event.pages) {
      if (!isRecord(page) || !Array.isArray(page.list)) continue;
      for (const command of page.list) {
        const code = isRecord(command) ? Number(command.code || 0) : 0;
        if (code === 201 || code === 202 || code === 117) count += 1;
      }
    }
  }
  return count;
}

function buildScan(
  workflowRoot: string,
  project: string,
  sourceProjectPath: string,
  sourceMapIds: number[],
  eventOptions: { eventsIncluded: boolean; validateEventResources: boolean },
  language?: ProductLanguage | null,
  replace?: { targetMapId: number },
): InternalScan {
  const validation = validateSource(sourceProjectPath, language);
  const srcLayout: ProjectLayout = {
    resourceRootRelative: validation.manifest.resourceRootRelative,
    dataDir: validation.dataDir,
  };
  const tgtLayout = projectLayout(project);
  const engine = validation.manifest.engine;
  const resolvedSource = validation.projectPath;

  const srcTilesets = readJsonArray(path.join(srcLayout.dataDir, 'Tilesets.json'));
  const srcMapInfos = readJsonArray(path.join(srcLayout.dataDir, 'MapInfos.json'));

  const resourceRows = new Map<string, InternalResourceRow>();
  const warnings: ExternalMapImportWarning[] = [];
  const srcMaps = new Map<number, Record<string, unknown>>();
  const distinctTilesetIds = new Set<number>();

  const addResourceRow = (
    category: RmmvAssetCategory,
    name: string,
    tilesetSourceId?: number,
  ): InternalResourceRow | null => {
    if (!name) return null;
    const key = `${category}:${name}`;
    const existing = resourceRows.get(key);
    if (existing) {
      if (tilesetSourceId != null && existing.tilesetSourceId == null) existing.tilesetSourceId = tilesetSourceId;
      return existing;
    }
    const definition = categoryDefinition(category);
    let sourceAbs: string | null = null;
    let sourceExt = '';
    for (const ext of definition.extensions) {
      const relative = assetRelative(srcLayout, category, name, ext);
      const absolute = path.join(resolvedSource, ...relative.split('/'));
      if (fs.existsSync(absolute)) {
        sourceAbs = absolute;
        sourceExt = ext;
        break;
      }
    }
    const sourceHash = sourceAbs ? sha256(fs.readFileSync(sourceAbs)) : null;
    let targetRel: string | null = null;
    let targetExt = '';
    for (const ext of definition.extensions) {
      const relative = assetRelative(tgtLayout, category, name, ext);
      if (getProjectFileForRead(workflowRoot, project, relative)) {
        targetRel = relative;
        targetExt = ext;
        break;
      }
    }
    const targetAbs = targetRel ? getProjectFileForRead(workflowRoot, project, targetRel) : null;
    const targetHash = targetAbs ? sha256(fs.readFileSync(targetAbs)) : null;
    const writeExt = sourceExt || targetExt || definition.extensions[0];
    let status: ExternalMapResourceStatus;
    let defaultAction: ExternalMapResourceAction;
    if (!targetRel) {
      status = 'missing';
      defaultAction = 'add';
    } else if (sourceHash && targetHash && sourceHash === targetHash) {
      status = 'same';
      defaultAction = 'ignore';
    } else {
      status = 'conflict';
      defaultAction = 'add';
    }
    const row: InternalResourceRow = {
      key,
      category,
      name,
      sourceRelativePath: assetRelative(srcLayout, category, name, sourceExt || writeExt),
      targetRelativePath: targetRel || assetRelative(tgtLayout, category, name, writeExt),
      sourceHash,
      targetHash,
      status,
      defaultAction,
      sourceMissing: !sourceAbs,
      tilesetSourceId,
      sourceAbs,
      sourceExt,
    };
    resourceRows.set(key, row);
    return row;
  };

  for (const mapId of sourceMapIds) {
    const file = path.join(srcLayout.dataDir, `Map${padMapId(mapId)}.json`);
    if (!fs.existsSync(file)) throw new Error(externalImportSourceMapMissing(mapId, language));
    const map = readJson(file);
    if (!isRecord(map)) throw new Error(externalImportSourceMapMissing(mapId, language));
    srcMaps.set(mapId, map);
    const tilesetId = Number(map.tilesetId) || 0;
    if (tilesetId > 0) distinctTilesetIds.add(tilesetId);
  }

  let unmappedCount = 0;
  for (const [, map] of srcMaps) {
    // When events are excluded, drop every event-derived reference (page images and
    // commands) so we never copy assets that only the discarded events would use.
    const mapForRefs = eventOptions.eventsIncluded ? map : { ...map, events: [] };
    const refs = collectMapAssetReferences(mapForRefs, {
      includeEventCommands: eventOptions.eventsIncluded && eventOptions.validateEventResources,
      includeAutoplayAudio: true,
    });
    for (const ref of refs) addResourceRow(ref.category, ref.name);
    unmappedCount += countUnmappedIds(map, eventOptions.eventsIncluded);
  }

  const tilesets: ExternalMapImportTilesetRow[] = [];
  for (const tilesetId of [...distinctTilesetIds].sort((a, b) => a - b)) {
    const source = srcTilesets[tilesetId];
    if (!isRecord(source)) {
      warnings.push({ code: 'source-tileset-missing', message: externalImportSourceTilesetMissing(tilesetId, language) });
      tilesets.push({ sourceTilesetId: tilesetId, name: `Tileset ${tilesetId}`, imageKeys: [], defaultAction: 'ignore' });
      continue;
    }
    const imageKeys: string[] = [];
    for (const imageName of collectMapTilesetImageNames(source)) {
      if (!imageName) continue;
      const row = addResourceRow('tilesets', imageName, tilesetId);
      if (row && !imageKeys.includes(row.key)) imageKeys.push(row.key);
    }
    tilesets.push({
      sourceTilesetId: tilesetId,
      name: String(source.name || `Tileset ${tilesetId}`),
      imageKeys,
      defaultAction: 'add',
    });
  }

  if (eventOptions.eventsIncluded && !eventOptions.validateEventResources) {
    warnings.push({ code: 'events-not-validated', message: externalImportEventsNotValidated(language) });
  }
  if (unmappedCount > 0) {
    warnings.push({ code: 'unmapped-ids', message: externalImportUnmappedReferences(unmappedCount, language) });
  }
  for (const row of resourceRows.values()) {
    if (row.sourceMissing) {
      warnings.push({ code: 'source-missing', message: externalImportResourceSourceMissing(row.sourceRelativePath, language) });
    }
  }

  const targetMapInfos = readTargetJsonArray(workflowRoot, project, tgtLayout, 'MapInfos.json');
  const idMap = new Map<number, number>();
  let replaceTarget: InternalScan['replaceTarget'];
  if (replace) {
    // Replace mode: reuse the target map's id (no reservation) and capture the
    // fields we must preserve from it.
    const [sourceMapId] = sourceMapIds;
    idMap.set(sourceMapId, replace.targetMapId);
    const targetFile = getProjectFileForRead(workflowRoot, project, mapRelative(tgtLayout, project, replace.targetMapId));
    const targetMap = targetFile ? readJson(targetFile) : null;
    if (!isRecord(targetMap)) throw new Error(externalReplaceTargetMapMissing(replace.targetMapId, language));
    const targetEvents = Array.isArray(targetMap.events) ? targetMap.events : [];
    replaceTarget = {
      width: Number(targetMap.width) || 0,
      height: Number(targetMap.height) || 0,
      displayName: typeof targetMap.displayName === 'string' ? targetMap.displayName : '',
      tilesetId: Number(targetMap.tilesetId) || 0,
      events: targetEvents,
    };
    // Keeping the target's events while the source map is smaller can leave events
    // outside the new bounds. Warn only; never auto-remove or move them.
    if (!eventOptions.eventsIncluded) {
      const srcMap = srcMaps.get(sourceMapId)!;
      const srcWidth = Number(srcMap.width) || 0;
      const srcHeight = Number(srcMap.height) || 0;
      let outOfBounds = 0;
      for (const event of targetEvents) {
        if (!isRecord(event)) continue;
        if ((Number(event.x) || 0) >= srcWidth || (Number(event.y) || 0) >= srcHeight) outOfBounds += 1;
      }
      if (outOfBounds > 0) {
        warnings.push({ code: 'out-of-bounds-events', message: externalReplaceOutOfBoundsEvents(outOfBounds, language) });
      }
    }
  } else {
    const reservation = targetMapInfos.slice();
    for (const mapId of sourceMapIds) {
      const newId = nextFreeIndex(reservation);
      idMap.set(mapId, newId);
      reservation[newId] = { id: newId };
    }
  }

  const maps: ExternalMapImportMapPreview[] = sourceMapIds.map((sourceMapId) => {
    const map = srcMaps.get(sourceMapId)!;
    const info = isRecord(srcMapInfos[sourceMapId]) ? (srcMapInfos[sourceMapId] as Record<string, unknown>) : {};
    return {
      sourceMapId,
      newMapId: idMap.get(sourceMapId)!,
      name: String(info.name || `Map${padMapId(sourceMapId)}`),
      parentId: 0,
      width: Number(map.width) || 0,
      height: Number(map.height) || 0,
      sourceTilesetId: Number(map.tilesetId) || 0,
    };
  });

  return {
    engine,
    maps,
    resources: [...resourceRows.values()],
    tilesets,
    warnings,
    srcMaps,
    srcTilesets,
    srcMapInfos,
    targetMapInfos,
    idMap,
    srcLayout,
    tgtLayout,
    sourceProjectPath: resolvedSource,
    replaceTarget,
  };
}

function toResourceRow(row: InternalResourceRow): ExternalMapImportResourceRow {
  return {
    key: row.key,
    category: row.category,
    name: row.name,
    sourceRelativePath: row.sourceRelativePath,
    targetRelativePath: row.targetRelativePath,
    sourceHash: row.sourceHash,
    targetHash: row.targetHash,
    status: row.status,
    defaultAction: row.defaultAction,
    sourceMissing: row.sourceMissing,
    ...(row.tilesetSourceId != null ? { tilesetSourceId: row.tilesetSourceId } : {}),
    ...(row.risk ? { risk: row.risk } : {}),
  };
}

export function scanExternalMapImport(
  workflowRoot: string,
  project: string,
  request: ExternalMapImportScanRequest,
  language?: ProductLanguage | null,
): ExternalMapImportScanResult {
  const { sourceProjectPath, sourceMapIds, options } = request;
  if (!Array.isArray(sourceMapIds) || sourceMapIds.length === 0) throw new Error(externalImportNoMaps(language));
  const scan = buildScan(
    workflowRoot,
    project,
    sourceProjectPath,
    sourceMapIds,
    { eventsIncluded: options.includeEvents, validateEventResources: options.validateEventResources },
    language,
  );
  return {
    sourceProjectPath: scan.sourceProjectPath,
    engine: scan.engine,
    maps: scan.maps,
    resources: scan.resources.map(toResourceRow),
    tilesets: scan.tilesets,
    warnings: scan.warnings,
  };
}

function nextMapOrder(infos: unknown[], parentId: number): number {
  const orders = infos
    .filter(isRecord)
    .filter((info) => Number(info.parentId || 0) === parentId)
    .map((info) => Number(info.order) || 0);
  return Math.max(0, ...orders) + 1;
}

function resolveParentId(sourceMapId: number, srcInfos: unknown[], idMap: Map<number, number>, anchorParentId: number): number {
  const info = srcInfos[sourceMapId];
  const sourceParent = isRecord(info) ? Number(info.parentId || 0) : 0;
  if (!sourceParent) return anchorParentId;
  const mapped = idMap.get(sourceParent);
  return mapped == null ? anchorParentId : mapped;
}

function renameLookup(renames: Map<string, string>, category: RmmvAssetCategory, name: unknown): string {
  if (typeof name !== 'string' || !name) return typeof name === 'string' ? name : '';
  return renames.get(`${category}:${name}`) ?? name;
}

function rewriteCommandList(list: unknown, renames: Map<string, string>): void {
  if (!Array.isArray(list)) return;
  for (const command of list) {
    if (!isRecord(command)) continue;
    const params = Array.isArray(command.parameters) ? command.parameters : [];
    const code = Number(command.code || 0);
    const setName = (category: RmmvAssetCategory, index: number): void => {
      if (typeof params[index] === 'string') params[index] = renameLookup(renames, category, params[index]);
    };
    const setAudio = (category: RmmvAssetCategory, index: number): void => {
      if (isRecord(params[index])) (params[index] as Record<string, unknown>).name = renameLookup(renames, category, (params[index] as Record<string, unknown>).name);
    };
    switch (code) {
      case 101: setName('faces', 0); break;
      case 132: setAudio('bgm', 0); break;
      case 133:
      case 139: setAudio('me', 0); break;
      case 205: {
        const route = params[1];
        if (isRecord(route) && Array.isArray(route.list)) {
          for (const routeCommand of route.list) {
            if (!isRecord(routeCommand)) continue;
            const routeParams = Array.isArray(routeCommand.parameters) ? routeCommand.parameters : [];
            const routeCode = Number(routeCommand.code || 0);
            if (routeCode === 41 && typeof routeParams[0] === 'string') routeParams[0] = renameLookup(renames, 'characters', routeParams[0]);
            if (routeCode === 44 && isRecord(routeParams[0])) (routeParams[0] as Record<string, unknown>).name = renameLookup(renames, 'se', (routeParams[0] as Record<string, unknown>).name);
          }
        }
        break;
      }
      case 231: setName('pictures', 1); break;
      case 241: setAudio('bgm', 0); break;
      case 245: setAudio('bgs', 0); break;
      case 249: setAudio('me', 0); break;
      case 250: setAudio('se', 0); break;
      case 261: setName('movies', 0); break;
      case 283: setName('battlebacks1', 0); setName('battlebacks2', 1); break;
      case 284: setName('parallaxes', 0); break;
      case 322: setName('characters', 1); setName('faces', 3); setName('svActors', 5); break;
      case 323: setName('characters', 1); break;
      default: break;
    }
  }
}

function rewriteMapReferences(map: Record<string, unknown>, renames: Map<string, string>, includeEventCommands: boolean): void {
  if (renames.size === 0) return;
  if (typeof map.parallaxName === 'string') map.parallaxName = renameLookup(renames, 'parallaxes', map.parallaxName);
  if (typeof map.battleback1Name === 'string') map.battleback1Name = renameLookup(renames, 'battlebacks1', map.battleback1Name);
  if (typeof map.battleback2Name === 'string') map.battleback2Name = renameLookup(renames, 'battlebacks2', map.battleback2Name);
  if (isRecord(map.bgm)) map.bgm.name = renameLookup(renames, 'bgm', map.bgm.name);
  if (isRecord(map.bgs)) map.bgs.name = renameLookup(renames, 'bgs', map.bgs.name);
  const events = Array.isArray(map.events) ? map.events : [];
  for (const event of events) {
    if (!isRecord(event) || !Array.isArray(event.pages)) continue;
    for (const page of event.pages) {
      if (!isRecord(page)) continue;
      if (isRecord(page.image)) page.image.characterName = renameLookup(renames, 'characters', page.image.characterName);
      if (includeEventCommands) rewriteCommandList(page.list, renames);
    }
  }
}

interface StagedResourcesAndTilesets {
  renames: Map<string, string>;
  finalNameByKey: Map<string, string>;
  targetTilesetIdBySource: Map<number, number>;
  tilesetsOut: unknown[];
}

/**
 * Shared staging step for both import and replace: resolves tileset actions,
 * copies resource buffers into staging (renaming `add` collisions with the
 * `_2`/`_3` convention) and materializes tileset configs. Returns the rename
 * map plus the source→target tileset id remapping so the caller can rewrite the
 * map bodies it writes.
 *
 * `ignoreTilesetFallback` is only supplied in replace mode: an `ignore` tileset
 * then reuses the target map's existing tilesetId instead of requiring a
 * selection (import mode still requires an explicit target for ignore).
 */
function stageResourcesAndTilesets(
  workflowRoot: string,
  project: string,
  scan: InternalScan,
  resources: ExternalMapResourceResolution[] | undefined,
  tilesets: ExternalMapTilesetResolution[] | undefined,
  language?: ProductLanguage | null,
  ignoreTilesetFallback?: number,
): StagedResourcesAndTilesets {
  const resourceActionByKey = new Map((resources || []).map((entry) => [entry.key, entry.action]));
  const tilesetResolutionBySource = new Map((tilesets || []).map((entry) => [entry.sourceTilesetId, entry]));
  const targetGraph = getProjectAssetReferenceGraph(workflowRoot, project);
  const tilesetsOut = readTargetJsonArray(workflowRoot, project, scan.tgtLayout, 'Tilesets.json').slice();

  // Resolve tileset actions first: image rows depend on their owning tileset.
  const tilesetActionBySource = new Map<number, ExternalMapResourceAction>();
  const targetTilesetIdBySource = new Map<number, number>();
  for (const row of scan.tilesets) {
    const resolution = tilesetResolutionBySource.get(row.sourceTilesetId);
    const action = resolution?.action || row.defaultAction;
    tilesetActionBySource.set(row.sourceTilesetId, action);
    if (action === 'overwrite') {
      if (resolution?.targetTilesetId == null) {
        throw new Error(externalImportTilesetTargetRequired(row.sourceTilesetId, language));
      }
      targetTilesetIdBySource.set(row.sourceTilesetId, resolution.targetTilesetId);
    } else if (action === 'ignore') {
      if (resolution?.targetTilesetId != null) {
        targetTilesetIdBySource.set(row.sourceTilesetId, resolution.targetTilesetId);
      } else if (ignoreTilesetFallback != null) {
        targetTilesetIdBySource.set(row.sourceTilesetId, ignoreTilesetFallback);
      } else {
        throw new Error(externalImportTilesetTargetRequired(row.sourceTilesetId, language));
      }
    }
  }

  // Copy resources and build the rename map for "add" collisions.
  const claimedByCategory = new Map<RmmvAssetCategory, Set<string>>();
  const finalNameByKey = new Map<string, string>();
  const renames = new Map<string, string>();
  const claimSet = (category: RmmvAssetCategory): Set<string> => {
    let set = claimedByCategory.get(category);
    if (!set) {
      set = new Set();
      claimedByCategory.set(category, set);
    }
    return set;
  };

  for (const row of scan.resources) {
    if (row.tilesetSourceId != null && tilesetActionBySource.get(row.tilesetSourceId) === 'ignore') continue;
    if (row.sourceMissing || !row.sourceAbs) {
      finalNameByKey.set(row.key, row.name);
      continue;
    }
    const action = resourceActionByKey.get(row.key) || row.defaultAction;
    let finalName = row.name;
    if (action === 'add') {
      if (row.status !== 'missing') finalName = nextAvailableName(targetGraph, row.category, row.name, claimSet(row.category));
      claimSet(row.category).add(finalName);
      if (finalName !== row.name) renames.set(`${row.category}:${row.name}`, finalName);
    }
    finalNameByKey.set(row.key, finalName);
    if (action === 'add' || action === 'overwrite') {
      const buffer = fs.readFileSync(row.sourceAbs);
      const relative = action === 'overwrite'
        ? row.targetRelativePath
        : assetRelative(scan.tgtLayout, row.category, finalName, row.sourceExt);
      writeStagedProjectBuffer(workflowRoot, project, relative, buffer);
    }
  }

  // Materialize tileset configs with renamed image slots.
  const tilesetImageFinalName = (imageName: string): string => {
    if (!imageName) return imageName;
    return finalNameByKey.get(`tilesets:${imageName}`) ?? imageName;
  };
  for (const row of scan.tilesets) {
    const action = tilesetActionBySource.get(row.sourceTilesetId)!;
    if (action === 'ignore') continue;
    const source = scan.srcTilesets[row.sourceTilesetId];
    if (!isRecord(source)) continue;
    const tilesetNames = collectMapTilesetImageNames(source).map((name) => (name ? tilesetImageFinalName(name) : ''));
    if (action === 'add') {
      const newId = nextFreeIndex(tilesetsOut);
      tilesetsOut[newId] = { ...source, id: newId, tilesetNames };
      targetTilesetIdBySource.set(row.sourceTilesetId, newId);
    } else {
      const targetId = targetTilesetIdBySource.get(row.sourceTilesetId)!;
      tilesetsOut[targetId] = { ...source, id: targetId, tilesetNames };
    }
  }

  return { renames, finalNameByKey, targetTilesetIdBySource, tilesetsOut };
}

export function applyExternalMapImport(
  workflowRoot: string,
  project: string,
  request: ExternalMapImportApplyRequest,
  language?: ProductLanguage | null,
): ExternalMapImportApplyResult {
  const { sourceProjectPath, sourceMapIds, anchorParentId, options, resources, tilesets } = request;
  if (!Array.isArray(sourceMapIds) || sourceMapIds.length === 0) throw new Error(externalImportNoMaps(language));

  const scan = buildScan(
    workflowRoot,
    project,
    sourceProjectPath,
    sourceMapIds,
    { eventsIncluded: options.includeEvents, validateEventResources: options.validateEventResources },
    language,
  );
  const warnings = [...scan.warnings];
  const { renames, targetTilesetIdBySource, tilesetsOut } = stageResourcesAndTilesets(
    workflowRoot,
    project,
    scan,
    resources,
    tilesets,
    language,
  );

  // Write maps + MapInfos.
  const mapInfosOut = scan.targetMapInfos.slice();
  const mapIds: number[] = [];
  const includeEventCommands = options.includeEvents && options.validateEventResources;
  for (const sourceMapId of sourceMapIds) {
    const newMapId = scan.idMap.get(sourceMapId)!;
    const map = JSON.parse(JSON.stringify(scan.srcMaps.get(sourceMapId))) as Record<string, unknown>;
    const sourceTilesetId = Number(map.tilesetId) || 0;
    if (targetTilesetIdBySource.has(sourceTilesetId)) map.tilesetId = targetTilesetIdBySource.get(sourceTilesetId);
    if (!options.includeEvents) map.events = [null];
    rewriteMapReferences(map, renames, includeEventCommands);
    writeStagedProjectJson(workflowRoot, project, mapRelative(scan.tgtLayout, project, newMapId), map);
    const sourceInfo = isRecord(scan.srcMapInfos[sourceMapId]) ? (scan.srcMapInfos[sourceMapId] as Record<string, unknown>) : {};
    const parentId = resolveParentId(sourceMapId, scan.srcMapInfos, scan.idMap, anchorParentId);
    mapInfosOut[newMapId] = {
      id: newMapId,
      name: String(sourceInfo.name || `Map${padMapId(sourceMapId)}`),
      parentId,
      order: nextMapOrder(mapInfosOut, parentId),
      expanded: false,
      scrollX: 0,
      scrollY: 0,
    };
    mapIds.push(newMapId);
  }

  writeStagedProjectJson(workflowRoot, project, dataRelative(scan.tgtLayout, project, 'MapInfos.json'), mapInfosOut);
  writeStagedProjectJson(workflowRoot, project, dataRelative(scan.tgtLayout, project, 'Tilesets.json'), tilesetsOut);

  return { mapIds, warnings, staging: getProjectStagingStatus(workflowRoot, project) };
}

export function scanExternalMapReplace(
  workflowRoot: string,
  project: string,
  request: ExternalMapReplaceScanRequest,
  language?: ProductLanguage | null,
): ExternalMapImportScanResult {
  const { sourceProjectPath, sourceMapId, targetMapId, options } = request;
  const scan = buildScan(
    workflowRoot,
    project,
    sourceProjectPath,
    [sourceMapId],
    { eventsIncluded: options.overwriteEvents, validateEventResources: options.validateEventResources },
    language,
    { targetMapId },
  );
  return {
    sourceProjectPath: scan.sourceProjectPath,
    engine: scan.engine,
    maps: scan.maps,
    resources: scan.resources.map(toResourceRow),
    tilesets: scan.tilesets,
    warnings: scan.warnings,
  };
}

export function applyExternalMapReplace(
  workflowRoot: string,
  project: string,
  request: ExternalMapReplaceApplyRequest,
  language?: ProductLanguage | null,
): ExternalMapImportApplyResult {
  const { sourceProjectPath, sourceMapId, targetMapId, options, resources, tilesets } = request;
  const scan = buildScan(
    workflowRoot,
    project,
    sourceProjectPath,
    [sourceMapId],
    { eventsIncluded: options.overwriteEvents, validateEventResources: options.validateEventResources },
    language,
    { targetMapId },
  );
  const target = scan.replaceTarget;
  if (!target) throw new Error(externalReplaceTargetMapMissing(targetMapId, language));
  const warnings = [...scan.warnings];
  const { renames, targetTilesetIdBySource, tilesetsOut } = stageResourcesAndTilesets(
    workflowRoot,
    project,
    scan,
    resources,
    tilesets,
    language,
    target.tilesetId,
  );

  // Build the replacement body from the source map, then restore the fields the
  // target must keep. MapInfos is left untouched so id/name/tree position stay.
  const map = JSON.parse(JSON.stringify(scan.srcMaps.get(sourceMapId))) as Record<string, unknown>;
  map.displayName = target.displayName;
  if (!options.overwriteEvents) map.events = target.events;
  const sourceTilesetId = Number(map.tilesetId) || 0;
  if (targetTilesetIdBySource.has(sourceTilesetId)) map.tilesetId = targetTilesetIdBySource.get(sourceTilesetId);
  const includeEventCommands = options.overwriteEvents && options.validateEventResources;
  rewriteMapReferences(map, renames, includeEventCommands);

  writeStagedProjectJson(workflowRoot, project, mapRelative(scan.tgtLayout, project, targetMapId), map);
  writeStagedProjectJson(workflowRoot, project, dataRelative(scan.tgtLayout, project, 'Tilesets.json'), tilesetsOut);

  return { mapIds: [targetMapId], warnings, staging: getProjectStagingStatus(workflowRoot, project) };
}
