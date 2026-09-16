import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import { RPG_MAKER_ENGINE_PROFILES } from '../rmmv/rpg-maker-engine.ts';
import { invalidateProjectAssetReferenceGraphCache } from './project-asset-reference-graph-cache-store.ts';
import { PROJECT_FILE_ERROR_CODES, ProjectFileError } from './project-file-errors.ts';
import { withProjectFileLock } from './project-file-lock.ts';
import {
  commitProjectFileTransaction,
  type ProjectFileTransactionDependencies,
  type ProjectFileTransactionEntry,
} from './project-file-transaction.ts';

export { PROJECT_FILE_ERROR_CODES, ProjectFileError, type ProjectFileErrorCode } from './project-file-errors.ts';

export interface ProjectFileVersion {
  exists: boolean;
  sha256: string | null;
  mtimeMs: number | null;
  size: number | null;
}

export interface ProjectFileReadResult {
  relativePath: string;
  absolutePath: string;
  content: Buffer;
  version: ProjectFileVersion;
}

export type ProjectFileMutation =
  | {
    relativePath: string;
    content: Buffer;
    delete?: false;
    expectedSourceHash?: string | null;
  }
  | {
    relativePath: string;
    delete: true;
    content?: never;
    expectedSourceHash?: string | null;
  };

export interface ProjectFileBatchDependencies extends ProjectFileTransactionDependencies {
  beforeMutation?: (mutation: ProjectFileMutation & { index: number }) => void;
}

export interface ProjectMapMutationTarget {
  project: string;
  sourceProject: string;
  mapFile: string;
  ensureCompleteProjectContext: () => void;
}

export interface ProjectReadFileIndex {
  project: string;
  resolve: (relativePath: string) => string | null;
  map: (mapId: number) => string | null;
}

interface ProjectFileContext {
  workflowRoot: string;
  project: string;
  projectHash: string;
  lockFile: string;
}

const PROJECT_WRITE_LOCK_DIR = path.join('runtime', 'project-write-locks');
const MAP_CONTEXT_FILES = ['CommonEvents.json', 'MapInfos.json', 'System.json', 'Tilesets.json'];

export function projectHash(project: string): string {
  const identity = projectIdentity(project);
  return crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16);
}

