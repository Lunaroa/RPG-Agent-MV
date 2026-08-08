import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  UiDesignerRuntimeStageResult as ContractUiDesignerRuntimeStageResult,
  UiRuntimeSceneExport,
  UiRuntimeStatus,
} from '../../../../contract/ui-designer.ts';
import {
  inspectRmmvProject,
  resourceRelativePath,
  resolveRmmvLayout,
} from '../rmmv/rmmv-layout.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  stageProjectFilesAtomically,
} from './staging-service.ts';
import { writeFileAtomically } from './ui-designer-service.ts';
import { validateUiRuntimeSceneExport } from './ui-designer-validation.ts';
import { uiDesignerProjectCompatibility, unsupportedUiDesignerProjectCompatibility } from './ui-designer-compatibility.ts';

export const UI_DESIGNER_RUNTIME_PLUGIN_NAME = 'MZUIRuntime';
export const UI_DESIGNER_RUNTIME_VERSION = '1.0.0';
export const UI_DESIGNER_RUNTIME_RELATIVE_PATH = 'js/plugins/MZUIRuntime.js';
export const UI_DESIGNER_SCENE_DIRECTORY = 'js/plugins/mzui-data';

export type UiDesignerRuntimeInspectionState =
  | 'missing'
  | 'file-unconfigured'
  | 'configured-disabled'
  | 'enabled-compatible'
  | 'version-too-old'
  | 'content-mismatch'
  | 'staged-pending'
  | 'error';

export interface UiDesignerRuntimeInspection extends UiRuntimeStatus {
  state: UiDesignerRuntimeInspectionState;
  runtimeRelativePath: string;
  pluginConfigRelativePath: string;
  digest: string | null;
  expectedDigest: string;
  affectedFiles: string[];
  needsConfirmation: boolean;
}

export interface UiDesignerRuntimeStageOptions {
  enable?: boolean;
  forceModifiedRuntime?: boolean;
  sceneRelativePath?: string;
  overwrite?: boolean;
}

export interface UiDesignerRuntimeStageResult extends ContractUiDesignerRuntimeStageResult {
  runtime: UiDesignerRuntimeInspection;
}

export class UiDesignerRuntimeModifiedError extends Error {
  readonly code = 'UI_DESIGNER_RUNTIME_MODIFIED';
  readonly recoverable = true;

  constructor() {
    super('The project contains a modified MZUI runtime. Review or explicitly replace it before staging an update.');
    this.name = 'UiDesignerRuntimeModifiedError';
  }
}

export class UiDesignerRuntimeEnableRequiredError extends Error {
  readonly code = 'UI_DESIGNER_RUNTIME_ENABLE_REQUIRED';
  readonly recoverable = false;

  constructor() {
    super('Runtime installation must explicitly enable MZUIRuntime; no project files were staged.');
    this.name = 'UiDesignerRuntimeEnableRequiredError';
  }
}

export class UiDesignerSceneOverwriteRequiredError extends Error {
  readonly code = 'UI_DESIGNER_OVERWRITE_REQUIRED';
  readonly recoverable = true;
  readonly relativePath: string;
  readonly digest: string | null;
  readonly mtimeMs: number | null;
  readonly affectedFiles: string[];

  constructor(relativePath: string, digest: string | null, mtimeMs: number | null) {
    super(`UI designer scene already exists at ${relativePath}; confirm overwrite after reviewing the existing file.`);
    this.name = 'UiDesignerSceneOverwriteRequiredError';
    this.relativePath = relativePath;
    this.digest = digest;
    this.mtimeMs = mtimeMs;
    this.affectedFiles = [relativePath];
  }
}

export class UiDesignerRuntimeExportOverwriteRequiredError extends Error {
  readonly code = 'UI_DESIGNER_OVERWRITE_REQUIRED';
  readonly recoverable = true;
  readonly path: string;
  readonly digest: string | null;
  readonly mtimeMs: number | null;
  readonly affectedFiles: string[];

