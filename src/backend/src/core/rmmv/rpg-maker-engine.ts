import fs from 'node:fs';
import path from 'node:path';

export type RpgMakerEngine = 'rpg-maker-mv' | 'rpg-maker-mz';

export interface RpgMakerCanvasSettings {
  tileSize: number;
  screenWidth: number;
  screenHeight: number;
  faceSize: number;
  iconSize: number;
}

export interface RpgMakerEngineProfile {
  id: RpgMakerEngine;
  label: 'MV' | 'MZ';
  projectMarker: 'Game.rpgproject' | 'game.rmmzproject';
  coreScript: 'js/rpg_core.js' | 'js/rmmz_core.js';
  engineFiles: readonly string[];
  resourceDirs: readonly string[];
}

export const SUPPORTED_RPG_MAKER_MZ_VERSION = '1.10.0';
export const RPG_MAKER_MZ_TILE_SIZES = [16, 24, 32, 48] as const;

export const RPG_MAKER_MV_ENGINE_FILES = [
  'index.html',
  'package.json',
  'js/rpg_core.js',
  'js/rpg_managers.js',
  'js/rpg_objects.js',
  'js/rpg_scenes.js',
  'js/rpg_sprites.js',
  'js/rpg_windows.js',
  'js/main.js',
  'js/plugins.js',
] as const;

export const RPG_MAKER_MZ_ENGINE_FILES = [
  'index.html',
  'package.json',
  'js/rmmz_core.js',
  'js/rmmz_managers.js',
  'js/rmmz_objects.js',
  'js/rmmz_scenes.js',
  'js/rmmz_sprites.js',
  'js/rmmz_windows.js',
  'js/main.js',
  'js/plugins.js',
] as const;

const COMMON_RESOURCE_DIRS = [
  'audio',
  'fonts',
  'img',
  'js/plugins',
  'movies',
] as const;

export const RPG_MAKER_ENGINE_PROFILES: Record<RpgMakerEngine, RpgMakerEngineProfile> = {
  'rpg-maker-mv': {
    id: 'rpg-maker-mv',
    label: 'MV',
    projectMarker: 'Game.rpgproject',
    coreScript: 'js/rpg_core.js',
    engineFiles: RPG_MAKER_MV_ENGINE_FILES,
    resourceDirs: COMMON_RESOURCE_DIRS,
  },
  'rpg-maker-mz': {
    id: 'rpg-maker-mz',
    label: 'MZ',
    projectMarker: 'game.rmmzproject',
    coreScript: 'js/rmmz_core.js',
    engineFiles: RPG_MAKER_MZ_ENGINE_FILES,
    resourceDirs: [...COMMON_RESOURCE_DIRS, 'effects'],
  },
};

export interface RpgMakerEngineInspection {
  engine: RpgMakerEngine;
  engineVersion: string | null;
  profile: RpgMakerEngineProfile;
  canvas: RpgMakerCanvasSettings;
}

export interface RpgMakerCoreIdentity {
  name: string | null;
  version: string | null;
}

/**
 * Detects the engine from project-owned marker/core files without executing any
 * project JavaScript. Legacy MV fixtures without a marker/core remain MV for
 * backwards compatibility; any MZ signal opts into the strict MZ boundary.
 */
export function inspectRpgMakerEngine(
  projectRoot: string,
  resourceRoot: string,
  system: unknown,
): RpgMakerEngineInspection {
  const root = path.resolve(projectRoot);
  const resources = path.resolve(resourceRoot);
  const mvMarker = fileExists(path.join(root, RPG_MAKER_ENGINE_PROFILES['rpg-maker-mv'].projectMarker));
  const mzMarker = fileExists(path.join(root, RPG_MAKER_ENGINE_PROFILES['rpg-maker-mz'].projectMarker));
  const mvCore = fileExists(path.join(resources, 'js', 'rpg_core.js'));
  const mzCore = fileExists(path.join(resources, 'js', 'rmmz_core.js'));

  if ((mvMarker && mzMarker) || (mvCore && mzCore) || (mvMarker && mzCore) || (mzMarker && mvCore)) {
    throw new Error(`Conflicting RPG Maker MV/MZ project markers or core scripts under ${root}`);
  }

  const hasMZSignal = mzMarker || mzCore || hasAnyMZCoreFile(resources);
  if (!hasMZSignal) {
    return {
      engine: 'rpg-maker-mv',
      engineVersion: readMVVersion(root, resources),
      profile: RPG_MAKER_ENGINE_PROFILES['rpg-maker-mv'],
      canvas: { tileSize: 48, screenWidth: 816, screenHeight: 624, faceSize: 144, iconSize: 32 },
    };
  }

  if (!mzMarker) {
    throw new Error(
      `RPG Maker MZ projects must be editable source projects containing game.rmmzproject: ${root}`,
    );
  }
  const missingCore = RPG_MAKER_MZ_ENGINE_FILES
    .filter((relative) => !fileExists(resolveRelative(resources, relative)));
  if (missingCore.length) {
    throw new Error(`RPG Maker MZ source project is missing required runtime files: ${missingCore.join(', ')}`);
  }

  const coreSource = fs.readFileSync(path.join(resources, 'js', 'rmmz_core.js'), 'utf8');
  const { name, version } = readRpgMakerCoreIdentity(coreSource);
  if (name !== 'MZ') {
    throw new Error(`Expected RPG Maker MZ core signature, found ${name || 'none'} in js/rmmz_core.js`);
  }
  if (version !== SUPPORTED_RPG_MAKER_MZ_VERSION) {
    throw new Error(
      `RPG Maker MZ ${SUPPORTED_RPG_MAKER_MZ_VERSION} core scripts are required; found ${version || 'unknown'}. `
      + 'Open the project in RPG Maker MZ 1.10.0 and run Game > Update Corescripts.',
    );
  }

  assertUnencryptedMZSource(resources, system);

  return {
    engine: 'rpg-maker-mz',
    engineVersion: version,
    profile: RPG_MAKER_ENGINE_PROFILES['rpg-maker-mz'],
    canvas: readMZCanvasSettings(system),
  };
}

