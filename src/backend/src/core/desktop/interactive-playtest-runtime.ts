import fs from 'node:fs';
import path from 'node:path';

import type { InteractivePlaytestRuntimeSelectionRequired } from '../../../../contract/types.ts';
import {
  readRpgMakerCoreIdentity,
  type RpgMakerEngine,
} from '../rmmv/rpg-maker-engine.ts';
import {
  resolveRpgMakerMZProjectRuntime,
  type RpgMakerMZProjectRuntime,
} from './rpg-maker-mz-runtime.ts';

export type InteractiveProjectRuntimeSource = 'project-local' | 'configured' | 'official-install';

export interface InteractiveProjectRuntime {
  engine: RpgMakerEngine;
  executable: string;
  runtimeRoot: string;
  source: InteractiveProjectRuntimeSource;
  launchStyle: 'embedded' | 'external';
  evidenceExecutable: string;
  privateExecutable?: string;
}

export interface InteractiveProjectRuntimeResolution {
  runtime?: InteractiveProjectRuntime;
  selectionRequired?: InteractivePlaytestRuntimeSelectionRequired;
}

export interface InteractiveProjectRuntimeOptions {
  /** Accepts the legacy runtime-directory value and the current executable-file value. */
  configuredRuntimeRoot?: string;
  officialRuntimeRoots?: readonly string[];
  resolveMZRuntime?: (projectDirectory: string) => RpgMakerMZProjectRuntime;
}

export type InteractiveProjectRuntimeValidationReason =
  | 'missing'
  | 'wrong-file'
  | 'not-executable'
  | 'incomplete'
  | 'wrong-engine'
  | 'unrecognized-install';

export interface InteractiveProjectRuntimeValidation {
  valid: boolean;
  executable?: string;
  runtimeRoot?: string;
  reason?: InteractiveProjectRuntimeValidationReason;
}

const MV_REQUIRED_RUNTIME_FILES = [
  'game.exe',
  'nw.dll',
  'nw_elf.dll',
  'node.dll',
  'icudtl.dat',
  'resources.pak',
  'libEGL.dll',
  'libGLESv2.dll',
  'd3dcompiler_47.dll',
  'ffmpeg.dll',
  'nw_100_percent.pak',
  'nw_200_percent.pak',
] as const;

export const RPG_MAKER_MZ_REQUIRED_OFFICIAL_RUNTIME_FILES = [
  'nw.exe',
  'nw.dll',
  'nw_elf.dll',
  'node.dll',
  'icudtl.dat',
  'resources.pak',
  'v8_context_snapshot.bin',
  'libEGL.dll',
  'libGLESv2.dll',
  'd3dcompiler_47.dll',
  'ffmpeg.dll',
  'nw_100_percent.pak',
  'nw_200_percent.pak',
] as const;

export function resolveInteractiveProjectRuntime(
  projectRoot: string,
  engine: RpgMakerEngine,
  options: InteractiveProjectRuntimeOptions = {},
): InteractiveProjectRuntimeResolution {
  const project = resolveExistingDirectory(projectRoot);
  const resolveMZRuntime = options.resolveMZRuntime ?? resolveInteractiveMZRuntime;
  const local = tryResolveProjectLocalRuntime(project, engine, resolveMZRuntime);
  if (local) return { runtime: local };

  const configured = String(options.configuredRuntimeRoot || '').trim();
  if (configured) {
    const runtime = tryResolveExternalRuntime(configured, engine, 'configured', resolveMZRuntime);
    if (runtime) return { runtime };
    return { selectionRequired: { engine, reason: 'invalid' } };
  }

  for (const candidate of options.officialRuntimeRoots || []) {
    const runtime = tryResolveExternalRuntime(candidate, engine, 'official-install', resolveMZRuntime);
    if (runtime) return { runtime };
  }
  return { selectionRequired: { engine, reason: 'missing' } };
}

export function inspectSelectedInteractiveProjectRuntime(
  selectedLocation: string,
  engine: RpgMakerEngine,
): InteractiveProjectRuntimeValidation {
  return engine === 'rpg-maker-mz'
    ? inspectMZRuntimeLocation(selectedLocation, resolveInteractiveMZRuntime)
    : inspectMVRuntimeLocation(selectedLocation);
}

export function validateSelectedInteractiveProjectRuntime(
  selectedLocation: string,
  engine: RpgMakerEngine,
): boolean {
  return inspectSelectedInteractiveProjectRuntime(selectedLocation, engine).valid;
}

