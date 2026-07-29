import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Fuse from 'fuse.js';

import type {
  GlobalSearchCategory,
  GlobalSearchDocument,
  GlobalSearchHit,
  GlobalSearchIndexState,
  GlobalSearchMatchPrecision,
  GlobalSearchOptions,
  GlobalSearchResult,
} from '../../../../contract/types.ts';
import { readJson } from '../rmmv/json.ts';
import {
  dataRelativePath,
  RMMV_ASSET_BUCKETS,
  resolveRmmvLayout,
  resourceRelativePath,
} from '../rmmv/rmmv-layout.ts';
import { listAssetAnnotations } from './asset-annotation-service.ts';
import { buildMapIndex, listEditorMapNotes } from './map-service.ts';
import { extractDefaultPluginHeaderBody } from './plugin-header-metadata.ts';
import { lunaRpgDirPath, readProjectConfig } from './project-config-service.ts';
import { getMapFileForRead, getProjectFileForRead } from './staging-service.ts';

const SEARCH_INDEX_FILE = 'search-index.json';
const SEARCH_INDEX_VERSION = 1;
const MAX_DOCUMENT_TEXT = 4000;
const MAX_EXTRA_FOLDER_FILES = 5000;
const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_CAP = 1000;

/** Fuzzy match tightness thresholds; lower = closer matches only. */
export const MATCH_PRECISION_THRESHOLDS: Record<GlobalSearchMatchPrecision, number> = {
  loose: 0.35,
  medium: 0.22,
  strict: 0.12,
};
export const DEFAULT_MATCH_PRECISION: GlobalSearchMatchPrecision = 'loose';

/** Database JSON files whose rows join the `database` category (id + name + note-ish fields). */
const SEARCHABLE_DATABASE_FILES = [
  'Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors',
  'Enemies', 'Troops', 'States', 'Animations', 'Tilesets',
] as const;

/** Asset buckets whose files join the `file` category (plugins have their own category). */
const FILE_BUCKET_IDS = Object.keys(RMMV_ASSET_BUCKETS)
  .filter((bucket) => bucket !== 'plugins') as Array<keyof typeof RMMV_ASSET_BUCKETS>;

interface SearchIndexCacheEntry {
  revision: string;
  documents: GlobalSearchDocument[];
  fuse: Fuse<GlobalSearchDocument>;
  /** Lazily built Fuse instances for non-default thresholds (precision buckets). */
  fuseByThreshold?: Map<number, Fuse<GlobalSearchDocument>>;
  builtAt: number;
  buildMs: number;
}

interface PersistedSearchIndex {
  version: number;
  revision: string;
  builtAt: number;
  buildMs: number;
  documents: GlobalSearchDocument[];
}

const indexCache = new Map<string, SearchIndexCacheEntry>();
const buildPromises = new Map<string, Promise<SearchIndexCacheEntry>>();

function cacheKey(project: string): string {
  return path.resolve(project).toLowerCase();
}

function searchIndexFilePath(project: string): string {
  return path.join(lunaRpgDirPath(project), SEARCH_INDEX_FILE);
}

function createFuse(
  documents: GlobalSearchDocument[],
  threshold: number = MATCH_PRECISION_THRESHOLDS.loose,
): Fuse<GlobalSearchDocument> {
  return new Fuse(documents, {
    keys: [
      { name: 'title', weight: 0.6 },
      { name: 'text', weight: 0.3 },
      { name: 'context', weight: 0.1 },
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold,
    minMatchCharLength: 1,
  });
}

/** Resolve an extra index folder to an absolute root. Absolute entries index outside the
 * project (user opt-in); relative entries stay project-anchored by their `/`-split segments. */
function resolveExtraFolderRoot(project: string, folder: string): string {
  return path.isAbsolute(folder)
    ? path.normalize(folder)
    : path.join(path.resolve(project), ...folder.split('/'));
}

/** Cheap change fingerprint: data/plugin file mtimes + asset directory mtimes + sidecars. */
export function computeGlobalSearchRevision(project: string): string {
  const layout = resolveRmmvLayout(project);
  const parts: string[] = [`v${SEARCH_INDEX_VERSION}`];
  const pushDirEntries = (absolute: string): void => {
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const stat = fs.statSync(path.join(absolute, entry.name));
      parts.push(`${entry.name}:${stat.mtimeMs}:${stat.size}`);
    }
  };
  const pushDirStat = (absolute: string): void => {
    if (!fs.existsSync(absolute)) return;
    parts.push(`${absolute}:${fs.statSync(absolute).mtimeMs}`);
  };
  pushDirEntries(layout.dataDir);
  pushDirEntries(path.join(layout.resourceRoot, 'js', 'plugins'));
  const pluginsJs = path.join(layout.resourceRoot, 'js', 'plugins.js');
  if (fs.existsSync(pluginsJs)) parts.push(`plugins.js:${fs.statSync(pluginsJs).mtimeMs}`);
  for (const bucket of FILE_BUCKET_IDS) {
    pushDirStat(path.join(layout.resourceRoot, ...RMMV_ASSET_BUCKETS[bucket].directory.split('/')));
  }
  const config = readProjectConfig(project);
  for (const folder of config.search?.extraFolders || []) {
    parts.push(`extra:${folder}`);
    pushDirStat(resolveExtraFolderRoot(project, folder));
  }
  const notesFile = path.join(lunaRpgDirPath(project), 'map-notes.json');
  if (fs.existsSync(notesFile)) parts.push(`map-notes:${fs.statSync(notesFile).mtimeMs}`);
  const annotationTargets = listAssetAnnotations(project);
  parts.push(`annotations:${annotationTargets.length}`);
  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
}