  constructor(filePath: string, digest: string | null, mtimeMs: number | null) {
    super(`Runtime export already exists at ${path.basename(filePath)}; confirm overwrite after reviewing the existing file.`);
    this.name = 'UiDesignerRuntimeExportOverwriteRequiredError';
    this.path = filePath;
    this.digest = digest;
    this.mtimeMs = mtimeMs;
    this.affectedFiles = [path.basename(filePath)];
  }
}

const BUNDLED_RUNTIME_SOURCE = fs.readFileSync(
  new URL('./ui-designer-runtime/MZUIRuntime.js', import.meta.url),
  'utf8',
);
const BUNDLED_RUNTIME_DIGEST = sha256(Buffer.from(BUNDLED_RUNTIME_SOURCE, 'utf8'));

export function bundledUiDesignerRuntime(): { version: string; digest: string; source: string } {
  return { version: UI_DESIGNER_RUNTIME_VERSION, digest: BUNDLED_RUNTIME_DIGEST, source: BUNDLED_RUNTIME_SOURCE };
}

export function writeUiDesignerRuntimeExport(
  filePath: string,
  scene: UiRuntimeSceneExport,
  options: { overwrite?: boolean } = {},
): { path: string; digest: string; mtimeMs: number; size: number } {
  validateRuntimeScene(scene);
  const resolved = path.resolve(filePath);
  if (path.extname(resolved).toLowerCase() !== '.json') throw new Error('Runtime exports must use the .json extension.');
  const existing = fs.existsSync(resolved) ? fs.readFileSync(resolved) : null;
  if (existing && !options.overwrite) {
    const stat = fs.statSync(resolved);
    throw new UiDesignerRuntimeExportOverwriteRequiredError(resolved, sha256(existing), stat.mtimeMs);
  }
  const body = Buffer.from(`${JSON.stringify(scene, null, 2)}\n`, 'utf8');
  // Use the `.mzui` persistence writer's backup-aware replacement path.  A
  // plain rename fails on Windows when the destination already exists and can
  // leave a crash window with the target missing.
  writeFileAtomically(resolved, body);
  const stat = fs.statSync(resolved);
  return { path: resolved, digest: sha256(body), mtimeMs: stat.mtimeMs, size: body.byteLength };
}

