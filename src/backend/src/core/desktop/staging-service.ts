import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { StagingManifestDao } from '../db/dao/staging-manifest-dao.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { STAGING_ERROR_CODES, StagingError } from './staging-errors.ts';
import { withProjectStagingLock } from './staging-lock.ts';
import {
  assertStagingWriteOwnership,
  cloneStagingOperation,
  listStagingOperationMetadata,
  normalizeStagingOperations,
  validateStagingOperationId,
  type RegisterDatabaseStagingOperationInput,
  type StagingOperation,
  type StagingOwnershipContext,
} from './staging-ownership.ts';
import { stagingSharedFilesRequireProjectAction } from './stagingServiceLocalization.ts';

export { STAGING_ERROR_CODES, StagingError, type StagingErrorCode } from './staging-errors.ts';
export type {
  RegisterDatabaseStagingOperationInput,
  StagingOperation,
  StagingOwnershipContext,
} from './staging-ownership.ts';

// Staging model v4 stores every edit as a pre-write draft under
// runtime/agent-console-staging/<projectHash>/draft.
//   - Reads prefer drafts, then source project files.
//   - Apply writes drafts back to the source project and clears draft metadata.
//   - Discard deletes only drafts and metadata, never source project files.
// Older v3 manifests used direct writes plus snapshots and are incompatible
// with v4 draft semantics, so readManifest treats version < 4 as empty.

export interface FileEntry {
  relativePath: string;
  sourceExisted: boolean;
  baseHash: string | null;
  baseMtimeMs: number | null;
  draftHash: string | null;
  updatedAt: string;
  delete?: boolean;
  operationId?: string;
}

export interface ProjectStagingActionOptions {
  rejectOperationOwned?: boolean;
}

export interface StagedMapMutationTarget {
  project: string;
  sourceProject: string;
  mapFile: string;
}

interface MapEntry extends FileEntry {
  mapId: number;
  sourceMapFile: string;
  draftMapFile: string;
}

interface Manifest {
  version: number;
  project: string;
  projectHash: string;
  maps: Record<string, MapEntry>;
  files: Record<string, FileEntry>;
  operations: Record<string, StagingOperation>;
}

interface StagingContext {
  workflowRoot: string;
  project: string;
  projectHash: string;
  stagingRoot: string;
  draftRoot: string;
  lockFile: string;
}

interface ResolvedProjectIdentity {
  project: string;
  identity: string;
  legacyHashes: string[];
}

export type StagingConflictReason =
  | { code: 'SOURCE_EXISTENCE_CHANGED'; expected: boolean; actual: boolean }
  | { code: 'SOURCE_HASH_CHANGED'; expected: string | null; actual: string | null }
  | { code: 'DRAFT_MISSING'; expected: string | null; actual: null }
  | { code: 'DRAFT_HASH_CHANGED'; expected: string | null; actual: string | null };


const STAGING_DIR = path.join('runtime', 'agent-console-staging');
const MANIFEST_VERSION = 4;
const PATCHER_CONTEXT_FILES = ['CommonEvents.json', 'MapInfos.json', 'System.json', 'Tilesets.json'];

export function projectHash(project: string): string {
  return hashProjectIdentity(resolveProjectIdentity(project).identity);
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function ensureStagedMap(
  workflowRoot: string,
  project: string,
  mapId: number,
  ownership?: StagingOwnershipContext,
) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = mapRelativePath(context.project, mapId);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    assertStagingWriteOwnership(manifest, relative, ownership, relativePathIdentity);
    const entry = ensureDraft(context, manifest, relative);
    ensureDraftProjectDataFiles(context, manifest);
    updateMapEntry(context, manifest, relative, entry);
    writeManifest(context, manifest);
    return { project: context.draftRoot, sourceProject: context.project, mapFile: draftFilePath(context, relative), staging: getStagingStatus(workflowRoot, project, mapId) };
  });
}

export function markStagedMapUpdated(
  workflowRoot: string,
  project: string,
  mapId: number,
  ownership?: StagingOwnershipContext,
) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = mapRelativePath(context.project, mapId);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    const draft = draftFilePath(context, relative);
    if (!fs.existsSync(draft)) throw new Error(`Staged map draft not found: ${relative}`);
    assertStagingWriteOwnership(manifest, relative, ownership, relativePathIdentity);
    const entry = ensureDraft(context, manifest, relative);
    entry.draftHash = fileHash(draft);
    entry.updatedAt = new Date().toISOString();
    delete entry.delete;
    updateMapEntry(context, manifest, relative, entry);
    writeManifest(context, manifest);
    return getStagingStatus(workflowRoot, project, mapId);
  });
}