function clipText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_DOCUMENT_TEXT
    ? normalized.slice(0, MAX_DOCUMENT_TEXT)
    : normalized;
}

function collectCommandText(list: unknown): string[] {
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
    if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(list);
  return values;
}

function readProjectJson(workflowRoot: string, project: string, relativePath: string): unknown {
  const file = getProjectFileForRead(workflowRoot, project, relativePath);
  if (!file || !fs.existsSync(file)) return null;
  return readJson(file);
}

/** Walk one directory tree collecting project-relative file paths (bounded). */
function walkFiles(
  absoluteRoot: string,
  relativeRoot: string,
  sink: Array<{ relativePath: string; fileName: string }>,
  depth = 0,
): void {
  if (depth > 4 || sink.length >= MAX_EXTRA_FOLDER_FILES) return;
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) return;
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (sink.length >= MAX_EXTRA_FOLDER_FILES) return;
    const relative = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      walkFiles(path.join(absoluteRoot, entry.name), relative, sink, depth + 1);
      continue;
    }
    if (entry.isFile()) sink.push({ relativePath: relative, fileName: entry.name });
  }
}

/** Build all searchable documents for the six categories. */
export function buildGlobalSearchDocuments(
  workflowRoot: string,
  project: string,
): GlobalSearchDocument[] {
  const layout = resolveRmmvLayout(project);
  const projectRoot = path.resolve(project);
  const documents: GlobalSearchDocument[] = [];
  const config = readProjectConfig(project);

  // --- file: asset bucket files (+ notes from asset annotations) + extra folders ---
  const annotationNotes = new Map<string, string>();
  for (const annotation of listAssetAnnotations(project)) {
    if (annotation.note) annotationNotes.set(annotation.targetId, annotation.note);
  }
  for (const bucket of FILE_BUCKET_IDS) {
    const directory = RMMV_ASSET_BUCKETS[bucket].directory;
    const relativeDirectory = resourceRelativePath(layout, directory);
    const files: Array<{ relativePath: string; fileName: string }> = [];
    walkFiles(path.join(projectRoot, ...relativeDirectory.split('/')), relativeDirectory, files);
    for (const file of files) {
      const insideBucket = file.relativePath.slice(relativeDirectory.length + 1);
      const extension = path.extname(insideBucket);
      const assetName = extension ? insideBucket.slice(0, -extension.length) : insideBucket;
      const note = annotationNotes.get(`${bucket}:${assetName}`) || '';
      documents.push({
        id: `file:${file.relativePath}`,
        category: 'file',
        title: file.fileName,
        text: clipText(`${assetName} ${note}`),
        context: file.relativePath,
        relativePath: file.relativePath,
        assetCategoryId: bucket,
        assetName,
      });
    }
  }
  for (const folder of config.search?.extraFolders || []) {
    const files: Array<{ relativePath: string; fileName: string }> = [];
    walkFiles(resolveExtraFolderRoot(project, folder), folder, files);
    for (const file of files) {
      documents.push({
        id: `file:${file.relativePath}`,
        category: 'file',
        title: file.fileName,
        text: clipText(file.relativePath),
        context: file.relativePath,
        relativePath: file.relativePath,
      });
    }
  }

  // --- map + event: one pass over every map file ---
  const editorNotes = listEditorMapNotes(project).maps;
  const mapIndex = buildMapIndex(workflowRoot, project);
  for (const mapInfo of mapIndex.maps) {
    const editorNote = editorNotes[String(mapInfo.id)]?.note || '';
    const mapFile = getMapFileForRead(workflowRoot, project, mapInfo.id);
    const map = mapInfo.mapFileExists && mapFile && fs.existsSync(mapFile)
      ? readJson(mapFile) as Record<string, unknown>
      : null;
    const displayName = map ? String(map.displayName || '') : '';
    const mapNote = map ? String(map.note || '') : '';
    documents.push({
      id: `map:${mapInfo.id}`,
      category: 'map',
      title: mapInfo.name,
      text: clipText([displayName, mapNote, editorNote].filter(Boolean).join(' ')),
      context: `Map${String(mapInfo.id).padStart(3, '0')}`,
      mapId: mapInfo.id,
    });
    if (!map) continue;
    for (const rawEvent of Array.isArray(map.events) ? map.events : []) {
      if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) continue;
      const event = rawEvent as Record<string, unknown>;
      const eventId = Number(event.id);
      if (!Number.isInteger(eventId) || eventId <= 0) continue;
      const eventName = String(event.name || `EV${String(eventId).padStart(3, '0')}`);
      const texts: string[] = [];
      const note = String(event.note || '');
      if (note) texts.push(note);
      for (const rawPage of Array.isArray(event.pages) ? event.pages : []) {
        if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) continue;
        texts.push(...collectCommandText((rawPage as Record<string, unknown>).list));
      }
      documents.push({
        id: `event:${mapInfo.id}:${eventId}`,
        category: 'event',
        title: eventName,
        text: clipText(texts.join(' · ')),
        context: mapInfo.name,
        mapId: mapInfo.id,
        eventId,
      });
    }
  }

  // --- event: common events ---
  const commonEvents = readProjectJson(workflowRoot, project, dataRelativePath(layout, 'CommonEvents.json'));
  for (const rawEvent of Array.isArray(commonEvents) ? commonEvents : []) {
    if (!rawEvent || typeof rawEvent !== 'object') continue;
    const event = rawEvent as Record<string, unknown>;
    const id = Number(event.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    documents.push({
      id: `commonEvent:${id}`,
      category: 'event',
      title: String(event.name || `#${id}`),
      text: clipText(collectCommandText(event.list).join(' · ')),
      context: 'CommonEvents',
      commonEventId: id,
    });
  }

  // --- database: standard DB rows + switches/variables ---
  for (const group of SEARCHABLE_DATABASE_FILES) {
    const rows = readProjectJson(workflowRoot, project, dataRelativePath(layout, `${group}.json`));
    if (!Array.isArray(rows)) continue;
    for (const rawRow of rows) {
      if (!rawRow || typeof rawRow !== 'object') continue;
      const row = rawRow as Record<string, unknown>;
      const id = Number(row.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const text = [row.description, row.note, row.profile, row.nickname]
        .map((value) => (typeof value === 'string' ? value : ''))
        .filter(Boolean)
        .join(' ');
      documents.push({
        id: `database:${group}:${id}`,
        category: 'database',
        title: String(row.name || `#${id}`),
        text: clipText(text),
        context: group,
        databaseGroup: group,
        databaseId: id,
      });
    }
  }
  const system = readProjectJson(workflowRoot, project, dataRelativePath(layout, 'System.json'));
  const systemRecord = system && typeof system === 'object' ? system as Record<string, unknown> : {};
  for (const [group, values] of [['Switches', systemRecord.switches], ['Variables', systemRecord.variables]] as const) {
    if (!Array.isArray(values)) continue;
    values.forEach((name, id) => {
      if (id <= 0 || typeof name !== 'string' || !name.trim()) return;
      documents.push({
        id: `database:${group}:${id}`,
        category: 'database',
        title: name,
        text: '',
        context: `${group} #${String(id).padStart(4, '0')}`,
        databaseGroup: group,
        databaseId: id,
      });
    });
  }

  // --- plugin: plugin file headers (@plugindesc + help body) ---
  const pluginsDirectory = resourceRelativePath(layout, 'js/plugins');
  const pluginsAbsolute = path.join(projectRoot, ...pluginsDirectory.split('/'));
  if (fs.existsSync(pluginsAbsolute) && fs.statSync(pluginsAbsolute).isDirectory()) {
    for (const entry of fs.readdirSync(pluginsAbsolute, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.js')) continue;
      const relativePath = `${pluginsDirectory}/${entry.name}`;
      let header = '';
      try {
        header = extractDefaultPluginHeaderBody(fs.readFileSync(path.join(pluginsAbsolute, entry.name), 'utf8')) || '';
      } catch {
        header = '';
      }
      const pluginName = entry.name.replace(/\.js$/i, '');
      documents.push({
        id: `plugin:${pluginName}`,
        category: 'plugin',
        title: pluginName,
        text: clipText(header),
        context: relativePath,
        pluginName,
        relativePath,
      });
    }
  }

  // --- pluginParam: configured plugins.js rows (description + parameter values) ---
  const pluginsJsRelative = resourceRelativePath(layout, 'js/plugins.js');
  const pluginsJsFile = getProjectFileForRead(workflowRoot, project, pluginsJsRelative);
  if (pluginsJsFile && fs.existsSync(pluginsJsFile)) {
    const raw = fs.readFileSync(pluginsJsFile, 'utf8').replace(/^\uFEFF/, '');
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
      let entries: unknown[] = [];
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
        entries = Array.isArray(parsed) ? parsed : [];
      } catch {
        entries = [];
      }
      entries.forEach((rawEntry, index) => {
        if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return;
        const entry = rawEntry as Record<string, unknown>;
        const name = typeof entry.name === 'string' ? entry.name : '';
        if (!name) return;
        const parameters = entry.parameters && typeof entry.parameters === 'object' && !Array.isArray(entry.parameters)
          ? entry.parameters as Record<string, unknown>
          : {};
        const parameterText = Object.entries(parameters)
          .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
          .join(' · ');
        documents.push({
          id: `pluginParam:${index}:${name}`,
          category: 'pluginParam',
          title: name,
          text: clipText(`${String(entry.description || '')} ${parameterText}`),
          context: pluginsJsRelative,
          pluginName: name,
        });
      });
    }
  }

  return documents;
}

