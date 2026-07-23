import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { MapPreviewLoadStage } from '../../../../contract/types.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  preflightStagedProjectFiles,
} from './staging-service.ts';

export interface IsolatedStagedFileSnapshot {
  relativePath: string;
  delete: boolean;
  draftHash: string | null;
}

export interface IsolatedStagingSnapshot {
  files: IsolatedStagedFileSnapshot[];
  digest: string;
}

export interface IsolatedProjectPreparation {
  sourceProject: string;
  temporaryProject: string;
  sourceFingerprint: string;
  saveFingerprint: string;
  staging: IsolatedStagingSnapshot;
  savesExcluded: boolean;
}

export interface IsolatedProjectSourceSnapshotEntry {
  relativePath: string;
  size: number;
  mtimeMs: number;
  hash: string;
}

export interface IsolatedMapPreviewPreparation extends IsolatedProjectPreparation {
  sourceSnapshot: IsolatedProjectSourceSnapshotEntry[];
}

export interface IsolatedMapPreviewPreparationOptions {
  excludeRelativePaths?: readonly string[];
  onStage?(stage: string): void;
  onProgress?(progress: IsolatedMapPreviewPreparationProgress): void;
}

export interface IsolatedMapPreviewPreparationProgress {
  stage: MapPreviewLoadStage;
  completed?: number;
  total?: number;
  completedBytes?: number;
  totalBytes?: number;
}

export interface IsolatedProjectStateEvidence {
  sourceUnchanged: boolean;
  savesUnchanged: boolean;
  stagingUnchanged: boolean;
  stagingError?: string;
}

export interface IsolatedProjectPreparationOptions {
  temporaryPrefix?: string;
  createTemporaryProject?: () => string;
  excludeRelativePaths?: readonly string[];
}

export class IsolatedProjectPreparationError extends Error {}

export function prepareIsolatedStagedProject(
  workflowRootInput: string,
  projectInput: string,
  options: IsolatedProjectPreparationOptions = {},
): IsolatedProjectPreparation {
  const workflowRoot = fs.realpathSync.native(path.resolve(workflowRootInput));
  let sourceProject: string;
  try {
    sourceProject = fs.realpathSync.native(path.resolve(projectInput));
  } catch {
    throw new IsolatedProjectPreparationError(`RMMV project directory does not exist: ${path.resolve(projectInput)}`);
  }
  if (!isDirectory(sourceProject)) {
    throw new IsolatedProjectPreparationError(`RMMV project directory does not exist: ${sourceProject}`);
  }

  const sourceFingerprint = fingerprintProjectSource(sourceProject);
  const saveFingerprint = fingerprintSaveState(sourceProject);
  const staging = snapshotProjectStaging(workflowRoot, sourceProject);
  const temporaryProject = (options.createTemporaryProject || (() => defaultCreateTemporaryProject(options.temporaryPrefix)))();
  try {
    copyProjectExcludingSaves(sourceProject, temporaryProject, options.excludeRelativePaths || []);
    overlayStagedProjectFiles(workflowRoot, sourceProject, temporaryProject, staging.files);
    const savesExcluded = candidateSavePaths(temporaryProject).every((candidate) => !fs.existsSync(candidate));
    if (!savesExcluded) throw new IsolatedProjectPreparationError('Temporary project copy still contains a save directory.');
    return {
      sourceProject,
      temporaryProject,
      sourceFingerprint,
      saveFingerprint,
      staging,
      savesExcluded,
    };
  } catch (error) {
    try { defaultRemoveTemporaryProject(temporaryProject); } catch { /* Report the preparation failure first. */ }
    throw error;
  }
}