export function inspectUiDesignerRuntime(
  workflowRootInput: string,
  projectInput: string,
): UiDesignerRuntimeInspection {
  const workflowRoot = path.resolve(workflowRootInput);
  const project = path.resolve(projectInput);
  try {
    const manifest = inspectRmmvProject(project);
    const projectCompatibility = uiDesignerProjectCompatibility(manifest);
    const layout = resolveRmmvLayout(project);
    const runtimeRelativePath = resourceRelativePath(layout, UI_DESIGNER_RUNTIME_RELATIVE_PATH);
    const pluginConfigRelativePath = resourceRelativePath(layout, 'js/plugins.js');
    const runtimeFile = getProjectFileForRead(workflowRoot, project, runtimeRelativePath);
    const pluginConfigFile = getProjectFileForRead(workflowRoot, project, pluginConfigRelativePath);
    const digest = runtimeFile && fs.existsSync(runtimeFile) ? sha256(fs.readFileSync(runtimeFile)) : null;
    const plugins = pluginConfigFile && fs.existsSync(pluginConfigFile)
      ? parsePlugins(fs.readFileSync(pluginConfigFile, 'utf8'))
      : { entries: [], parseError: null };
    const plugin = plugins.entries.find((entry) => entry.name === UI_DESIGNER_RUNTIME_PLUGIN_NAME);
    const affectedFiles = stagedAffectedFiles(workflowRoot, project, [runtimeRelativePath, pluginConfigRelativePath]);
    let state: UiDesignerRuntimeInspectionState;
    if (!runtimeFile || !fs.existsSync(runtimeFile)) state = 'missing';
    else if (plugins.parseError) state = 'error';
    else if (!plugin) state = 'file-unconfigured';
    else if (digest !== BUNDLED_RUNTIME_DIGEST) state = runtimeVersion(runtimeFile) === UI_DESIGNER_RUNTIME_VERSION ? 'content-mismatch' : 'version-too-old';
    else if (!plugin.status) state = 'configured-disabled';
    else state = 'enabled-compatible';
    // A staged runtime is only "pending" when its effective file is already
    // the bundled content.  If a user edits the staged copy, report the
    // mismatch first so an install cannot silently overwrite it.
    if (affectedFiles.length > 0 && ['enabled-compatible', 'configured-disabled', 'file-unconfigured'].includes(state)) state = 'staged-pending';
    return {
      state,
      message: runtimeMessage(state),
      requiredVersion: UI_DESIGNER_RUNTIME_VERSION,
      version: runtimeFile && fs.existsSync(runtimeFile) ? runtimeVersion(runtimeFile) : undefined,
      runtimePath: runtimeRelativePath,
      runtimeRelativePath,
      pluginConfigRelativePath,
      digest,
      expectedDigest: BUNDLED_RUNTIME_DIGEST,
      pluginConfigured: Boolean(plugin),
      pluginEnabled: Boolean(plugin?.status),
      affectedFiles,
      staging: { pending: affectedFiles.length > 0, affectedFiles },
      needsConfirmation: state === 'content-mismatch' || state === 'version-too-old',
      projectCompatibility,
    };
  } catch (error) {
    return {
      state: 'error',
      message: error instanceof Error ? error.message : String(error),
      requiredVersion: UI_DESIGNER_RUNTIME_VERSION,
      runtimePath: UI_DESIGNER_RUNTIME_RELATIVE_PATH,
      runtimeRelativePath: UI_DESIGNER_RUNTIME_RELATIVE_PATH,
      pluginConfigRelativePath: 'js/plugins.js',
      digest: null,
      expectedDigest: BUNDLED_RUNTIME_DIGEST,
      affectedFiles: [],
      staging: { pending: false, affectedFiles: [] },
      needsConfirmation: false,
      projectCompatibility: unsupportedUiDesignerProjectCompatibility('The selected folder is not a supported RPG Maker MV or MZ project.'),
    };
  }
}

/** Explicit runtime install/update + enable. Scene export is intentionally separate. */
export function stageUiDesignerRuntimeInstall(
  workflowRootInput: string,
  projectInput: string,
  options: UiDesignerRuntimeStageOptions = {},
): UiDesignerRuntimeStageResult {
  if (options.enable !== true) throw new UiDesignerRuntimeEnableRequiredError();
  const workflowRoot = path.resolve(workflowRootInput);
  const project = path.resolve(projectInput);
  const before = inspectUiDesignerRuntime(workflowRoot, project);
  if ((before.state === 'content-mismatch' || before.state === 'version-too-old') && !options.forceModifiedRuntime) {
    throw new UiDesignerRuntimeModifiedError();
  }
  const layout = resolveRmmvLayout(project);
  const runtimeRelativePath = resourceRelativePath(layout, UI_DESIGNER_RUNTIME_RELATIVE_PATH);
  const pluginConfigRelativePath = resourceRelativePath(layout, 'js/plugins.js');
  const sourceBefore = snapshotSourceFiles(project, [runtimeRelativePath, pluginConfigRelativePath]);
  const pluginFile = getProjectFileForRead(workflowRoot, project, pluginConfigRelativePath);
  const parsed = pluginFile && fs.existsSync(pluginFile)
    ? parsePlugins(fs.readFileSync(pluginFile, 'utf8'))
    : { entries: [], parseError: null };
  if (parsed.parseError) throw new Error(`Cannot stage MZUI runtime while plugins.js is invalid: ${parsed.parseError}`);
  const existing = parsed.entries.find((entry) => entry.name === UI_DESIGNER_RUNTIME_PLUGIN_NAME);
  const runtimeEntry = {
    name: UI_DESIGNER_RUNTIME_PLUGIN_NAME,
    status: true,
    description: existing?.description || 'MZ UI designer runtime',
    parameters: existing?.parameters && typeof existing.parameters === 'object' ? existing.parameters : {},
  };
  const entries = [...parsed.entries];
  const existingIndex = entries.findIndex((entry) => entry.name === UI_DESIGNER_RUNTIME_PLUGIN_NAME);
  if (existingIndex >= 0) entries[existingIndex] = runtimeEntry;
  else entries.push(runtimeEntry);
  const mutations: Array<{ relativePath: string; content: Buffer }> = [
    { relativePath: runtimeRelativePath, content: Buffer.from(BUNDLED_RUNTIME_SOURCE, 'utf8') },
    { relativePath: pluginConfigRelativePath, content: Buffer.from(serializePlugins(entries), 'utf8') },
  ];
  stageProjectFilesAtomically(workflowRoot, project, mutations);
  const runtime = inspectUiDesignerRuntime(workflowRoot, project);
  return {
    status: 'staged',
    affectedFiles: [...new Set(runtime.affectedFiles)],
    runtime,
    digest: BUNDLED_RUNTIME_DIGEST,
    transaction: stageTransactionProof(project, [runtimeRelativePath, pluginConfigRelativePath], sourceBefore),
    projectCompatibility: runtime.projectCompatibility,
  };
}