export function withStagedMapMutation<T>(
  workflowRoot: string,
  project: string,
  mapId: number,
  mutation: (staged: StagedMapMutationTarget) => T,
  ownership?: StagingOwnershipContext,
) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = mapRelativePath(context.project, mapId);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    assertStagingWriteOwnership(manifest, relative, ownership, relativePathIdentity);
    const entry = ensureDraft(context, manifest, relative);
    ensureDraftProjectDataFiles(context, manifest);
    updateMapEntry(context, manifest, relative, entry);
    writeManifest(context, manifest);

    const mapFile = draftFilePath(context, relative);
    const staged = {
      project: context.draftRoot,
      sourceProject: context.project,
      mapFile,
    };
    const result = mutation(staged);
    if (!fs.existsSync(mapFile)) throw new Error(`Staged map draft not found: ${relative}`);
    entry.draftHash = fileHash(mapFile);
    entry.updatedAt = new Date().toISOString();
    delete entry.delete;
    updateMapEntry(context, manifest, relative, entry);
    writeManifest(context, manifest);
    return {
      ...staged,
      result,
      staging: getStagingStatus(workflowRoot, project, mapId),
    };
  });
}

export function getMapFileForRead(workflowRoot: string, project: string, mapId: number): string {
  const fromManifest = getProjectFileForRead(workflowRoot, project, mapRelativePath(project, mapId));
  if (fromManifest) return fromManifest;
  return path.join(resolveDataDir(project), `Map${String(mapId).padStart(3, '0')}.json`);
}

export function getProjectFileForRead(workflowRoot: string, project: string, relativePath: string): string | null {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = normalizeRelativePath(relativePath);
  const manifest = readManifest(context);
  const relative = resolveManifestRelativePath(manifest, requestedRelative);
  const entry = manifest.files[relative];
  if (entry?.delete) return null;
  if (entry) {
    const draftFile = draftFilePath(context, relative);
    if (!fs.existsSync(draftFile)) throw new Error(`Staged project file is missing: ${relative}`);
    return draftFile;
  }
  const sourceFile = sourceFilePath(context, relative);
  return fs.existsSync(sourceFile) ? sourceFile : null;
}

export function ensureStagedProjectFile(
  workflowRoot: string,
  project: string,
  relativePath: string,
  ownership?: StagingOwnershipContext,
) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = normalizeRelativePath(relativePath);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    assertStagingWriteOwnership(manifest, relative, ownership, relativePathIdentity);
    const entry = ensureDraft(context, manifest, relative);
    writeManifest(context, manifest);
    const draftFile = draftFilePath(context, relative);
    return {
      project: context.project,
      relativePath: relative,
      sourceFile: sourceFilePath(context, relative),
      draftFile,
      backupFile: draftFile,
      entry,
    };
  });
}

export function writeStagedProjectJson(
  workflowRoot: string,
  project: string,
  relativePath: string,
  value: unknown,
  ownership?: StagingOwnershipContext,
) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = normalizeRelativePath(relativePath);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    assertStagingWriteOwnership(manifest, relative, ownership, relativePathIdentity);
    const entry = ensureDraft(context, manifest, relative);
    const sourceFile = sourceFilePath(context, relative);
    const draftFile = draftFilePath(context, relative);
    writeJsonAtomic(draftFile, value);
    entry.draftHash = fileHash(draftFile);
    entry.updatedAt = new Date().toISOString();
    delete entry.delete;
    updateMapEntry(context, manifest, relative, entry);
    writeManifest(context, manifest);
    return { relativePath: relative, sourceFile, draftFile, entry };
  });
}

export function writeStagedProjectBuffer(
  workflowRoot: string,
  project: string,
  relativePath: string,
  buffer: Buffer,
  ownership?: StagingOwnershipContext,
) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = normalizeRelativePath(relativePath);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    assertStagingWriteOwnership(manifest, relative, ownership, relativePathIdentity);
    const entry = ensureDraft(context, manifest, relative);
    const sourceFile = sourceFilePath(context, relative);
    const draftFile = draftFilePath(context, relative);
    fs.mkdirSync(path.dirname(draftFile), { recursive: true });
    fs.writeFileSync(draftFile, buffer);
    entry.draftHash = fileHash(draftFile);
    entry.updatedAt = new Date().toISOString();
    delete entry.delete;
    updateMapEntry(context, manifest, relative, entry);
    writeManifest(context, manifest);
    return { relativePath: relative, sourceFile, draftFile, entry };
  });
}