export function prepareIsolatedMapPreviewProject(
  workflowRootInput: string,
  projectInput: string,
  temporaryProjectInput: string,
  options: IsolatedMapPreviewPreparationOptions = {},
): IsolatedMapPreviewPreparation {
  options.onStage?.('resolve-source-project');
  const workflowRoot = fs.realpathSync.native(path.resolve(workflowRootInput));
  let sourceProject: string;
  try {
    sourceProject = fs.realpathSync.native(path.resolve(projectInput));
  } catch {
    throw new IsolatedProjectPreparationError(`RMMV project directory does not exist: ${path.resolve(projectInput)}`);
  }
  if (!isDirectory(sourceProject)) {
    throw new IsolatedProjectPreparationError(`RMMV project directory does not exist: ${sourceProject}`);
  }
  const temporaryProject = path.resolve(temporaryProjectInput);
  reportMapPreviewProgress(options, { stage: 'checking-staged-changes' });
  options.onStage?.('snapshot-staging');
  const staging = snapshotProjectStaging(workflowRoot, sourceProject);
  options.onStage?.('fingerprint-save-state');
  const saveFingerprint = fingerprintSaveState(sourceProject);
  try {
    options.onStage?.('copy-source-project');
    const copied = copyProjectAndCaptureSnapshot(
      sourceProject,
      temporaryProject,
      options.excludeRelativePaths || [],
      (progress) => reportMapPreviewProgress(options, progress),
    );
    reportMapPreviewProgress(options, {
      stage: 'applying-staged-changes',
      completed: 0,
      total: staging.files.length,
    });
    options.onStage?.('overlay-staged-files');
    overlayStagedProjectFiles(workflowRoot, sourceProject, temporaryProject, staging.files, (completed) => {
      reportMapPreviewProgress(options, {
        stage: 'applying-staged-changes',
        completed,
        total: staging.files.length,
      });
    });
    reportMapPreviewProgress(options, {
      stage: 'verifying-isolation',
      completed: 0,
      total: copied.sourceFileCount,
    });
    validateSourceTreeMetadata(
      sourceProject,
      options.excludeRelativePaths || [],
      copied.sourceMetadata,
      (completed) => reportMapPreviewProgress(options, {
        stage: 'verifying-isolation',
        completed,
        total: copied.sourceFileCount,
      }),
    );
    options.onStage?.('validate-staging-state');
    if (snapshotProjectStaging(workflowRoot, sourceProject).digest !== staging.digest) {
      throw new IsolatedProjectPreparationError('Project staging changed while preparing the isolated preview.');
    }
    options.onStage?.('validate-save-state');
    if (fingerprintSaveState(sourceProject) !== saveFingerprint) {
      throw new IsolatedProjectPreparationError('Project save data changed while preparing the isolated preview.');
    }
    options.onStage?.('validate-isolated-output');
    const savesExcluded = candidateSavePaths(temporaryProject).every((candidate) => !fs.existsSync(candidate));
    if (!savesExcluded) throw new IsolatedProjectPreparationError('Temporary project copy still contains a save directory.');
    return {
      sourceProject,
      temporaryProject,
      sourceFingerprint: copied.sourceFingerprint,
      sourceSnapshot: copied.sourceSnapshot,
      saveFingerprint,
      staging,
      savesExcluded,
    };
  } catch (error) {
    try { defaultRemoveTemporaryProject(temporaryProject); } catch { /* Report the preparation failure first. */ }
    throw error;
  }
}

function reportMapPreviewProgress(
  options: IsolatedMapPreviewPreparationOptions,
  progress: IsolatedMapPreviewPreparationProgress,
): void {
  options.onProgress?.(progress);
}

export function verifyIsolatedSourceState(
  workflowRootInput: string,
  preparation: IsolatedProjectPreparation,
): IsolatedProjectStateEvidence {
  const workflowRoot = fs.realpathSync.native(path.resolve(workflowRootInput));
  const sourceUnchanged = safeFingerprint(() => fingerprintProjectSource(preparation.sourceProject)) === preparation.sourceFingerprint;
  const savesUnchanged = safeFingerprint(() => fingerprintSaveState(preparation.sourceProject)) === preparation.saveFingerprint;
  try {
    const stagingUnchanged = snapshotProjectStaging(workflowRoot, preparation.sourceProject).digest === preparation.staging.digest;
    return { sourceUnchanged, savesUnchanged, stagingUnchanged };
  } catch (error) {
    return { sourceUnchanged, savesUnchanged, stagingUnchanged: false, stagingError: errorMessage(error) };
  }
}

export function cleanupIsolatedProject(
  preparation: IsolatedProjectPreparation,
  removeTemporaryProject: (project: string) => void = defaultRemoveTemporaryProject,
): void {
  removeTemporaryProject(preparation.temporaryProject);
  if (fs.existsSync(preparation.temporaryProject)) {
    throw new Error(`Temporary project could not be removed: ${preparation.temporaryProject}`);
  }
}

