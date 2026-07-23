import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type {
  ManagedPluginEntry,
  ManagedPluginFile,
  PluginCommandArgument,
  PluginCommandHint,
  PluginConfigurationResult,
  PluginDependencyMetadata,
  PluginParameterSchema,
  PluginParameterSchemaField,
  PluginValidationIssue,
  PluginValidationResult,
} from '../../../../contract/types.ts';

import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  stageProjectFilesAtomically,
  type StagedProjectFileMutation,
  writeStagedProjectBuffer,
} from './staging-service.ts';
import {
  extractDefaultPluginHeaderBlock,
  extractDefaultPluginHeaderBody,
  parseDefaultPluginHeaderMetadata,
} from './plugin-header-metadata.ts';

interface PluginConfigEntry {
  name: string;
  status: boolean;
  description: string;
  parameters: unknown;
}

interface ParsedPlugins {
  relativePath: string;
  exists: boolean;
  entries: PluginConfigEntry[];
  parseError?: string;
}

export function readPluginConfiguration(workflowRoot: string, project: string): PluginConfigurationResult {
  const parsed = readPlugins(workflowRoot, project);
  const pluginFiles = listPluginFiles(workflowRoot, project);
  const plugins = parsed.entries.map((entry, index) => toManagedEntry(workflowRoot, project, entry, index));
  return {
    project: path.resolve(project),
    relativePath: parsed.relativePath,
    exists: parsed.exists,
    plugins,
    pluginFiles,
    validation: validatePluginConfiguration(workflowRoot, project),
  };
}

export function writePluginConfiguration(
  workflowRoot: string,
  project: string,
  entries: Array<Partial<PluginConfigEntry>>,
): PluginConfigurationResult {
  const relativePath = readPlugins(workflowRoot, project).relativePath;
  const normalized = entries.map((entry, index) => normalizeWritableEntry(entry, index));
  writePluginsJs(workflowRoot, project, relativePath, normalized);
  return readPluginConfiguration(workflowRoot, project);
}

export function setPluginEnabled(
  workflowRoot: string,
  project: string,
  pluginName: string,
  enabled: boolean,
): PluginConfigurationResult {
  const parsed = requireReadablePlugins(workflowRoot, project);
  const name = normalizeConfiguredPluginName(pluginName);
  const next = clonePluginConfigEntries(parsed.entries);
  const entry = requireUniquePluginEntry(next, name);
  if (enabled && !resolveExistingPluginFileRelativePath(workflowRoot, project, name)) {
    throw new Error(`[PLUGIN_FILE_MISSING] ${name}`);
  }
  entry.status = Boolean(enabled);
  assertNoNewDependencyIssues(workflowRoot, project, parsed.entries, next);
  writePluginsJs(workflowRoot, project, parsed.relativePath, next);
  return readPluginConfiguration(workflowRoot, project);
}

export function reorderPlugins(
  workflowRoot: string,
  project: string,
  pluginIndexes: number[],
): PluginConfigurationResult {
  const parsed = requireReadablePlugins(workflowRoot, project);
  if (pluginIndexes.length !== parsed.entries.length) {
    throw new Error('Plugin ordering must include every currently configured plugin');
  }
  const requestedSet = new Set<number>();
  for (const index of pluginIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= parsed.entries.length) {
      throw new Error(`Plugin ordering contains an invalid configuration index: ${String(index)}`);
    }
    if (requestedSet.has(index)) {
      throw new Error(`Plugin ordering contains a duplicate configuration index: ${index}`);
    }
    requestedSet.add(index);
  }
  const next = pluginIndexes.map((index) => structuredClone(parsed.entries[index]!));
  assertNoNewDependencyIssues(workflowRoot, project, parsed.entries, next);
  writePluginsJs(workflowRoot, project, parsed.relativePath, next);
  return readPluginConfiguration(workflowRoot, project);
}

export function addPluginConfigurationEntry(
  workflowRoot: string,
  project: string,
  pluginName: string,
): PluginConfigurationResult {
  const parsed = requireReadablePlugins(workflowRoot, project);
  const name = normalizeConfiguredPluginName(pluginName);
  assertUniqueConfiguredNames(parsed.entries);
  if (parsed.entries.some((entry) => entry.name === name)) {
    throw new Error(`Plugin configuration already exists: ${name}`);
  }
  if (!resolveExistingPluginFileRelativePath(workflowRoot, project, name)) {
    throw new Error(`[PLUGIN_FILE_MISSING] ${name}`);
  }
  writePluginsJs(workflowRoot, project, parsed.relativePath, [
    ...parsed.entries,
    { name, status: false, description: '', parameters: {} },
  ]);
  return readPluginConfiguration(workflowRoot, project);
}

export function removePluginConfigurationEntry(
  workflowRoot: string,
  project: string,
  pluginName: string,
): PluginConfigurationResult {
  const parsed = requireReadablePlugins(workflowRoot, project);
  const name = normalizeConfiguredPluginName(pluginName);
  requireUniquePluginEntry(parsed.entries, name);
  writePluginsJs(
    workflowRoot,
    project,
    parsed.relativePath,
    parsed.entries.filter((entry) => entry.name !== name),
  );
  return readPluginConfiguration(workflowRoot, project);
}

export function updatePluginParameters(
  workflowRoot: string,
  project: string,
  pluginName: string,
  parameters: Record<string, unknown>,
): PluginConfigurationResult {
  if (!isPlainObject(parameters)) throw new Error('Plugin parameters must be an object');
  const managed = readPluginConfiguration(workflowRoot, project).plugins.find((entry) => entry.name === pluginName);
  if (!managed) throw new Error(`Plugin does not exist: ${pluginName}`);
  for (const field of managed.parameterSchema?.fields || []) {
    if (field.editable !== false) continue;
    if (!isDeepStrictEqual(parameters[field.key], managed.parameters[field.key])) {
      throw new Error(`Plugin parameter ${field.key} uses unsupported type ${field.rawType || '(unknown)'} and must be preserved unchanged`);
    }
  }
  return updatePluginEntry(workflowRoot, project, pluginName, (entry) => {
    entry.parameters = structuredClone(parameters);
  });
}

export function installPluginFile(
  workflowRoot: string,
  project: string,
  sourceFile: string,
  options: {
    name?: string;
    overwrite?: boolean;
    configuration?: Partial<PluginConfigEntry>;
  } = {},
): { name: string; relativePath: string; staging: unknown; configuration?: PluginConfigurationResult } {
  const source = path.resolve(sourceFile);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Plugin source file does not exist');
  if (path.extname(source).toLowerCase() !== '.js') throw new Error('Only .js plugin files can be installed');
  if (options.overwrite !== undefined && typeof options.overwrite !== 'boolean') throw new Error('Plugin overwrite must be a boolean');
  const name = normalizePluginFileStem(options.name || path.basename(source, '.js'));
  const relativePath = `${pluginDirRelativePath(project)}/${name}.js`;
  const targetExists = Boolean(getProjectFileForRead(workflowRoot, project, relativePath));
  if (targetExists && !options.overwrite) {
    throw new Error(`Plugin file already exists: ${name}.js`);
  }

  const parsed = requireReadablePlugins(workflowRoot, project);
  const configured = parsed.entries.filter((entry) => entry.name === name);
  if (configured.length > 1) throw new Error(`Duplicate plugin configuration cannot be modified safely: ${name}`);
  const mutations: StagedProjectFileMutation[] = [{
    relativePath,
    content: fs.readFileSync(source),
  }];
  if (configured.length === 0) {
    const configuration = options.configuration || {};
    const entry: PluginConfigEntry = {
      name,
      status: false,
      description: String(configuration.description || ''),
      parameters: isPlainObject(configuration.parameters) ? structuredClone(configuration.parameters) : {},
    };
    mutations.push({
      relativePath: parsed.relativePath,
      content: Buffer.from(serializePlugins([...parsed.entries, entry]), 'utf8'),
    });
  }
  stageProjectFilesAtomically(workflowRoot, project, mutations);
  const configuration = readPluginConfiguration(workflowRoot, project);
  return {
    name,
    relativePath,
    staging: getProjectStagingStatus(workflowRoot, project),
    configuration,
  };
}