export function deleteStagedProjectFile(
  workflowRoot: string,
  project: string,
  relativePath: string,
  ownership?: StagingOwnershipContext,
) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = normalizeRelativePath(relativePath);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    assertStagingWriteOwnership(manifest, relative, ownership, relativePathIdentity);
    const entry = ensureDraft(context, manifest, relative);
    const draftFile = draftFilePath(context, relative);
    if (fs.existsSync(draftFile)) fs.unlinkSync(draftFile);
    entry.delete = true;
    entry.draftHash = null;
    entry.updatedAt = new Date().toISOString();
    updateMapEntry(context, manifest, relative, entry);
    writeManifest(context, manifest);
    return { relativePath: relative, deleted: true, entry };
  });
}

export function registerDatabaseStagingOperation(
  workflowRoot: string,
  project: string,
  input: RegisterDatabaseStagingOperationInput,
): StagingOperation {
  const context = buildContext(workflowRoot, project);
  return withStagingMutationLock(context, () => {
    const operationId = validateStagingOperationId(input?.operationId);
    if (!/^[a-f0-9]{64}$/i.test(String(input?.planHash || ''))) {
      throw new StagingError(
        STAGING_ERROR_CODES.invalidPlanHash,
        'Database staging operation planHash must be a SHA-256 hex digest.',
      );
    }
    if (!Array.isArray(input?.files) || input.files.length === 0) {
      throw new StagingError(
        STAGING_ERROR_CODES.emptyFileSet,
        'Database staging operation must own at least one file.',
      );
    }

    const files = input.files.map(normalizeRelativePath);
    if (new Set(files.map(relativePathIdentity)).size !== files.length) {
      throw new StagingError(
        STAGING_ERROR_CODES.duplicateFile,
        'Database staging operation contains duplicate normalized file paths.',
      );
    }

    const manifest = readManifest(context);
    if (Object.hasOwn(manifest.operations, operationId)) {
      throw new StagingError(
        STAGING_ERROR_CODES.duplicateOperationId,
        `Database staging operation already exists: ${operationId}`,
      );
    }

    for (const relative of files) {
      const registeredRelative = resolveManifestRelativePath(manifest, relative);
      const existing = manifest.files[registeredRelative];
      if (existing?.operationId) {
        throw new StagingError(
          STAGING_ERROR_CODES.fileOwned,
          `Staged file is already owned by operation ${existing.operationId}: ${relative}`,
          { relativePath: relative, operationId: existing.operationId },
        );
      }
      if (existing) {
        throw new StagingError(
          STAGING_ERROR_CODES.unownedDraft,
          `Cannot claim an existing unowned staging draft: ${relative}`,
          { relativePath: relative },
        );
      }
      const identity = relativePathIdentity(relative);
      const owner = Object.values(manifest.operations).find((operation) => (
        operation.files.some((candidate) => relativePathIdentity(candidate) === identity)
      ));
      if (owner) {
        throw new StagingError(
          STAGING_ERROR_CODES.fileOwned,
          `Staged file is already owned by operation ${owner.operationId}: ${relative}`,
          { relativePath: relative, operationId: owner.operationId },
        );
      }
    }

    const operation: StagingOperation = {
      operationId,
      kind: 'database',
      planHash: input.planHash.toLowerCase(),
      ...(typeof input.sessionId === 'string' && input.sessionId.trim()
        ? { sessionId: input.sessionId.trim() }
        : {}),
      changes: input.changes,
      files,
      createdAt: new Date().toISOString(),
    };
    const draftSnapshots = new Map<string, Buffer | null>();
    for (const relative of files) {
      const draftFile = draftFilePath(context, relative);
      draftSnapshots.set(draftFile, fs.existsSync(draftFile) ? fs.readFileSync(draftFile) : null);
    }
    try {
      for (const relative of files) {
        const draftFile = draftFilePath(context, relative);
        const entry = ensureDraft(context, manifest, relative);
        entry.operationId = operationId;
        updateMapEntry(context, manifest, relative, entry);
      }
      manifest.operations[operationId] = operation;
      writeManifest(context, manifest);
      return cloneStagingOperation(operation);
    } catch (error) {
      for (const [draftFile, snapshot] of draftSnapshots) {
        if (snapshot === null) {
          if (fs.existsSync(draftFile)) fs.unlinkSync(draftFile);
          removeEmptyParents(path.dirname(draftFile), context.draftRoot);
          continue;
        }
        fs.mkdirSync(path.dirname(draftFile), { recursive: true });
        fs.writeFileSync(draftFile, snapshot);
      }
      throw error;
    }
  });
}

export function getDatabaseStagingOperation(
  workflowRoot: string,
  project: string,
  operationId: string,
): StagingOperation | null {
  const context = buildContext(workflowRoot, project);
  const manifest = readManifest(context);
  const validatedOperationId = validateStagingOperationId(operationId);
  const operation = Object.hasOwn(manifest.operations, validatedOperationId)
    ? manifest.operations[validatedOperationId]
    : undefined;
  return operation ? cloneStagingOperation(operation) : null;
}