export function projectRelativePathIdentity(relativePath: string): string {
  const normalized = normalizeProjectRelativePath(relativePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function readProjectFileVersion(project: string, relativePath: string): ProjectFileVersion {
  const context = buildProjectOnlyContext(project);
  const target = resolveSafeProjectPath(context.project, relativePath);
  return fileVersion(target);
}

export function readProjectFile(project: string, relativePath: string): ProjectFileReadResult {
  const context = buildProjectOnlyContext(project);
  const normalized = normalizeProjectRelativePath(relativePath);
  const absolutePath = resolveSafeProjectPath(context.project, normalized);
  if (!fs.existsSync(absolutePath)) throw new Error(`Project file does not exist: ${normalized}`);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw unsafePathError(normalized, 'The project path is not a regular file.');
  }
  const content = fs.readFileSync(absolutePath);
  return {
    relativePath: normalized,
    absolutePath,
    content,
    version: {
      exists: true,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      mtimeMs: stat.mtimeMs,
      size: content.byteLength,
    },
  };
}

export function readProjectJson<T = unknown>(project: string, relativePath: string): {
  value: T;
  file: ProjectFileReadResult;
} {
  const file = readProjectFile(project, relativePath);
  const text = file.content.toString('utf8').replace(/^\uFEFF/, '');
  return { value: JSON.parse(text) as T, file };
}

export function resolveProjectFileForRead(project: string, relativePath: string): string | null {
  const context = buildProjectOnlyContext(project);
  const target = resolveSafeProjectPath(context.project, relativePath);
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (!stat.isFile()) throw unsafePathError(relativePath, 'The project path is not a regular file.');
  return target;
}

export function resolveMapFileForRead(project: string, mapId: number): string {
  assertMapId(mapId);
  const resolvedProject = resolveProjectRoot(project);
  const relativePath = projectRelativePath(
    resolvedProject,
    path.join(resolveDataDir(resolvedProject), `Map${String(mapId).padStart(3, '0')}.json`),
  );
  return resolveProjectFileForRead(resolvedProject, relativePath)
    || path.join(resolveDataDir(resolvedProject), `Map${String(mapId).padStart(3, '0')}.json`);
}

export function createProjectReadFileIndex(project: string): ProjectReadFileIndex {
  const resolvedProject = resolveProjectRoot(project);
  const resolve = (relativePath: string): string | null => resolveProjectFileForRead(resolvedProject, relativePath);
  return {
    project: resolvedProject,
    resolve,
    map: (mapId: number) => {
      assertMapId(mapId);
      const relativePath = projectRelativePath(
        resolvedProject,
        path.join(resolveDataDir(resolvedProject), `Map${String(mapId).padStart(3, '0')}.json`),
      );
      return resolve(relativePath);
    },
  };
}

export function writeProjectJson(
  workflowRoot: string,
  project: string,
  relativePath: string,
  value: unknown,
  expectedSourceHash?: string | null,
) {
  return writeProjectBuffer(
    workflowRoot,
    project,
    relativePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
    expectedSourceHash,
  );
}

export function writeProjectBuffer(
  workflowRoot: string,
  project: string,
  relativePath: string,
  content: Buffer,
  expectedSourceHash?: string | null,
) {
  const result = writeProjectFilesAtomically(workflowRoot, project, [{
    relativePath,
    content,
    ...(expectedSourceHash !== undefined ? { expectedSourceHash } : {}),
  }]);
  return result.files[0]!;
}

export function deleteProjectFile(
  workflowRoot: string,
  project: string,
  relativePath: string,
  expectedSourceHash?: string | null,
) {
  const result = writeProjectFilesAtomically(workflowRoot, project, [{
    relativePath,
    delete: true,
    ...(expectedSourceHash !== undefined ? { expectedSourceHash } : {}),
  }]);
  return result.files[0]!;
}

export function writeProjectFilesAtomically(
  workflowRoot: string,
  project: string,
  mutations: readonly ProjectFileMutation[],
  dependencies: ProjectFileBatchDependencies = {},
) {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    throw new Error('An atomic project write requires at least one file mutation.');
  }
  const context = buildContext(workflowRoot, project);
  const normalized = mutations.map((mutation) => normalizeMutation(context.project, mutation));
  const identities = normalized.map((mutation) => projectRelativePathIdentity(mutation.relativePath));
  if (new Set(identities).size !== identities.length) {
    throw new ProjectFileError(
      PROJECT_FILE_ERROR_CODES.identityCollision,
      'The project write contains the same target path more than once.',
      { files: normalized.map((mutation) => mutation.relativePath) },
    );
  }

  return withProjectFileLock(context, () => {
    normalized.forEach((mutation, index) => {
      dependencies.beforeMutation?.({ ...mutation, index } as ProjectFileMutation & { index: number });
    });
    const baselines = normalized.map((mutation) => {
      const actual = fileVersion(mutation.targetFile);
      if (mutation.expectedSourceHash !== undefined) {
        assertExpectedSourceHash(mutation.relativePath, mutation.expectedSourceHash, actual);
      }
      return actual.sha256;
    });

    const entries: ProjectFileTransactionEntry[] = normalized.map((mutation) => (
      mutation.delete
        ? { relativePath: mutation.relativePath, targetFile: mutation.targetFile, delete: true }
        : { relativePath: mutation.relativePath, targetFile: mutation.targetFile, content: mutation.content }
    ));

    commitProjectFileTransaction(entries, {
      beforePrepare: (entry) => {
        const current = fileVersion(entry.targetFile);
        assertExpectedSourceHash(entry.relativePath, baselines[entry.index] ?? null, current);
        dependencies.beforePrepare?.(entry);
      },
      beforeReplace: dependencies.beforeReplace,
      beforeDelete: dependencies.beforeDelete,
    });

    invalidateProjectAssetReferenceGraphCache(context.project);
    return {
      project: context.project,
      files: normalized.map((mutation) => ({
        relativePath: mutation.relativePath,
        deleted: mutation.delete,
        version: fileVersion(mutation.targetFile),
      })),
    };
  });
}

