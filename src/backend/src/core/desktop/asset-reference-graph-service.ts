import fs from 'node:fs';
import path from 'node:path';

import { readJson } from '../rmmv/json.ts';
import {
  assetGraphAssetMissing,
  assetGraphIconsetRenameForbidden,
  assetGraphNameInvalid,
  assetGraphNameMissing,
  assetGraphReferenceRewriteUnsupported,
  assetGraphReferencedBlocker,
  assetGraphTargetNameOccupied,
  assetGraphUnsupportedCategory,
} from './assetReferenceGraphLocalization.ts';
import { getProjectFileForRead, getProjectStagingStatus } from './staging-service.ts';
import { readPluginConfiguration } from './plugin-management-service.ts';
import type { PluginParameterSchemaField } from '../../../../contract/types.ts';

export type RmmvAssetCategory =
  | 'characters'
  | 'faces'
  | 'pictures'
  | 'tilesets'
  | 'animations'
  | 'parallaxes'
  | 'battlebacks1'
  | 'battlebacks2'
  | 'enemies'
  | 'svEnemies'
  | 'svActors'
  | 'system'
  | 'titles1'
  | 'titles2'
  | 'bgm'
  | 'bgs'
  | 'me'
  | 'se'
  | 'movies'
  | 'fonts'
  | 'plugins'
  | 'effects';

export interface RmmvAssetCategoryDefinition {
  id: RmmvAssetCategory;
  directory: string;
  extensions: string[];
}

export interface RmmvProjectAsset {
  category: RmmvAssetCategory;
  name: string;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  staged: boolean;
}

export interface RmmvAssetReference {
  category: RmmvAssetCategory;
  name: string;
  file: string;
  path: string;
  source: string;
}

export interface RmmvMissingAssetReference extends RmmvAssetReference {
  expectedRelativePaths: string[];
}

export interface RmmvAssetReferenceGraph {
  generatedAt: string;
  projectRoot: string;
  dataRelativeDir: string;
  gameRootRelative: string;
  categories: RmmvAssetCategoryDefinition[];
  assets: RmmvProjectAsset[];
  references: RmmvAssetReference[];
  missingReferences: RmmvMissingAssetReference[];
  unusedAssets: RmmvProjectAsset[];
  summary: {
    assets: number;
    references: number;
    missingReferences: number;
    unusedAssets: number;
  };
}

export interface AssetGraphTarget {
  category: string;
  relativePath?: string;
  name?: string;
}

export interface AssetMutationSafetyCheck {
  ok: boolean;
  action: 'delete' | 'rename';
  target: {
    category: RmmvAssetCategory;
    name: string;
    relativePath: string | null;
  };
  nextName?: string;
  nextRelativePath?: string;
  references: RmmvAssetReference[];
  blockers: string[];
}

interface ProjectAssetLayout {
  dataRelativeDir: string;
  gameRootRelative: string;
}