export function readRpgMakerCoreIdentity(source: string): RpgMakerCoreIdentity {
  return {
    name: readSingleConstant(source, 'RPGMAKER_NAME'),
    version: readSingleConstant(source, 'RPGMAKER_VERSION'),
  };
}

function assertUnencryptedMZSource(resourceRoot: string, system: unknown): void {
  const record = asRecord(system);
  if (record?.hasEncryptedImages === true || record?.hasEncryptedAudio === true) {
    throw new Error('Encrypted RPG Maker MZ resources are not supported; register an unencrypted editor source project.');
  }
  const encryptedExtensions = new Set(['.rpgmvp', '.rpgmvo', '.rpgmvm', '.png_', '.ogg_', '.m4a_']);
  for (const relative of ['img', 'audio', 'movies', 'effects']) {
    const root = path.join(resourceRoot, relative);
    const encrypted = firstFileWithExtension(root, encryptedExtensions);
    if (encrypted) {
      throw new Error(`Encrypted RPG Maker resource is not supported: ${path.relative(resourceRoot, encrypted).replaceAll('\\', '/')}`);
    }
  }
}

function firstFileWithExtension(root: string, extensions: ReadonlySet<string>): string | null {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) return absolute;
    }
  }
  return null;
}

export function engineLabel(engine: RpgMakerEngine): 'MV' | 'MZ' {
  return RPG_MAKER_ENGINE_PROFILES[engine].label;
}

function readMZCanvasSettings(system: unknown): RpgMakerCanvasSettings {
  const record = asRecord(system);
  const advanced = asRecord(record?.advanced);
  const tileSize = Number(record?.tileSize);
  const screenWidth = Number(advanced?.screenWidth);
  const screenHeight = Number(advanced?.screenHeight);
  const faceSize = Number(record?.faceSize);
  const iconSize = Number(record?.iconSize);

  if (!RPG_MAKER_MZ_TILE_SIZES.includes(tileSize as (typeof RPG_MAKER_MZ_TILE_SIZES)[number])) {
    throw new Error(`RPG Maker MZ System.json tileSize must be one of 16, 24, 32, or 48; found ${String(record?.tileSize)}`);
  }
  if (!Number.isInteger(screenWidth) || screenWidth <= 0 || !Number.isInteger(screenHeight) || screenHeight <= 0) {
    throw new Error('RPG Maker MZ System.json must define positive advanced.screenWidth and advanced.screenHeight values.');
  }
  if (!Number.isInteger(faceSize) || faceSize <= 0 || !Number.isInteger(iconSize) || iconSize <= 0) {
    throw new Error('RPG Maker MZ System.json must define positive faceSize and iconSize values.');
  }
  return { tileSize, screenWidth, screenHeight, faceSize, iconSize };
}

function readMVVersion(projectRoot: string, resourceRoot: string): string | null {
  const markerPath = path.join(projectRoot, 'Game.rpgproject');
  if (fileExists(markerPath)) {
    const marker = fs.readFileSync(markerPath, 'utf8');
    const match = marker.match(/\bRPGMV\s+([0-9]+(?:\.[0-9]+){1,2})\b/i);
    if (match) return match[1];
  }
  const corePath = path.join(resourceRoot, 'js', 'rpg_core.js');
  if (!fileExists(corePath)) return null;
  return readSingleConstant(fs.readFileSync(corePath, 'utf8'), 'RPGMAKER_VERSION');
}

function readSingleConstant(source: string, constant: 'RPGMAKER_NAME' | 'RPGMAKER_VERSION'): string | null {
  const expression = new RegExp(`\\bUtils\\.${constant}\\s*=\\s*["']([^"']+)["']\\s*;`, 'g');
  const matches = [...source.matchAll(expression)].map((match) => match[1]);
  if (matches.length !== 1) return null;
  return matches[0];
}

function hasAnyMZCoreFile(resourceRoot: string): boolean {
  return RPG_MAKER_MZ_ENGINE_FILES
    .filter((relative) => relative.startsWith('js/rmmz_'))
    .some((relative) => fileExists(resolveRelative(resourceRoot, relative)));
}

function resolveRelative(root: string, relative: string): string {
  return path.join(root, ...relative.split('/'));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}
