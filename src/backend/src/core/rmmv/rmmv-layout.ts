import fs from 'node:fs';
import path from 'node:path';

import {
  inspectRpgMakerEngine,
  RPG_MAKER_ENGINE_PROFILES,
  RPG_MAKER_MV_ENGINE_FILES,
  type RpgMakerEngine,
} from './rpg-maker-engine.ts';

export type RmmvLayoutKind = 'www-data' | 'data';

export interface RmmvProjectLayout {
  projectRoot: string;
  kind: RmmvLayoutKind;
  dataDir: string;
  dataRootRelative: 'www/data' | 'data';
  resourceRoot: string;
  resourceRootRelative: 'www' | '';
}

export interface RmmvProjectManifest extends RmmvProjectLayout {
  engine: RpgMakerEngine;
  engineVersion: string | null;
  tileSize: number;
  screenWidth: number;
  screenHeight: number;
  faceSize: number;
  iconSize: number;
  projectMarker: {
    gameRpgProject: boolean;
    gameRmmzProject: boolean;
    indexHtml: boolean;
    packageJson: boolean;
  };
  engineFiles: Record<string, boolean>;
  resourceDirs: Record<string, boolean>;
  databaseFiles: Record<string, boolean>;
  mapFiles: Array<{ id: number; fileName: string; exists: boolean }>;
  editable: boolean;
  runnableStructure: boolean;
  missingRequired: string[];
  missingRecommended: string[];
}

export const RMMV_STANDARD_DATABASE_FILES = [
  'Actors.json',
  'Animations.json',
  'Armors.json',
  'Classes.json',
  'CommonEvents.json',
  'Enemies.json',
  'Items.json',
  'MapInfos.json',
  'Skills.json',
  'States.json',
  'System.json',
  'Terms.json',
  'Tilesets.json',
  'Troops.json',
  'Types.json',
  'Weapons.json',
] as const;

export const RMMV_ENGINE_FILES = RPG_MAKER_MV_ENGINE_FILES;

export const RMMV_RESOURCE_DIRS = [
  'audio',
  'fonts',
  'img',
  'js/plugins',
  'movies',
] as const;

export const RMMV_ASSET_BUCKETS = {
  characters: { directory: 'img/characters', extensions: ['.png'] },
  faces: { directory: 'img/faces', extensions: ['.png'] },
  tilesets: { directory: 'img/tilesets', extensions: ['.png'] },
  animations: { directory: 'img/animations', extensions: ['.png'] },
  parallaxes: { directory: 'img/parallaxes', extensions: ['.png'] },
  pictures: { directory: 'img/pictures', extensions: ['.png'] },
  battlebacks1: { directory: 'img/battlebacks1', extensions: ['.png'] },
  battlebacks2: { directory: 'img/battlebacks2', extensions: ['.png'] },
  enemies: { directory: 'img/enemies', extensions: ['.png'] },
  svEnemies: { directory: 'img/sv_enemies', extensions: ['.png'] },
  svActors: { directory: 'img/sv_actors', extensions: ['.png'] },
  system: { directory: 'img/system', extensions: ['.png'] },
  titles1: { directory: 'img/titles1', extensions: ['.png'] },
  titles2: { directory: 'img/titles2', extensions: ['.png'] },
  bgm: { directory: 'audio/bgm', extensions: ['.ogg', '.m4a'] },
  bgs: { directory: 'audio/bgs', extensions: ['.ogg', '.m4a'] },
  me: { directory: 'audio/me', extensions: ['.ogg', '.m4a'] },
  se: { directory: 'audio/se', extensions: ['.ogg', '.m4a'] },
  movies: { directory: 'movies', extensions: ['.webm', '.mp4'] },
  fonts: { directory: 'fonts', extensions: ['.ttf', '.otf', '.woff', '.woff2'] },
  plugins: { directory: 'js/plugins', extensions: ['.js'] },
  effects: { directory: 'effects', extensions: ['.efkefc'] },
} as const;

export function resolveRmmvLayout(projectRoot: string): RmmvProjectLayout {
  const root = path.resolve(projectRoot);
  const candidates: RmmvProjectLayout[] = [
    {
      projectRoot: root,
      kind: 'www-data',
      dataDir: path.join(root, 'www', 'data'),
      dataRootRelative: 'www/data',
      resourceRoot: path.join(root, 'www'),
      resourceRootRelative: 'www',
    },
    {
      projectRoot: root,
      kind: 'data',
      dataDir: path.join(root, 'data'),
      dataRootRelative: 'data',
      resourceRoot: root,
      resourceRootRelative: '',
    },
  ];
  const foundCandidates = candidates.filter((candidate) => directoryExists(candidate.dataDir));
  const hasMZSignal = fileExists(path.join(root, 'game.rmmzproject'))
    || fileExists(path.join(root, 'js', 'rmmz_core.js'))
    || fileExists(path.join(root, 'www', 'js', 'rmmz_core.js'));
  if (hasMZSignal && foundCandidates.length > 1) {
    throw new Error(`Conflicting RPG Maker source/deployment data folders under ${root}`);
  }
  const found = foundCandidates[0];
  if (!found) throw new Error(`Cannot find an RPG Maker data folder under ${root}`);
  return found;
}

export function tryResolveRmmvLayout(projectRoot: string): RmmvProjectLayout | null {
  try {
    return resolveRmmvLayout(projectRoot);
  } catch {
    return null;
  }
}

export function resolveRmmvDataDir(projectRoot: string): string {
  return resolveRmmvLayout(projectRoot).dataDir;
}