interface ScanContext {
  workflowRoot: string;
  project: string;
  layout: ProjectAssetLayout;
  references: RmmvAssetReference[];
  referenceKeys: Set<string>;
  enemyBattlerCategory: 'enemies' | 'svEnemies';
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.rpgmvp'];
const AUDIO_EXTENSIONS = ['.ogg', '.m4a', '.rpgmvo', '.rpgmvm'];

export const RMMV_ASSET_CATEGORIES: RmmvAssetCategoryDefinition[] = [
  { id: 'characters', directory: 'img/characters', extensions: IMAGE_EXTENSIONS },
  { id: 'faces', directory: 'img/faces', extensions: IMAGE_EXTENSIONS },
  { id: 'pictures', directory: 'img/pictures', extensions: IMAGE_EXTENSIONS },
  { id: 'tilesets', directory: 'img/tilesets', extensions: IMAGE_EXTENSIONS },
  { id: 'animations', directory: 'img/animations', extensions: IMAGE_EXTENSIONS },
  { id: 'parallaxes', directory: 'img/parallaxes', extensions: IMAGE_EXTENSIONS },
  { id: 'battlebacks1', directory: 'img/battlebacks1', extensions: IMAGE_EXTENSIONS },
  { id: 'battlebacks2', directory: 'img/battlebacks2', extensions: IMAGE_EXTENSIONS },
  { id: 'enemies', directory: 'img/enemies', extensions: IMAGE_EXTENSIONS },
  { id: 'svEnemies', directory: 'img/sv_enemies', extensions: IMAGE_EXTENSIONS },
  { id: 'svActors', directory: 'img/sv_actors', extensions: IMAGE_EXTENSIONS },
  { id: 'system', directory: 'img/system', extensions: IMAGE_EXTENSIONS },
  { id: 'titles1', directory: 'img/titles1', extensions: IMAGE_EXTENSIONS },
  { id: 'titles2', directory: 'img/titles2', extensions: IMAGE_EXTENSIONS },
  { id: 'bgm', directory: 'audio/bgm', extensions: AUDIO_EXTENSIONS },
  { id: 'bgs', directory: 'audio/bgs', extensions: AUDIO_EXTENSIONS },
  { id: 'me', directory: 'audio/me', extensions: AUDIO_EXTENSIONS },
  { id: 'se', directory: 'audio/se', extensions: AUDIO_EXTENSIONS },
  { id: 'movies', directory: 'movies', extensions: ['.webm', '.mp4', '.rpgmvm'] },
  { id: 'fonts', directory: 'fonts', extensions: ['.css', '.ttf', '.otf', '.woff', '.woff2'] },
  { id: 'plugins', directory: 'js/plugins', extensions: ['.js'] },
  { id: 'effects', directory: 'effects', extensions: ['.efkefc'] },
];

const CATEGORY_BY_ID = new Map(RMMV_ASSET_CATEGORIES.map((category) => [category.id, category]));
const CATEGORY_BY_DIRECTORY = new Map(RMMV_ASSET_CATEGORIES.map((category) => [category.directory, category]));

const CATEGORY_ALIASES: Record<string, RmmvAssetCategory> = {
  sv_actors: 'svActors',
  svActors: 'svActors',
  svactor: 'svActors',
  svactors: 'svActors',
  sv_enemies: 'svEnemies',
  svEnemies: 'svEnemies',
  svenemy: 'svEnemies',
  svenemies: 'svEnemies',
  'js/plugins': 'plugins',
  plugin: 'plugins',
  plugins: 'plugins',
  effect: 'effects',
  effects: 'effects',
};

const DATABASE_FILES = [
  'System',
  'Actors',
  'Classes',
  'Skills',
  'Items',
  'Weapons',
  'Armors',
  'Enemies',
  'Troops',
  'States',
  'Animations',
  'Tilesets',
  'CommonEvents',
  'MapInfos',
];

export function buildAssetReferenceGraph(workflowRoot: string, project: string): RmmvAssetReferenceGraph {
  const layout = resolveProjectAssetLayout(workflowRoot, project);
  const context: ScanContext = {
    workflowRoot: path.resolve(workflowRoot),
    project: path.resolve(project),
    layout,
    references: [],
    referenceKeys: new Set(),
    enemyBattlerCategory: 'enemies',
  };

  scanDatabaseReferences(context);
  scanMapReferences(context);
  scanPluginConfiguration(context);

  const assets = listProjectAssets(context);
  const assetKeys = new Set(assets.map((asset) => assetKey(asset.category, asset.name)));
  const referencedKeys = new Set(context.references.map((reference) => assetKey(reference.category, reference.name)));
  const missingReferences = context.references
    .filter((reference) => !assetKeys.has(assetKey(reference.category, reference.name)))
    .map((reference) => ({
      ...reference,
      expectedRelativePaths: expectedRelativePaths(context.layout, reference.category, reference.name),
    }));
  const unusedAssets = assets.filter((asset) => !referencedKeys.has(assetKey(asset.category, asset.name)));

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: context.project,
    dataRelativeDir: layout.dataRelativeDir,
    gameRootRelative: layout.gameRootRelative,
    categories: RMMV_ASSET_CATEGORIES,
    assets,
    references: context.references,
    missingReferences,
    unusedAssets,
    summary: {
      assets: assets.length,
      references: context.references.length,
      missingReferences: missingReferences.length,
      unusedAssets: unusedAssets.length,
    },
  };
}

export function findReferencesForAsset(workflowRoot: string, project: string, target: AssetGraphTarget): RmmvAssetReference[] {
  const category = requireCategory(target.category);
  const name = targetAssetName(target);
  return buildAssetReferenceGraph(workflowRoot, project).references
    .filter((reference) => reference.category === category && reference.name === name);
}

export function findMissingAssetReferences(workflowRoot: string, project: string): RmmvMissingAssetReference[] {
  return buildAssetReferenceGraph(workflowRoot, project).missingReferences;
}

export function findUnusedProjectAssets(workflowRoot: string, project: string): RmmvProjectAsset[] {
  return buildAssetReferenceGraph(workflowRoot, project).unusedAssets;
}

export function checkAssetDeleteSafety(workflowRoot: string, project: string, target: AssetGraphTarget): AssetMutationSafetyCheck {
  const graph = buildAssetReferenceGraph(workflowRoot, project);
  const category = requireCategory(target.category);
  const name = targetAssetName(target);
  const asset = findGraphAsset(graph, target, category, name);
  const references = graph.references.filter((reference) => reference.category === category && reference.name === name);
  const blockers: string[] = [];
  if (!asset) blockers.push(assetGraphAssetMissing());
  if (references.length) blockers.push(assetGraphReferencedBlocker(references.length));
  return {
    ok: blockers.length === 0,
    action: 'delete',
    target: { category, name, relativePath: asset?.relativePath || target.relativePath || null },
    references,
    blockers,
  };
}