/** Explicit scene export: stage only the scene JSON. Runtime install is separate. */
export function stageUiDesignerSceneExport(
  workflowRootInput: string,
  projectInput: string,
  scene: UiRuntimeSceneExport,
  options: Pick<UiDesignerRuntimeStageOptions, 'sceneRelativePath' | 'overwrite'> = {},
): UiDesignerRuntimeStageResult {
  const workflowRoot = path.resolve(workflowRootInput);
  const project = path.resolve(projectInput);
  validateRuntimeScene(scene);
  const layout = resolveRmmvLayout(project);
  const sceneEnginePath = options.sceneRelativePath
    ? normalizeSceneEnginePath(options.sceneRelativePath, layout)
    : `${UI_DESIGNER_SCENE_DIRECTORY}/${scene.meta.sceneName}.json`;
  const sceneRelativePath = resourceRelativePath(layout, sceneEnginePath);
  const sourceBefore = snapshotSourceFiles(project, [sceneRelativePath]);
  const existingFile = getProjectFileForRead(workflowRoot, project, sceneRelativePath);
  if (existingFile && !options.overwrite) {
    const stat = fs.statSync(existingFile);
    throw new UiDesignerSceneOverwriteRequiredError(sceneRelativePath, sha256(fs.readFileSync(existingFile)), stat.mtimeMs);
  }
  stageProjectFilesAtomically(workflowRoot, project, [
    { relativePath: sceneRelativePath, content: Buffer.from(`${JSON.stringify(scene, null, 2)}\n`, 'utf8') },
  ]);
  const runtime = inspectUiDesignerRuntime(workflowRoot, project);
  return {
    status: 'staged',
    affectedFiles: [sceneRelativePath],
    runtime,
    sceneRelativePath,
    digest: sha256(Buffer.from(JSON.stringify(scene), 'utf8')),
    transaction: stageTransactionProof(project, [sceneRelativePath], sourceBefore),
    projectCompatibility: runtime.projectCompatibility,
  };
}

/** Backward-compatible name now means the explicit install operation only. */
export function stageUiDesignerRuntime(
  workflowRootInput: string,
  projectInput: string,
  options: UiDesignerRuntimeStageOptions = {},
): UiDesignerRuntimeStageResult {
  return stageUiDesignerRuntimeInstall(workflowRootInput, projectInput, options);
}

export function runtimeSourceDigest(): string {
  return BUNDLED_RUNTIME_DIGEST;
}

function validateRuntimeScene(scene: UiRuntimeSceneExport): void {
  const report = validateUiRuntimeSceneExport(scene);
  if (!report.valid) throw new Error(`UI runtime scene validation failed: ${report.errors.map((issue) => issue.message).join('; ')}`);
}