function readPersistedSearchIndex(project: string): PersistedSearchIndex | null {
  const file = searchIndexFilePath(project);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedSearchIndex;
    if (parsed?.version !== SEARCH_INDEX_VERSION || !Array.isArray(parsed.documents)) return null;
    return parsed;
  } catch {
    // A corrupt cache file is disposable; it is rebuilt from project data.
    return null;
  }
}

function persistSearchIndex(project: string, entry: SearchIndexCacheEntry): void {
  const payload: PersistedSearchIndex = {
    version: SEARCH_INDEX_VERSION,
    revision: entry.revision,
    builtAt: entry.builtAt,
    buildMs: entry.buildMs,
    documents: entry.documents,
  };
  fs.mkdirSync(lunaRpgDirPath(project), { recursive: true });
  fs.writeFileSync(searchIndexFilePath(project), `${JSON.stringify(payload)}\n`, 'utf8');
}

/** Load, reuse or (re)build the index; resolves when it is ready to query. */
export function ensureGlobalSearchIndex(
  workflowRoot: string,
  project: string,
): Promise<SearchIndexCacheEntry> {
  const key = cacheKey(project);
  const revision = computeGlobalSearchRevision(project);
  const cached = indexCache.get(key);
  if (cached && cached.revision === revision) return Promise.resolve(cached);
  const inflight = buildPromises.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    const persisted = readPersistedSearchIndex(project);
    let entry: SearchIndexCacheEntry;
    if (persisted && persisted.revision === revision) {
      entry = {
        revision,
        documents: persisted.documents,
        fuse: createFuse(persisted.documents),
        builtAt: persisted.builtAt,
        buildMs: persisted.buildMs,
      };
    } else {
      const started = Date.now();
      const documents = buildGlobalSearchDocuments(workflowRoot, project);
      entry = {
        revision,
        documents,
        fuse: createFuse(documents),
        builtAt: Date.now(),
        buildMs: Date.now() - started,
      };
      persistSearchIndex(project, entry);
    }
    indexCache.set(key, entry);
    return entry;
  })();
  buildPromises.set(key, promise);
  promise.finally(() => {
    if (buildPromises.get(key) === promise) buildPromises.delete(key);
  }).catch(() => { /* surfaced to the caller of ensureGlobalSearchIndex */ });
  return promise;
}