export function checkAssetRenameSafety(
  workflowRoot: string,
  project: string,
  target: AssetGraphTarget,
  nextNameValue: string,
): AssetMutationSafetyCheck {
  const graph = buildAssetReferenceGraph(workflowRoot, project);
  const category = requireCategory(target.category);
  const name = targetAssetName(target);
  const nextName = normalizeAssetName(nextNameValue);
  const asset = findGraphAsset(graph, target, category, name);
  const references = graph.references.filter((reference) => reference.category === category && reference.name === name);
  const blockers: string[] = [];
  let nextRelativePath: string | undefined;
  if (!asset) {
    blockers.push(assetGraphAssetMissing());
  } else {
    const relativeDir = categoryRelativeDirectory({
      dataRelativeDir: graph.dataRelativeDir,
      gameRootRelative: graph.gameRootRelative,
    }, category);
    nextRelativePath = `${relativeDir}/${nextName}${path.extname(asset.fileName)}`;
    const occupied = graph.assets.some((item) => item.relativePath === nextRelativePath);
    if (occupied) blockers.push(assetGraphTargetNameOccupied());
  }
  if (category === 'system' && name === 'IconSet' && references.some((reference) => reference.path.endsWith('.iconIndex'))) {
    blockers.push(assetGraphIconsetRenameForbidden());
  }
  const unsupportedReferences = references.filter((reference) => !canRewriteAssetReference(reference));
  if (unsupportedReferences.length > 0) blockers.push(assetGraphReferenceRewriteUnsupported(unsupportedReferences.length));
  return {
    ok: blockers.length === 0,
    action: 'rename',
    target: { category, name, relativePath: asset?.relativePath || target.relativePath || null },
    nextName,
    nextRelativePath,
    references,
    blockers,
  };
}

function canRewriteAssetReference(reference: RmmvAssetReference): boolean {
  if (reference.file.toLowerCase().endsWith('.json')) return true;
  if (/(?:^|\/)js\/plugins\/(?:[^/]+\/)*[^/]+\.js$/i.test(reference.file)) {
    return reference.source.startsWith('Plugin declaration');
  }
  return /(?:^|\/)js\/plugins\.js$/i.test(reference.file)
    && reference.path.startsWith('$.plugins[');
}

