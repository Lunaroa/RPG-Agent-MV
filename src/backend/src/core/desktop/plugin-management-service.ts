import fs from 'node:fs';
import path from 'node:path';

import { resolveDataDir } from '../rmmv/project-scanner.ts';
import {
  deleteStagedProjectFile,
  getProjectFileForRead,
  getProjectStagingStatus,
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
  if (requested.length !== current.length) throw new Error('插件排序必须包含当前全部插件');
  const currentSet = new Set(current);
  const requestedSet = new Set(requested);
  if (requestedSet.size !== requested.length) throw new Error('插件排序包含重复名称');
  for (const name of currentSet) {
    if (!requestedSet.has(name)) throw new Error(`插件排序缺少：${name}`);
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
  if (!isPlainObject(parameters)) throw new Error('插件参数必须是对象');
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
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('插件源文件不存在');
  if (path.extname(source).toLowerCase() !== '.js') throw new Error('只允许安装 .js 插件文件');
  const name = normalizePluginFileStem(options.name || path.basename(source, '.js'));
  const relativePath = `${pluginDirRelativePath(project)}/${name}.js`;
  if (getProjectFileForRead(workflowRoot, project, relativePath) && !options.overwrite) {
    throw new Error(`插件文件已存在：${name}.js`);
  }

  writeStagedProjectBuffer(workflowRoot, project, relativePath, fs.readFileSync(source));
  let configuration: PluginConfigurationResult | undefined;
  if (options.configuration) {
    configuration = upsertPluginConfiguration(workflowRoot, project, {
      name,
      status: Boolean(options.configuration.status),
      description: String(options.configuration.description || ''),
      parameters: isPlainObject(options.configuration.parameters) ? options.configuration.parameters : {},
    });
  }
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
  const name = normalizePluginFileStem(pluginName);
  const parsed = readPlugins(workflowRoot, project);
  const configured = parsed.entries.filter((entry) => entry.name === name);
  if (configured.some((entry) => entry.status) && !options.force && !options.removeConfigurationEntry) {
    throw new Error(`插件仍在启用，禁止删除文件：${name}`);
  }
  const relativePath = pluginFileCandidates(project, name).find((candidate) => getProjectFileForRead(workflowRoot, project, candidate));
  if (!relativePath) throw new Error(`插件文件不存在：${name}.js`);
  deleteStagedProjectFile(workflowRoot, project, relativePath);

  let configuration: PluginConfigurationResult | undefined;
  if (options.removeConfigurationEntry) {
    const next = parsed.entries.filter((entry) => entry.name !== name);
    writePluginsJs(workflowRoot, project, parsed.relativePath, next);
    configuration = readPluginConfiguration(workflowRoot, project);
  }

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
      message: '缺少插件配置 js/plugins.js',
      relativePath: parsed.relativePath,
    });
  }
  if (parsed.parseError) {
    issues.push({
      severity: 'error',
      code: 'plugins-js-parse-error',
      message: `plugins.js 无法解析：${parsed.parseError}`,
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
        message: `第 ${index + 1} 个插件缺少名称`,
        index,
      });
      return;
    }
    if (seen.has(name)) {
      issues.push({
        severity: 'error',
        code: 'plugin-name-duplicate',
        message: `插件重复配置：${name}`,
        pluginName: name,
        index,
      });
    }
    seen.set(name, index);
    if (!isPlainObject(entry.parameters)) {
      issues.push({
        severity: 'error',
        code: 'plugin-parameters-invalid',
        message: `插件 ${name} 的 parameters 必须是对象`,
        pluginName: name,
        index,
      });
    }
    const fileRelativePath = resolveExistingPluginFileRelativePath(workflowRoot, project, name);
    if (!fileRelativePath) {
      issues.push({
        severity: entry.status ? 'error' : 'warn',
        code: 'plugin-file-missing',
        message: `插件文件缺失：${name}.js`,
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
  if (!matches.length) throw new Error(`插件不存在：${name}`);
  if (matches.length > 1) throw new Error(`插件重复配置，不能安全修改：${name}`);
  update(matches[0]);
  writePluginsJs(workflowRoot, project, parsed.relativePath, parsed.entries);
  return readPluginConfiguration(workflowRoot, project);
}

function upsertPluginConfiguration(
  workflowRoot: string,
  project: string,
  entry: PluginConfigEntry,
): PluginConfigurationResult {
  const parsed = readPlugins(workflowRoot, project);
  const index = parsed.entries.findIndex((item) => item.name === entry.name);
  const next = [...parsed.entries];
  if (index >= 0) next[index] = entry;
  else next.push(entry);
  writePluginsJs(workflowRoot, project, parsed.relativePath, next);
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
  if (!parsed.exists) throw new Error(`项目文件不存在：${parsed.relativePath}`);
  if (parsed.parseError) throw new Error(`plugins.js 无法解析：${parsed.parseError}`);
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`插件配置无效：${index + 1}`);
  const name = normalizeConfiguredPluginName(String(value.name || ''));
  if (!isPlainObject(value.parameters)) throw new Error(`插件 ${name} 的 parameters 必须是对象`);
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
  if (!name || name === '.' || name === '..') throw new Error('插件名称无效');
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || name.split(/[\\/]/).some((part) => part === '..')) {
    throw new Error('插件名称无效');
  }
  return name;
}