export function inspectRmmvProject(projectRoot: string): RmmvProjectManifest {
  const layout = resolveRmmvLayout(projectRoot);
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];

  const system = readJsonIfPossible(path.join(layout.dataDir, 'System.json'));
  const engineInspection = inspectRpgMakerEngine(layout.projectRoot, layout.resourceRoot, system);
  if (engineInspection.engine === 'rpg-maker-mz' && layout.kind !== 'data') {
    throw new Error('RPG Maker MZ is supported only as an editable source project with a root data folder.');
  }
  const engineProfile = RPG_MAKER_ENGINE_PROFILES[engineInspection.engine];

  const databaseFiles = Object.fromEntries(
    RMMV_STANDARD_DATABASE_FILES.map((fileName) => [fileName, fileExists(path.join(layout.dataDir, fileName))]),
  ) as Record<string, boolean>;
  for (const fileName of ['System.json', 'MapInfos.json']) {
    if (!databaseFiles[fileName]) missingRequired.push(`${layout.dataRootRelative}/${fileName}`);
  }
  for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
    if (!databaseFiles[fileName]) missingRecommended.push(`${layout.dataRootRelative}/${fileName}`);
  }

  const mapFiles = inspectMapFiles(layout, missingRequired);
  const engineFiles = Object.fromEntries(
    engineProfile.engineFiles.map((relative) => [relative, fileExists(path.join(layout.resourceRoot, ...relative.split('/')))]),
  ) as Record<string, boolean>;
  const resourceDirs = Object.fromEntries(
    engineProfile.resourceDirs.map((relative) => [relative, directoryExists(path.join(layout.resourceRoot, ...relative.split('/')))]),
  ) as Record<string, boolean>;

  const projectMarker = {
    gameRpgProject: fileExists(path.join(layout.projectRoot, 'Game.rpgproject')),
    gameRmmzProject: fileExists(path.join(layout.projectRoot, 'game.rmmzproject')),
    indexHtml: engineFiles['index.html'],
    packageJson: engineFiles['package.json'],
  };
  for (const relative of engineProfile.engineFiles) {
    if (!engineFiles[relative]) {
      const target = resourceRelativePath(layout, relative);
      if (engineInspection.engine === 'rpg-maker-mz') missingRequired.push(target);
      else missingRecommended.push(target);
    }
  }
  for (const relative of engineProfile.resourceDirs) {
    if (!resourceDirs[relative]) missingRecommended.push(resourceRelativePath(layout, relative));
  }
  if (engineInspection.engine === 'rpg-maker-mz') {
    if (!projectMarker.gameRmmzProject) missingRequired.push('game.rmmzproject');
  } else if (!projectMarker.gameRpgProject) {
    missingRecommended.push('Game.rpgproject');
  }

  const editable = missingRequired.length === 0;
  const runnableStructure = editable
    && engineFiles['index.html']
    && engineFiles['package.json']
    && engineFiles[engineProfile.coreScript]
    && engineFiles['js/plugins.js'];

  return {
    ...layout,
    engine: engineInspection.engine,
    engineVersion: engineInspection.engineVersion,
    tileSize: engineInspection.canvas.tileSize,
    screenWidth: engineInspection.canvas.screenWidth,
    screenHeight: engineInspection.canvas.screenHeight,
    faceSize: engineInspection.canvas.faceSize,
    iconSize: engineInspection.canvas.iconSize,
    projectMarker,
    engineFiles,
    resourceDirs,
    databaseFiles,
    mapFiles,
    editable,
    runnableStructure,
    missingRequired: unique(missingRequired),
    missingRecommended: unique(missingRecommended),
  };
}

export function dataRelativePath(layout: Pick<RmmvProjectLayout, 'dataRootRelative'>, fileName: string): string {
  return `${layout.dataRootRelative}/${safeRelative(fileName)}`;
}

export function resourceRelativePath(layout: Pick<RmmvProjectLayout, 'resourceRootRelative'>, relativePath: string): string {
  const relative = safeRelative(relativePath);
  return layout.resourceRootRelative ? `${layout.resourceRootRelative}/${relative}` : relative;
}

export function assetBucketRelativePath(
  layout: Pick<RmmvProjectLayout, 'resourceRootRelative'>,
  bucket: keyof typeof RMMV_ASSET_BUCKETS,
): string {
  return resourceRelativePath(layout, RMMV_ASSET_BUCKETS[bucket].directory);
}

function inspectMapFiles(layout: RmmvProjectLayout, missingRequired: string[]): Array<{ id: number; fileName: string; exists: boolean }> {
  const mapInfosPath = path.join(layout.dataDir, 'MapInfos.json');
  if (!fileExists(mapInfosPath)) return [];
  const raw = readJsonIfPossible(mapInfosPath);
  if (!Array.isArray(raw)) {
    missingRequired.push(`${layout.dataRootRelative}/MapInfos.json: invalid array`);
    return [];
  }
  const result: Array<{ id: number; fileName: string; exists: boolean }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = Number((entry as Record<string, unknown>).id);
    if (!Number.isInteger(id) || id <= 0) {
      missingRequired.push(`${layout.dataRootRelative}/MapInfos.json: invalid map id`);
      continue;
    }
    const fileName = `Map${String(id).padStart(3, '0')}.json`;
    const exists = fileExists(path.join(layout.dataDir, fileName));
    if (!exists) missingRequired.push(`${layout.dataRootRelative}/${fileName}`);
    result.push({ id, fileName, exists });
  }
  if (!result.length) missingRequired.push(`${layout.dataRootRelative}/MapInfos.json: no maps`);
  return result;
}

function readJsonIfPossible(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function directoryExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}

function safeRelative(value: string): string {
  const relative = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid RMMV relative path: ${value}`);
  }
  return relative;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