export function normalizeAssetCategory(category: string): RmmvAssetCategory | null {
  const raw = String(category || '').trim();
  if (!raw) return null;
  if (CATEGORY_BY_ID.has(raw as RmmvAssetCategory)) return raw as RmmvAssetCategory;
  const normalized = raw.replace(/\\/g, '/').replace(/^www\//, '').replace(/^\/+/, '');
  if (CATEGORY_ALIASES[normalized]) return CATEGORY_ALIASES[normalized];
  const direct = CATEGORY_BY_DIRECTORY.get(normalized);
  if (direct) return direct.id;
  const compact = normalized.replace(/[-_\s/]/g, '').toLowerCase();
  const match = RMMV_ASSET_CATEGORIES.find((item) => item.id.toLowerCase() === compact || item.directory.replace(/[-_\s/]/g, '').toLowerCase() === compact);
  return match?.id || null;
}

export function requireAssetCategory(category: string): RmmvAssetCategory {
  return requireCategory(category);
}

export function projectAssetRelativeDirectory(workflowRoot: string, project: string, category: string): string {
  return categoryRelativeDirectory(resolveProjectAssetLayout(workflowRoot, project), requireCategory(category));
}

export function expectedAssetRelativePaths(workflowRoot: string, project: string, category: string, name: string): string[] {
  return expectedRelativePaths(resolveProjectAssetLayout(workflowRoot, project), requireCategory(category), normalizeAssetName(name));
}

function scanDatabaseReferences(context: ScanContext): void {
  for (const stem of DATABASE_FILES) {
    const file = readDataJson(context, stem);
    if (!file) continue;
    const { value, relative } = file;
    switch (stem) {
      case 'System':
        scanSystem(context, value, relative);
        break;
      case 'Actors':
        scanActors(context, value, relative);
        break;
      case 'Skills':
      case 'Items':
      case 'Weapons':
      case 'Armors':
      case 'States':
        scanIconDatabase(context, value, relative, stem);
        break;
      case 'Enemies':
        scanEnemies(context, value, relative);
        break;
      case 'Troops':
        scanTroops(context, value, relative);
        break;
      case 'Animations':
        scanAnimations(context, value, relative);
        break;
      case 'Tilesets':
        scanTilesets(context, value, relative);
        break;
      case 'CommonEvents':
        scanCommonEvents(context, value, relative);
        break;
      case 'Classes':
      case 'MapInfos':
      default:
        break;
    }
  }
}

function scanSystem(context: ScanContext, value: unknown, file: string): void {
  if (!isRecord(value)) return;
  context.enemyBattlerCategory = value.optSideView === true ? 'svEnemies' : 'enemies';
  addReference(context, 'titles1', value.title1Name, file, '$.title1Name', 'System title image');
  addReference(context, 'titles2', value.title2Name, file, '$.title2Name', 'System title image');
  addReference(context, 'battlebacks1', value.battleback1Name, file, '$.battleback1Name', 'System battleback');
  addReference(context, 'battlebacks2', value.battleback2Name, file, '$.battleback2Name', 'System battleback');
  addAudioReference(context, 'bgm', value.titleBgm, file, '$.titleBgm', 'System title BGM');
  addAudioReference(context, 'bgm', value.battleBgm, file, '$.battleBgm', 'System battle BGM');
  addAudioReference(context, 'me', value.victoryMe, file, '$.victoryMe', 'System victory ME');
  addAudioReference(context, 'me', value.defeatMe, file, '$.defeatMe', 'System defeat ME');
  for (const vehicleName of ['boat', 'ship', 'airship']) {
    const vehicle = value[vehicleName];
    if (!isRecord(vehicle)) continue;
    addReference(context, 'characters', vehicle.characterName, file, `$.${vehicleName}.characterName`, 'System vehicle image');
    addAudioReference(context, 'bgm', vehicle.bgm, file, `$.${vehicleName}.bgm`, 'System vehicle BGM');
  }
  if (Array.isArray(value.sounds)) {
    value.sounds.forEach((sound, index) => addAudioReference(context, 'se', sound, file, `$.sounds[${index}]`, 'System sound effect'));
  }
}

function scanActors(context: ScanContext, value: unknown, file: string): void {
  forEachDatabaseEntry(value, (entry, index) => {
    addReference(context, 'characters', entry.characterName, file, `$[${index}].characterName`, 'Actor character image');
    addReference(context, 'faces', entry.faceName, file, `$[${index}].faceName`, 'Actor face image');
    addReference(context, 'svActors', entry.battlerName, file, `$[${index}].battlerName`, 'Actor side-view battler');
  });
}

function scanIconDatabase(context: ScanContext, value: unknown, file: string, source: string): void {
  forEachDatabaseEntry(value, (entry, index) => {
    if (Number(entry.iconIndex || 0) > 0) {
      addReference(context, 'system', 'IconSet', file, `$[${index}].iconIndex`, `${source} icon set`);
    }
  });
}

function scanEnemies(context: ScanContext, value: unknown, file: string): void {
  forEachDatabaseEntry(value, (entry, index) => {
    addReference(context, context.enemyBattlerCategory, entry.battlerName, file, `$[${index}].battlerName`, 'Enemy battler');
  });
}

function scanTroops(context: ScanContext, value: unknown, file: string): void {
  forEachDatabaseEntry(value, (entry, troopIndex) => {
    if (!Array.isArray(entry.pages)) return;
    entry.pages.forEach((page, pageIndex) => {
      if (isRecord(page)) scanCommandList(context, page.list, file, `$[${troopIndex}].pages[${pageIndex}].list`, 'Troop event');
    });
  });
}

function scanAnimations(context: ScanContext, value: unknown, file: string): void {
  forEachDatabaseEntry(value, (entry, index) => {
    addReference(context, 'effects', entry.effectName, file, `$[${index}].effectName`, 'MZ particle animation effect');
    addReference(context, 'animations', entry.animation1Name, file, `$[${index}].animation1Name`, 'Animation sheet');
    addReference(context, 'animations', entry.animation2Name, file, `$[${index}].animation2Name`, 'Animation sheet');
    if (Array.isArray(entry.timings)) entry.timings.forEach((timing, timingIndex) => {
      if (isRecord(timing)) addAudioReference(context, 'se', timing.se, file, `$[${index}].timings[${timingIndex}].se`, 'Animation timing SE');
    });
    if (Array.isArray(entry.soundTimings)) entry.soundTimings.forEach((timing, timingIndex) => {
      if (isRecord(timing)) addAudioReference(context, 'se', timing.se, file, `$[${index}].soundTimings[${timingIndex}].se`, 'MZ animation timing SE');
    });
  });
}

function scanTilesets(context: ScanContext, value: unknown, file: string): void {
  forEachDatabaseEntry(value, (entry, index) => {
    if (!Array.isArray(entry.tilesetNames)) return;
    entry.tilesetNames.forEach((name, slot) => {
      addReference(context, 'tilesets', name, file, `$[${index}].tilesetNames[${slot}]`, 'Tileset image');
    });
  });
}

function scanCommonEvents(context: ScanContext, value: unknown, file: string): void {
  forEachDatabaseEntry(value, (entry, index) => {
    scanCommandList(context, entry.list, file, `$[${index}].list`, 'Common event');
  });
}

function scanMapReferences(context: ScanContext): void {
  const mapInfosFile = readDataJson(context, 'MapInfos');
  const mapIds = new Set<number>();
  if (mapInfosFile && Array.isArray(mapInfosFile.value)) {
    for (const info of mapInfosFile.value) {
      if (isRecord(info) && Number.isInteger(Number(info.id))) mapIds.add(Number(info.id));
    }
  }
  for (const relative of listDataJsonRelatives(context)) {
    const match = /Map(\d{3})\.json$/.exec(relative);
    if (match) mapIds.add(Number(match[1]));
  }
  for (const mapId of Array.from(mapIds).sort((a, b) => a - b)) {
    const relative = `${context.layout.dataRelativeDir}/Map${String(mapId).padStart(3, '0')}.json`;
    const file = getProjectFileForRead(context.workflowRoot, context.project, relative);
    if (!file) continue;
    scanMap(context, readJson(file), relative);
  }
}

function scanMap(context: ScanContext, value: unknown, file: string): void {
  if (!isRecord(value)) return;
  addReference(context, 'parallaxes', value.parallaxName, file, '$.parallaxName', 'Map parallax');
  addReference(context, 'battlebacks1', value.battleback1Name, file, '$.battleback1Name', 'Map battleback');
  addReference(context, 'battlebacks2', value.battleback2Name, file, '$.battleback2Name', 'Map battleback');
  if (!Array.isArray(value.events)) return;
  value.events.forEach((event, eventIndex) => {
    if (!isRecord(event) || !Array.isArray(event.pages)) return;
    event.pages.forEach((page, pageIndex) => {
      if (!isRecord(page)) return;
      if (isRecord(page.image)) {
        addReference(context, 'characters', page.image.characterName, file, `$.events[${eventIndex}].pages[${pageIndex}].image.characterName`, 'Map event page image');
      }
      scanCommandList(context, page.list, file, `$.events[${eventIndex}].pages[${pageIndex}].list`, 'Map event command');
    });
  });
}

function scanCommandList(context: ScanContext, value: unknown, file: string, jsonPath: string, source: string): void {
  if (!Array.isArray(value)) return;
  value.forEach((command, index) => {
    if (!isRecord(command)) return;
    const params = Array.isArray(command.parameters) ? command.parameters : [];
    const code = Number(command.code || 0);
    const base = `${jsonPath}[${index}]`;
    switch (code) {
      case 101:
        addReference(context, 'faces', params[0], file, `${base}.parameters[0]`, `${source} text face`);
        break;
      case 132:
        addAudioReference(context, 'bgm', params[0], file, `${base}.parameters[0]`, `${source} battle BGM`);
        break;
      case 133:
      case 139:
        addAudioReference(context, 'me', params[0], file, `${base}.parameters[0]`, `${source} system ME`);
        break;
      case 205:
        scanMoveRoute(context, params[1], file, `${base}.parameters[1]`, source);
        break;
      case 231:
        addReference(context, 'pictures', params[1], file, `${base}.parameters[1]`, `${source} picture`);
        break;
      case 241:
        addAudioReference(context, 'bgm', params[0], file, `${base}.parameters[0]`, `${source} BGM`);
        break;
      case 245:
        addAudioReference(context, 'bgs', params[0], file, `${base}.parameters[0]`, `${source} BGS`);
        break;
      case 249:
        addAudioReference(context, 'me', params[0], file, `${base}.parameters[0]`, `${source} ME`);
        break;
      case 250:
        addAudioReference(context, 'se', params[0], file, `${base}.parameters[0]`, `${source} SE`);
        break;
      case 261:
        addReference(context, 'movies', params[0], file, `${base}.parameters[0]`, `${source} movie`);
        break;
      case 283:
        addReference(context, 'battlebacks1', params[0], file, `${base}.parameters[0]`, `${source} battleback`);
        addReference(context, 'battlebacks2', params[1], file, `${base}.parameters[1]`, `${source} battleback`);
        break;
      case 284:
        addReference(context, 'parallaxes', params[0], file, `${base}.parameters[0]`, `${source} parallax`);
        break;
      case 322:
        addReference(context, 'characters', params[1], file, `${base}.parameters[1]`, `${source} actor character image`);
        addReference(context, 'faces', params[3], file, `${base}.parameters[3]`, `${source} actor face image`);
        addReference(context, 'svActors', params[5], file, `${base}.parameters[5]`, `${source} actor side-view image`);
        break;
      case 323:
        addReference(context, 'characters', params[1], file, `${base}.parameters[1]`, `${source} vehicle image`);
        break;
      default:
        break;
    }
  });
}

function scanMoveRoute(context: ScanContext, value: unknown, file: string, jsonPath: string, source: string): void {
  if (!isRecord(value) || !Array.isArray(value.list)) return;
  value.list.forEach((command, index) => {
    if (!isRecord(command)) return;
    const params = Array.isArray(command.parameters) ? command.parameters : [];
    const code = Number(command.code || 0);
    if (code === 41) addReference(context, 'characters', params[0], file, `${jsonPath}.list[${index}].parameters[0]`, `${source} move route image`);
    if (code === 44) addAudioReference(context, 'se', params[0], file, `${jsonPath}.list[${index}].parameters[0]`, `${source} move route SE`);
  });
}

function scanPluginConfiguration(context: ScanContext): void {
  const relative = `${context.layout.gameRootRelative ? `${context.layout.gameRootRelative}/` : ''}js/plugins.js`;
  const file = getProjectFileForRead(context.workflowRoot, context.project, relative);
  if (!file) return;
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return;
  let entries: unknown[];
  try {
    entries = JSON.parse(raw.slice(start, end + 1)) as unknown[];
  } catch {
    return;
  }
  const managedByName = new Map(readPluginConfiguration(context.workflowRoot, context.project).plugins.map((plugin) => [plugin.name, plugin]));
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    addReference(context, 'plugins', entry.name, relative, `$.plugins[${index}].name`, 'Plugin configuration');
    scanPluginParameters(context, entry.parameters, relative, `$.plugins[${index}].parameters`);
    const pluginName = String(entry.name || '');
    const managed = managedByName.get(pluginName);
    if (!managed) return;
    for (const field of managed.parameterSchema?.fields || []) {
      scanDeclaredPluginParameter(
        context,
        field,
        isRecord(entry.parameters) ? entry.parameters[field.key] : undefined,
        relative,
        `$.plugins[${index}].parameters${jsonPathKey(field.key)}`,
      );
    }
    managed.dependencies?.requiredAssets.forEach((asset, assetIndex) => {
      scanResourceString(context, asset, managed.fileRelativePath, `@requiredAssets[${assetIndex}]`, 'Plugin declaration');
    });
    for (const declaration of managed.dependencies?.noteAssets || []) {
      scanPluginNoteAssets(context, managed.fileRelativePath, declaration);
    }
  });
}