export function listDatabaseStagingOperations(workflowRoot: string, project: string): StagingOperation[] {
  const manifest = readManifest(buildContext(workflowRoot, project));
  return listStagingOperationMetadata(manifest);
}

export function hasDatabaseStagingOperations(workflowRoot: string, project: string): boolean {
  return listDatabaseStagingOperations(workflowRoot, project).length > 0;
}

export function assertNoDatabaseStagingOperations(workflowRoot: string, project: string): void {
  assertManifestHasNoDatabaseOperations(readManifest(buildContext(workflowRoot, project)));
}

function assertManifestHasNoDatabaseOperations(manifest: Manifest): void {
  const operations = listStagingOperationMetadata(manifest);
  if (operations.length === 0) return;
  throw new StagingError(
    STAGING_ERROR_CODES.operationOwned,
    'Agent-owned staging operations cannot be applied or discarded through RmmvMap.',
    { operationIds: operations.map((operation) => operation.operationId) },
  );
}

export function preflightStagedProjectFiles(
  workflowRoot: string,
  project: string,
  relativePaths: readonly string[],
) {
  const context = buildContext(workflowRoot, project);
  const manifest = readManifest(context);
  const normalized = relativePaths.map(normalizeRelativePath);
  const unique = normalized.filter((relativePath, index) => (
    normalized.findIndex((candidate) => relativePathIdentity(candidate) === relativePathIdentity(relativePath)) === index
  ));
  const entries = unique.map((requestedRelativePath) => {
    const relativePath = resolveManifestRelativePath(manifest, requestedRelativePath);
    const entry = manifest.files[relativePath];
    if (!entry) {
      throw new StagingError(
        STAGING_ERROR_CODES.fileNotStaged,
        `Staged project file is not registered: ${relativePath}`,
        { relativePath },
      );
    }
    return buildFileStatus(context, manifest, relativePath, entry);
  });
  const conflicts = entries.filter((entry) => entry.conflict);
  if (conflicts.length > 0) {
    throw new StagingError(
      STAGING_ERROR_CODES.conflict,
      `Staging preflight found ${conflicts.length} conflicted file(s).`,
      { conflicts },
    );
  }
  return entries;
}

export function getStagingStatus(workflowRoot: string, project: string, mapId: number) {
  const context = buildContext(workflowRoot, project);
  const requestedRelative = mapRelativePath(context.project, mapId);
  const manifest = readManifest(context);
  const relative = resolveManifestRelativePath(manifest, requestedRelative);
  const entry = manifest.files[relative];
  if (!entry) return { staged: false, mapId };
  const status = buildFileStatus(context, manifest, relative, entry);
  return {
    ...status,
    mapId,
  };
}

export function getProjectStagingStatus(workflowRoot: string, project: string) {
  const context = buildContext(workflowRoot, project);
  const manifest = readManifest(context);
  const files = Object.entries(manifest.files).map(([relativePath, entry]) => (
    buildFileStatus(context, manifest, relativePath, entry)
  ));
  return {
    staged: files.length > 0,
    conflict: files.some((entry) => entry.conflict),
    project: context.project,
    projectHash: context.projectHash,
    files,
    maps: Object.keys(manifest.maps).map(Number).filter(Number.isFinite),
    operations: listStagingOperationMetadata(manifest),
  };
}

export function applyStagedMap(workflowRoot: string, project: string, mapId: number) {
  const context = buildContext(workflowRoot, project);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, mapRelativePath(context.project, mapId));
    assertMapOnlyOperation(manifest, relative);
    const status = getStagingStatus(workflowRoot, project, mapId);
    if (!status.staged) return { applied: false, staging: status };
    const entry = manifest.files[relative];
    applyFileEntry(context, relative, entry);
    removeFileEntry(context, manifest, relative);
    writeManifest(context, manifest);
    return { applied: true, mapId, staging: getStagingStatus(workflowRoot, project, mapId) };
  });
}

export function discardStagedMap(workflowRoot: string, project: string, mapId: number) {
  const context = buildContext(workflowRoot, project);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    const relative = resolveManifestRelativePath(manifest, mapRelativePath(context.project, mapId));
    assertMapOnlyOperation(manifest, relative);
    const entry = manifest.files[relative];
    const hadDraft = Boolean(entry);
    removeFileEntry(context, manifest, relative);
    writeManifest(context, manifest);
    return { discarded: hadDraft, mapId, staging: getStagingStatus(workflowRoot, project, mapId) };
  });
}

