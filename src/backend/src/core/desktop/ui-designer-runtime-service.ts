import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { UiRuntimeStatus } from '../../../../contract/ui-designer.ts';
import {
  inspectRmmvProject,
  resourceRelativePath,
  resolveRmmvLayout,
} from '../rmmv/rmmv-layout.ts';
import { writeFileAtomically } from './ui-designer-service.ts';
import { uiDesignerProjectCompatibility, unsupportedUiDesignerProjectCompatibility } from './ui-designer-compatibility.ts';
import { isLegacyManagedUiDesignerRuntimeDigest } from './ui-designer-managed-runtime-revisions.ts';

export const UI_DESIGNER_RUNTIME_PLUGIN_NAME = 'MZUIRuntime';
export const UI_DESIGNER_RUNTIME_VERSION = '1.1.0';
export const UI_DESIGNER_RUNTIME_RELATIVE_PATH = 'js/plugins/MZUIRuntime.js';
export const UI_DESIGNER_RUNTIME_MANIFEST_RELATIVE_PATH = 'data/ui-scenes/MZUIRuntime.manifest.json';
const UI_DESIGNER_RUNTIME_MANIFEST_VERSION = '1.0.0';

export type UiDesignerRuntimeInspectionState =
  | 'missing'
  | 'file-unconfigured'
  | 'configured-disabled'
  | 'enabled-compatible'
  | 'managed-update-available'
  | 'version-too-old'
  | 'content-mismatch'
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

export interface UiDesignerRuntimeInstallOptions {
  enable?: boolean;
  forceModifiedRuntime?: boolean;
}

export interface UiDesignerRuntimeInstallResult {
  status: 'installed';
  affectedFiles: string[];
  runtime: UiDesignerRuntimeInspection;
  digest: string;
  backupRelativePath?: string;
}

export class UiDesignerRuntimeModifiedError extends Error {
  readonly code = 'UI_DESIGNER_RUNTIME_MODIFIED';
  readonly recoverable = true;
  readonly choices = ['backup-and-replace', 'cancel'] as const;
  readonly affectedFiles: string[];
  readonly digest: string;

  constructor(runtimeRelativePath: string, digest: string) {
    super('The project runtime contains unrecognized changes. Back it up and replace it before continuing the save.');
    this.name = 'UiDesignerRuntimeModifiedError';
    this.affectedFiles = [runtimeRelativePath];
    this.digest = digest;
  }
}

export class UiDesignerRuntimeEnableRequiredError extends Error {
  readonly code = 'UI_DESIGNER_RUNTIME_ENABLE_REQUIRED';
  readonly recoverable = false;

  constructor() {
    super('Runtime installation must explicitly enable MZUIRuntime; no project files were changed.');
    this.name = 'UiDesignerRuntimeEnableRequiredError';
  }
}

const BUNDLED_RUNTIME_SOURCE = fs.readFileSync(
  new URL('./ui-designer-runtime/MZUIRuntime.js', import.meta.url),
  'utf8',
);
const BUNDLED_RUNTIME_DIGEST = runtimeContentDigest(Buffer.from(BUNDLED_RUNTIME_SOURCE, 'utf8'));

export function bundledUiDesignerRuntime(): { version: string; digest: string; source: string } {
  return { version: UI_DESIGNER_RUNTIME_VERSION, digest: BUNDLED_RUNTIME_DIGEST, source: BUNDLED_RUNTIME_SOURCE };
}

