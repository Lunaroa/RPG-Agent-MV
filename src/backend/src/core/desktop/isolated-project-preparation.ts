import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
): void {
  for (const entry of files) {
    const target = confinedProjectPath(temporaryProject, entry.relativePath);
    if (entry.delete) {
      fs.rmSync(target, { force: true });
      continue;
    }
    const draft = getProjectFileForRead(workflowRoot, sourceProject, entry.relativePath);
    if (!draft || !isFile(draft)) throw new IsolatedProjectPreparationError(`Staged draft is missing: ${entry.relativePath}`);
    if (!entry.draftHash || sha256(fs.readFileSync(draft)) !== entry.draftHash) {
      throw new IsolatedProjectPreparationError(`Staged draft hash changed while preparing isolated project: ${entry.relativePath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(draft, target);
    if (sha256(fs.readFileSync(target)) !== entry.draftHash) {
      throw new IsolatedProjectPreparationError(`Staged draft changed while copying isolated input: ${entry.relativePath}`);
    }
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