function tryResolveProjectLocalRuntime(
  projectRoot: string,
  engine: RpgMakerEngine,
  resolveMZRuntime: (projectDirectory: string) => RpgMakerMZProjectRuntime,
): InteractiveProjectRuntime | null {
  if (engine === 'rpg-maker-mz') {
    try {
      const runtime = resolveMZRuntime(projectRoot);
      return {
        engine,
        executable: runtime.executable,
        runtimeRoot: runtime.projectRoot,
        source: 'project-local',
        launchStyle: 'external',
        evidenceExecutable: 'project-local-rpg-maker-mz-nwjs',
        privateExecutable: runtime.executable,
      };
    } catch {
      return null;
    }
  }

  const executable = findCaseInsensitiveFile(projectRoot, 'game.exe');
  if (!executable || !hasCompleteMVRuntime(projectRoot) || !isPortableExecutable(executable)) return null;
  const corePath = findCaseInsensitiveFile(projectRoot, path.join('js', 'rpg_core.js'));
  if (!corePath) return null;
  try {
    const identity = readRpgMakerCoreIdentity(fs.readFileSync(corePath, 'utf8'));
    if (identity.name && identity.name !== 'MV') return null;
  } catch {
    return null;
  }
  return {
    engine,
    executable,
    runtimeRoot: projectRoot,
    source: 'project-local',
    launchStyle: 'embedded',
    evidenceExecutable: executable,
  };
}

function tryResolveExternalRuntime(
  selectedLocation: string,
  engine: RpgMakerEngine,
  source: Exclude<InteractiveProjectRuntimeSource, 'project-local'>,
  resolveMZRuntime: (projectDirectory: string) => RpgMakerMZProjectRuntime,
): InteractiveProjectRuntime | null {
  const validation = engine === 'rpg-maker-mz'
    ? inspectMZRuntimeLocation(selectedLocation, resolveMZRuntime)
    : inspectMVRuntimeLocation(selectedLocation);
  if (!validation.valid || !validation.executable || !validation.runtimeRoot) return null;
  return {
    engine,
    executable: validation.executable,
    runtimeRoot: validation.runtimeRoot,
    source,
    launchStyle: 'external',
    evidenceExecutable: `${source}-${engine}-nwjs`,
    privateExecutable: validation.executable,
  };
}

function inspectMZRuntimeLocation(
  selectedLocation: string,
  resolveMZRuntime: (projectDirectory: string) => RpgMakerMZProjectRuntime,
): InteractiveProjectRuntimeValidation {
  const resolved = resolveRuntimeLocation(selectedLocation);
  if (!resolved) return { valid: false, reason: 'missing' };

  if (resolved.kind === 'directory') {
    try {
      const legacy = resolveMZRuntime(resolved.path);
      return {
        valid: true,
        executable: legacy.executable,
        runtimeRoot: legacy.projectRoot,
      };
    } catch {
      // Continue with the official nwjs-win runtime check.
    }
  }

  const executable = resolved.kind === 'file'
    ? resolved.path
    : findCaseInsensitiveFile(resolved.path, 'nw.exe');
  if (!executable) return { valid: false, reason: 'incomplete' };
  if (path.basename(executable).toLowerCase() !== 'nw.exe') {
    return { valid: false, reason: 'wrong-file' };
  }
  if (!isPortableExecutable(executable)) return { valid: false, reason: 'not-executable' };

  const runtimeRoot = path.dirname(executable);
  if (!hasCompleteMZOfficialRuntime(runtimeRoot)) return { valid: false, reason: 'incomplete' };
  const identity = readOfficialInstallIdentity(runtimeRoot, 'RPGMZ.exe', path.join('newdata', 'js', 'rmmz_core.js'));
  if (identity === null || identity === undefined) return { valid: false, reason: 'unrecognized-install' };
  if (identity !== 'MZ') return { valid: false, reason: 'wrong-engine' };
  return { valid: true, executable, runtimeRoot };
}

function inspectMVRuntimeLocation(selectedLocation: string): InteractiveProjectRuntimeValidation {
  const resolved = resolveRuntimeLocation(selectedLocation);
  if (!resolved) return { valid: false, reason: 'missing' };
  const executable = resolved.kind === 'file'
    ? resolved.path
    : findCaseInsensitiveFile(resolved.path, 'Game.exe');
  if (!executable) return { valid: false, reason: 'incomplete' };
  if (path.basename(executable).toLowerCase() !== 'game.exe') {
    return { valid: false, reason: 'wrong-file' };
  }
  if (!isPortableExecutable(executable)) return { valid: false, reason: 'not-executable' };

  const runtimeRoot = path.dirname(executable);
  if (!hasCompleteMVRuntime(runtimeRoot)) return { valid: false, reason: 'incomplete' };

  const projectCore = findCaseInsensitiveFile(runtimeRoot, path.join('js', 'rpg_core.js'));
  if (projectCore) {
    try {
      const identity = readRpgMakerCoreIdentity(fs.readFileSync(projectCore, 'utf8'));
      return identity.name && identity.name !== 'MV'
        ? { valid: false, reason: 'wrong-engine' }
        : { valid: true, executable, runtimeRoot };
    } catch {
      return { valid: false, reason: 'unrecognized-install' };
    }
  }

  const officialIdentity = readOfficialInstallIdentity(runtimeRoot, 'RPGMV.exe', path.join('newdata', 'js', 'rpg_core.js'));
  if (officialIdentity === 'MV' || hasLegacyMVRuntimeSignature(runtimeRoot)) {
    return { valid: true, executable, runtimeRoot };
  }
  if (officialIdentity === 'MZ') return { valid: false, reason: 'wrong-engine' };
  return { valid: false, reason: 'unrecognized-install' };
}