export function snapshotProjectStaging(workflowRoot: string, project: string): IsolatedStagingSnapshot {
  const status = getProjectStagingStatus(workflowRoot, project) as {
    files?: Array<Record<string, unknown>>;
    operations?: unknown[];
    maps?: number[];
  };
  const relativePaths = (status.files || []).map((entry) => String(entry.relativePath || '')).filter(Boolean);
  const preflight = relativePaths.length
    ? preflightStagedProjectFiles(workflowRoot, project, relativePaths) as Array<Record<string, unknown>>
    : [];
  const files = preflight.map((entry) => ({
    relativePath: String(entry.relativePath || ''),
    delete: Boolean(entry.delete),
    draftHash: typeof entry.draftHash === 'string' ? entry.draftHash : null,
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const digestPayload = {
    files: preflight.map((entry) => ({
      relativePath: entry.relativePath,
      delete: Boolean(entry.delete),
      baseHash: entry.baseHash ?? null,
      sourceHash: entry.sourceHash ?? null,
      draftHash: entry.draftHash ?? null,
      recordedDraftHash: entry.recordedDraftHash ?? null,
      operationId: entry.operationId ?? null,
      conflictReasons: entry.conflictReasons ?? [],
    })).sort((left, right) => String(left.relativePath).localeCompare(String(right.relativePath))),
    operations: Array.isArray(status.operations) ? status.operations : [],
    maps: Array.isArray(status.maps) ? [...status.maps].sort((left, right) => left - right) : [],
  };
  return { files, digest: sha256(Buffer.from(JSON.stringify(digestPayload), 'utf8')) };
}

export function emptyIsolatedStagingSnapshot(): IsolatedStagingSnapshot {
  return { files: [], digest: sha256(Buffer.from(JSON.stringify({ files: [], operations: [], maps: [] }), 'utf8')) };
}

function overlayStagedProjectFiles(
  workflowRoot: string,
  sourceProject: string,
  temporaryProject: string,
  files: IsolatedStagedFileSnapshot[],
  onProgress?: (completed: number) => void,
): void {
  let completed = 0;
  for (const entry of files) {
    const target = confinedProjectPath(temporaryProject, entry.relativePath);
    if (entry.delete) {
      fs.rmSync(target, { force: true });
      completed += 1;
      onProgress?.(completed);
      continue;
    }
    const draft = getProjectFileForRead(workflowRoot, sourceProject, entry.relativePath);
    if (!draft || !isFile(draft)) throw new IsolatedProjectPreparationError(`Staged draft is missing: ${entry.relativePath}`);
    const before = fs.lstatSync(draft);
    const body = fs.readFileSync(draft);
    const after = fs.lstatSync(draft);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || !entry.draftHash || sha256(body) !== entry.draftHash) {
      throw new IsolatedProjectPreparationError(`Staged draft hash changed while preparing isolated project: ${entry.relativePath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.rpg-agent-${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, body, { flag: 'wx' });
      fs.chmodSync(temporary, after.mode);
      fs.utimesSync(temporary, after.atime, after.mtime);
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
    completed += 1;
    onProgress?.(completed);
  }
}

function copyProjectExcludingSaves(
  sourceProject: string,
  temporaryProject: string,
  excludedRelativePaths: readonly string[],
): void {
  const source = fs.realpathSync.native(path.resolve(sourceProject));
  const exclusions = excludedRelativePaths.map((relative) => normalizeRelative(relative).toLowerCase());
  fs.rmSync(temporaryProject, { recursive: true, force: true });
  fs.mkdirSync(temporaryProject, { recursive: true });
  fs.cpSync(source, temporaryProject, {
    recursive: true,
    preserveTimestamps: true,
    filter: (sourcePath) => {
      const relative = normalizeRelative(path.relative(source, sourcePath));
      if (!relative) return true;
      const lower = relative.toLowerCase();
      return !exclusions.some((excluded) => lower === excluded || lower.startsWith(`${excluded}/`))
        && lower !== '.git'
        && !lower.startsWith('.git/')
        && lower !== 'save'
        && !lower.startsWith('save/')
        && lower !== 'www/save'
        && !lower.startsWith('www/save/');
    },
  });
}

interface SourceTreeMetadataEntry {
  type: 'directory' | 'file' | 'link';
  size: number;
  mtimeMs: number;
  linkTarget?: string;
}

function copyProjectAndCaptureSnapshot(
  sourceProject: string,
  temporaryProject: string,
  excludedRelativePaths: readonly string[],
  onProgress?: (progress: IsolatedMapPreviewPreparationProgress) => void,
): {
  sourceFingerprint: string;
  sourceSnapshot: IsolatedProjectSourceSnapshotEntry[];
  sourceMetadata: Map<string, SourceTreeMetadataEntry>;
  sourceFileCount: number;
} {
  const source = fs.realpathSync.native(path.resolve(sourceProject));
  const exclusions = excludedRelativePaths.map((relative) => normalizeRelative(relative).toLowerCase());
  const excluded = (relative: string) => {
    const lower = normalizeRelative(relative).toLowerCase();
    return exclusions.some((candidate) => lower === candidate || lower.startsWith(`${candidate}/`))
      || lower === '.git'
      || lower.startsWith('.git/')
      || lower === 'save'
      || lower.startsWith('save/')
      || lower === 'www/save'
      || lower.startsWith('www/save/');
  };
  fs.rmSync(temporaryProject, { recursive: true, force: true });
  fs.mkdirSync(temporaryProject, { recursive: true });
  let scannedFiles = 0;
  onProgress?.({ stage: 'scanning-project', completed: 0 });
  const metadata = captureSourceTreeMetadata(source, excluded, () => {
    scannedFiles += 1;
    onProgress?.({ stage: 'scanning-project', completed: scannedFiles });
  });
  const sourceFiles = [...metadata.values()].filter((entry) => entry.type !== 'directory');
  const totalFiles = sourceFiles.length;
  const totalBytes = sourceFiles.reduce((sum, entry) => sum + entry.size, 0);
  onProgress?.({ stage: 'scanning-project', completed: totalFiles });
  onProgress?.({
    stage: 'copying-project',
    completed: 0,
    total: totalFiles,
    completedBytes: 0,
    totalBytes,
  });
  const sourceHash = crypto.createHash('sha256');
  const sourceSnapshot: IsolatedProjectSourceSnapshotEntry[] = [];
  const directoryTimes: Array<{ target: string; atime: Date; mtime: Date }> = [];
  let completedFiles = 0;
  let completedBytes = 0;
  for (const [relative, entry] of metadata) {
    const sourcePath = path.join(source, ...relative.split('/'));
    const targetPath = path.join(temporaryProject, ...relative.split('/'));
    if (entry.type === 'directory') {
      fs.mkdirSync(targetPath, { recursive: true });
      const stat = fs.lstatSync(sourcePath);
      directoryTimes.push({ target: targetPath, atime: stat.atime, mtime: stat.mtime });
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (entry.type === 'link') {
      const linkTarget = fs.readlinkSync(sourcePath);
      if (linkTarget !== entry.linkTarget) {
        throw new IsolatedProjectPreparationError(`Source link changed while preparing isolated preview: ${relative}`);
      }
      fs.symlinkSync(linkTarget, targetPath);
      const body = Buffer.from(linkTarget, 'utf8');
      sourceHash.update(`link:${relative}:${linkTarget}\n`);
      sourceSnapshot.push({ relativePath: relative, size: entry.size, mtimeMs: entry.mtimeMs, hash: sha256(body) });
      completedFiles += 1;
      completedBytes += entry.size;
      onProgress?.({
        stage: 'copying-project',
        completed: completedFiles,
        total: totalFiles,
        completedBytes,
        totalBytes,
      });
      continue;
    }
    const before = fs.lstatSync(sourcePath);
    const body = fs.readFileSync(sourcePath);
    const after = fs.lstatSync(sourcePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.size !== entry.size || before.mtimeMs !== entry.mtimeMs) {
      throw new IsolatedProjectPreparationError(`Source file changed while preparing isolated preview: ${relative}`);
    }
    fs.writeFileSync(targetPath, body);
    fs.chmodSync(targetPath, after.mode);
    fs.utimesSync(targetPath, after.atime, after.mtime);
    const hash = sha256(body);
    sourceHash.update(`file:${relative}:${after.size}:`);
    sourceHash.update(body);
    sourceHash.update('\n');
    sourceSnapshot.push({ relativePath: relative, size: after.size, mtimeMs: after.mtimeMs, hash });
    completedFiles += 1;
    completedBytes += after.size;
    onProgress?.({
      stage: 'copying-project',
      completed: completedFiles,
      total: totalFiles,
      completedBytes,
      totalBytes,
    });
  }
  for (const directory of directoryTimes.reverse()) {
    fs.utimesSync(directory.target, directory.atime, directory.mtime);
  }
  return {
    sourceFingerprint: sourceHash.digest('hex'),
    sourceSnapshot,
    sourceMetadata: metadata,
    sourceFileCount: totalFiles,
  };
}

function captureSourceTreeMetadata(
  root: string,
  excluded: (relative: string) => boolean,
  onFile?: () => void,
): Map<string, SourceTreeMetadataEntry> {
  const metadata = new Map<string, SourceTreeMetadataEntry>();
  const visit = (directory: string) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const directoryEntry of entries) {
      const absolute = path.join(directory, directoryEntry.name);
      const relative = normalizeRelative(path.relative(root, absolute));
      if (!relative || excluded(relative)) continue;
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) {
        metadata.set(relative, { type: 'directory', size: stat.size, mtimeMs: stat.mtimeMs });
        visit(absolute);
      } else if (stat.isSymbolicLink()) {
        metadata.set(relative, {
          type: 'link',
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          linkTarget: fs.readlinkSync(absolute),
        });
        onFile?.();
      } else if (stat.isFile()) {
        metadata.set(relative, { type: 'file', size: stat.size, mtimeMs: stat.mtimeMs });
        onFile?.();
      }
    }
  };
  visit(root);
  return new Map([...metadata].sort(([left], [right]) => left.localeCompare(right)));
}

function validateSourceTreeMetadata(
  sourceProject: string,
  excludedRelativePaths: readonly string[],
  expected: Map<string, SourceTreeMetadataEntry>,
  onProgress?: (completed: number) => void,
): void {
  const source = fs.realpathSync.native(path.resolve(sourceProject));
  const exclusions = excludedRelativePaths.map((relative) => normalizeRelative(relative).toLowerCase());
  const excluded = (relative: string) => {
    const lower = normalizeRelative(relative).toLowerCase();
    return exclusions.some((candidate) => lower === candidate || lower.startsWith(`${candidate}/`))
      || lower === '.git'
      || lower.startsWith('.git/')
      || lower === 'save'
      || lower.startsWith('save/')
      || lower === 'www/save'
      || lower.startsWith('www/save/');
  };
  let completed = 0;
  const validated = captureSourceTreeMetadata(source, excluded, () => {
    completed += 1;
    onProgress?.(completed);
  });
  if (!sameSourceTreeMetadata(expected, validated)) {
    throw new IsolatedProjectPreparationError('Project files changed while preparing the isolated preview.');
  }
}

function sameSourceTreeMetadata(
  before: Map<string, SourceTreeMetadataEntry>,
  after: Map<string, SourceTreeMetadataEntry>,
): boolean {
  if (before.size !== after.size) return false;
  for (const [relative, entry] of before) {
    const current = after.get(relative);
    if (!current || current.type !== entry.type || current.size !== entry.size
      || current.mtimeMs !== entry.mtimeMs || current.linkTarget !== entry.linkTarget) return false;
  }
  return true;
}

function fingerprintProjectSource(project: string): string {
  return fingerprintTree(project, (relative) => {
    const lower = relative.toLowerCase();
    return lower === '.git'
      || lower.startsWith('.git/')
      || lower === 'save'
      || lower.startsWith('save/')
      || lower === 'www/save'
      || lower.startsWith('www/save/');
  });
}

function fingerprintSaveState(project: string): string {
  const hash = crypto.createHash('sha256');
  for (const candidate of candidateSavePaths(project)) {
    const relative = normalizeRelative(path.relative(project, candidate));
    hash.update(`${relative}:${fs.existsSync(candidate) ? 'exists' : 'missing'}\n`);
    if (isDirectory(candidate)) hash.update(fingerprintTree(candidate, () => false));
  }
  return hash.digest('hex');
}

function fingerprintTree(root: string, exclude: (relative: string) => boolean): string {
  const hash = crypto.createHash('sha256');
  if (!fs.existsSync(root)) return hash.update('missing').digest('hex');
  for (const entry of listTreeEntries(root)) {
    const relative = normalizeRelative(path.relative(root, entry));
    if (!relative || exclude(relative)) continue;
    const stat = fs.lstatSync(entry);
    if (stat.isDirectory()) continue;
    if (stat.isSymbolicLink()) {
      hash.update(`link:${relative}:${fs.readlinkSync(entry)}\n`);
      continue;
    }
    if (!stat.isFile()) continue;
    hash.update(`file:${relative}:${stat.size}:`);
    hash.update(fs.readFileSync(entry));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function listTreeEntries(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    out.push(absolute);
    if (entry.isDirectory()) out.push(...listTreeEntries(absolute));
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function defaultCreateTemporaryProject(prefix = 'rmmv-agent-isolated-'): string {
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(prefix)) throw new Error(`Invalid temporary project prefix: ${prefix}`);
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function defaultRemoveTemporaryProject(project: string): void {
  fs.rmSync(project, { recursive: true, force: true });
}

function candidateSavePaths(project: string): string[] {
  return [path.join(project, 'save'), path.join(project, 'www', 'save')];
}

function confinedProjectPath(project: string, relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new IsolatedProjectPreparationError(`Unsafe staged project path: ${relativePath}`);
  }
  const root = path.resolve(project);
  const target = path.resolve(root, normalized);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new IsolatedProjectPreparationError(`Unsafe staged project path: ${relativePath}`);
  }
  return target;
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function safeFingerprint(read: () => string): string {
  try { return read(); } catch { return ''; }
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