function scanDeclaredPluginParameter(
  context: ScanContext,
  field: PluginParameterSchemaField,
  rawValue: unknown,
  file: string,
  jsonPath: string,
): void {
  const value = parsePluginStructuredValue(rawValue);
  if (field.kind === 'file' && field.directory && typeof value === 'string' && value.trim()) {
    scanResourceString(context, `${field.directory}/${value}`.replace(/\/+/g, '/'), file, jsonPath, 'Plugin file parameter');
    return;
  }
  if (field.kind === 'struct' && isRecord(value)) {
    for (const child of field.fields || []) {
      scanDeclaredPluginParameter(context, child, value[child.key], file, jsonPath);
    }
    return;
  }
  if (field.kind === 'array' && Array.isArray(value) && field.item) {
    value.forEach((item) => scanDeclaredPluginParameter(context, field.item!, item, file, jsonPath));
  }
}

function parsePluginStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function scanPluginNoteAssets(
  context: ScanContext,
  pluginFile: string,
  declaration: { parameter: string; directory: string; type: string; data: string },
): void {
  if (declaration.type !== 'file' || !declaration.data) return;
  const dataFiles: Record<string, string> = {
    actor: 'Actors.json', actors: 'Actors.json', class: 'Classes.json', classes: 'Classes.json',
    skill: 'Skills.json', skills: 'Skills.json', item: 'Items.json', items: 'Items.json',
    weapon: 'Weapons.json', weapons: 'Weapons.json', armor: 'Armors.json', armors: 'Armors.json',
    enemy: 'Enemies.json', enemies: 'Enemies.json', state: 'States.json', states: 'States.json',
    tileset: 'Tilesets.json', tilesets: 'Tilesets.json', common_event: 'CommonEvents.json', commonevents: 'CommonEvents.json',
  };
  const fileName = dataFiles[declaration.data.toLowerCase().replace(/[\s-]/g, '')] || dataFiles[declaration.data.toLowerCase()];
  if (!fileName) return;
  const relative = `${context.layout.dataRelativeDir}/${fileName}`;
  const absolute = getProjectFileForRead(context.workflowRoot, context.project, relative);
  if (!absolute) return;
  const escaped = declaration.parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<${escaped}\\s*:\\s*([^>]+)>`, 'gi');
  const visit = (value: unknown, jsonPath: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${jsonPath}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.note === 'string') {
      for (const match of value.note.matchAll(pattern)) {
        scanResourceString(
          context,
          `${declaration.directory}/${match[1].trim()}`.replace(/\/+/g, '/'),
          relative,
          `${jsonPath}.note`,
          `Plugin note declaration (${path.posix.basename(pluginFile)})`,
        );
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'note') visit(child, `${jsonPath}${jsonPathKey(key)}`);
    }
  };
  visit(readJson(absolute), '$');
}

function scanPluginParameters(context: ScanContext, value: unknown, file: string, jsonPath: string): void {
  if (typeof value === 'string') {
    scanResourceString(context, value, file, jsonPath, 'Plugin parameter');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPluginParameters(context, item, file, `${jsonPath}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    scanPluginParameters(context, item, file, `${jsonPath}${jsonPathKey(key)}`);
  }
}