function resolveInteractiveMZRuntime(root: string): RpgMakerMZProjectRuntime {
  return resolveRpgMakerMZProjectRuntime(root, { allowUnsupportedVersion: true });
}

function readOfficialInstallIdentity(
  runtimeRoot: string,
  editorExecutableName: string,
  coreRelativePath: string,
): 'MV' | 'MZ' | undefined | null {
  const installRoot = path.dirname(runtimeRoot);
  if (!findCaseInsensitiveFile(installRoot, editorExecutableName)) return null;
  const corePath = findCaseInsensitiveFile(installRoot, coreRelativePath);
  if (!corePath) return null;
  return readCoreEngine(corePath);
}

function readCoreEngine(corePath: string): 'MV' | 'MZ' | undefined {
  try {
    const identity = readRpgMakerCoreIdentity(fs.readFileSync(corePath, 'utf8'));
    return identity.name === 'MV' || identity.name === 'MZ' ? identity.name : undefined;
  } catch {
    return undefined;
  }
}

function hasLegacyMVRuntimeSignature(root: string): boolean {
  return isDirectory(path.join(root, 'pnacl'))
    && Boolean(findCaseInsensitiveFile(root, 'nacl_irt_x86_64.nexe'))
    && Boolean(findCaseInsensitiveFile(root, 'nacl64.exe'));
}

function hasCompleteMZOfficialRuntime(root: string): boolean {
  return RPG_MAKER_MZ_REQUIRED_OFFICIAL_RUNTIME_FILES.every((relative) => Boolean(findCaseInsensitiveFile(root, relative)))
    && hasRuntimeLocales(root);
}

function hasCompleteMVRuntime(root: string): boolean {
  return MV_REQUIRED_RUNTIME_FILES.every((relative) => Boolean(findCaseInsensitiveFile(root, relative)))
    && hasRuntimeLocales(root);
}

function hasRuntimeLocales(root: string): boolean {
  const locales = findCaseInsensitiveDirectory(root, 'locales');
  return Boolean(locales && fs.readdirSync(locales, { withFileTypes: true }).some((entry) => (
    entry.isFile() && entry.name.toLowerCase().endsWith('.pak')
  )));
}

function resolveRuntimeLocation(candidate: string): { kind: 'file' | 'directory'; path: string } | null {
  const selected = String(candidate || '').trim();
  if (!selected) return null;
  try {
    const resolved = fs.realpathSync.native(path.resolve(selected));
    if (isFile(resolved)) return { kind: 'file', path: resolved };
    if (isDirectory(resolved)) return { kind: 'directory', path: resolved };
    return null;
  } catch {
    return null;
  }
}

function resolveExistingDirectory(candidate: string): string {
  const resolved = resolveRuntimeLocation(candidate);
  if (!resolved) throw new Error('Runtime directory does not exist.');
  if (resolved.kind !== 'directory') throw new Error('Runtime location is not a directory.');
  return resolved.path;
}

function findCaseInsensitiveFile(root: string, relative: string): string | null {
  const resolved = findCaseInsensitivePath(root, relative);
  return resolved && isFile(resolved) ? resolved : null;
}

function findCaseInsensitiveDirectory(root: string, relative: string): string | null {
  const resolved = findCaseInsensitivePath(root, relative);
  return resolved && isDirectory(resolved) ? resolved : null;
}

function findCaseInsensitivePath(root: string, relative: string): string | null {
  let current = root;
  for (const part of relative.split(/[\\/]+/).filter(Boolean)) {
    if (!isDirectory(current)) return null;
    const expected = part.toLowerCase();
    const match = fs.readdirSync(current, { withFileTypes: true }).find((entry) => (
      entry.name.toLowerCase() === expected
    ));
    if (!match) return null;
    current = path.join(current, match.name);
  }
  return current;
}

function isPortableExecutable(executable: string): boolean {
  try {
    const descriptor = fs.openSync(executable, 'r');
    try {
      const header = Buffer.alloc(2);
      const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
      return bytesRead === 2 && header.toString('ascii') === 'MZ';
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return false;
  }
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}