export function applyProjectStaging(
  workflowRoot: string,
  project: string,
  options: ProjectStagingActionOptions = {},
) {
  const context = buildContext(workflowRoot, project);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    if (options.rejectOperationOwned) assertManifestHasNoDatabaseOperations(manifest);
    const status = getProjectStagingStatus(workflowRoot, project);
    if (!status.staged) return { applied: false, staging: status };
    const files = Object.keys(manifest.files).sort();
    for (const relative of files) applyFileEntry(context, relative, manifest.files[relative]);
    clearStaging(context);
    return { applied: true, files, staging: getProjectStagingStatus(workflowRoot, project) };
  });
}

export function discardProjectStaging(
  workflowRoot: string,
  project: string,
  options: ProjectStagingActionOptions = {},
) {
  const context = buildContext(workflowRoot, project);
  return withStagingMutationLock(context, () => {
    const manifest = readManifest(context);
    if (options.rejectOperationOwned) assertManifestHasNoDatabaseOperations(manifest);
    const entries = Object.entries(manifest.files);
    const existed = entries.length > 0 || fs.existsSync(context.stagingRoot);
    clearStaging(context);
    return { discarded: existed, staging: getProjectStagingStatus(workflowRoot, project) };
  });
}

function assertMapOnlyOperation(manifest: Manifest, mapRelative: string): void {
  const registeredMapRelative = resolveManifestRelativePath(manifest, mapRelative);
  const entry = manifest.files[registeredMapRelative];
  if (entry?.operationId) {
    throw new StagingError(
      STAGING_ERROR_CODES.operationOwned,
      `Operation-owned staged map requires operation-level apply or discard: ${registeredMapRelative}`,
      { relativePath: registeredMapRelative, operationId: entry.operationId },
    );
  }
  const mapIdentity = relativePathIdentity(registeredMapRelative);
  const shared = Object.keys(manifest.files).filter((relative) => (
    relativePathIdentity(relative) !== mapIdentity && !/^(?:www\/)?data\/Map\d{3}\.json$/i.test(relative)
  ));
  if (shared.length) {
    throw new Error(stagingSharedFilesRequireProjectAction());
  }
}

function buildContext(workflowRoot: string, project: string): StagingContext {
  const root = fs.realpathSync.native(path.resolve(workflowRoot));
  const resolved = resolveProjectIdentity(project);
  const hash = hashProjectIdentity(resolved.identity);
  const legacyHashes = discoverLegacyManifestHashes(resolved.identity, hash, resolved.legacyHashes);
  const stagingRoot = path.join(root, STAGING_DIR, hash);
  const draftRoot = path.join(stagingRoot, 'draft');
  const lockFile = path.join(root, STAGING_DIR, `${hash}.lock`);
  const context = {
    workflowRoot: root,
    project: resolved.project,
    projectHash: hash,
    stagingRoot,
    draftRoot,
    lockFile,
  };
  migrateLegacyStagingIdentity(context, legacyHashes);
  return context;
}

function discoverLegacyManifestHashes(
  canonicalIdentity: string,
  canonicalHash: string,
  knownLegacyHashes: string[],
): string[] {
  const hashes = new Set(knownLegacyHashes);
  for (const row of StagingManifestDao.listAll()) {
    if (row.project_id === canonicalHash || !/^[a-f0-9]{16}$/i.test(row.project_id)) continue;
    const manifestProject = row.manifest.project;
    if (typeof manifestProject !== 'string' || !manifestProject.trim()) continue;
    try {
      if (resolveProjectIdentity(manifestProject).identity === canonicalIdentity) hashes.add(row.project_id);
    } catch {
      // A manifest whose project no longer resolves cannot be safely attributed.
    }
  }
  return Array.from(hashes);
}

function resolveProjectIdentity(project: string): ResolvedProjectIdentity {
  const resolved = path.resolve(project);
  const real = fs.realpathSync.native(resolved);
  const identity = process.platform === 'win32' ? real.toLowerCase() : real;
  const canonicalHash = hashProjectIdentity(identity);
  const legacyHashes = Array.from(new Set([resolved, real].map(hashLegacyProjectPath)))
    .filter((candidate) => candidate !== canonicalHash);
  return { project: real, identity, legacyHashes };
}

function hashProjectIdentity(identity: string): string {
  return crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16);
}

function hashLegacyProjectPath(project: string): string {
  return crypto.createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 16);
}

