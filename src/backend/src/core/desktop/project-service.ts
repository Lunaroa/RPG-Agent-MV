import fs from 'node:fs';
import path from 'node:path';
import { execFile, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';

import type { ProjectGitBaselineResult, ProjectInfo, ProjectVersionSaveOptions } from '../../../../contract/types.ts';
import { inspectRmmvProject, type RmmvLayoutKind, type RmmvProjectManifest } from '../rmmv/rmmv-layout.ts';
import { SUPPORTED_RPG_MAKER_MZ_VERSION } from '../rmmv/rpg-maker-engine.ts';
import {
  projectCheckGitDependency,
  projectDataDirMissing,
  projectDefaultVersionCommitMessage,
  projectDirectoryMissing,
  projectGitFailed,
  projectGitMissing,
  projectGitRootMismatch,
  projectGitTimeout,
  projectInvalidMapId,
  projectJsonParseFailed,
  projectMapInfosEmpty,
  projectMapInfosMissing,
  projectMapInfosNotArray,
  projectNotEditable,
  projectNotRegistered,
  projectNotRunnable,
  projectRemoveTargetRequired,
  projectSystemJsonMissing,
  projectSystemMissingArrays,
  projectSystemNotObject,
  projectVersionEmpty,
  projectVersionInvalidChars,
  projectVersionMessageTooLong,
  projectVersionNoChanges,
  projectVersionNotInitialized,
  projectVersionReadyNoChanges,
  projectVersionSaved,
  projectVersionSavedCurrent,
  projectWorkspaceRemoveForbidden,
} from './projectServiceLocalization.ts';
import { projectAssetUrl } from './asset-service.ts';

const execFileAsync = promisify(execFile);
const DEFAULT_GIT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_GIT_WRITE_TIMEOUT_MS = 300_000;

interface RegisteredProject {
  path: string;
  name?: string;
  addedAt?: string;
  updatedAt?: string;
}

interface ProjectRegistry {
  projects?: RegisteredProject[];
}

interface ProjectValidation {
  projectPath: string;
  dataDir: string;
  layout: RmmvLayoutKind;
  resourceRoot: string;
  manifest: RmmvProjectManifest;
  gameTitle?: string;
  mapCount: number;
}

export interface ProjectCompatibilityWarning {
  detectedVersion: string;
  supportedVersion: string;
  versionMismatch: boolean;
  encryptedResources: boolean;
  encryptedImages: boolean;
  encryptedAudio: boolean;
}

export function resolveProjectPath(workflowRoot: string, project?: string): string {
  const root = path.resolve(workflowRoot);
  if (!project) return path.join(root, 'projects', 'Project');
  if (path.isAbsolute(project)) return path.resolve(project);
  if (project.startsWith('projects/') || project.startsWith('projects\\')) return path.resolve(root, project);
  return path.resolve(root, 'projects', project);
}

export function listProjects(workflowRoot: string): ProjectInfo[] {
  const projects = [
    ...listWorkspaceProjects(workflowRoot),
    ...listRegisteredProjects(workflowRoot),
  ];
  return dedupeProjects(workflowRoot, projects).sort(sortProjects);
}

export function refreshProjects(workflowRoot: string): ProjectInfo[] {
  return listProjects(workflowRoot);
}

export function registerExternalProject(
  workflowRoot: string,
  projectPath: string,
  options: { name?: string } = {},
): ProjectInfo {
  const validation = validateRmmvProjectDirectory(projectPath);
  const registry = readProjectRegistry(workflowRoot);
  const now = new Date().toISOString();
  const resolvedPath = validation.projectPath;
  const name = normalizeProjectName(options.name)
    || validation.gameTitle
    || path.basename(resolvedPath);
  const existing = (registry.projects || []).find((item) => samePath(item.path, resolvedPath));
  if (existing) {
    existing.path = resolvedPath;
    existing.name = name;
    existing.updatedAt = now;
  } else {
    registry.projects = [
      ...(registry.projects || []),
      { path: resolvedPath, name, addedAt: now, updatedAt: now },
    ];
  }
  writeProjectRegistry(workflowRoot, registry);
  return toProjectInfo({
    name,
    publicPath: resolvedPath,
    isDefault: false,
    source: 'registered',
    validation,
  });
}

export function removeRegisteredProject(workflowRoot: string, projectPath: string): ProjectInfo[] {
  const target = typeof projectPath === 'string' ? projectPath.trim() : '';
  if (!target) throw new Error(projectRemoveTargetRequired());

  const resolvedPath = resolveProjectPath(workflowRoot, target);
  const workspaceProject = listWorkspaceProjects(workflowRoot)
    .find((project) => samePath(resolveProjectPath(workflowRoot, project.path), resolvedPath));
  if (workspaceProject) {
    throw new Error(projectWorkspaceRemoveForbidden());
  }

  const registry = readProjectRegistry(workflowRoot);
  const projects = registry.projects || [];
  const nextProjects = projects.filter((item) => !samePath(item.path, resolvedPath));
  if (nextProjects.length === projects.length) {
    throw new Error(projectNotRegistered(resolvedPath));
  }

  writeProjectRegistry(workflowRoot, { ...registry, projects: nextProjects });
  return listProjects(workflowRoot);
}

export function validateRmmvProjectDirectory(projectPath: string): ProjectValidation {
  const projectRoot = path.resolve(projectPath);
  assertProjectDirectory(projectRoot);
  let manifest: RmmvProjectManifest;
  try {
    manifest = inspectRmmvProject(projectRoot);
  } catch (error) {
    throw new Error(projectNotRunnable(projectRoot, error instanceof Error ? error.message : String(error)));
  }
  if (!manifest.editable) {
    throw new Error(projectNotEditable(projectRoot, manifest.missingRequired));
  }
  return validateDataDir(projectRoot, manifest);
}

export function getProjectCompatibilityWarning(projectPath: string): ProjectCompatibilityWarning | null {
  const manifest = validateRmmvProjectDirectory(projectPath).manifest;
  if (manifest.engine !== 'rpg-maker-mz') return null;
  const versionMismatch = !manifest.engineVersionSupported;
  if (!versionMismatch && !manifest.encryptedResources) return null;
  return {
    detectedVersion: manifest.engineVersion!,
    supportedVersion: SUPPORTED_RPG_MAKER_MZ_VERSION,
    versionMismatch,
    encryptedResources: manifest.encryptedResources,
    encryptedImages: manifest.encryptedImages,
    encryptedAudio: manifest.encryptedAudio,
  };
}

function listWorkspaceProjects(workflowRoot: string): ProjectInfo[] {
  const projectsDir = path.resolve(workflowRoot, 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: ProjectInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(projectsDir, entry.name);
    let validation: ProjectValidation;
    try {
      validation = validateRmmvProjectDirectory(fullPath);
    } catch {
      continue;
    }
    projects.push({
      name: validation.gameTitle || entry.name,
      iconUrl: projectIconUrl(validation),
      path: `projects/${entry.name}`,
      isDefault: entry.name === 'Project',
      source: 'workspace',
      dataDir: validation.dataDir,
      layout: validation.layout,
      engine: validation.manifest.engine,
      engineVersion: validation.manifest.engineVersion,
      engineVersionSupported: validation.manifest.engineVersionSupported,
      encryptedResources: validation.manifest.encryptedResources,
      encryptedImages: validation.manifest.encryptedImages,
      encryptedAudio: validation.manifest.encryptedAudio,
      tileSize: validation.manifest.tileSize,
      screenWidth: validation.manifest.screenWidth,
      screenHeight: validation.manifest.screenHeight,
      faceSize: validation.manifest.faceSize,
      iconSize: validation.manifest.iconSize,
    });
  }

  return projects;
}

function listRegisteredProjects(workflowRoot: string): ProjectInfo[] {
  const registry = readProjectRegistry(workflowRoot);
  const result: ProjectInfo[] = [];
  for (const item of registry.projects || []) {
    if (!item.path) continue;
    try {
      const validation = validateRmmvProjectDirectory(item.path);
      result.push(toProjectInfo({
        name: normalizeProjectName(item.name) || validation.gameTitle || path.basename(validation.projectPath),
        publicPath: validation.projectPath,
        isDefault: false,
        source: 'registered',
        validation,
      }));
    } catch {
      continue;
    }
  }
  return result;
}

function toProjectInfo(input: {
  name: string;
  publicPath: string;
  isDefault: boolean;
  source: 'workspace' | 'registered';
  validation: ProjectValidation;
}): ProjectInfo {
  return {
    name: input.name,
    iconUrl: projectIconUrl(input.validation),
    path: input.publicPath,
    isDefault: input.isDefault,
    source: input.source,
    dataDir: input.validation.dataDir,
    layout: input.validation.layout,
    resourceRoot: input.validation.resourceRoot,
    runnableStructure: input.validation.manifest.runnableStructure,
    missingRecommended: input.validation.manifest.missingRecommended,
    engine: input.validation.manifest.engine,
    engineVersion: input.validation.manifest.engineVersion,
    engineVersionSupported: input.validation.manifest.engineVersionSupported,
    encryptedResources: input.validation.manifest.encryptedResources,
    encryptedImages: input.validation.manifest.encryptedImages,
    encryptedAudio: input.validation.manifest.encryptedAudio,
    tileSize: input.validation.manifest.tileSize,
    screenWidth: input.validation.manifest.screenWidth,
    screenHeight: input.validation.manifest.screenHeight,
    faceSize: input.validation.manifest.faceSize,
    iconSize: input.validation.manifest.iconSize,
  };
}

function dedupeProjects(workflowRoot: string, projects: ProjectInfo[]): ProjectInfo[] {
  const seen = new Set<string>();
  const result: ProjectInfo[] = [];
  for (const project of projects) {
    const resolved = resolveProjectPath(workflowRoot, project.path).toLowerCase();
    const key = path.isAbsolute(project.path) ? resolved : project.path.toLowerCase();
    if (seen.has(resolved) || seen.has(key)) continue;
    seen.add(resolved);
    seen.add(key);
    result.push(project);
  }
  return result;
}

function sortProjects(a: ProjectInfo, b: ProjectInfo): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (a.source !== b.source) return a.source === 'workspace' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function validateDataDir(projectRoot: string, manifest: RmmvProjectManifest): ProjectValidation {
  const dataDir = manifest.dataDir;
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    throw new Error(projectDataDirMissing(dataDir));
  }

  const systemPath = path.join(dataDir, 'System.json');
  const mapInfosPath = path.join(dataDir, 'MapInfos.json');
  if (!fs.existsSync(systemPath)) throw new Error(projectSystemJsonMissing(systemPath));
  if (!fs.existsSync(mapInfosPath)) throw new Error(projectMapInfosMissing(mapInfosPath));

  const system = readJsonFile(systemPath);
  if (!system || typeof system !== 'object' || Array.isArray(system)) {
    throw new Error(projectSystemNotObject(systemPath));
  }
  const systemRecord = system as Record<string, unknown>;
  if (!Array.isArray(systemRecord.switches) || !Array.isArray(systemRecord.variables)) {
    throw new Error(projectSystemMissingArrays(systemPath));
  }

  const mapInfos = readJsonFile(mapInfosPath);
  if (!Array.isArray(mapInfos)) {
    throw new Error(projectMapInfosNotArray(mapInfosPath));
  }
  const entries = mapInfos.filter(Boolean) as Array<Record<string, unknown>>;
  if (!entries.length) {
    throw new Error(projectMapInfosEmpty(mapInfosPath));
  }
  for (const entry of entries) {
    const mapId = Number(entry.id);
    if (!Number.isInteger(mapId) || mapId <= 0) {
      throw new Error(projectInvalidMapId(mapInfosPath));
    }
  }

  return {
    projectPath: projectRoot,
    dataDir,
    layout: manifest.kind,
    resourceRoot: manifest.resourceRoot,
    manifest,
    gameTitle: typeof systemRecord.gameTitle === 'string' && systemRecord.gameTitle.trim()
      ? systemRecord.gameTitle.trim()
      : undefined,
    mapCount: entries.length,
  };
}

