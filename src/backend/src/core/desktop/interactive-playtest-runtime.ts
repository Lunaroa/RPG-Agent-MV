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
  configuredRuntimeRoot?: string;
  officialRuntimeRoots?: readonly string[];
  resolveMZRuntime?: (projectDirectory: string) => RpgMakerMZProjectRuntime;
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

export function resolveInteractiveProjectRuntime(
  projectRoot: string,
  engine: RpgMakerEngine,
  options: InteractiveProjectRuntimeOptions = {},
): InteractiveProjectRuntimeResolution {
  const project = resolveExistingDirectory(projectRoot);
  const resolveMZRuntime = options.resolveMZRuntime ?? resolveInteractiveMZRuntime;
  const local = tryResolveRuntime(project, engine, 'project-local', false, resolveMZRuntime);
  if (local) return { runtime: local };

  const configured = String(options.configuredRuntimeRoot || '').trim();
  if (configured) {
    const runtime = tryResolveRuntime(configured, engine, 'configured', true, resolveMZRuntime);
    if (runtime) return { runtime };
    return { selectionRequired: { engine, reason: 'invalid' } };
  }

  for (const candidate of options.officialRuntimeRoots || []) {
    const runtime = tryResolveRuntime(candidate, engine, 'official-install', true, resolveMZRuntime);
    if (runtime) return { runtime };
  }
  return { selectionRequired: { engine, reason: 'missing' } };
}

export function validateSelectedInteractiveProjectRuntime(
  selectedRoot: string,
  engine: RpgMakerEngine,
): boolean {
  return Boolean(tryResolveRuntime(
    selectedRoot,
    engine,
    'configured',
    true,
    resolveInteractiveMZRuntime,
  ));
}

function tryResolveRuntime(
  candidateRoot: string,
  engine: RpgMakerEngine,
  source: InteractiveProjectRuntimeSource,
  allowRuntimeOnlyMV: boolean,
  resolveMZRuntime: (projectDirectory: string) => RpgMakerMZProjectRuntime,
): InteractiveProjectRuntime | null {
  let root: string;
  try {
    root = resolveExistingDirectory(candidateRoot);
  } catch {
    return null;
  }

  if (engine === 'rpg-maker-mz') {
    try {
      const runtime = resolveMZRuntime(root);
      return {
        engine,
        executable: runtime.executable,
        runtimeRoot: runtime.projectRoot,
        source,
        launchStyle: 'external',
        evidenceExecutable: source === 'project-local'
          ? 'project-local-rpg-maker-mz-nwjs'
          : `${source}-rpg-maker-mz-nwjs`,
        privateExecutable: runtime.executable,
      };
    } catch {
      return null;
    }
  }

  const executable = findCaseInsensitiveFile(root, 'game.exe');
  if (!executable || !hasCompleteMVRuntime(root) || !isPortableExecutable(executable)) return null;
  const corePath = path.join(root, 'js', 'rpg_core.js');
  if (!isFile(corePath) && (!allowRuntimeOnlyMV || !hasOfficialMVRuntimeSignature(root))) return null;
  if (isFile(corePath)) {
    const identity = readRpgMakerCoreIdentity(fs.readFileSync(corePath, 'utf8'));
    if (identity.name && identity.name !== 'MV') return null;
  }
  return {
    engine,
    executable,
    runtimeRoot: root,
    source,
    launchStyle: source === 'project-local' ? 'embedded' : 'external',
    evidenceExecutable: source === 'project-local'
      ? executable
      : `${source}-rpg-maker-mv-nwjs`,
    ...(source === 'project-local' ? {} : { privateExecutable: executable }),
  };
}

function resolveInteractiveMZRuntime(root: string): RpgMakerMZProjectRuntime {
  return resolveRpgMakerMZProjectRuntime(root, { allowUnsupportedVersion: true });
}

function hasOfficialMVRuntimeSignature(root: string): boolean {
  return isDirectory(path.join(root, 'pnacl'))
    && Boolean(findCaseInsensitiveFile(root, 'nacl_irt_x86_64.nexe'))
    && Boolean(findCaseInsensitiveFile(root, 'nacl64.exe'));
}

function hasCompleteMVRuntime(root: string): boolean {
  if (!MV_REQUIRED_RUNTIME_FILES.every((relative) => Boolean(findCaseInsensitiveFile(root, relative)))) return false;
  const locales = path.join(root, 'locales');
  return isDirectory(locales) && fs.readdirSync(locales, { withFileTypes: true }).some((entry) => (
    entry.isFile() && entry.name.toLowerCase().endsWith('.pak')
  ));
}

function resolveExistingDirectory(candidate: string): string {
  const selected = String(candidate || '').trim();
  if (!selected) throw new Error('Runtime directory is required.');
  const root = fs.realpathSync.native(path.resolve(selected));
  if (!isDirectory(root)) throw new Error('Runtime location is not a directory.');
  return root;
}

function findCaseInsensitiveFile(root: string, relative: string): string | null {
  const direct = path.join(root, relative);
  if (isFile(direct)) return direct;
  const directory = path.dirname(direct);
  if (!isDirectory(directory)) return null;
  const expected = path.basename(relative).toLowerCase();
  const match = fs.readdirSync(directory, { withFileTypes: true }).find((entry) => (
    entry.isFile() && entry.name.toLowerCase() === expected
  ));
  return match ? path.join(directory, match.name) : null;
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