function migrateLegacyStagingIdentity(context: StagingContext, legacyHashes: string[]): void {
  if (!legacyHashes.some((hash) => stagingIdentityHasState(context.workflowRoot, hash))) return;
  const hashes = Array.from(new Set([context.projectHash, ...legacyHashes])).sort();
  withStagingIdentityLocks(context.workflowRoot, hashes, 0, () => {
    const legacyWithState = legacyHashes.filter((hash) => stagingIdentityHasState(context.workflowRoot, hash));
    const canonicalHasState = stagingIdentityHasState(context.workflowRoot, context.projectHash);
    if (legacyWithState.length > 1 || (canonicalHasState && legacyWithState.length > 0)) {
      throw new StagingError(
        STAGING_ERROR_CODES.identityCollision,
        'Canonical and legacy staging identities both contain state; automatic merge is forbidden.',
        { canonicalHash: context.projectHash, legacyHashes: legacyWithState },
      );
    }
    if (canonicalHasState || legacyWithState.length === 0) return;
    migrateOneLegacyStagingIdentity(context, legacyWithState[0]);
  });
}

function withStagingIdentityLocks<T>(
  workflowRoot: string,
  hashes: string[],
  index: number,
  action: () => T,
): T {
  if (index >= hashes.length) return action();
  const hash = hashes[index];
  return withProjectStagingLock({
    projectHash: hash,
    lockFile: path.join(workflowRoot, STAGING_DIR, `${hash}.lock`),
  }, () => withStagingIdentityLocks(workflowRoot, hashes, index + 1, action));
}

function stagingIdentityHasState(workflowRoot: string, hash: string): boolean {
  return Boolean(StagingManifestDao.getLatestByProject(hash))
    || fs.existsSync(path.join(workflowRoot, STAGING_DIR, hash));
}

function migrateOneLegacyStagingIdentity(context: StagingContext, legacyHash: string): void {
  const legacyRoot = path.join(context.workflowRoot, STAGING_DIR, legacyHash);
  const legacyRowExisted = Boolean(StagingManifestDao.getLatestByProject(legacyHash));
  let movedDraftTree = false;
  try {
    if (fs.existsSync(legacyRoot)) {
      if (fs.existsSync(context.stagingRoot)) {
        throw new StagingError(
          STAGING_ERROR_CODES.identityCollision,
          'Canonical staging directory appeared during legacy migration.',
          { canonicalHash: context.projectHash, legacyHash },
        );
      }
      fs.mkdirSync(path.dirname(context.stagingRoot), { recursive: true });
      fs.renameSync(legacyRoot, context.stagingRoot);
      movedDraftTree = true;
    }
    const movedRows = StagingManifestDao.rekeyProject(legacyHash, context.projectHash);
    if (legacyRowExisted && movedRows === 0) {
      throw new Error(`Legacy staging manifest disappeared during identity migration: ${legacyHash}`);
    }
  } catch (error) {
    if (movedDraftTree && fs.existsSync(context.stagingRoot) && !fs.existsSync(legacyRoot)) {
      fs.renameSync(context.stagingRoot, legacyRoot);
    }
    throw error;
  }
}

function readManifest(context: StagingContext): Manifest {
  const value = StagingManifestDao.getLatestByProject(context.projectHash)?.manifest as Manifest | undefined;
  // Ignore legacy manifests so direct-write snapshots are never treated as v4 drafts.
  if (!value || (value.version ?? 0) < MANIFEST_VERSION) {
    return {
      version: MANIFEST_VERSION,
      project: context.project,
      projectHash: context.projectHash,
      maps: {},
      files: {},
      operations: Object.create(null) as Record<string, StagingOperation>,
    };
  }
  const operations = normalizeStagingOperations(value.operations, normalizeRelativePath, relativePathIdentity);
  return {
    version: MANIFEST_VERSION,
    project: context.project,
    projectHash: context.projectHash,
    maps: value.maps || {},
    files: normalizeManifestFiles(value.files),
    operations,
  };
}

function writeManifest(context: StagingContext, manifest: Manifest): void {
  const normalized = {
    ...manifest,
    version: MANIFEST_VERSION,
    project: context.project,
    projectHash: context.projectHash,
    operations: manifest.operations || {},
  };
  const existing = StagingManifestDao.getLatestByProject(context.projectHash);
  if (existing) StagingManifestDao.update(existing.id, normalized);
  else StagingManifestDao.create(context.projectHash, normalized);
}