export function deletePluginFile(
  workflowRoot: string,
  project: string,
  pluginName: string,
  options: { force?: boolean; removeConfigurationEntry?: boolean } = {},
): { name: string; relativePath: string; staging: unknown; configuration?: PluginConfigurationResult } {
  if (options.force !== undefined) throw new Error('Plugin force deletion is not supported');
  if (options.removeConfigurationEntry === false) {
    throw new Error('Plugin file and configuration must be deleted together');
  }
  const name = normalizePluginFileStem(pluginName);
  const parsed = requireReadablePlugins(workflowRoot, project);
  const configured = parsed.entries.filter((entry) => entry.name === name);
  if (configured.length > 1) throw new Error(`Duplicate plugin configuration cannot be modified safely: ${name}`);
  const relativePath = pluginFileCandidates(project, name).find((candidate) => getProjectFileForRead(workflowRoot, project, candidate));
  if (!relativePath) throw new Error(`Plugin file does not exist: ${name}.js`);
  const next = parsed.entries.filter((entry) => entry.name !== name);
  stageProjectFilesAtomically(workflowRoot, project, [
    { relativePath, delete: true },
    {
      relativePath: parsed.relativePath,
      content: Buffer.from(serializePlugins(next), 'utf8'),
    },
  ]);
  const configuration = readPluginConfiguration(workflowRoot, project);

  return {
    name,
    relativePath,
    staging: getProjectStagingStatus(workflowRoot, project),
    configuration,
  };
}

export function validatePluginConfiguration(workflowRoot: string, project: string): PluginValidationResult {
  const parsed = readPlugins(workflowRoot, project);
  const issues: PluginValidationIssue[] = [];
  const engineTarget = inspectRmmvProject(project).engine === 'rpg-maker-mz' ? 'MZ' : 'MV';
  if (!parsed.exists) {
    issues.push({
      severity: 'error',
      code: 'plugins-js-missing',
      message: 'Missing plugin configuration js/plugins.js',
      relativePath: parsed.relativePath,
    });
  }
  if (parsed.parseError) {
    issues.push({
      severity: 'error',
      code: 'plugins-js-parse-error',
      message: `plugins.js could not be parsed: ${parsed.parseError}`,
      relativePath: parsed.relativePath,
    });
  }

  const seen = new Map<string, number>();
  parsed.entries.forEach((entry, index) => {
    const name = String(entry.name || '');
    if (!name) {
      issues.push({
        severity: 'error',
        code: 'plugin-name-missing',
        message: `Plugin #${index + 1} is missing a name`,
        index,
      });
      return;
    }
    if (seen.has(name)) {
      issues.push({
        severity: 'error',
        code: 'plugin-name-duplicate',
        message: `Duplicate plugin configuration: ${name}`,
        pluginName: name,
        index,
      });
    }
    seen.set(name, index);
    if (!isPlainObject(entry.parameters)) {
      issues.push({
        severity: 'error',
        code: 'plugin-parameters-invalid',
        message: `Plugin ${name} parameters must be an object`,
        pluginName: name,
        index,
      });
    }
    const fileRelativePath = resolveExistingPluginFileRelativePath(workflowRoot, project, name);
    if (!fileRelativePath) {
      issues.push({
        severity: entry.status ? 'error' : 'warn',
        code: 'plugin-file-missing',
        message: `Plugin file is missing: ${name}.js`,
        pluginName: name,
        index,
        relativePath: `${pluginDirRelativePath(project)}/${name}.js`,
      });
      return;
    }
    const schemaResult = parsePluginParameterSchema(workflowRoot, project, name, fileRelativePath);
    for (const warning of schemaResult.warnings) {
      issues.push({
        severity: 'warn',
        code: 'plugin-parameter-schema-unparsed',
        message: warning,
        pluginName: name,
        index,
      });
    }
    const targets = readPluginTargets(workflowRoot, project, fileRelativePath);
    if (targets.length && !targets.includes(engineTarget)) {
      issues.push({
        severity: 'error',
        code: 'plugin-engine-target-mismatch',
        message: `Plugin ${name} targets ${targets.join('/')} but the project engine is ${engineTarget}`,
        pluginName: name,
        index,
        relativePath: fileRelativePath,
      });
    }
  });

  issues.push(...collectPluginDependencyIssues(workflowRoot, project, parsed.entries));

  return { ok: !issues.some((issue) => issue.severity === 'error'), issues };
}

function updatePluginEntry(
  workflowRoot: string,
  project: string,
  pluginName: string,
  update: (entry: PluginConfigEntry) => void,
): PluginConfigurationResult {
  const parsed = requireReadablePlugins(workflowRoot, project);
  const name = normalizeConfiguredPluginName(pluginName);
  const matches = parsed.entries.filter((entry) => entry.name === name);
  if (!matches.length) throw new Error(`Plugin does not exist: ${name}`);
  if (matches.length > 1) throw new Error(`Duplicate plugin configuration cannot be modified safely: ${name}`);
  update(matches[0]);
  writePluginsJs(workflowRoot, project, parsed.relativePath, parsed.entries);
  return readPluginConfiguration(workflowRoot, project);
}

