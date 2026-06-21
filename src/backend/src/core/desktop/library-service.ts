import fs from 'node:fs';
import path from 'node:path';

import { MapSelectionDao } from '../db/dao/map-selection-dao.ts';
import { readJson } from '../rmmv/json.ts';
import { resolveLocalSourcePath } from './local-assets-service.ts';
import {
  mapLibraryAssetNotFound,
  mapLibraryEntryUnreadable,
  mapLibraryJsonMissing,
  mapLibrarySelectionDownstreamNote,
  mapLibrarySourceProjectMissing,
  mapVisualLibraryIndexNotFound,
} from './libraryServiceLocalization.ts';
import {
  mapLibraryIndexPath as resolveMapLibraryIndexPath,
  resolveMapLibraryFilePath,
} from './map-library-paths.ts';
import { resolveMapLibraryPackage } from './map-library-package.ts';
import { isInside } from './staging-service.ts';

const SELECTION_PROJECT_ID = 'default';

export function mapLibraryIndexPath(workflowRoot: string): string {
  return resolveMapLibraryIndexPath(workflowRoot);
}

export function getMapLibraryEntry(workflowRoot: string, assetIdValue: string): Record<string, any> {
  const indexPath = mapLibraryIndexPath(workflowRoot);
  if (!fs.existsSync(indexPath)) throw new Error(mapVisualLibraryIndexNotFound());
  const assetId = String(assetIdValue || '');
  const index = readJson(indexPath) as { entries?: Record<string, any>[] };
  const entries = index.entries || [];
  const entry = entries.find((item) => item?.assetId === assetId);
  if (entry) return entry;

  // Fallback for asset IDs shaped as <package>-map<NNN>-<hash>. The trailing
  // hash can change when the index is rebuilt, so match by stable prefix.
  const prefixMatch = assetId.match(/^(.+-map\d+-)/);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    const fallback = entries.find((item) => typeof item?.assetId === 'string' && item.assetId.startsWith(prefix));
    if (fallback) return fallback;
  }

  throw new Error(mapLibraryAssetNotFound(assetId));
}