function scanResourceString(context: ScanContext, value: string, file: string, jsonPath: string, source: string): void {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^www\//, '').replace(/^\/+/, '');
  if (!normalized) return;
  const match = /^((?:img|audio|movies|fonts|effects|js\/plugins)\/[^.]+)(?:\.[A-Za-z0-9]+)?$/.exec(normalized);
  if (!match) return;
  const assetPath = match[1];
  const category = RMMV_ASSET_CATEGORIES
    .filter((candidate) => assetPath.startsWith(`${candidate.directory}/`))
    .sort((left, right) => right.directory.length - left.directory.length)[0];
  if (!category) return;
  addReference(context, category.id, assetPath.slice(category.directory.length + 1), file, jsonPath, source);
}

function listProjectAssets(context: ScanContext): RmmvProjectAsset[] {
  const byRelative = new Map<string, RmmvProjectAsset>();
  for (const category of RMMV_ASSET_CATEGORIES) {
    const relativeDir = categoryRelativeDirectory(context.layout, category.id);
    const sourceDir = path.join(context.project, ...relativeDir.split('/'));
    if (fs.existsSync(sourceDir)) {
      for (const fileName of listFilesRecursively(sourceDir)) {
        const extension = path.extname(fileName).toLowerCase();
        if (!category.extensions.includes(extension)) continue;
        const relativePath = `${relativeDir}/${fileName}`;
        const absolutePath = path.join(sourceDir, ...fileName.split('/'));
        byRelative.set(relativePath, makeAsset(category.id, relativePath, absolutePath, false, context.layout));
      }
    }
  }
  for (const staged of getProjectStagingStatus(context.workflowRoot, context.project).files || []) {
    const category = categoryForRelativePath(context.layout, staged.relativePath);
    if (!category) continue;
    if (staged.delete) {
      byRelative.delete(staged.relativePath);
      continue;
    }
    const absolutePath = getProjectFileForRead(context.workflowRoot, context.project, staged.relativePath);
    if (!absolutePath) continue;
    byRelative.set(staged.relativePath, makeAsset(category.id, staged.relativePath, absolutePath, true, context.layout));
  }
  return Array.from(byRelative.values()).sort((a, b) => a.category.localeCompare(b.category) || a.relativePath.localeCompare(b.relativePath));
}