export function withProjectMapMutation<T>(
  workflowRoot: string,
  project: string,
  mapId: number,
  mutation: (target: ProjectMapMutationTarget) => T,
) {
  assertMapId(mapId);
  const context = buildContext(workflowRoot, project);
  const sourceMapFile = path.join(resolveDataDir(context.project), `Map${String(mapId).padStart(3, '0')}.json`);
  const relativePath = projectRelativePath(context.project, sourceMapFile);
  const expectedSourceHash = fileVersion(resolveSafeProjectPath(context.project, relativePath)).sha256;
  const temporaryProject = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-project-write-'));
  let result!: T;
  let content!: Buffer;

  try {
    const inspected = inspectRmmvProject(context.project);
    copyMapMutationContext(context.project, temporaryProject, inspected, mapId, false);
    const temporaryMapFile = path.join(temporaryProject, relativePath);
    const target: ProjectMapMutationTarget = {
      project: temporaryProject,
      sourceProject: context.project,
      mapFile: temporaryMapFile,
      ensureCompleteProjectContext: () => copyMapMutationContext(
        context.project,
        temporaryProject,
        inspected,
        mapId,
        true,
      ),
    };
    result = mutation(target);
    if (!fs.existsSync(temporaryMapFile) || !fs.lstatSync(temporaryMapFile).isFile()) {
      throw new Error(`The map mutation did not produce a readable map file: ${relativePath}`);
    }
    content = fs.readFileSync(temporaryMapFile);
  } finally {
    fs.rmSync(temporaryProject, { recursive: true, force: true });
  }

  const written = writeProjectFilesAtomically(workflowRoot, context.project, [{
    relativePath,
    content,
    expectedSourceHash,
  }]);
  return {
    project: context.project,
    sourceProject: context.project,
    mapFile: sourceMapFile,
    result,
    write: written.files[0],
  };
}

function normalizeMutation(project: string, mutation: ProjectFileMutation) {
  if (!mutation || typeof mutation !== 'object') throw new Error('Project file mutation must be an object.');
  const relativePath = normalizeProjectRelativePath(mutation.relativePath);
  validateExpectedSourceHash(relativePath, mutation.expectedSourceHash);
  const targetFile = resolveSafeProjectPath(project, relativePath);
  if (mutation.delete === true) {
    return {
      relativePath,
      targetFile,
      delete: true as const,
      ...(mutation.expectedSourceHash !== undefined ? { expectedSourceHash: mutation.expectedSourceHash } : {}),
    };
  }
  if (!Buffer.isBuffer(mutation.content)) {
    throw new Error(`Project file content must be a Buffer: ${relativePath}`);
  }
  return {
    relativePath,
    targetFile,
    content: mutation.content,
    delete: false as const,
    ...(mutation.expectedSourceHash !== undefined ? { expectedSourceHash: mutation.expectedSourceHash } : {}),
  };
}

function assertExpectedSourceHash(relativePath: string, expected: string | null, actual: ProjectFileVersion): void {
  const matches = expected === null ? !actual.exists : actual.exists && actual.sha256 === expected;
  if (matches) return;
  throw new ProjectFileError(
    PROJECT_FILE_ERROR_CODES.conflict,
    `The project file changed after it was read: ${relativePath}. Reload the latest file before saving, or explicitly overwrite it after reviewing the difference.`,
    { relativePath, expectedSourceHash: expected, actual },
  );
}

function validateExpectedSourceHash(relativePath: string, value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new ProjectFileError(
      PROJECT_FILE_ERROR_CODES.conflict,
      `The expected project file fingerprint is invalid: ${relativePath}.`,
      { relativePath },
    );
  }
}