export function getGlobalSearchIndexState(project: string): GlobalSearchIndexState {
  const key = cacheKey(project);
  if (buildPromises.has(key)) {
    return { project: path.resolve(project), status: 'building', docCount: 0, builtAt: null, buildMs: null };
  }
  const cached = indexCache.get(key);
  if (cached) {
    return {
      project: path.resolve(project),
      status: 'ready',
      docCount: cached.documents.length,
      builtAt: cached.builtAt,
      buildMs: cached.buildMs,
    };
  }
  const persisted = readPersistedSearchIndex(project);
  if (persisted) {
    return {
      project: path.resolve(project),
      status: 'ready',
      docCount: persisted.documents.length,
      builtAt: persisted.builtAt,
      buildMs: persisted.buildMs,
    };
  }
  return { project: path.resolve(project), status: 'empty', docCount: 0, builtAt: null, buildMs: null };
}

/** Force a rebuild (drops memory cache and the persisted file). */
export async function rebuildGlobalSearchIndex(
  workflowRoot: string,
  project: string,
): Promise<GlobalSearchIndexState> {
  const key = cacheKey(project);
  indexCache.delete(key);
  const file = searchIndexFilePath(project);
  if (fs.existsSync(file)) fs.rmSync(file);
  await ensureGlobalSearchIndex(workflowRoot, project);
  return getGlobalSearchIndexState(project);
}