function makeAsset(
  category: RmmvAssetCategory,
  relativePath: string,
  absolutePath: string,
  staged: boolean,
  layout: ProjectAssetLayout,
): RmmvProjectAsset {
  const relativeDir = categoryRelativeDirectory(layout, category);
  const fileName = relativePath.slice(relativeDir.length + 1);
  return {
    category,
    name: fileName.slice(0, -path.extname(fileName).length),
    fileName,
    relativePath,
    absolutePath,
    size: fs.statSync(absolutePath).size,
    staged,
  };
}

function categoryForRelativePath(layout: ProjectAssetLayout, relativePath: string): RmmvAssetCategoryDefinition | null {
  const normalized = relativePath.replace(/\\/g, '/');
  for (const category of RMMV_ASSET_CATEGORIES) {
    const dir = categoryRelativeDirectory(layout, category.id);
    if (!normalized.startsWith(`${dir}/`)) continue;
    if (!category.extensions.includes(path.extname(normalized).toLowerCase())) continue;
    return category;
  }
  return null;
}

function listFilesRecursively(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  visit(root, '');
  return files;
}

function listDataJsonRelatives(context: ScanContext): string[] {
  const result = new Set<string>();
  const sourceDir = path.join(context.project, ...context.layout.dataRelativeDir.split('/'));
  if (fs.existsSync(sourceDir)) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) result.add(`${context.layout.dataRelativeDir}/${entry.name}`);
    }
  }
  for (const staged of getProjectStagingStatus(context.workflowRoot, context.project).files || []) {
    if (!staged.relativePath.startsWith(`${context.layout.dataRelativeDir}/`) || !staged.relativePath.endsWith('.json')) continue;
    if (staged.delete) result.delete(staged.relativePath);
    else result.add(staged.relativePath);
  }
  return Array.from(result).sort();
}

