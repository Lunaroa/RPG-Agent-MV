import fs from 'node:fs';
import path from 'node:path';

import { resolveDataDir } from '../rmmv/project-scanner.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  stageProjectFilesAtomically,
  type StagedProjectFileMutation,
  writeStagedProjectBuffer,
} from './staging-service.ts';

export interface ManagedPluginEntry {
  index: number;
  name: string;
  status: boolean;
  description: string;
  parameters: Record<string, unknown>;
  parameterCount: number;
  fileName: string;
  fileRelativePath: string;
  fileExists: boolean;
  parameterSchema?: PluginParameterSchema;
  parameterSchemaWarnings: string[];
  commandHints: PluginCommandHint[];
}

export interface PluginParameterSchemaField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'select' | 'json' | 'struct' | 'array';
  description: string;
  rawType?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string | number | boolean; label: string }>;
  min?: number;
  max?: number;
  directory?: string;
  required?: boolean;
  structName?: string;
  fields?: PluginParameterSchemaField[];
  item?: PluginParameterSchemaField;
}

export interface PluginParameterSchema {
  source: 'rmmv-plugin-header';
  fields: PluginParameterSchemaField[];
  structs?: Record<string, PluginParameterSchemaField[]>;
  warnings: string[];
}

export interface PluginCommandHint {
  pluginName: string;
  command: string;
  source: 'command-comparison' | 'switch-command-case';
  evidence: string;
}

export interface ManagedPluginFile {
  name: string;
  fileName: string;
  relativePath: string;
  exists: boolean;
  staged: boolean;
  deleted: boolean;
  size: number | null;
}

export interface PluginValidationIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  pluginName?: string;
  index?: number;
  relativePath?: string;
}

export interface PluginValidationResult {
  ok: boolean;
  issues: PluginValidationIssue[];
}

export interface PluginConfigurationResult {
  project: string;
  relativePath: string;
  exists: boolean;
  plugins: ManagedPluginEntry[];
  pluginFiles: ManagedPluginFile[];
  validation: PluginValidationResult;
}

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
  return updatePluginEntry(workflowRoot, project, pluginName, (entry) => {
    entry.status = Boolean(enabled);
  });
}

export function reorderPlugins(
  workflowRoot: string,
  project: string,
  pluginNames: string[],
): PluginConfigurationResult {
  const parsed = requireReadablePlugins(workflowRoot, project);
  assertUniqueConfiguredNames(parsed.entries);
  const requested = pluginNames.map(normalizeConfiguredPluginName);
  const current = parsed.entries.map((entry) => normalizeConfiguredPluginName(entry.name));
  if (requested.length !== current.length) throw new Error('Plugin ordering must include every currently configured plugin');
  const currentSet = new Set(current);
  const requestedSet = new Set(requested);
  if (requestedSet.size !== requested.length) throw new Error('Plugin ordering contains duplicate names');
  for (const name of currentSet) {
    if (!requestedSet.has(name)) throw new Error(`Plugin ordering is missing: ${name}`);
  }
  const byName = new Map(parsed.entries.map((entry) => [normalizeConfiguredPluginName(entry.name), entry]));
  writePluginsJs(workflowRoot, project, parsed.relativePath, requested.map((name) => byName.get(name)!));
  return readPluginConfiguration(workflowRoot, project);
}

export function updatePluginParameters(
  workflowRoot: string,
  project: string,
  pluginName: string,
  parameters: Record<string, unknown>,
): PluginConfigurationResult {
  if (!isPlainObject(parameters)) throw new Error('Plugin parameters must be an object');
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
  });

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
  const metadata = entry.name
    ? parsePluginParameterSchema(workflowRoot, project, entry.name, fileRelativePath)
    : { schema: undefined, warnings: [] };
  const commandHints = entry.name && fileRelativePath
    ? extractPluginCommandHintsFromFile(workflowRoot, project, entry.name, fileRelativePath)
    : [];
  const fileName = entry.name ? `${entry.name}.js` : '';
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
  };
}