export function inspectUiDesignerRuntime(
  workflowRootInput: string,
  projectInput: string,
): UiDesignerRuntimeInspection {
  void workflowRootInput;
  const project = path.resolve(projectInput);
  try {
    const manifest = inspectRmmvProject(project);
    const projectCompatibility = uiDesignerProjectCompatibility(manifest);
    const layout = resolveRmmvLayout(project);
    const runtimeRelativePath = resourceRelativePath(layout, UI_DESIGNER_RUNTIME_RELATIVE_PATH);
    const manifestRelativePath = resourceRelativePath(layout, UI_DESIGNER_RUNTIME_MANIFEST_RELATIVE_PATH);
    const pluginConfigRelativePath = resourceRelativePath(layout, 'js/plugins.js');
    const runtimeFile = path.join(project, ...runtimeRelativePath.split('/'));
    const manifestFile = path.join(project, ...manifestRelativePath.split('/'));
    const pluginConfigFile = path.join(project, ...pluginConfigRelativePath.split('/'));
    const runtimeExists = fs.existsSync(runtimeFile) && fs.statSync(runtimeFile).isFile();
    const digest = runtimeExists ? runtimeContentDigest(fs.readFileSync(runtimeFile)) : null;
    const management = inspectRuntimeManagement(digest, manifestFile);
    const plugins = fs.existsSync(pluginConfigFile) && fs.statSync(pluginConfigFile).isFile()
      ? parsePlugins(fs.readFileSync(pluginConfigFile, 'utf8'))
      : { entries: [], parseError: null };
    const plugin = plugins.entries.find((entry) => entry.name === UI_DESIGNER_RUNTIME_PLUGIN_NAME);
    let state: UiDesignerRuntimeInspectionState;
    if (!runtimeExists) state = 'missing';
    else if (plugins.parseError) state = 'error';
    else if (management === 'modified') state = 'content-mismatch';
    else if (management === 'managed-previous') state = 'managed-update-available';
    else if (!plugin) state = 'file-unconfigured';
    else if (!plugin.status) state = 'configured-disabled';
    else state = 'enabled-compatible';
    const manifestCurrent = digest === BUNDLED_RUNTIME_DIGEST && runtimeManifestDigest(manifestFile) === BUNDLED_RUNTIME_DIGEST;
    const affectedFiles = [
      ...(!runtimeExists || digest !== BUNDLED_RUNTIME_DIGEST ? [runtimeRelativePath] : []),
      ...(!manifestCurrent ? [manifestRelativePath] : []),
      ...(!plugins.parseError && (!plugin || !plugin.status) ? [pluginConfigRelativePath] : []),
    ];
    return {
      state,
      message: runtimeMessage(state),
      requiredVersion: UI_DESIGNER_RUNTIME_VERSION,
      version: runtimeExists ? runtimeVersion(runtimeFile) : undefined,
      runtimePath: runtimeRelativePath,
      runtimeRelativePath,
      pluginConfigRelativePath,
      digest,
      expectedDigest: BUNDLED_RUNTIME_DIGEST,
      pluginConfigured: Boolean(plugin),
      pluginEnabled: Boolean(plugin?.status),
      affectedFiles,
      needsConfirmation: state === 'content-mismatch',
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
      needsConfirmation: false,
      projectCompatibility: unsupportedUiDesignerProjectCompatibility('The selected folder is not a supported RPG Maker MV or MZ project.'),
    };
  }
}

/**
 * Install and enable the project Runtime directly. Scene saves call this
 * before writing their single Runtime-readable `.mzui` source, so no staging
 * or second publish transaction is involved.
 */