function assertUniqueConfiguredNames(entries: PluginConfigEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = normalizeConfiguredPluginName(entry.name);
    if (seen.has(name)) throw new Error(`插件重复配置，不能安全排序：${name}`);
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
  if (!absolutePath) return { warnings: [`插件 ${pluginName} 的文件不存在，无法读取参数元数据`] };
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const header = extractPlugindescHeader(raw);
  if (!header) {
    return { warnings: [`插件 ${pluginName} 缺少可解析的参数注释（未检测到 @plugindesc）`] };
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
        structWarnings.push(`struct ${name} 存在循环引用，已拒绝解析`);
        return null;
      }
      const block = structBlocks.get(normalized);
      if (!block) {
        structCache.set(normalized, { status: 'missing' });
        structWarnings.push(`缺少 struct ${name} 的 /*~struct~${name}: */ 定义`);
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
    return { warnings: warnings.length ? warnings : [`插件 ${pluginName} 的参数注释中未解析到任何参数`] };
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
        warnings.push('发现 @param 但缺少参数名');
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
      warnings.push(`在 @${tag} 之前未识别对应参数`);
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
        current.unsupportedReason = `参数 ${current.key} 的 @type "${rest || '(空)'}" 不受支持`;
      } else if ('unsupportedReason' in mapped) {
        current.unsupportedReason = `参数 ${current.key} 的 @type "${rest || '(空)'}" 不受支持：${mapped.unsupportedReason}`;
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
      else warnings.push(`参数 ${current.key} 的 @min 非法：${rest}`);
      continue;
    }

    if (tag === 'max') {
      const max = Number(rest);
      if (Number.isFinite(max)) setNumericBound(current, 'max', max);
      else warnings.push(`参数 ${current.key} 的 @max 非法：${rest}`);
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
        warnings.push(`参数 ${current.key} 的 @value 没有可匹配的 @option`);
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

    warnings.push(`参数 ${current.key} 的 @${tag} 暂不支持`);
  }
  flushCurrentParameter(fields, current, warnings);
  if (!fields.length) {
    return { fields: [], warnings: ['未解析到 @param 定义'] };
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
    warnings.push(`忽略无效参数字段: ${JSON.stringify(current)}`);
    return null;
  }
  if (current.unsupportedReason) {
    warnings.push(current.unsupportedReason);
    return null;
  }
  if (current.kind === 'number') {
    validateNumberDefault(current, current.key, warnings);
    if (typeof current.min === 'number' && typeof current.max === 'number' && current.min > current.max) {
      warnings.push(`参数 ${current.key} 的 @min 大于 @max`);
    }
  }
  if (current.kind === 'array' && current.item?.kind === 'number') {
    validateNumberDefault(current.item, `${current.key}[]`, warnings);
    if (typeof current.item.min === 'number' && typeof current.item.max === 'number' && current.item.min > current.item.max) {
      warnings.push(`参数 ${current.key} 的 @min 大于 @max`);
    }
  }
  if (current.kind === 'struct') {
    if (!current.fields?.length) {
      warnings.push(`参数 ${current.key} 的 struct ${current.structName || ''} 缺少可编辑字段`);
      return null;
    }
    if (typeof current.defaultValue !== 'undefined' && current.defaultValue !== '' && !parseJsonObjectLiteral(String(current.defaultValue))) {
      warnings.push(`参数 ${current.key} 的 @default 不可解析为 struct 对象`);
    }
  }
  if (current.kind === 'array') {
    if (!current.item) {
      warnings.push(`参数 ${current.key} 的数组元素类型缺失`);
      return null;
    }
    if (current.item.kind === 'struct' && !current.item.fields?.length) {
      warnings.push(`参数 ${current.key} 的数组 struct ${current.item.structName || ''} 缺少可编辑字段`);
      return null;
    }
    if (typeof current.defaultValue !== 'undefined' && current.defaultValue !== '' && !parseJsonArrayLiteral(String(current.defaultValue))) {
      warnings.push(`参数 ${current.key} 的 @default 不可解析为数组`);
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
      warnings.push(`参数 ${current.key} 的 @default 不可解析为布尔值`);
    }
  }
  if (current.kind === 'select' && (!current.options || current.options.length === 0)) {
    warnings.push(`参数 ${current.key} 声明为 select 但缺少 @option`);
    return null;
  }
  if (current.kind === 'array' && current.item?.kind === 'select' && (!current.item.options || current.item.options.length === 0)) {
    warnings.push(`参数 ${current.key} 声明为 select 数组但缺少 @option`);
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
      warnings.push('发现 struct 注释块但缺少 struct 名称');
      continue;
    }
    const name = normalizeStructName(rawName);
    if (structs.has(name)) warnings.push(`struct ${rawName} 重复定义，后一个定义会覆盖前一个`);
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
      return { unsupportedReason: itemType && 'unsupportedReason' in itemType ? itemType.unsupportedReason : '数组元素类型不受支持' };
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
    if (!fields?.length) return { unsupportedReason: `struct ${structName} 未定义或没有字段` };
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
    if (!fields?.length) return { unsupportedReason: `struct ${structName} 未定义或没有字段` };
    return { kind: 'struct', rawType: raw, structName, fields };
  }
  if (/\[\]$/.test(raw)) return { unsupportedReason: '嵌套数组暂不支持' };
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
    warnings.push(`参数 ${label} 的 @default 不可解析为数字`);
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
