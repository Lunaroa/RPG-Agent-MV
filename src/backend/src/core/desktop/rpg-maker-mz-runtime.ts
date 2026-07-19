import fs from 'node:fs';
import path from 'node:path';

import {
  readRpgMakerCoreIdentity,
  SUPPORTED_RPG_MAKER_MZ_VERSION,
} from '../rmmv/rpg-maker-engine.ts';

export interface RpgMakerMZProjectRuntime {
  executable: string;
  projectRoot: string;
  engineVersion: string;
}

export interface ResolveRpgMakerMZProjectRuntimeOptions {
  allowUnsupportedVersion?: boolean;
}

export class RpgMakerMZRuntimeError extends Error {}

export interface RpgMakerMZRuntimeOutputSanitizer {
  push(value: string): string;
  flush(): string;
}

export const RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES = [
  'Game.exe',
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

export const RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES = [
  'js/libs/pixi.js',
  'js/libs/pako.min.js',
  'js/libs/localforage.min.js',
  'js/libs/effekseer.min.js',
  'js/libs/effekseer.wasm',
  'js/libs/vorbisdecoder.js',
] as const;

/**
 * Known NW.js runtime payload that must stay in the project directory. Isolated
 * runs launch the original Game.exe against the temporary app directory, so
 * these files and directories are deliberately not copied into os.tmpdir().
 */
export const RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS = [
  ...RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'd3dcompiler_47.dll',
  'dxcompiler.dll',
  'dxil.dll',
  'ffmpeg.dll',
  'natives_blob.bin',
  'node.dll',
  'notification_helper.exe',
  'nwjc.exe',
  'snapshot_blob.bin',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',
  'locales',
  'Dictionaries',
  'swiftshader',
] as const;

export function redactRpgMakerMZRuntimePath(value: string, executable: string): string {
  return runtimePathCandidates(executable)
    .reduce((redacted, candidate) => redacted.replace(
      new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      '[project-local RPG Maker MZ runtime]',
    ), value);
}

/**
 * Keeps enough trailing text to redact a private path even when a process
 * writes that path across multiple stdout/stderr chunks.
 */
export function createRpgMakerMZRuntimeOutputSanitizer(
  executable: string,
): RpgMakerMZRuntimeOutputSanitizer {
  const candidates = runtimePathCandidates(executable);
  const tailLength = Math.max(0, ...candidates.map((candidate) => candidate.length - 1));
  let pending = '';
  return {
    push(value: string): string {
      if (!executable) return value;
      pending += value;
      const redacted = redactRpgMakerMZRuntimePath(pending, executable);
      const safeLength = Math.max(0, redacted.length - tailLength);
      pending = redacted.slice(safeLength);
      return redacted.slice(0, safeLength);
    },
    flush(): string {
      const redacted = redactRpgMakerMZRuntimePath(pending, executable);
      pending = '';
      return redacted;
    },
  };
}

/**
 * Validates the NW.js runtime shipped beside a project's Game.exe.
 * Validation is static: no project executable or script is run here.
 */
export function resolveRpgMakerMZProjectRuntime(
  projectDirectory: string,
  options: ResolveRpgMakerMZProjectRuntimeOptions = {},
): RpgMakerMZProjectRuntime {
  const selected = String(projectDirectory || '').trim();
  if (!selected) {
    throw new RpgMakerMZRuntimeError('Select an RPG Maker MZ project that includes its local Game.exe runtime.');
  }

  let root: string;
  try {
    root = fs.realpathSync.native(path.resolve(selected));
  } catch {
    throw new RpgMakerMZRuntimeError('The RPG Maker MZ project directory no longer exists.');
  }
  if (!isDirectory(root)) {
    throw new RpgMakerMZRuntimeError('The RPG Maker MZ project location is not a directory.');
  }
  const corePath = path.join(root, 'js', 'rmmz_core.js');
  if (!isFile(corePath)) {
    throw new RpgMakerMZRuntimeError('The RPG Maker MZ project is missing js/rmmz_core.js.');
  }
  const identity = readRpgMakerCoreIdentity(fs.readFileSync(corePath, 'utf8'));
  if (identity.name !== 'MZ' || !identity.version) {
    throw new RpgMakerMZRuntimeError(
      'The project-local runtime requires a recognizable RPG Maker MZ core version.',
    );
  }
  if (identity.version !== SUPPORTED_RPG_MAKER_MZ_VERSION && !options.allowUnsupportedVersion) {
    throw new RpgMakerMZRuntimeError(
      `The project-local runtime requires an RPG Maker MZ ${SUPPORTED_RPG_MAKER_MZ_VERSION} project.`,
    );
  }

  for (const relative of [
    ...RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
    ...RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES,
  ]) {
    if (!isFile(path.join(root, relative))) {
      throw new RpgMakerMZRuntimeError(`The project-local RPG Maker MZ runtime is incomplete: ${relative} is missing.`);
    }
  }
  const executable = path.join(root, 'Game.exe');
  assertPortableExecutable(executable);

  const locales = path.join(root, 'locales');
  if (!isDirectory(locales) || !fs.readdirSync(locales, { withFileTypes: true }).some((entry) => (
    entry.isFile() && entry.name.toLowerCase().endsWith('.pak')
  ))) {
    throw new RpgMakerMZRuntimeError('The project-local RPG Maker MZ runtime is incomplete: locales is missing or empty.');
  }

  return {
    executable,
    projectRoot: root,
    engineVersion: identity.version,
  };
}

function assertPortableExecutable(executable: string): void {
  const descriptor = fs.openSync(executable, 'r');
  try {
    const header = Buffer.alloc(2);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead !== 2 || header.toString('ascii') !== 'MZ') {
      throw new RpgMakerMZRuntimeError('The project-local Game.exe is not a Windows executable.');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function runtimePathCandidates(executable: string): string[] {
  if (!executable) return [];
  const projectDirectory = path.dirname(executable);
  const nativePaths = [executable, projectDirectory];
  return [...new Set(nativePaths.flatMap((candidate) => [
    candidate,
    candidate.replaceAll('\\', '/'),
    candidate.replaceAll('\\', '\\\\'),
  ]))]
    .filter((candidate) => candidate.length > 3)
    .sort((left, right) => right.length - left.length);
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}