export function installUiDesignerRuntime(
  workflowRootInput: string,
  projectInput: string,
  options: UiDesignerRuntimeInstallOptions = {},
): UiDesignerRuntimeInstallResult {
  if (options.enable !== true) throw new UiDesignerRuntimeEnableRequiredError();
  const workflowRoot = path.resolve(workflowRootInput);
  const project = path.resolve(projectInput);
  inspectRmmvProject(project);
  const layout = resolveRmmvLayout(project);
  const runtimeRelativePath = resourceRelativePath(layout, UI_DESIGNER_RUNTIME_RELATIVE_PATH);
  const manifestRelativePath = resourceRelativePath(layout, UI_DESIGNER_RUNTIME_MANIFEST_RELATIVE_PATH);
  const pluginConfigRelativePath = resourceRelativePath(layout, 'js/plugins.js');
  const runtimePath = path.join(project, ...runtimeRelativePath.split('/'));
  const manifestPath = path.join(project, ...manifestRelativePath.split('/'));
  const pluginConfigPath = path.join(project, ...pluginConfigRelativePath.split('/'));
  const affectedFiles: string[] = [];
  let backupRelativePath: string | undefined;
  const currentRuntime = fs.existsSync(runtimePath) ? fs.readFileSync(runtimePath) : null;
  const currentDigest = currentRuntime ? runtimeContentDigest(currentRuntime) : null;
  const parsed = fs.existsSync(pluginConfigPath)
    ? parsePlugins(fs.readFileSync(pluginConfigPath, 'utf8'))
    : { entries: [], parseError: null };
  if (parsed.parseError) throw new Error(`Cannot install MZUI runtime while plugins.js is invalid: ${parsed.parseError}`);
  if (currentRuntime && inspectRuntimeManagement(currentDigest, manifestPath) === 'modified') {
    if (!options.forceModifiedRuntime) throw new UiDesignerRuntimeModifiedError(runtimeRelativePath, currentDigest as string);
    backupRelativePath = backupRuntime(project, runtimeRelativePath, currentRuntime);
    affectedFiles.push(backupRelativePath);
  }
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
  const runtimeBody = Buffer.from(BUNDLED_RUNTIME_SOURCE, 'utf8');
  if (!fs.existsSync(runtimePath) || runtimeContentDigest(fs.readFileSync(runtimePath)) !== BUNDLED_RUNTIME_DIGEST) {
    writeFileAtomically(runtimePath, runtimeBody);
    affectedFiles.push(runtimeRelativePath);
  }
  const pluginBody = Buffer.from(serializePlugins(entries), 'utf8');
  if (!fs.existsSync(pluginConfigPath) || !fs.readFileSync(pluginConfigPath).equals(pluginBody)) {
    writeFileAtomically(pluginConfigPath, pluginBody);
    affectedFiles.push(pluginConfigRelativePath);
  }
  const manifestBody = serializeRuntimeManifest(BUNDLED_RUNTIME_DIGEST);
  if (!fs.existsSync(manifestPath) || !fs.readFileSync(manifestPath).equals(manifestBody)) {
    writeFileAtomically(manifestPath, manifestBody);
    affectedFiles.push(manifestRelativePath);
  }
  return {
    status: 'installed',
    affectedFiles,
    runtime: inspectUiDesignerRuntime(workflowRoot, project),
    digest: BUNDLED_RUNTIME_DIGEST,
    ...(backupRelativePath ? { backupRelativePath } : {}),
  };
}

export function runtimeSourceDigest(): string {
  return BUNDLED_RUNTIME_DIGEST;
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
    'managed-update-available': 'A managed MZ UI runtime update is available.',
    'version-too-old': 'MZ UI runtime is older than the bundled runtime.',
    'content-mismatch': 'MZ UI runtime differs from the bundled runtime.',
    error: 'MZ UI runtime status could not be inspected.',
  }[state];
}

type RuntimeManagement = 'missing' | 'current' | 'managed-previous' | 'modified';

function inspectRuntimeManagement(digest: string | null, manifestPath: string): RuntimeManagement {
  if (!digest) return 'missing';
  if (digest === BUNDLED_RUNTIME_DIGEST) return 'current';
  if (runtimeManifestDigest(manifestPath) === digest || isLegacyManagedUiDesignerRuntimeDigest(digest)) return 'managed-previous';
  return 'modified';
}

function runtimeManifestDigest(filePath: string): string | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    return value.schemaVersion === UI_DESIGNER_RUNTIME_MANIFEST_VERSION
      && typeof value.digest === 'string'
      && /^[a-f0-9]{64}$/.test(value.digest)
      ? value.digest
      : null;
  } catch {
    return null;
  }
}

function serializeRuntimeManifest(digest: string): Buffer {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: UI_DESIGNER_RUNTIME_MANIFEST_VERSION,
    runtimeVersion: UI_DESIGNER_RUNTIME_VERSION,
    digest,
  }, null, 2)}\n`, 'utf8');
}

function backupRuntime(project: string, runtimeRelativePath: string, source: Buffer): string {
  const rawDigest = sha256(source);
  const backupRelativePath = `${runtimeRelativePath}.${rawDigest.slice(0, 12)}.bak`;
  const backupPath = path.join(project, ...backupRelativePath.split('/'));
  if (fs.existsSync(backupPath)) {
    if (!fs.readFileSync(backupPath).equals(source)) throw new Error(`Runtime backup path is already occupied: ${backupRelativePath}`);
    return backupRelativePath;
  }
  writeFileAtomically(backupPath, source);
  return backupRelativePath;
}

function runtimeContentDigest(value: Buffer): string {
  const normalized = value.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return sha256(Buffer.from(normalized, 'utf8'));
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