function resolveMaxResults(project: string, requested?: number): number {
  if (Number.isInteger(requested) && (requested as number) > 0) {
    return Math.min(requested as number, MAX_RESULTS_CAP);
  }
  const configured = readProjectConfig(project).search?.maxResults;
  if (Number.isInteger(configured) && (configured as number) > 0) {
    return Math.min(configured as number, MAX_RESULTS_CAP);
  }
  return DEFAULT_MAX_RESULTS;
}

/** Pure precedence: an explicit request wins, else the project config, else the loose default. */
export function pickMatchPrecision(
  requested?: GlobalSearchMatchPrecision,
  configured?: GlobalSearchMatchPrecision,
): GlobalSearchMatchPrecision {
  if (requested && requested in MATCH_PRECISION_THRESHOLDS) return requested;
  if (configured && configured in MATCH_PRECISION_THRESHOLDS) return configured;
  return DEFAULT_MATCH_PRECISION;
}

function resolveMatchPrecision(
  project: string,
  requested?: GlobalSearchMatchPrecision,
): GlobalSearchMatchPrecision {
  return pickMatchPrecision(requested, readProjectConfig(project).search?.matchPrecision);
}

/** Reuse the default Fuse for loose; lazily build+cache tighter-threshold instances. */
function resolveFuseForPrecision(
  entry: SearchIndexCacheEntry,
  precision: GlobalSearchMatchPrecision,
): Fuse<GlobalSearchDocument> {
  const threshold = MATCH_PRECISION_THRESHOLDS[precision];
  if (threshold === MATCH_PRECISION_THRESHOLDS.loose) return entry.fuse;
  if (!entry.fuseByThreshold) entry.fuseByThreshold = new Map();
  let fuse = entry.fuseByThreshold.get(threshold);
  if (!fuse) {
    fuse = createFuse(entry.documents, threshold);
    entry.fuseByThreshold.set(threshold, fuse);
  }
  return fuse;
}

const GLOBAL_SEARCH_CATEGORIES = new Set<GlobalSearchCategory>([
  'file', 'map', 'event', 'database', 'plugin', 'pluginParam',
]);

export async function searchGlobalProjectIndex(
  workflowRoot: string,
  project: string,
  rawQuery: string,
  options: GlobalSearchOptions = {},
): Promise<GlobalSearchResult> {
  const query = String(rawQuery || '').trim();
  if (query.length > 200) throw new Error('Global search query must be 200 characters or fewer');
  const requestedCategories = (options.categories || [])
    .filter((category) => GLOBAL_SEARCH_CATEGORIES.has(category));
  const categories = requestedCategories.length ? new Set(requestedCategories) : null;
  const entry = await ensureGlobalSearchIndex(workflowRoot, project);
  const started = performance.now();
  const matches: GlobalSearchHit[] = [];
  if (query) {
    if (options.exact) {
      const needle = query.toLocaleLowerCase();
      for (const document of entry.documents) {
        if (categories && !categories.has(document.category)) continue;
        if (
          document.title.toLocaleLowerCase().includes(needle)
          || document.text.toLocaleLowerCase().includes(needle)
          || document.context.toLocaleLowerCase().includes(needle)
        ) {
          matches.push({ document, score: 0 });
        }
      }
    } else {
      const fuse = resolveFuseForPrecision(entry, resolveMatchPrecision(project, options.matchPrecision));
      for (const result of fuse.search(query)) {
        if (categories && !categories.has(result.item.category)) continue;
        matches.push({ document: result.item, score: result.score ?? 0 });
      }
    }
  }
  const maxResults = resolveMaxResults(project, options.maxResults);
  const tookMs = Math.max(0, Math.round(performance.now() - started));
  return {
    project: path.resolve(project),
    query,
    hits: matches.slice(0, maxResults),
    total: matches.length,
    tookMs,
    indexDocCount: entry.documents.length,
    indexBuiltAt: entry.builtAt,
  };
}