function listPluginFiles(workflowRoot: string, project: string): ManagedPluginFile[] {
  const result = new Map<string, ManagedPluginFile>();
  for (const dir of pluginDirCandidates(project)) {
    const absoluteDir = path.join(project, dir);
    if (!fs.existsSync(absoluteDir)) continue;
    for (const fileName of fs.readdirSync(absoluteDir).filter((name) => name.toLowerCase().endsWith('.js')).sort()) {
      const relativePath = `${dir}/${fileName}`;
      const absolute = getProjectFileForRead(workflowRoot, project, relativePath) || path.join(absoluteDir, fileName);
      result.set(relativePath, {
        name: path.basename(fileName, '.js'),
        fileName,
        relativePath,
        exists: true,
        staged: absolute.includes(path.join(path.resolve(workflowRoot), 'runtime', 'agent-console-staging')),
        deleted: false,
        size: fs.existsSync(absolute) ? fs.statSync(absolute).size : null,
      });
    }
  }

  for (const file of getProjectStagingStatus(workflowRoot, project).files) {
    if (!isPluginFileRelativePath(file.relativePath)) continue;
    const fileName = path.posix.basename(file.relativePath);
    const existing = result.get(file.relativePath);
    const absolute = getProjectFileForRead(workflowRoot, project, file.relativePath);
    result.set(file.relativePath, {
      name: path.posix.basename(fileName, '.js'),
      fileName,
      relativePath: file.relativePath,
      exists: !file.delete && Boolean(absolute),
      staged: true,
      deleted: Boolean(file.delete),
      size: absolute && fs.existsSync(absolute) ? fs.statSync(absolute).size : existing?.size ?? null,
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
  const name = String(value || '').trim().replace(/\.js$/i, '');
  if (!name || name === '.' || name === '..') throw new Error('Invalid plugin name');
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || name.split(/[\\/]/).some((part) => part === '..')) {
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
  return /^(?:www\/)?js\/plugins\/[^/]+\.js$/i.test(relativePath);
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
  const preWarnings: string[] = [];
  const structBlocks = extractStructDefinitionBlocks(raw, preWarnings);
  const structCache = new Map<string, StructCacheEntry>();
  const structWarnings: string[] = [];
  const context: SchemaParseContext = {
    resolveStruct(name: string): PluginParameterSchemaField[] | null {
      const normalized = normalizeStructName(name);
      const cached = structCache.get(normalized);
      if (cached?.status === 'done') return cached.fields || [];
      if (cached?.status === 'missing') return null;
      if (cached?.status === 'parsing') {
        structWarnings.push(`struct ${name} has a circular reference and was rejected`);
        return null;
      }
      const block = structBlocks.get(normalized);
      if (!block) {
        structCache.set(normalized, { status: 'missing' });
        structWarnings.push(`Missing /*~struct~${name}: */ definition for struct ${name}`);
        return null;
      }
      structCache.set(normalized, { status: 'parsing' });
      const parsed = parseHeaderToSchema(block, context);
      for (const warning of parsed.warnings) structWarnings.push(`struct ${name}: ${warning}`);
      structCache.set(normalized, { status: 'done', fields: parsed.fields });
      return parsed.fields;
    },
  };
  const parseResult = parseHeaderToSchema(header, context);
  const warnings = dedupeStrings([...preWarnings, ...parseResult.warnings, ...structWarnings]);
  const structs = Object.fromEntries(
    [...structCache.entries()]
      .filter(([, entry]) => entry.status === 'done')
      .map(([name, entry]) => [name, entry.fields || []]),
  );
  if (!parseResult.fields.length) {
    return { warnings: warnings.length ? warnings : [`No parameters were parsed from plugin ${pluginName} parameter comments`] };
  }
  return {
    schema: { source: 'rmmv-plugin-header', fields: parseResult.fields, structs, warnings },
    warnings,
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
        current.structName = mapped.structName;
        current.fields = mapped.fields;
        current.item = mapped.item;
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
      if (target.kind !== 'select') target.kind = 'select';
      const option = parseOptionLine(rest, target.kind);
      target.options = target.options || [];
      target.options.push(option);
      optionWaitingForValue = true;
      continue;
    }

    if (tag === 'value') {
      const target = optionTarget(current);
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
  const blocks = raw.match(/\/\*[:\s]?[^\n]*[\s\S]*?\*\//g);
  if (!blocks?.length) return null;
  return blocks.find((block) => /@plugindesc\b/i.test(block)) || null;
}

function extractStructDefinitionBlocks(raw: string, warnings: string[]): Map<string, string> {
  const structs = new Map<string, string>();
  const blocks = raw.match(/\/\*~struct~[^\n]*[\s\S]*?\*\//g) || [];
  for (const block of blocks) {
    const match = block.match(/^\/\*~struct~([^:\r\n]+)\s*:/i);
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
    'parent', 'decimals', 'clamp',
  ].includes(tag);
}

function normalizeStructName(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

type ParameterTypeMapping =
  | Pick<PluginParameterSchemaField, 'kind' | 'rawType' | 'structName' | 'fields' | 'item'>
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
): Pick<PluginParameterSchemaField, 'kind' | 'rawType' | 'structName' | 'fields' | 'item'> | { unsupportedReason: string } | null {
  const structMatch = raw.match(/^struct\s*<\s*([^>]+?)\s*>$/i);
  if (structMatch) {
    const structName = structMatch[1].trim();
    const fields = context?.resolveStruct(structName);
    if (!fields?.length) return { unsupportedReason: `struct ${structName} is undefined or has no fields` };
    return { kind: 'struct', rawType: raw, structName, fields };
  }
  if (/\[\]$/.test(raw)) return { unsupportedReason: 'Nested arrays are not supported yet' };
  return mapScalarParameterKind(raw);
}

function mapScalarParameterKind(raw: string): Pick<PluginParameterSchemaField, 'kind' | 'rawType'> | null {
  const kind = mapParameterKind(raw);
  return kind ? { kind, rawType: raw || undefined } : null;
}

function mapParameterKind(raw: string): PluginParameterSchemaField['kind'] | null {
  const value = raw.toLowerCase().trim();
  if (!value) return 'text';
  if (/\[\]$/.test(value) || /^struct\s*</.test(value)) return null;
  if (['number', 'numeric', 'integer', 'float', 'decimal'].includes(value)) return 'number';
  if (['actor', 'class', 'skill', 'item', 'weapon', 'armor', 'enemy', 'troop', 'state', 'animation', 'tileset', 'common_event', 'common event', 'switch', 'variable'].includes(value)) return 'number';
  if (['boolean', 'bool', 'onoff', 'on/off', 'switch'].includes(value)) return 'boolean';
  if (['select', 'combo', 'dropdown'].includes(value)) return 'select';
  if (['json', 'object', 'note'].includes(value)) return 'json';
  if (['string', 'text', 'multiline_string', 'multiline string', 'multiline'].includes(value)) return 'text';
  if (value === 'file' || value.startsWith('file ')) return 'text';
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
  const add = (command: string, source: PluginCommandHint['source'], offset: number) => {
    const normalized = command.trim();
    if (!normalized || /\s/.test(normalized)) return;
    const key = `${source}:${normalized.toLowerCase()}`;
    if (hints.has(key)) return;
    hints.set(key, {
      pluginName,
      command: normalized,
      source,
      evidence: sourceLineAt(raw, offset),
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

  return Array.from(hints.values()).sort((a, b) => a.command.localeCompare(b.command));
}

function sourceLineAt(raw: string, offset: number): string {
  const start = raw.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const end = raw.indexOf('\n', offset);
  const line = raw.slice(start, end >= 0 ? end : raw.length).trim();
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}