function normalizeManifestFiles(value: unknown): Record<string, FileEntry> {
  if (value === undefined || value === null) return Object.create(null) as Record<string, FileEntry>;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new StagingError(STAGING_ERROR_CODES.invalidManifest, 'Staging manifest files must be an object.');
  }
  const normalized = Object.create(null) as Record<string, FileEntry>;
  const identities = new Set<string>();
  for (const [rawRelativePath, rawEntry] of Object.entries(value)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new StagingError(
        STAGING_ERROR_CODES.invalidManifest,
        `Invalid staging file metadata: ${rawRelativePath}`,
      );
    }
    const relativePath = normalizeRelativePath(rawRelativePath);
    const entryRelativePath = normalizeRelativePath(
      typeof (rawEntry as Partial<FileEntry>).relativePath === 'string'
        ? (rawEntry as Partial<FileEntry>).relativePath!
        : rawRelativePath,
    );
    const identity = relativePathIdentity(relativePath);
    if (relativePathIdentity(entryRelativePath) !== identity || identities.has(identity)) {
      throw new StagingError(
        STAGING_ERROR_CODES.identityCollision,
        `Staging manifest contains colliding file identities: ${rawRelativePath}`,
        { relativePath: rawRelativePath },
      );
    }
    identities.add(identity);
    normalized[relativePath] = {
      ...(rawEntry as FileEntry),
      relativePath,
    };
  }
  return normalized;
}

function buildFileStatus(
  context: StagingContext,
  manifest: Manifest,
  relativePath: string,
  entry: FileEntry,
) {
  const sourceFile = sourceFilePath(context, relativePath);
  const sourceExists = fs.existsSync(sourceFile);
  const sourceHash = sourceExists ? fileHash(sourceFile) : null;
  const draftHash = stagedFileHash(context, relativePath);
  const conflictReasons: StagingConflictReason[] = [];
  if (sourceExists !== entry.sourceExisted) {
    conflictReasons.push({
      code: 'SOURCE_EXISTENCE_CHANGED',
      expected: entry.sourceExisted,
      actual: sourceExists,
    });
  } else if (sourceExists && sourceHash !== entry.baseHash) {
    conflictReasons.push({
      code: 'SOURCE_HASH_CHANGED',
      expected: entry.baseHash,
      actual: sourceHash,
    });
  }
  if (!entry.delete && draftHash === null) {
    conflictReasons.push({ code: 'DRAFT_MISSING', expected: entry.draftHash, actual: null });
  }
  if (draftHash !== entry.draftHash) {
    conflictReasons.push({
      code: 'DRAFT_HASH_CHANGED',
      expected: entry.draftHash,
      actual: draftHash,
    });
  }
  const operation = entry.operationId ? manifest.operations[entry.operationId] : undefined;
  return {
    staged: true,
    relativePath,
    delete: Boolean(entry.delete),
    sourceExisted: entry.sourceExisted,
    baseMtimeMs: entry.baseMtimeMs,
    dirty: isDirty(entry, draftHash),
    conflict: conflictReasons.length > 0,
    conflictReasons,
    baseHash: entry.baseHash,
    sourceHash,
    draftHash,
    recordedDraftHash: entry.draftHash,
    updatedAt: entry.updatedAt,
    ...(entry.operationId
      ? { operationId: entry.operationId, operation: operation ? cloneStagingOperation(operation) : null }
      : {}),
  };
}

// Creates the first draft for a file, records source baseline metadata, and
// copies the source file into the runtime draft area.
function ensureDraft(context: StagingContext, manifest: Manifest, relative: string): FileEntry {
  relative = resolveManifestRelativePath(manifest, relative);
  const existing = manifest.files[relative];
  if (existing) return existing;
  const sourceFile = sourceFilePath(context, relative);
  const sourceExisted = fs.existsSync(sourceFile);
  const stat = sourceExisted ? fs.statSync(sourceFile) : null;
  const baseHash = sourceExisted ? fileHash(sourceFile) : null;
  const entry: FileEntry = {
    relativePath: relative,
    sourceExisted,
    baseHash,
    baseMtimeMs: stat?.mtimeMs ?? null,
    draftHash: baseHash,
    updatedAt: new Date().toISOString(),
  };
  if (sourceExisted) {
    const draftFile = draftFilePath(context, relative);
    fs.mkdirSync(path.dirname(draftFile), { recursive: true });
    fs.copyFileSync(sourceFile, draftFile);
  }
  manifest.files[relative] = entry;
  return entry;
}

function updateMapEntry(context: StagingContext, manifest: Manifest, relative: string, entry: FileEntry): void {
  if (!mapFilePattern().test(relative)) return;
  const mapId = Number(path.basename(relative, '.json').slice(3));
  manifest.maps[String(mapId)] = {
    ...entry,
    mapId,
    sourceMapFile: sourceFilePath(context, relative),
    draftMapFile: draftFilePath(context, relative),
  };
}

function removeFileEntry(context: StagingContext, manifest: Manifest, relative: string): void {
  relative = resolveManifestRelativePath(manifest, relative);
  const draftFile = draftFilePath(context, relative);
  if (fs.existsSync(draftFile)) fs.unlinkSync(draftFile);
  delete manifest.files[relative];
  const match = /^(?:www\/)?data\/Map(\d{3})\.json$/i.exec(relative);
  if (match) delete manifest.maps[String(Number(match[1]))];
}