function readPlugins(workflowRoot: string, project: string): ParsedPlugins {
  const relativePath = pluginConfigRelativePath(workflowRoot, project);
  const file = getProjectFileForRead(workflowRoot, project, relativePath);
  if (!file) return { relativePath, exists: false, entries: [] };
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return { relativePath, exists: true, entries: [], parseError: 'Cannot locate $plugins array in plugins.js' };
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) throw new Error('$plugins must be an array');
    return {
      relativePath,
      exists: true,
      entries: parsed.filter(Boolean).map(normalizeParsedEntry),
    };
  } catch (error) {
    return {
      relativePath,
      exists: true,
      entries: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function requireReadablePlugins(workflowRoot: string, project: string): ParsedPlugins {
  const parsed = readPlugins(workflowRoot, project);
  if (!parsed.exists) throw new Error(`Project file does not exist: ${parsed.relativePath}`);
  if (parsed.parseError) throw new Error(`plugins.js could not be parsed: ${parsed.parseError}`);
  return parsed;
}

function writePluginsJs(workflowRoot: string, project: string, relativePath: string, entries: PluginConfigEntry[]): void {
  const payload = serializePlugins(entries.map((entry, index) => normalizeWritableEntry(entry, index)));
  writeStagedProjectBuffer(workflowRoot, project, relativePath, Buffer.from(payload, 'utf8'));
}

function serializePlugins(entries: PluginConfigEntry[]): string {
  const payload = entries.map((entry) => ({
    name: entry.name,
    status: Boolean(entry.status),
    description: entry.description,
    parameters: entry.parameters,
  }));
  return `var $plugins =\n${JSON.stringify(payload, null, 2)};\n`;
}

function normalizeParsedEntry(value: unknown): PluginConfigEntry {
  const entry = isPlainObject(value) ? value : {};
  return {
    name: typeof entry.name === 'string' ? entry.name : '',
    status: Boolean(entry.status),
    description: typeof entry.description === 'string' ? entry.description : '',
    parameters: entry.parameters,
  };
}

function normalizeWritableEntry(value: Partial<PluginConfigEntry>, index: number): PluginConfigEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid plugin configuration: ${index + 1}`);
  const name = normalizeConfiguredPluginName(String(value.name || ''));
  if (!isPlainObject(value.parameters)) throw new Error(`Plugin ${name} parameters must be an object`);
  return {
    name,
    status: Boolean(value.status),
    description: String(value.description || ''),
    parameters: structuredClone(value.parameters),
  };
}

function toManagedEntry(
  workflowRoot: string,
  project: string,
  entry: PluginConfigEntry,
  index: number,
): ManagedPluginEntry {
  const fileRelativePath = resolveExistingPluginFileRelativePath(workflowRoot, project, entry.name) || '';
  const metadata = entry.name && fileRelativePath
    ? parsePluginParameterSchema(workflowRoot, project, entry.name, fileRelativePath)
    : { schema: undefined, warnings: [] };
  const commandHints = entry.name && fileRelativePath
    ? extractPluginCommandHintsFromFile(workflowRoot, project, entry.name, fileRelativePath)
    : [];
  const targets = fileRelativePath ? readPluginTargets(workflowRoot, project, fileRelativePath) : [];
  const dependencies = fileRelativePath ? readPluginDependencies(workflowRoot, project, fileRelativePath) : undefined;
  const fileName = entry.name ? `${entry.name}.js` : '';
  const absolutePath = fileRelativePath ? getProjectFileForRead(workflowRoot, project, fileRelativePath) : null;
  const header = absolutePath
    ? parseDefaultPluginHeaderMetadata(fs.readFileSync(absolutePath, 'utf8'), fileRelativePath, entry.name)
    : parseDefaultPluginHeaderMetadata('', fileRelativePath, entry.name);
  return {
    index,
    name: entry.name,
    status: entry.status,
    description: entry.description,
    parameters: isPlainObject(entry.parameters) ? structuredClone(entry.parameters) : {},
    parameterCount: isPlainObject(entry.parameters) ? Object.keys(entry.parameters).length : 0,
    fileName,
    fileRelativePath,
    fileExists: entry.name ? pluginFileCandidates(project, entry.name).some((candidate) => Boolean(getProjectFileForRead(workflowRoot, project, candidate))) : false,
    parameterSchema: metadata.schema,
    parameterSchemaWarnings: metadata.warnings,
    commandHints,
    targets,
    dependencies,
    header,
  };
}

function listPluginFiles(workflowRoot: string, project: string): ManagedPluginFile[] {
  const result = new Map<string, ManagedPluginFile>();
  for (const dir of pluginDirCandidates(project)) {
    const absoluteDir = path.join(project, dir);
    if (!fs.existsSync(absoluteDir)) continue;
    for (const fileName of listFilesRecursively(absoluteDir).filter((name) => name.toLowerCase().endsWith('.js')).sort()) {
      const relativePath = `${dir}/${fileName}`;
      const absolute = getProjectFileForRead(workflowRoot, project, relativePath) || path.join(absoluteDir, fileName);
      result.set(relativePath, {
        name: fileName.slice(0, -3),
        fileName,
        relativePath,
        exists: true,
        staged: absolute.includes(path.join(path.resolve(workflowRoot), 'runtime', 'agent-console-staging')),
        deleted: false,
        size: fs.existsSync(absolute) ? fs.statSync(absolute).size : null,
        header: parseDefaultPluginHeaderMetadata(
          fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '',
          relativePath,
          fileName.slice(0, -3),
        ),
      });
    }
  }

  for (const file of getProjectStagingStatus(workflowRoot, project).files) {
    if (!isPluginFileRelativePath(file.relativePath)) continue;
    const fileName = path.posix.basename(file.relativePath);
    const pluginName = pluginNameFromRelativePath(file.relativePath);
    const existing = result.get(file.relativePath);
    const absolute = getProjectFileForRead(workflowRoot, project, file.relativePath);
    result.set(file.relativePath, {
      name: pluginName,
      fileName,
      relativePath: file.relativePath,
      exists: !file.delete && Boolean(absolute),
      staged: true,
      deleted: Boolean(file.delete),
      size: absolute && fs.existsSync(absolute) ? fs.statSync(absolute).size : existing?.size ?? null,
      header: absolute && fs.existsSync(absolute)
        ? parseDefaultPluginHeaderMetadata(fs.readFileSync(absolute, 'utf8'), file.relativePath, pluginName)
        : existing?.header || parseDefaultPluginHeaderMetadata('', file.relativePath, pluginName),
    });
  }

  return Array.from(result.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function pluginConfigRelativePath(workflowRoot: string, project: string): string {
  const candidates = pluginConfigCandidates(project);
  return candidates.find((relativePath) => getProjectFileForRead(workflowRoot, project, relativePath)) || candidates[0];
}

function pluginConfigCandidates(project: string): string[] {
  const primary = `${projectJsRelativeRoot(project)}/plugins.js`;
  const fallback = primary.startsWith('www/') ? 'js/plugins.js' : 'www/js/plugins.js';
  return primary === fallback ? [primary] : [primary, fallback];
}

function pluginDirRelativePath(project: string): string {
  return `${projectJsRelativeRoot(project)}/plugins`;
}

function pluginDirCandidates(project: string): string[] {
  const primary = pluginDirRelativePath(project);
  const fallback = primary.startsWith('www/') ? 'js/plugins' : 'www/js/plugins';
  return primary === fallback ? [primary] : [primary, fallback];
}

function pluginFileCandidates(project: string, pluginName: string): string[] {
  const fileName = `${normalizePluginFileStem(pluginName)}.js`;
  return pluginDirCandidates(project).map((dir) => `${dir}/${fileName}`);
}

function resolveExistingPluginFileRelativePath(workflowRoot: string, project: string, pluginName: string): string | null {
  if (!pluginName) return null;
  return pluginFileCandidates(project, pluginName).find((candidate) => Boolean(getProjectFileForRead(workflowRoot, project, candidate))) || null;
}

function projectJsRelativeRoot(project: string): string {
  const dataRelative = path.relative(path.resolve(project), resolveDataDir(project)).replace(/\\/g, '/');
  return dataRelative.startsWith('www/') ? 'www/js' : 'js';
}

function normalizeConfiguredPluginName(value: string): string {
  return normalizePluginFileStem(value);
}

function normalizePluginFileStem(value: string): string {
  const name = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.js$/i, '');
  const parts = name.split('/');
  if (!name || parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid plugin name');
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid plugin name');
  }
  return name;
}

function assertUniqueConfiguredNames(entries: PluginConfigEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = normalizeConfiguredPluginName(entry.name);
    if (seen.has(name)) throw new Error(`Duplicate plugin configuration cannot be sorted safely: ${name}`);
    seen.add(name);
  }
}

function isPluginFileRelativePath(relativePath: string): boolean {
  return /^(?:www\/)?js\/plugins\/(?:[^/]+\/)*[^/]+\.js$/i.test(relativePath)
    && !relativePath.split('/').some((part) => part === '..');
}

function listFilesRecursively(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  visit(root, '');
  return files;
}

function readPluginTargets(workflowRoot: string, project: string, fileRelativePath: string): string[] {
  const absolutePath = fileRelativePath ? getProjectFileForRead(workflowRoot, project, fileRelativePath) : null;
  if (!absolutePath) return [];
  return parseDefaultPluginHeaderMetadata(
    fs.readFileSync(absolutePath, 'utf8'),
    fileRelativePath,
  ).target.filter((target) => target === 'MV' || target === 'MZ');
}

function readPluginDependencies(
  workflowRoot: string,
  project: string,
  fileRelativePath: string,
): PluginDependencyMetadata {
  const absolutePath = getProjectFileForRead(workflowRoot, project, fileRelativePath);
  if (!absolutePath) return { base: [], orderAfter: [], orderBefore: [], requiredAssets: [], noteAssets: [] };
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const defaultHeader = extractDefaultPluginHeaderBody(raw) || '';
  const header = parseDefaultPluginHeaderMetadata(raw, fileRelativePath);
  const tags = (name: string): string[] => [...defaultHeader.matchAll(new RegExp(`^[ \\t*]*@${name}\\s+([^\\r\\n*]+)`, 'gim'))]
    .flatMap((match) => name.toLowerCase() === 'requiredassets'
      ? [stripAnnotationQuotes(match[1].trim())]
      : match[1].trim().split(/[\s,]+/).map(stripAnnotationQuotes))
    .filter(Boolean);
  return {
    base: header.base,
    orderAfter: header.orderAfter,
    orderBefore: dedupeStrings(tags('orderBefore')),
    requiredAssets: dedupeStrings(tags('requiredAssets').map((value) => value.replace(/\\/g, '/'))),
    noteAssets: readPluginNoteAssetDeclarations(defaultHeader),
  };
}

function pluginNameFromRelativePath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^(?:www\/)?js\/plugins\//i, '')
    .replace(/\.js$/i, '');
}

function readPluginNoteAssetDeclarations(raw: string): PluginDependencyMetadata['noteAssets'] {
  const result: PluginDependencyMetadata['noteAssets'] = [];
  let current: PluginDependencyMetadata['noteAssets'][number] | null = null;
  const flush = (): void => {
    if (current?.parameter && current.directory && current.type) result.push(current);
    current = null;
  };
  for (const match of raw.matchAll(/^[ \t*]*@(noteParam|noteDir|noteType|noteData)\s+([^\r\n*]+)/gim)) {
    const tag = match[1].toLowerCase();
    const value = stripAnnotationQuotes(match[2].trim());
    if (tag === 'noteparam') {
      flush();
      current = { parameter: value, directory: '', type: '', data: '' };
    } else if (current && tag === 'notedir') current.directory = value.replace(/\\/g, '/').replace(/\/$/, '');
    else if (current && tag === 'notetype') current.type = value.toLowerCase();
    else if (current && tag === 'notedata') current.data = value;
  }
  flush();
  return result;
}

function stripAnnotationQuotes(value: string): string {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function resolveConfiguredDependency(
  entries: PluginConfigEntry[],
  dependency: string,
): { entry: PluginConfigEntry; index: number } | null {
  const normalized = String(dependency || '').trim().replace(/\.js$/i, '').replace(/\\/g, '/');
  const exactIndex = entries.findIndex((entry) => entry.name === normalized);
  if (exactIndex >= 0) return { entry: entries[exactIndex], index: exactIndex };
  const basenameMatches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => path.posix.basename(entry.name) === normalized);
  return basenameMatches.length === 1 ? basenameMatches[0] : null;
}

function validatePluginOrderingHint(
  issues: PluginValidationIssue[],
  entries: PluginConfigEntry[],
  pluginName: string,
  pluginIndex: number,
  dependencies: string[],
  relation: 'after' | 'before',
): void {
  for (const dependency of dependencies) {
    const resolved = resolveConfiguredDependency(entries, dependency);
    if (!resolved?.entry.status) continue;
    const valid = relation === 'after' ? pluginIndex > resolved.index : pluginIndex < resolved.index;
    if (valid) continue;
    issues.push({
      severity: 'error',
      code: relation === 'after' ? 'plugin-order-after-invalid' : 'plugin-order-before-invalid',
      message: `Plugin ${pluginName} must be ordered ${relation} ${resolved.entry.name}`,
      pluginName,
      index: pluginIndex,
    });
  }
}

function collectPluginDependencyIssues(
  workflowRoot: string,
  project: string,
  entries: PluginConfigEntry[],
): PluginValidationIssue[] {
  const issues: PluginValidationIssue[] = [];
  entries.forEach((entry, index) => {
    if (!entry.status || !entry.name) return;
    const fileRelativePath = resolveExistingPluginFileRelativePath(workflowRoot, project, entry.name);
    if (!fileRelativePath) return;
    const dependencies = readPluginDependencies(workflowRoot, project, fileRelativePath);
    for (const dependency of dependencies.base) {
      const resolved = resolveConfiguredDependency(entries, dependency);
      if (!resolved) {
        issues.push({
          severity: 'error',
          code: 'plugin-base-missing',
          message: `Plugin ${entry.name} requires missing base plugin ${dependency}`,
          pluginName: entry.name,
          index,
        });
      } else if (!resolved.entry.status) {
        issues.push({
          severity: 'error',
          code: 'plugin-base-disabled',
          message: `Plugin ${entry.name} requires enabled base plugin ${resolved.entry.name}`,
          pluginName: entry.name,
          index,
        });
      } else if (resolved.index >= index) {
        issues.push({
          severity: 'error',
          code: 'plugin-base-order-invalid',
          message: `Plugin ${entry.name} must be ordered after base plugin ${resolved.entry.name}`,
          pluginName: entry.name,
          index,
        });
      }
    }
    validatePluginOrderingHint(issues, entries, entry.name, index, dependencies.orderAfter, 'after');
    validatePluginOrderingHint(issues, entries, entry.name, index, dependencies.orderBefore, 'before');
  });
  return issues;
}

function assertNoNewDependencyIssues(
  workflowRoot: string,
  project: string,
  current: PluginConfigEntry[],
  next: PluginConfigEntry[],
): void {
  const existing = new Set(collectPluginDependencyIssues(workflowRoot, project, current).map(pluginIssueIdentity));
  const introduced = collectPluginDependencyIssues(workflowRoot, project, next)
    .find((issue) => !existing.has(pluginIssueIdentity(issue)));
  if (introduced) {
    throw new Error(`[PLUGIN_DEPENDENCY_CONFLICT] ${introduced.message}`);
  }
}

function pluginIssueIdentity(issue: PluginValidationIssue): string {
  return `${issue.code}:${issue.pluginName || ''}:${issue.message}`;
}

function clonePluginConfigEntries(entries: PluginConfigEntry[]): PluginConfigEntry[] {
  return entries.map((entry) => ({
    name: entry.name,
    status: entry.status,
    description: entry.description,
    parameters: structuredClone(entry.parameters),
  }));
}

function requireUniquePluginEntry(entries: PluginConfigEntry[], name: string): PluginConfigEntry {
  const matches = entries.filter((entry) => entry.name === name);
  if (!matches.length) throw new Error(`Plugin does not exist: ${name}`);
  if (matches.length > 1) throw new Error(`Duplicate plugin configuration cannot be modified safely: ${name}`);
  return matches[0];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

interface PluginMetadataParseResult {
  schema?: PluginParameterSchema;
  warnings: string[];
}

interface ParsedSchemaResult {
  fields: PluginParameterSchemaField[];
  warnings: string[];
}

interface WorkingPluginParameterSchemaField extends PluginParameterSchemaField {
  unsupportedReason?: string;
  onLabel?: string;
  offLabel?: string;
}

interface SchemaParseContext {
  resolveStruct(name: string): PluginParameterSchemaField[] | null;
}

interface StructCacheEntry {
  status: 'parsing' | 'done' | 'missing';
  fields?: PluginParameterSchemaField[];
}

function parsePluginParameterSchema(
  workflowRoot: string,
  project: string,
  pluginName: string,
  fileRelativePath: string,
): PluginMetadataParseResult {
  const absolutePath = getProjectFileForRead(workflowRoot, project, fileRelativePath);
  if (!absolutePath) return { warnings: [`Plugin ${pluginName} file does not exist, so parameter metadata cannot be read`] };
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const header = extractPlugindescHeader(raw);
  if (!header) {
    return { warnings: [`Plugin ${pluginName} does not have a parseable parameter header (@plugindesc was not found)`] };
  }
  const metadataWarnings: string[] = [];
  const structResolver = createSchemaParseContext(raw, metadataWarnings);
  const context = structResolver.context;
  const parseResult = parseHeaderToSchema(header, context);
  const warnings = dedupeStrings([...metadataWarnings, ...parseResult.warnings]);
  const structs = structResolver.parsedStructs();
  if (!parseResult.fields.length) {
    return { warnings: warnings.length ? warnings : [`No parameters were parsed from plugin ${pluginName} parameter comments`] };
  }
  return {
    schema: { source: 'rmmv-plugin-header', fields: parseResult.fields, structs, warnings },
    warnings,
  };
}

function createSchemaParseContext(
  raw: string,
  warnings: string[],
): { context: SchemaParseContext; parsedStructs(): Record<string, PluginParameterSchemaField[]> } {
  const structBlocks = extractStructDefinitionBlocks(raw, warnings);
  const structCache = new Map<string, StructCacheEntry>();
  const context: SchemaParseContext = {
    resolveStruct(name: string): PluginParameterSchemaField[] | null {
      const normalized = normalizeStructName(name);
      const cached = structCache.get(normalized);
      if (cached?.status === 'done') return cached.fields || [];
      if (cached?.status === 'missing') return null;
      if (cached?.status === 'parsing') {
        warnings.push(`struct ${name} has a circular reference and was rejected`);
        return null;
      }
      const block = structBlocks.get(normalized);
      if (!block) {
        structCache.set(normalized, { status: 'missing' });
        warnings.push(`Missing /*~struct~${name}: */ definition for struct ${name}`);
        return null;
      }
      structCache.set(normalized, { status: 'parsing' });
      const parsed = parseHeaderToSchema(block, context);
      for (const warning of parsed.warnings) warnings.push(`struct ${name}: ${warning}`);
      structCache.set(normalized, { status: 'done', fields: parsed.fields });
      return parsed.fields;
    },
  };
  return {
    context,
    parsedStructs: () => Object.fromEntries(
      [...structCache.entries()]
        .filter(([, entry]) => entry.status === 'done')
        .map(([name, entry]) => [name, entry.fields || []]),
    ),
  };
}

function parseHeaderToSchema(block: string, context?: SchemaParseContext): ParsedSchemaResult {
  const fields: PluginParameterSchemaField[] = [];
  const warnings: string[] = [];
  const lines = parseHeaderLines(block);
  let current: WorkingPluginParameterSchemaField | null = null;
  let optionWaitingForValue = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tagMatch = trimmed.match(/^@([A-Za-z][A-Za-z0-9_-]*)\b\s*(.*)$/i);
    if (!tagMatch) {
      if (optionWaitingForValue) continue;
      if (current) {
        current.description = current.description ? `${current.description}\n${trimmed}` : trimmed;
      }
      continue;
    }

    const tag = tagMatch[1].toLowerCase();
    const rest = tagMatch[2].trim();

    if (tag === 'param') {
      current = flushCurrentParameter(fields, current, warnings);
      optionWaitingForValue = false;
      const rawKey = rest.trim();
      if (!rawKey) {
        warnings.push('Found @param without a parameter name');
        continue;
      }
      current = {
        key: rawKey,
        label: rawKey,
        kind: 'text',
        description: '',
      };
      continue;
    }

    if (!current) {
      if (isGlobalPluginMetadataTag(tag)) continue;
      warnings.push(`No parameter was active before @${tag}`);
      continue;
    }

    if (isGlobalPluginMetadataTag(tag)) {
      current = flushCurrentParameter(fields, current, warnings);
      optionWaitingForValue = false;
      continue;
    }

    if (tag === 'desc') {
      current.description = rest
        ? (current.description ? `${current.description}\n${rest}` : rest)
        : current.description;
      continue;
    }

    if (tag === 'text') {
      current.label = rest || current.label;
      continue;
    }

    if (tag === 'type') {
      current.rawType = rest || undefined;
      const mapped = mapParameterType(rest, context);
      if (!mapped) {
        current.unsupportedReason = `Parameter ${current.key} @type "${rest || '(empty)'}" is not supported`;
      } else if ('unsupportedReason' in mapped) {
        current.unsupportedReason = `Parameter ${current.key} @type "${rest || '(empty)'}" is not supported: ${mapped.unsupportedReason}`;
      } else {
        current.kind = mapped.kind;
        if (mapped.structName) current.structName = mapped.structName;
        else delete current.structName;
        if (mapped.fields) current.fields = mapped.fields;
        else delete current.fields;
        if (mapped.item) current.item = mapped.item;
        else delete current.item;
        if (mapped.databaseTable) current.databaseTable = mapped.databaseTable;
        else delete current.databaseTable;
      }
      continue;
    }

    if (tag === 'default') {
      current.defaultValue = rest;
      continue;
    }

    if (tag === 'min') {
      const min = Number(rest);
      if (Number.isFinite(min)) setNumericBound(current, 'min', min);
      else warnings.push(`Parameter ${current.key} has an invalid @min: ${rest}`);
      continue;
    }

    if (tag === 'max') {
      const max = Number(rest);
      if (Number.isFinite(max)) setNumericBound(current, 'max', max);
      else warnings.push(`Parameter ${current.key} has an invalid @max: ${rest}`);
      continue;
    }

    if (tag === 'option') {
      const target = optionTarget(current);
      if (target.kind !== 'select' && target.kind !== 'combo') target.kind = 'select';
      const option = parseOptionLine(rest, target.kind);
      target.options = target.options || [];
      target.options.push(option);
      optionWaitingForValue = true;
      continue;
    }

    if (tag === 'value') {
      const target = optionTarget(current);
      if (target.kind === 'combo') {
        warnings.push(`Parameter ${current.key} uses @value with combo; MZ combo values come from @option, so @value was ignored`);
        optionWaitingForValue = false;
        continue;
      }
      if (!target.options || target.options.length === 0) {
        warnings.push(`Parameter ${current.key} has @value without a matching @option`);
        continue;
      }
      const value = parseOptionValue(rest, target.kind);
      if (optionWaitingForValue) {
        const last = target.options[target.options.length - 1];
        if (last) last.value = value;
      }
      optionWaitingForValue = false;
      continue;
    }

    if (tag === 'on') {
      current.onLabel = rest || 'ON';
      continue;
    }

    if (tag === 'off') {
      current.offLabel = rest || 'OFF';
      continue;
    }

    if (tag === 'dir') {
      current.directory = rest || undefined;
      continue;
    }

    if (tag === 'parent') {
      current.parent = rest || undefined;
      continue;
    }

    if (tag === 'decimals') {
      const decimals = Number(rest);
      if (Number.isInteger(decimals) && decimals >= 0) setNumericDecimals(current, decimals);
      else warnings.push(`Parameter ${current.key} has an invalid @decimals: ${rest}`);
      continue;
    }

    if (tag === 'require') {
      current.required = rest === '' || rest === '1' || /^true$/i.test(rest);
      continue;
    }

    if (tag === 'plugindesc' || tag === 'author') {
      optionWaitingForValue = false;
      continue;
    }

    if (isIgnorableParameterMetadataTag(tag)) {
      optionWaitingForValue = false;
      continue;
    }

    warnings.push(`Parameter ${current.key} @${tag} is not supported yet`);
  }
  flushCurrentParameter(fields, current, warnings);
  validateParameterParentTree(fields, warnings);
  if (!fields.length) {
    return { fields: [], warnings: ['No @param definitions were parsed'] };
  }
  return { fields, warnings };
}

function flushCurrentParameter(
  fields: PluginParameterSchemaField[],
  current: WorkingPluginParameterSchemaField | null,
  warnings: string[],
): null {
  if (!current) return null;
  if (!current.key || !current.label) {
    warnings.push(`Ignored invalid parameter field: ${JSON.stringify(current)}`);
    return null;
  }
  if (current.unsupportedReason) {
    warnings.push(current.unsupportedReason);
    const { onLabel, offLabel, ...readonlyField } = current;
    readonlyField.editable = false;
    fields.push(readonlyField);
    return null;
  }
  if (current.kind === 'number') {
    validateNumberDefault(current, current.key, warnings);
    if (typeof current.min === 'number' && typeof current.max === 'number' && current.min > current.max) {
      warnings.push(`Parameter ${current.key} @min is greater than @max`);
    }
  }
  if (current.kind === 'array' && current.item?.kind === 'number') {
    validateNumberDefault(current.item, `${current.key}[]`, warnings);
    if (typeof current.item.min === 'number' && typeof current.item.max === 'number' && current.item.min > current.item.max) {
      warnings.push(`Parameter ${current.key} @min is greater than @max`);
    }
  }
  if (current.kind === 'struct') {
    if (!current.fields?.length) {
      warnings.push(`Parameter ${current.key} struct ${current.structName || ''} has no editable fields`);
      return null;
    }
    if (typeof current.defaultValue !== 'undefined' && current.defaultValue !== '' && !parseJsonObjectLiteral(String(current.defaultValue))) {
      warnings.push(`Parameter ${current.key} @default could not be parsed as a struct object`);
    }
  }
  if (current.kind === 'array') {
    if (!current.item) {
      warnings.push(`Parameter ${current.key} array item type is missing`);
      return null;
    }
    if (current.item.kind === 'struct' && !current.item.fields?.length) {
      warnings.push(`Parameter ${current.key} array struct ${current.item.structName || ''} has no editable fields`);
      return null;
    }
    if (typeof current.defaultValue !== 'undefined' && current.defaultValue !== '' && !parseJsonArrayLiteral(String(current.defaultValue))) {
      warnings.push(`Parameter ${current.key} @default could not be parsed as an array`);
    }
  }
  if (current.kind === 'boolean') {
    if (current.onLabel || current.offLabel) {
      current.options = [
        { label: current.onLabel || 'ON', value: 'true' },
        { label: current.offLabel || 'OFF', value: 'false' },
      ];
    }
    if (typeof current.defaultValue !== 'undefined' && current.defaultValue !== '' && parseBooleanLiteral(String(current.defaultValue)) == null) {
      warnings.push(`Parameter ${current.key} @default could not be parsed as a boolean`);
    }
  }
  if (current.kind === 'select' && (!current.options || current.options.length === 0)) {
    warnings.push(`Parameter ${current.key} is declared as select but has no @option`);
    return null;
  }
  if (current.kind === 'array' && current.item?.kind === 'select' && (!current.item.options || current.item.options.length === 0)) {
    warnings.push(`Parameter ${current.key} is declared as a select array but has no @option`);
    return null;
  }
  const { unsupportedReason, onLabel, offLabel, ...field } = current;
  fields.push(field);
  return null;
}

function extractPlugindescHeader(raw: string): string | null {
  const body = extractDefaultPluginHeaderBody(raw);
  if (!body || !/@plugindesc\b/i.test(body)) return null;
  return `/*:\n${body}\n*/`;
}

function extractStructDefinitionBlocks(raw: string, warnings: string[]): Map<string, string> {
  const structs = new Map<string, string>();
  const blocks = raw.match(/\/\*~struct~[^\n]*[\s\S]*?\*\//g) || [];
  for (const block of blocks) {
    const match = block.match(/^\/\*~struct~([^:\r\n]+)\s*:\s*(?:\r?\n|$)/i);
    if (!match) continue;
    const rawName = match?.[1]?.trim();
    if (!rawName) {
      warnings.push('Found a struct comment block without a struct name');
      continue;
    }
    const name = normalizeStructName(rawName);
    if (structs.has(name)) warnings.push(`struct ${rawName} is defined more than once; the later definition overrides the earlier one`);
    structs.set(name, block);
  }
  return structs;
}

function parseHeaderLines(block: string): string[] {
  return block
    .replace(/^\/\*~struct~[^:]+:\s?/i, '')
    .replace(/^\/\*[:\s]?/, '')
    .replace(/\*\/$/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*?\s?/, ''))
    .filter((line) => line.trim().length > 0);
}

function isGlobalPluginMetadataTag(tag: string): boolean {
  return [
    'plugindesc', 'author', 'help', 'url', 'target', 'base', 'orderafter', 'orderbefore',
  ].includes(tag);
}

function isIgnorableParameterMetadataTag(tag: string): boolean {
  return [
    'clamp',
  ].includes(tag);
}

function validateParameterParentTree(fields: PluginParameterSchemaField[], warnings: string[]): void {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const field of fields) {
    if (!field.parent) continue;
    if (!byKey.has(field.parent)) {
      warnings.push(`Parameter ${field.key} references missing @parent ${field.parent}`);
      continue;
    }
    const visited = new Set([field.key]);
    let parent = field.parent;
    while (parent) {
      if (visited.has(parent)) {
        warnings.push(`Parameter ${field.key} has a circular @parent chain`);
        break;
      }
      visited.add(parent);
      parent = byKey.get(parent)?.parent || '';
    }
  }
}

function normalizeStructName(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

type ParameterTypeMapping =
  | Pick<PluginParameterSchemaField, 'kind' | 'rawType' | 'structName' | 'fields' | 'item' | 'databaseTable'>
  | { unsupportedReason: string };

function mapParameterType(raw: string, context?: SchemaParseContext): ParameterTypeMapping | null {
  const value = raw.trim();
  if (!value) return { kind: 'text' };

  const arrayMatch = value.match(/^(.+?)\s*\[\]$/);
  if (arrayMatch) {
    const itemType = mapArrayItemType(arrayMatch[1].trim(), context);
    if (!itemType || 'unsupportedReason' in itemType) {
      return { unsupportedReason: itemType && 'unsupportedReason' in itemType ? itemType.unsupportedReason : 'Array item type is not supported' };
    }
    return {
      kind: 'array',
      rawType: value,
      item: {
        key: '$item',
        label: 'Item',
        description: '',
        rawType: arrayMatch[1].trim(),
        ...itemType,
      },
    };
  }

  const structMatch = value.match(/^struct\s*<\s*([^>]+?)\s*>$/i);
  if (structMatch) {
    const structName = structMatch[1].trim();
    const fields = context?.resolveStruct(structName);
    if (!fields?.length) return { unsupportedReason: `struct ${structName} is undefined or has no fields` };
    return { kind: 'struct', rawType: value, structName, fields };
  }

  return mapScalarParameterKind(value);
}

function mapArrayItemType(
  raw: string,
  context?: SchemaParseContext,
): Pick<PluginParameterSchemaField, 'kind' | 'rawType' | 'structName' | 'fields' | 'item' | 'databaseTable'> | { unsupportedReason: string } | null {
  return mapParameterType(raw, context);
}

function mapScalarParameterKind(
  raw: string,
): Pick<PluginParameterSchemaField, 'kind' | 'rawType' | 'databaseTable'> | { unsupportedReason: string } | null {
  const value = raw.toLowerCase().trim();
  if (!value) return { kind: 'text' };
  if (/\[\]$/.test(value) || /^struct\s*</.test(value)) return null;
  const rawType = raw || undefined;
  if (['number', 'numeric', 'integer', 'float', 'decimal'].includes(value)) return { kind: 'number', rawType };
  if (['boolean', 'bool', 'onoff', 'on/off'].includes(value)) return { kind: 'boolean', rawType };
  if (['select', 'dropdown'].includes(value)) return { kind: 'select', rawType };
  if (value === 'combo') return { kind: 'combo', rawType };
  if (value === 'note' || ['multiline_string', 'multiline string', 'multiline'].includes(value)) {
    return { kind: 'multiline', rawType };
  }
  if (value === 'json' || value === 'object') {
    return { unsupportedReason: 'raw JSON editing is intentionally unavailable' };
  }
  if (['string', 'text'].includes(value)) return { kind: 'text', rawType };
  if (value === 'file' || value.startsWith('file ')) return { kind: 'file', rawType };
  if (value === 'map') return { kind: 'map', rawType };
  if (value === 'location') return { kind: 'location', rawType };
  const databaseTables: Record<string, string> = {
    actor: 'Actors',
    class: 'Classes',
    skill: 'Skills',
    item: 'Items',
    weapon: 'Weapons',
    armor: 'Armors',
    enemy: 'Enemies',
    troop: 'Troops',
    state: 'States',
    animation: 'Animations',
    tileset: 'Tilesets',
    common_event: 'CommonEvents',
    'common event': 'CommonEvents',
    switch: 'System.switches',
    variable: 'System.variables',
  };
  if (databaseTables[value]) return { kind: 'database', rawType, databaseTable: databaseTables[value] };
  return null;
}

function optionTarget(field: WorkingPluginParameterSchemaField): WorkingPluginParameterSchemaField | PluginParameterSchemaField {
  if (field.kind === 'array' && field.item) return field.item;
  return field;
}

function setNumericBound(field: WorkingPluginParameterSchemaField, key: 'min' | 'max', value: number): void {
  if (field.kind === 'array' && field.item && field.item.kind === 'number') {
    field.item[key] = value;
    return;
  }
  field[key] = value;
}

function setNumericDecimals(field: WorkingPluginParameterSchemaField, value: number): void {
  if (field.kind === 'array' && field.item && field.item.kind === 'number') {
    field.item.decimals = value;
    return;
  }
  field.decimals = value;
}

function validateNumberDefault(field: Pick<PluginParameterSchemaField, 'defaultValue'>, label: string, warnings: string[]): void {
  if (typeof field.defaultValue !== 'undefined' && field.defaultValue !== '' && !Number.isFinite(Number(field.defaultValue))) {
    warnings.push(`Parameter ${label} @default could not be parsed as a number`);
  }
}

function parseJsonObjectLiteral(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonArrayLiteral(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseOptionLine(text: string, kind: PluginParameterSchemaField['kind']): { label: string; value: string | number | boolean } {
  const [label, value] = text.split(':').map((item) => item.trim());
  if (value !== undefined && value !== '') {
    return { label: label || value, value: parseOptionValue(value, kind) };
  }
  return { label: label || text, value: parseOptionValue(label || text, kind) };
}

function parseDefaultValue(value: string, kind: PluginParameterSchemaField['kind']): unknown {
  if (kind === 'boolean') {
    const parsed = parseBooleanLiteral(value);
    if (parsed != null) return parsed;
    return value;
  }
  if (kind === 'number') {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }
  return value;
}

function parseBooleanLiteral(value: string): boolean | null {
  if (value.toLowerCase() === 'true' || value.toLowerCase() === 'on' || value === '1') return true;
  if (value.toLowerCase() === 'false' || value.toLowerCase() === 'off' || value === '0') return false;
  return null;
}

function parseOptionValue(value: string, kind: PluginParameterSchemaField['kind']): string | number | boolean {
  const parsed = parseDefaultValue(value, kind);
  if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') return parsed;
  return value;
}

function extractPluginCommandHintsFromFile(
  workflowRoot: string,
  project: string,
  pluginName: string,
  fileRelativePath: string,
): PluginCommandHint[] {
  const absolutePath = getProjectFileForRead(workflowRoot, project, fileRelativePath);
  if (!absolutePath) return [];
  return extractPluginCommandHints(pluginName, fs.readFileSync(absolutePath, 'utf8'));
}

function extractPluginCommandHints(pluginName: string, raw: string): PluginCommandHint[] {
  const hints = new Map<string, PluginCommandHint>();
  const add = (
    command: string,
    source: PluginCommandHint['source'],
    offset: number,
    details: Pick<PluginCommandHint, 'displayName' | 'arguments'> = {},
  ) => {
    const normalized = command.trim();
    if (!normalized || /\s/.test(normalized)) return;
    const key = `${source}:${normalized.toLowerCase()}`;
    if (hints.has(key)) return;
    hints.set(key, {
      pluginName,
      command: normalized,
      source,
      evidence: sourceLineAt(raw, offset),
      ...details,
    });
  };

  const commandExpr = String.raw`command(?:\.(?:toLowerCase|toUpperCase)\(\))?`;
  const compare = new RegExp(`${commandExpr}\\s*(?:===|==)\\s*(['"])([^'"]+)\\1|(['"])([^'"]+)\\3\\s*(?:===|==)\\s*${commandExpr}`, 'g');
  for (const match of raw.matchAll(compare)) {
    add(match[2] || match[4] || '', 'command-comparison', match.index || 0);
  }

  const switchCommand = new RegExp(String.raw`switch\s*\(\s*${commandExpr}\s*\)\s*\{([\s\S]*?)\n\s*\}`, 'g');
  for (const blockMatch of raw.matchAll(switchCommand)) {
    const body = blockMatch[1] || '';
    const bodyOffset = (blockMatch.index || 0) + blockMatch[0].indexOf(body);
    const cases = /case\s+(['"])([^'"]+)\1\s*:/g;
    for (const caseMatch of body.matchAll(cases)) {
      add(caseMatch[2] || '', 'switch-command-case', bodyOffset + (caseMatch.index || 0));
    }
  }


  for (const declaration of parseMZPluginCommands(raw)) {
    add(declaration.command, 'mz-command-header', declaration.offset, {
      displayName: declaration.displayName,
      arguments: declaration.arguments,
    });
  }

  return Array.from(hints.values()).sort((a, b) => a.command.localeCompare(b.command));
}

interface ParsedMZPluginCommand {
  command: string;
  displayName: string;
  arguments: PluginCommandArgument[];
  offset: number;
}

interface WorkingPluginCommandArgument extends PluginCommandArgument {
  unsupportedReason?: string;
  onLabel?: string;
  offLabel?: string;
}

function parseMZPluginCommands(raw: string): ParsedMZPluginCommand[] {
  const result: ParsedMZPluginCommand[] = [];
  const metadataWarnings: string[] = [];
  const context = createSchemaParseContext(raw, metadataWarnings).context;
  const defaultHeader = extractDefaultPluginHeaderBlock(raw);
  for (const block of defaultHeader ? [defaultHeader] : []) {
    const lines = defaultHeaderLinesWithOffsets(block.body);
    const target = lines
      .map(({ line }) => line.match(/^@target\s+(.+)$/i)?.[1]?.trim())
      .find(Boolean);
    if (target && !target.split(/\s+/).some((value) => value.toUpperCase() === 'MZ')) continue;

    let current: ParsedMZPluginCommand | null = null;
    let argument: WorkingPluginCommandArgument | null = null;
    let optionWaitingForValue = false;
    const flushArgument = (): void => {
      if (current && argument) {
        if (argument.kind === 'boolean' && (argument.onLabel || argument.offLabel)) {
          argument.options = [
            { label: argument.onLabel || 'ON', value: 'true' },
            { label: argument.offLabel || 'OFF', value: 'false' },
          ];
        }
        const { onLabel, offLabel, ...field } = argument;
        current.arguments.push(field);
      }
      argument = null;
      optionWaitingForValue = false;
    };
    const flushCommand = (): void => {
      flushArgument();
      if (current?.command) result.push(current);
      current = null;
    };

    for (const { line, offset } of lines) {
      const tag = line.match(/^@([A-Za-z][A-Za-z0-9_-]*)\b\s*(.*)$/);
      if (!tag) continue;
      const name = tag[1].toLowerCase();
      const value = tag[2].trim();
      if (name === 'command') {
        flushCommand();
        current = {
          command: value,
          displayName: value,
          arguments: [],
          offset: block.bodyOffset + offset,
        };
        continue;
      }
      if (!current) continue;
      if (name === 'arg') {
        flushArgument();
        argument = { name: value, key: value, label: value, description: '', kind: 'text', rawType: 'string', defaultValue: '' };
        continue;
      }
      if (name === 'text') {
        if (argument) argument.label = value || argument.label;
        else current.displayName = value || current.displayName;
        continue;
      }
      if (name === 'desc' && argument) {
        argument.description = argument.description ? `${argument.description}\n${value}` : value;
        continue;
      }
      if (name === 'type' && argument) {
        const mapped = mapParameterType(value || 'string', context);
        argument.rawType = value || 'string';
        if (!mapped) {
          argument.editable = false;
          argument.unsupportedReason = `Plugin command argument ${argument.name} uses unsupported type ${value || '(empty)'}`;
        } else if ('unsupportedReason' in mapped) {
          argument.editable = false;
          argument.unsupportedReason = mapped.unsupportedReason;
        } else {
          argument.kind = mapped.kind;
          if (mapped.structName) argument.structName = mapped.structName;
          if (mapped.fields) argument.fields = mapped.fields;
          if (mapped.item) argument.item = mapped.item;
          if (mapped.databaseTable) argument.databaseTable = mapped.databaseTable;
        }
        continue;
      }
      if (name === 'default' && argument) {
        argument.defaultValue = value;
        continue;
      }
      if (name === 'min' && argument) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) setNumericBound(argument, 'min', parsed);
        continue;
      }
      if (name === 'max' && argument) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) setNumericBound(argument, 'max', parsed);
        continue;
      }
      if (name === 'decimals' && argument) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 0) setNumericDecimals(argument, parsed);
        continue;
      }
      if (name === 'dir' && argument) {
        argument.directory = value || undefined;
        continue;
      }
      if (name === 'parent' && argument) {
        argument.parent = value || undefined;
        continue;
      }
      if (name === 'require' && argument) {
        argument.required = value === '' || value === '1' || /^true$/i.test(value);
        continue;
      }
      if (name === 'option' && argument) {
        const target = optionTarget(argument);
        if (target.kind !== 'select' && target.kind !== 'combo') target.kind = 'select';
        target.options = target.options || [];
        target.options.push(parseOptionLine(value, target.kind));
        optionWaitingForValue = true;
        continue;
      }
      if (name === 'value' && argument && optionWaitingForValue) {
        const target = optionTarget(argument);
        if (target.kind === 'combo') {
          optionWaitingForValue = false;
          continue;
        }
        const option = target.options?.[target.options.length - 1];
        if (option) option.value = parseOptionValue(value, target.kind);
        optionWaitingForValue = false;
        continue;
      }
      if (name === 'on' && argument) {
        argument.onLabel = value || 'ON';
        continue;
      }
      if (name === 'off' && argument) {
        argument.offLabel = value || 'OFF';
      }
    }
    flushCommand();
  }
  return result;
}

function defaultHeaderLinesWithOffsets(body: string): Array<{ line: string; offset: number }> {
  const result: Array<{ line: string; offset: number }> = [];
  for (const match of String(body || '').matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)) {
    const rawLine = match[0].replace(/\r?\n$/, '');
    if (!rawLine && match[0] === '') continue;
    const prefix = rawLine.match(/^\s*\*?\s?/)?.[0] || '';
    const line = rawLine.slice(prefix.length);
    if (!line.trim()) continue;
    result.push({
      line,
      offset: (match.index || 0) + prefix.length,
    });
  }
  return result;
}

function sourceLineAt(raw: string, offset: number): string {
  const start = raw.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const end = raw.indexOf('\n', offset);
  const line = raw.slice(start, end >= 0 ? end : raw.length).trim();
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}