function normalizeSceneEnginePath(input: string, layout: ReturnType<typeof resolveRmmvLayout>): string {
  const value = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const rootPrefix = layout.resourceRootRelative ? `${layout.resourceRootRelative}/` : '';
  const relative = value.startsWith(rootPrefix) ? value.slice(rootPrefix.length) : value;
  const fileName = path.posix.basename(relative);
  if (!relative.startsWith(`${UI_DESIGNER_SCENE_DIRECTORY}/`) || !/^Scene_[A-Za-z0-9_$]+\.json$/.test(fileName) || relative.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('UI runtime scene path is invalid.');
  return relative;
}

function stagedAffectedFiles(workflowRoot: string, project: string, candidates: readonly string[]): string[] {
  const status = getProjectStagingStatus(workflowRoot, project) as { files?: Array<{ relativePath?: unknown; operationId?: unknown }> };
  const wanted = new Set(candidates.map(normalizePath));
  return (status.files || [])
    .map((entry) => String(entry.relativePath || ''))
    .filter((relative) => wanted.has(normalizePath(relative)));
}

function parsePlugins(raw: string): { entries: Array<{ name: string; status: boolean; description: string; parameters: unknown }>; parseError: string | null } {
  const source = String(raw || '').replace(/^\uFEFF/, '');
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return { entries: [], parseError: 'Cannot locate $plugins array in plugins.js' };
  try {
    const value = JSON.parse(source.slice(start, end + 1));
    if (!Array.isArray(value)) return { entries: [], parseError: '$plugins must be an array' };
    return {
      entries: value.filter(Boolean).map((entry) => {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
        return {
          name: typeof record.name === 'string' ? record.name : '',
          status: Boolean(record.status),
          description: typeof record.description === 'string' ? record.description : '',
          parameters: record.parameters && typeof record.parameters === 'object' ? record.parameters : {},
        };
      }),
      parseError: null,
    };
  } catch (error) {
    return { entries: [], parseError: error instanceof Error ? error.message : String(error) };
  }
}

function serializePlugins(entries: Array<{ name: string; status: boolean; description: string; parameters: unknown }>): string {
  return `var $plugins =\n${JSON.stringify(entries.map((entry) => ({
    name: entry.name,
    status: Boolean(entry.status),
    description: entry.description,
    parameters: entry.parameters,
  })), null, 2)};\n`;
}

function runtimeVersion(filePath: string): string | undefined {
  try {
    const source = fs.readFileSync(filePath, 'utf8');
    return source.match(/VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
  } catch {
    return undefined;
  }
}

function runtimeMessage(state: UiDesignerRuntimeInspectionState): string {
  return {
    missing: 'MZ UI runtime is not installed.',
    'file-unconfigured': 'MZ UI runtime file exists but is not configured in plugins.js.',
    'configured-disabled': 'MZ UI runtime is installed but disabled.',
    'enabled-compatible': 'MZ UI runtime is installed and enabled.',
    'version-too-old': 'MZ UI runtime is older than the bundled runtime.',
    'content-mismatch': 'MZ UI runtime differs from the bundled runtime.',
    'staged-pending': 'MZ UI runtime changes are staged for this project.',
    error: 'MZ UI runtime status could not be inspected.',
  }[state];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

interface SourceFileSnapshot {
  exists: boolean;
  digest: string | null;
}

function snapshotSourceFiles(project: string, relativePaths: readonly string[]): Map<string, SourceFileSnapshot> {
  return new Map(relativePaths.map((relativePath) => {
    const filePath = path.join(project, ...relativePath.split('/'));
    const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    return [relativePath, { exists, digest: exists ? sha256(fs.readFileSync(filePath)) : null }];
  }));
}

function stageTransactionProof(
  project: string,
  relativePaths: readonly string[],
  sourceBefore: ReadonlyMap<string, SourceFileSnapshot>,
): NonNullable<ContractUiDesignerRuntimeStageResult['transaction']> {
  const sourceAfter = snapshotSourceFiles(project, relativePaths);
  const sourceUnchanged = relativePaths.every((relativePath) => {
    const before = sourceBefore.get(relativePath);
    const after = sourceAfter.get(relativePath);
    return before?.exists === after?.exists && before?.digest === after?.digest;
  });
  return {
    operationId: `ui-designer-${crypto.randomUUID()}`,
    sourceUnchanged,
    stagingUnchanged: false,
  };
}