function readProjectRegistry(workflowRoot: string): ProjectRegistry {
  const filePath = projectRegistryPath(workflowRoot);
  if (!fs.existsSync(filePath)) return {};
  const data = readJsonFile(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const source = data as ProjectRegistry;
  const projects = Array.isArray(source.projects)
    ? source.projects
        .filter((item) => item && typeof item === 'object' && typeof item.path === 'string')
        .map((item) => ({
          path: path.resolve(item.path),
          name: normalizeProjectName(item.name),
          addedAt: typeof item.addedAt === 'string' ? item.addedAt : undefined,
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
        }))
    : [];
  return projects.length ? { projects } : {};
}

function writeProjectRegistry(workflowRoot: string, registry: ProjectRegistry): void {
  const filePath = projectRegistryPath(workflowRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: ProjectRegistry = {
    projects: dedupeRegisteredProjects(registry.projects || []),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function dedupeRegisteredProjects(projects: RegisteredProject[]): RegisteredProject[] {
  const seen = new Set<string>();
  const result: RegisteredProject[] = [];
  for (const project of projects) {
    const resolved = path.resolve(project.path);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...project,
      path: resolved,
      name: normalizeProjectName(project.name),
    });
  }
  return result;
}

function projectRegistryPath(workflowRoot: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'project-registry.json');
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(projectJsonParseFailed(filePath, error instanceof Error ? error.message : String(error)));
  }
}

