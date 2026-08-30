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

export const UI_DESIGNER_RUNTIME_PLUGIN_NAME = 'MZUIRuntime';
export const UI_DESIGNER_RUNTIME_VERSION = '1.1.0';
export const UI_DESIGNER_RUNTIME_RELATIVE_PATH = 'js/plugins/MZUIRuntime.js';

export type UiDesignerRuntimeInspectionState =
  | 'missing'
  | 'file-unconfigured'
  | 'configured-disabled'
  | 'enabled-compatible'
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
}

export class UiDesignerRuntimeModifiedError extends Error {
  readonly code = 'UI_DESIGNER_RUNTIME_MODIFIED';
  readonly recoverable = true;

  constructor() {
    super('The project contains a modified MZUI runtime. Review it before replacing the plugin.');
    this.name = 'UiDesignerRuntimeModifiedError';
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
const BUNDLED_RUNTIME_DIGEST = sha256(Buffer.from(BUNDLED_RUNTIME_SOURCE, 'utf8'));

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
    const pluginConfigRelativePath = resourceRelativePath(layout, 'js/plugins.js');
    const runtimeFile = path.join(project, ...runtimeRelativePath.split('/'));
    const pluginConfigFile = path.join(project, ...pluginConfigRelativePath.split('/'));
    const runtimeExists = fs.existsSync(runtimeFile) && fs.statSync(runtimeFile).isFile();
    const digest = runtimeExists ? sha256(fs.readFileSync(runtimeFile)) : null;
    const plugins = fs.existsSync(pluginConfigFile) && fs.statSync(pluginConfigFile).isFile()
      ? parsePlugins(fs.readFileSync(pluginConfigFile, 'utf8'))
      : { entries: [], parseError: null };
    const plugin = plugins.entries.find((entry) => entry.name === UI_DESIGNER_RUNTIME_PLUGIN_NAME);
    let state: UiDesignerRuntimeInspectionState;
    if (!runtimeExists) state = 'missing';
    else if (plugins.parseError) state = 'error';
    else if (!plugin) state = 'file-unconfigured';
    else if (digest !== BUNDLED_RUNTIME_DIGEST) state = runtimeVersion(runtimeFile) === UI_DESIGNER_RUNTIME_VERSION ? 'content-mismatch' : 'version-too-old';
    else if (!plugin.status) state = 'configured-disabled';
    else state = 'enabled-compatible';
    const affectedFiles = [
      ...(!runtimeExists || digest !== BUNDLED_RUNTIME_DIGEST ? [runtimeRelativePath] : []),
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
  const pluginConfigRelativePath = resourceRelativePath(layout, 'js/plugins.js');
  const runtimePath = path.join(project, ...runtimeRelativePath.split('/'));
  const pluginConfigPath = path.join(project, ...pluginConfigRelativePath.split('/'));
  const affectedFiles: string[] = [];
  if (fs.existsSync(runtimePath)) {
    const current = fs.readFileSync(runtimePath);
    const currentDigest = sha256(current);
    const currentVersion = runtimeVersion(runtimePath);
    if (currentDigest !== BUNDLED_RUNTIME_DIGEST && currentVersion === UI_DESIGNER_RUNTIME_VERSION && !options.forceModifiedRuntime) {
      throw new UiDesignerRuntimeModifiedError();
    }
  }
  const parsed = fs.existsSync(pluginConfigPath)
    ? parsePlugins(fs.readFileSync(pluginConfigPath, 'utf8'))
    : { entries: [], parseError: null };
  if (parsed.parseError) throw new Error(`Cannot install MZUI runtime while plugins.js is invalid: ${parsed.parseError}`);
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
  if (!fs.existsSync(runtimePath) || sha256(fs.readFileSync(runtimePath)) !== BUNDLED_RUNTIME_DIGEST) {
    writeFileAtomically(runtimePath, runtimeBody);
    affectedFiles.push(runtimeRelativePath);
  }
  const pluginBody = Buffer.from(serializePlugins(entries), 'utf8');
  if (!fs.existsSync(pluginConfigPath) || !fs.readFileSync(pluginConfigPath).equals(pluginBody)) {
    writeFileAtomically(pluginConfigPath, pluginBody);
    affectedFiles.push(pluginConfigRelativePath);
  }
  return {
    status: 'installed',
    affectedFiles,
    runtime: inspectUiDesignerRuntime(workflowRoot, project),
    digest: BUNDLED_RUNTIME_DIGEST,
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
    'version-too-old': 'MZ UI runtime is older than the bundled runtime.',
    'content-mismatch': 'MZ UI runtime differs from the bundled runtime.',
    error: 'MZ UI runtime status could not be inspected.',
  }[state];
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