function fileVersion(filePath: string): ProjectFileVersion {
  if (!fs.existsSync(filePath)) return { exists: false, sha256: null, mtimeMs: null, size: null };
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw unsafePathError(filePath, 'The project write target is not a regular file.');
  }
  return {
    exists: true,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function buildContext(workflowRoot: string, project: string): ProjectFileContext {
  const root = fs.realpathSync.native(path.resolve(workflowRoot));
  const resolvedProject = resolveProjectRoot(project);
  const hash = projectHash(resolvedProject);
  return {
    workflowRoot: root,
    project: resolvedProject,
    projectHash: hash,
    lockFile: path.join(root, PROJECT_WRITE_LOCK_DIR, `${hash}.lock.sqlite`),
  };
}

function buildProjectOnlyContext(project: string): Pick<ProjectFileContext, 'project' | 'projectHash'> {
  const resolvedProject = resolveProjectRoot(project);
  return { project: resolvedProject, projectHash: projectHash(resolvedProject) };
}

function resolveProjectRoot(project: string): string {
  const resolved = path.resolve(project);
  const real = fs.realpathSync.native(resolved);
  if (!fs.statSync(real).isDirectory()) throw new Error(`Project root is not a directory: ${resolved}`);
  return real;
}

function projectIdentity(project: string): string {
  const real = resolveProjectRoot(project);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

function resolveSafeProjectPath(project: string, relativePath: string): string {
  const normalized = normalizeProjectRelativePath(relativePath);
  const root = resolveProjectRoot(project);
  const target = path.resolve(root, ...normalized.split('/'));
  if (!isInside(root, target) || target === root) {
    throw unsafePathError(relativePath, 'The project path escapes the current project.');
  }
  assertNoProjectSymlink(root, target, relativePath);
  return target;
}

function assertNoProjectSymlink(project: string, target: string, relativePath: string): void {
  const relative = path.relative(project, target);
  let current = project;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw unsafePathError(relativePath, 'Project writes through symbolic links or junctions are not allowed.');
    }
  }
}

function normalizeProjectRelativePath(value: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw unsafePathError(String(value), 'The project path is invalid.');
  }
  const portable = value.replace(/\\/g, '/');
  if (!portable
    || portable.startsWith('/')
    || portable.split('/').includes('..')
    || path.posix.isAbsolute(portable)
    || path.win32.isAbsolute(value)) {
    throw unsafePathError(value, 'The project path must be a relative path inside the current project.');
  }
  const normalized = path.posix.normalize(portable);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw unsafePathError(value, 'The project path must identify a file inside the current project.');
  }
  return normalized;
}

function unsafePathError(relativePath: string, message: string): ProjectFileError {
  return new ProjectFileError(PROJECT_FILE_ERROR_CODES.unsafePath, message, { relativePath });
}

function projectRelativePath(project: string, filePath: string): string {
  const relative = path.relative(path.resolve(project), path.resolve(filePath)).replace(/\\/g, '/');
  return normalizeProjectRelativePath(relative);
}

function assertMapId(mapId: number): void {
  if (!Number.isSafeInteger(mapId) || mapId <= 0 || mapId > 999) {
    throw new Error(`Map ID must be an integer from 1 to 999: ${String(mapId)}`);
  }
}

function copyMapMutationContext(
  sourceProject: string,
  temporaryProject: string,
  inspected: ReturnType<typeof inspectRmmvProject>,
  mapId: number,
  complete: boolean,
): void {
  const dataRoot = inspected.dataDir;
  for (const fileName of MAP_CONTEXT_FILES) {
    copyProjectContextFile(sourceProject, temporaryProject, path.join(dataRoot, fileName));
  }
  copyProjectContextFile(
    sourceProject,
    temporaryProject,
    path.join(dataRoot, `Map${String(mapId).padStart(3, '0')}.json`),
  );
  if (complete) {
    for (const mapFile of inspected.mapFiles) {
      if (mapFile.exists) copyProjectContextFile(sourceProject, temporaryProject, path.join(dataRoot, mapFile.fileName));
    }
  }
  if (inspected.engine === 'rpg-maker-mz') {
    const profile = RPG_MAKER_ENGINE_PROFILES[inspected.engine];
    copyProjectContextFile(sourceProject, temporaryProject, path.join(inspected.projectRoot, profile.projectMarker));
    for (const relative of profile.engineFiles) {
      copyProjectContextFile(
        sourceProject,
        temporaryProject,
        path.join(inspected.resourceRoot, ...relative.split('/')),
      );
    }
  }
}

function copyProjectContextFile(sourceProject: string, temporaryProject: string, sourceFile: string): void {
  if (!fs.existsSync(sourceFile) || !fs.lstatSync(sourceFile).isFile()) return;
  const relativePath = projectRelativePath(sourceProject, sourceFile);
  const targetFile = path.join(temporaryProject, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.copyFileSync(sourceFile, targetFile);
}