function normalizeProjectName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const MAX_VERSION_COMMIT_MESSAGE_LENGTH = 200;

export function initializeProjectGitBaseline(
  workflowRoot: string,
  project?: string,
  options: ProjectVersionSaveOptions = {},
): Promise<ProjectGitBaselineResult> {
  const projectPath = resolveProjectPath(workflowRoot, project);
  assertProjectDirectory(projectPath);
  return initializeProjectGitBaselineAsync(projectPath, options);
}

export function saveProjectVersion(
  workflowRoot: string,
  project?: string,
  options: ProjectVersionSaveOptions = {},
): Promise<ProjectGitBaselineResult> {
  const projectPath = resolveProjectPath(workflowRoot, project);
  assertProjectDirectory(projectPath);
  return saveProjectVersionAsync(projectPath, options);
}

async function initializeProjectGitBaselineAsync(
  projectPath: string,
  options: ProjectVersionSaveOptions,
): Promise<ProjectGitBaselineResult> {
  await assertGitAvailable(projectPath);

  const gitMarker = path.join(projectPath, '.git');
  let initialized = false;
  if (!fs.existsSync(gitMarker)) {
    await runGit(projectPath, ['init']);
    initialized = true;
  }

  const topLevel = (await runGit(projectPath, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if (!samePath(topLevel, projectPath)) {
    throw new Error(projectGitRootMismatch(topLevel));
  }

  const commitResult = await commitProjectChanges(projectPath, options);
  if (!commitResult.committed) {
    return {
      ...commitResult,
      initialized,
      message: initialized
        ? projectVersionReadyNoChanges()
        : projectVersionNoChanges(),
    };
  }

  return {
    ...commitResult,
    initialized,
    message: initialized ? projectVersionSavedCurrent() : projectVersionSaved(),
  };
}

async function saveProjectVersionAsync(
  projectPath: string,
  options: ProjectVersionSaveOptions,
): Promise<ProjectGitBaselineResult> {
  await assertGitAvailable(projectPath);

  const gitMarker = path.join(projectPath, '.git');
  if (!fs.existsSync(gitMarker)) {
    throw new Error(projectVersionNotInitialized());
  }

  const topLevel = (await runGit(projectPath, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if (!samePath(topLevel, projectPath)) {
    throw new Error(projectGitRootMismatch(topLevel));
  }

  const commitResult = await commitProjectChanges(projectPath, options);
  if (!commitResult.committed) {
    return {
      ...commitResult,
      initialized: false,
      message: projectVersionNoChanges(),
    };
  }

  return {
    ...commitResult,
    initialized: false,
    message: projectVersionSaved(),
  };
}

async function commitProjectChanges(
  projectPath: string,
  options: ProjectVersionSaveOptions,
): Promise<ProjectGitBaselineResult> {
  const beforeStatus = (await runGit(projectPath, ['status', '--porcelain', '--untracked-files=all'])).stdout.trim();
  if (!beforeStatus) {
    return {
      ok: true,
      projectPath,
      initialized: false,
      committed: false,
      message: projectVersionNoChanges(),
    };
  }

  const commitMessage = normalizeVersionCommitMessage(options.commitMessage);
  await runGit(projectPath, ['add', '-A']);
  await runGit(projectPath, ['commit', '-m', commitMessage]);
  const commitHash = (await runGit(projectPath, ['rev-parse', '--short', 'HEAD'])).stdout.trim();

  return {
    ok: true,
    projectPath,
    initialized: false,
    committed: true,
    commitHash,
    message: projectVersionSaved(),
  };
}

function normalizeVersionCommitMessage(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const message = trimmed || projectDefaultVersionCommitMessage();
  if (message.includes('\0')) {
    throw new Error(projectVersionInvalidChars());
  }
  const singleLine = message.replace(/[\r\n]+/g, ' ').trim();
  if (!singleLine) {
    throw new Error(projectVersionEmpty());
  }
  if (singleLine.length > MAX_VERSION_COMMIT_MESSAGE_LENGTH) {
    throw new Error(projectVersionMessageTooLong(MAX_VERSION_COMMIT_MESSAGE_LENGTH));
  }
  return singleLine;
}

async function assertGitAvailable(cwd: string): Promise<void> {
  await runGit(cwd, ['--version'], projectCheckGitDependency());
}

function assertProjectDirectory(projectPath: string): void {
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error(projectDirectoryMissing(projectPath));
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

async function runGit(cwd: string, args: string[], label = `git ${args.join(' ')}`): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = gitCommandTimeoutMs(args);
  const invocation = gitInvocation(args);
  try {
    const result = await execFileAsync(invocation.command, invocation.args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      stdout: stringOutput(result.stdout),
      stderr: stringOutput(result.stderr),
    };
  } catch (error) {
    const err = error as ExecFileException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string | number;
      killed?: boolean;
      signal?: NodeJS.Signals;
    };
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(projectGitMissing());
    }
    if (err.killed || err.signal === 'SIGTERM' || /timed out/i.test(err.message || '')) {
      throw new Error(projectGitTimeout(label, Math.max(1, Math.round(timeoutMs / 1000))));
    }
    const output = `${stringOutput(err.stderr)}${stringOutput(err.stdout)}`.trim();
    throw new Error(projectGitFailed(output, err.message || `git ${args.join(' ')}`));
  }
}

function gitCommandTimeoutMs(args: readonly string[]): number {
  const raw = Number(process.env.RMMV_GIT_TIMEOUT_MS || '');
  if (Number.isFinite(raw) && raw > 0) return raw;
  return args[0] === 'add' || args[0] === 'commit'
    ? DEFAULT_GIT_WRITE_TIMEOUT_MS
    : DEFAULT_GIT_READ_TIMEOUT_MS;
}

function projectIconUrl(validation: ProjectValidation): string | null {
  const iconPath = path.join(validation.resourceRoot, 'icon', 'icon.png');
  if (!fs.existsSync(iconPath) || !fs.statSync(iconPath).isFile()) return null;
  const relative = path.relative(validation.projectPath, iconPath).replace(/\\/g, '/');
  return projectAssetUrl(validation.projectPath, relative);
}

function gitInvocation(args: string[]): { command: string; args: string[] } {
  const configured = process.env.RMMV_GIT_COMMAND?.trim();
  if (!configured) return { command: 'git', args };
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(configured)) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', [configured, ...args].join(' ')],
    };
  }
  return { command: configured, args };
}

function stringOutput(value: string | Buffer | undefined): string {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}