function applyFileEntry(context: StagingContext, relative: string, entry: FileEntry | undefined): void {
  if (!entry) return;
  const sourceFile = sourceFilePath(context, relative);
  if (entry.delete) {
    if (fs.existsSync(sourceFile)) fs.unlinkSync(sourceFile);
    return;
  }
  const draftFile = draftFilePath(context, relative);
  if (!fs.existsSync(draftFile)) throw new Error(`Staged project file is missing: ${relative}`);
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.copyFileSync(draftFile, sourceFile);
}

function clearStaging(context: StagingContext): void {
  if (fs.existsSync(context.stagingRoot)) fs.rmSync(context.stagingRoot, { recursive: true, force: true });
  StagingManifestDao.deleteByProject(context.projectHash);
}

function isDirty(entry: FileEntry, draftHash: string | null): boolean {
  if (entry.delete) return true;
  return entry.sourceExisted ? draftHash !== entry.baseHash : draftHash !== null;
}

function sourceFilePath(context: StagingContext, relative: string): string {
  return path.join(context.project, relative);
}

function draftFilePath(context: StagingContext, relative: string): string {
  return path.join(context.draftRoot, relative);
}

function stagedFileHash(context: StagingContext, relative: string): string | null {
  const draftFile = draftFilePath(context, relative);
  return fs.existsSync(draftFile) ? fileHash(draftFile) : null;
}

function ensureDraftProjectDataFiles(context: StagingContext, manifest: Manifest): void {
  const dataRoot = resolveDataDir(context.project);
  for (const fileName of PATCHER_CONTEXT_FILES) {
    const requestedRelative = projectRelativePath(context.project, path.join(dataRoot, fileName));
    const relative = resolveManifestRelativePath(manifest, requestedRelative);
    const entry = manifest.files[relative];
    if (entry?.delete) continue;
    const source = entry ? draftFilePath(context, relative) : sourceFilePath(context, relative);
    if (!fs.existsSync(source)) continue;
    const target = draftFilePath(context, relative);
    if (path.resolve(source) === path.resolve(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function withStagingMutationLock<T>(context: StagingContext, action: () => T): T {
  return withProjectStagingLock(context, action);
}

function removeEmptyParents(start: string, stop: string): void {
  let current = path.resolve(start);
  const boundary = path.resolve(stop);
  while (current !== boundary && isInside(boundary, current)) {
    try {
      fs.rmdirSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        current = path.dirname(current);
        continue;
      }
      if (code === 'ENOTEMPTY' || code === 'EEXIST') return;
      throw error;
    }
    current = path.dirname(current);
  }
}

function normalizeRelativePath(value: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new StagingError(STAGING_ERROR_CODES.unsafePath, `Unsafe staging path: ${String(value)}`);
  }
  const portable = value.replace(/\\/g, '/');
  if (!portable
    || portable.startsWith('/')
    || portable.split('/').includes('..')
    || path.posix.isAbsolute(portable)
    || path.win32.isAbsolute(value)) {
    throw new StagingError(STAGING_ERROR_CODES.unsafePath, `Unsafe staging path: ${value}`);
  }
  const relative = path.posix.normalize(portable);
  if (!relative || relative === '.' || relative === '..' || relative.startsWith('../')) {
    throw new StagingError(STAGING_ERROR_CODES.unsafePath, `Unsafe staging path: ${value}`);
  }
  return relative;
}

function relativePathIdentity(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function resolveManifestRelativePath(manifest: Manifest, relativePath: string): string {
  const requested = normalizeRelativePath(relativePath);
  const identity = relativePathIdentity(requested);
  const matches = Object.keys(manifest.files).filter((candidate) => relativePathIdentity(candidate) === identity);
  if (matches.length > 1) {
    throw new StagingError(
      STAGING_ERROR_CODES.identityCollision,
      `Staging manifest contains colliding file identities: ${requested}`,
      { relativePath: requested, matches },
    );
  }
  return matches[0] || requested;
}

function mapRelativePath(project: string, mapId: number): string {
  return projectRelativePath(project, path.join(resolveDataDir(project), `Map${String(mapId).padStart(3, '0')}.json`));
}

function projectRelativePath(project: string, filePath: string): string {
  const relative = path.relative(path.resolve(project), path.resolve(filePath)).replace(/\\/g, '/');
  return normalizeRelativePath(relative);
}

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function mapFilePattern(): RegExp {
  return /^(?:www\/)?data\/Map\d{3}\.json$/i;
}