export function findMapLibraryScreenshot(workflowRoot: string, assetIdValue: string): string | null {
  const indexPath = mapLibraryIndexPath(workflowRoot);
  const libraryRoot = path.dirname(indexPath);
  if (!assetIdValue || !fs.existsSync(indexPath)) return null;
  const entry = getMapLibraryEntry(workflowRoot, assetIdValue);
  const relative = Array.isArray(entry.screenshots) ? entry.screenshots[0] : null;
  const filePath = relative ? resolveMapLibraryFilePath(workflowRoot, String(relative)) : null;
  if (!filePath || !isInside(libraryRoot, filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return null;
  return filePath;
}

export function listMapLibrary(workflowRoot: string) {
  const indexPath = mapLibraryIndexPath(workflowRoot);
  if (!fs.existsSync(indexPath)) return { totalEntries: 0, entries: [] };
  const index = readJson(indexPath) as { entries?: Record<string, any>[] };
  const all = (index.entries || []).filter(Boolean);
  const entries = all
    .filter((entry) => Array.isArray(entry.screenshots) && entry.screenshots.length)
    .filter((entry) => !entry.license || entry.license.usable !== false)
    .map((entry) => {
      const pkg = resolveMapLibraryPackage(entry);
      return {
        assetId: entry.assetId,
        title: entry.title || entry.assetId,
        engine: entry.engine || '',
        map: entry.map || null,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        license: entry.license || {},
        knownIssues: Array.isArray(entry.knownIssues) ? entry.knownIssues : [],
        dependencies: summarizeDependencies(entry.dependencies),
        source: { name: entry.source?.name || '' },
        packageId: pkg.packageId,
        packageLabel: pkg.packageLabel,
        screenshotUrl: libraryScreenshotUrl(entry.assetId),
      };
    });
  return { totalEntries: all.length, entries };
}

export function getMapLibrarySelection(): Record<string, unknown> | null {
  return MapSelectionDao.getLatest(SELECTION_PROJECT_ID)?.selection || null;
}

export function writeMapLibrarySelection(workflowRoot: string, body: Record<string, any>) {
  const entry = getMapLibraryEntry(workflowRoot, String(body.assetId || ''));
  const candidates = Array.isArray(body.candidates)
    ? body.candidates.slice(0, 8).map((item: Record<string, any>) => ({
      assetId: String(item.assetId || ''),
      title: String(item.title || item.assetId || ''),
      size: String(item.size || ''),
      width: Number(item.width || 0),
      height: Number(item.height || 0),
      tilesetId: item.tilesetId == null ? null : Number(item.tilesetId),
      tilesetName: String(item.tilesetName || ''),
      role: String(item.role || ''),
      entryDirection: String(item.entryDirection || ''),
      humanGoal: String(item.humanGoal || ''),
      humanNote: String(item.humanNote || ''),
    })).filter((item: { assetId: string }) => item.assetId)
    : [];
  const record = {
    schemaVersion: 2,
    selectedAt: new Date().toISOString(),
    selectedBy: 'human-agent-console',
    assetId: entry.assetId,
    title: entry.title || entry.assetId,
    engine: entry.engine || '',
    map: entry.map || null,
    source: entry.source || {},
    license: entry.license || {},
    mapFiles: Array.isArray(entry.mapFiles) ? entry.mapFiles : [],
    screenshots: Array.isArray(entry.screenshots) ? entry.screenshots : [],
    dependencies: entry.dependencies || {},
    knownIssues: Array.isArray(entry.knownIssues) ? entry.knownIssues : [],
    importedMapId: Number.isInteger(body.importedMapId) ? body.importedMapId : null,
    targetParent: body.parentMapId == null ? null : { mapId: Number(body.parentMapId) || 0, name: String(body.parentMapName || '').trim() },
    workflowAction: String(body.workflowAction || 'select').trim() || 'select',
    role: String(body.role || '').trim(),
    humanGoal: String(body.humanGoal || '').trim(),
    entryDirection: String(body.entryDirection || '').trim(),
    humanNote: String(body.note || '').trim(),
    candidates,
    requiredOutputs: Array.isArray(body.requiredOutputs) ? body.requiredOutputs.map(String).map((item: string) => item.trim()).filter(Boolean) : [],
    downstream: mapLibrarySelectionDownstreamNote(),
  };
  MapSelectionDao.create(SELECTION_PROJECT_ID, record);
  return record;
}

export function libraryScreenshotUrl(assetId: string): string {
  return `rmmv-asset://library/screenshot/${encodeURIComponent(assetId)}`;
}

export interface MapLibraryPackageValidation {
  ok: boolean;
  issues: Array<{ assetId: string; title: string; message: string }>;
  sourceProjectReachable: boolean;
  sourceProjectPath: string | null;
}

/** Checks whether package map files and local source assets are reachable before batch import. */
export function validateMapLibraryPackage(workflowRoot: string, assetIds: string[]): MapLibraryPackageValidation {
  const issues: MapLibraryPackageValidation['issues'] = [];
  let resolvedProjectPath: string | null = null;
  let sourceProjectReachable = false;

  for (const assetId of assetIds) {
    try {
      const entry = getMapLibraryEntry(workflowRoot, assetId);
      const title = String(entry.title || assetId);
      if (!libraryEntryMapFileExists(workflowRoot, entry)) {
        issues.push({ assetId, title, message: mapLibraryJsonMissing() });
      }
      const localPath = resolveLocalSourcePath(workflowRoot, entry);
      if (localPath && !resolvedProjectPath) resolvedProjectPath = localPath;
      if (localPath && fs.existsSync(localPath)) sourceProjectReachable = true;
      if (!localPath) {
        issues.push({ assetId, title, message: mapLibrarySourceProjectMissing() });
      }
    } catch (error) {
      issues.push({
        assetId,
        title: assetId,
        message: (error as Error).message || mapLibraryEntryUnreadable(),
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    sourceProjectReachable,
    sourceProjectPath: resolvedProjectPath,
  };
}

function libraryEntryMapFileExists(workflowRoot: string, entry: Record<string, unknown>): boolean {
  const value = Array.isArray(entry.mapFiles) ? entry.mapFiles[0] : null;
  const file = value ? resolveMapLibraryFilePath(workflowRoot, String(value)) : '';
  const libraryRoot = path.dirname(mapLibraryIndexPath(workflowRoot));
  return Boolean(file && isInside(libraryRoot, file) && fs.existsSync(file));
}

function summarizeDependencies(dependencies: Record<string, unknown> | undefined) {
  const value = dependencies || {};
  const count = (key: string) => Array.isArray(value[key]) ? value[key].length : 0;
  return {
    tilesets: count('tilesets'),
    tilesetImages: count('tilesetImages'),
    parallaxes: count('parallaxes'),
    plugins: count('plugins'),
    characters: count('characters'),
    audio: count('audio'),
  };
}