function readDataJson(context: ScanContext, stem: string): { relative: string; value: unknown } | null {
  const relative = `${context.layout.dataRelativeDir}/${stem}.json`;
  const file = getProjectFileForRead(context.workflowRoot, context.project, relative);
  if (!file) return null;
  return { relative, value: readJson(file) };
}

function resolveProjectAssetLayout(workflowRoot: string, project: string): ProjectAssetLayout {
  const candidates: ProjectAssetLayout[] = [
    { dataRelativeDir: 'www/data', gameRootRelative: 'www' },
    { dataRelativeDir: 'data', gameRootRelative: '' },
  ];
  for (const candidate of candidates) {
    if (
      getProjectFileForRead(workflowRoot, project, `${candidate.dataRelativeDir}/System.json`) ||
      getProjectFileForRead(workflowRoot, project, `${candidate.dataRelativeDir}/MapInfos.json`) ||
      fs.existsSync(path.join(project, ...candidate.dataRelativeDir.split('/')))
    ) {
      return candidate;
    }
  }
  throw new Error(`Cannot find an RPG Maker data folder under ${project}`);
}

function categoryRelativeDirectory(layout: ProjectAssetLayout, category: RmmvAssetCategory): string {
  const definition = CATEGORY_BY_ID.get(category);
  if (!definition) throw new Error(assetGraphUnsupportedCategory(category));
  return layout.gameRootRelative ? `${layout.gameRootRelative}/${definition.directory}` : definition.directory;
}

function expectedRelativePaths(layout: ProjectAssetLayout, category: RmmvAssetCategory, name: string): string[] {
  const definition = CATEGORY_BY_ID.get(category);
  if (!definition) return [];
  const directory = categoryRelativeDirectory(layout, category);
  return definition.extensions.map((extension) => `${directory}/${name}${extension}`);
}

function addAudioReference(
  context: ScanContext,
  category: RmmvAssetCategory,
  value: unknown,
  file: string,
  jsonPath: string,
  source: string,
): void {
  if (isRecord(value)) addReference(context, category, value.name, file, `${jsonPath}.name`, source);
}

function addReference(
  context: ScanContext,
  category: RmmvAssetCategory,
  rawName: unknown,
  file: string,
  jsonPath: string,
  source: string,
): void {
  const name = normalizeAssetReferenceName(rawName);
  if (!name) return;
  const key = `${category}\0${name}\0${file}\0${jsonPath}`;
  if (context.referenceKeys.has(key)) return;
  context.referenceKeys.add(key);
  context.references.push({ category, name, file, path: jsonPath, source });
}

function normalizeAssetReferenceName(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeAssetName(value: string): string {
  const name = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!name || name.split('/').some((part) => !part || part === '.' || part === '..' || /[<>:"|?*\u0000-\u001f]/.test(part))) {
    throw new Error(assetGraphNameInvalid());
  }
  return name;
}

function targetAssetName(target: AssetGraphTarget): string {
  if (target.name) return normalizeAssetName(target.name);
  if (target.relativePath) {
    const normalized = target.relativePath.replace(/\\/g, '/');
    const category = normalizeAssetCategory(target.category);
    const definition = category ? CATEGORY_BY_ID.get(category) : null;
    const marker = definition ? `${definition.directory}/` : '';
    const markerIndex = marker ? normalized.indexOf(marker) : -1;
    const withinCategory = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : path.posix.basename(normalized);
    return normalizeAssetName(withinCategory.slice(0, -path.posix.extname(withinCategory).length));
  }
  throw new Error(assetGraphNameMissing());
}

function findGraphAsset(
  graph: RmmvAssetReferenceGraph,
  target: AssetGraphTarget,
  category: RmmvAssetCategory,
  name: string,
): RmmvProjectAsset | null {
  const relative = target.relativePath ? target.relativePath.replace(/\\/g, '/') : null;
  return graph.assets.find((asset) => asset.category === category && (asset.relativePath === relative || (!relative && asset.name === name))) || null;
}

function requireCategory(category: string): RmmvAssetCategory {
  const normalized = normalizeAssetCategory(category);
  if (!normalized) throw new Error(assetGraphUnsupportedCategory(category));
  return normalized;
}

function assetKey(category: RmmvAssetCategory, name: string): string {
  return `${category}\0${name}`;
}

function forEachDatabaseEntry(value: unknown, callback: (entry: Record<string, unknown>, index: number) => void): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    if (isRecord(entry)) callback(entry, index);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function jsonPathKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
