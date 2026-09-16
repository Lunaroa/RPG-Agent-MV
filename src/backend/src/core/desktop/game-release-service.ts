import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  GameReleaseConfig,
  GameReleaseManagedChange,
  GameReleaseSaveRequest,
  GameReleaseSaveResult,
  GameReleaseStatus,
  GameSaveCompatibilityConfig,
  SaveCompatibilityAction,
  SaveCompatibilityKind,
} from '../../../../contract/game-release.ts';
import {
  dataRelativePath,
  resolveRmmvLayout,
  resourceRelativePath,
  type RmmvProjectLayout,
} from '../rmmv/rmmv-layout.ts';
import { normalizeGameVersion } from './game-version.ts';
import { validateGameManifestSignatureConfig } from './game-manifest-signing-service.ts';
import {
  readProjectFile,
  readProjectFileVersion,
  resolveProjectFileForRead,
  writeProjectFilesAtomically,
  type ProjectFileMutation,
} from './project-file-service.ts';

const RELEASE_FILE_NAME = 'RPGAgentRelease.json';
const VERSION_PLUGIN_NAME = 'RPGAgentVersion';
const UPDATER_PLUGIN_NAME = 'RPGAgentUpdater';
const RUNTIME_SOURCE_DIRECTORY = fileURLToPath(new URL('./game-release-runtime/', import.meta.url));
const SAVE_ACTIONS = new Set<SaveCompatibilityAction>(['allow', 'warn', 'block', 'callback']);
const SAVE_KINDS: SaveCompatibilityKind[] = ['legacy', 'older', 'same', 'newer', 'differentChannel'];

interface PluginEntry {
  name: string;
  status: boolean;
  description: string;
  parameters: Record<string, unknown>;
}

interface ManagedRuntimeState {
  changes: GameReleaseManagedChange[];
  mutations: ProjectFileMutation[];
  changedRelativePaths: string[];
}

export function createDefaultGameReleaseConfig(project: string): GameReleaseConfig {
  return {
    schemaVersion: 1,
    gameId: defaultGameId(project),
    version: '0.1.0',
    channel: 'stable',
    update: {
      enabled: false,
      indexUrl: '',
      checkOnStart: true,
      backgroundDownload: false,
      policy: 'optional',
    },
    saveCompatibility: {
      legacy: 'allow',
      older: 'allow',
      same: 'allow',
      newer: 'warn',
      differentChannel: 'warn',
    },
  };
}

export function validateGameReleaseConfig(value: unknown): GameReleaseConfig {
  const root = requireRecord(value, 'RPGAgentRelease.json');
  assertExactKeys(root, [
    'schemaVersion', 'gameId', 'version', 'channel', 'update', 'saveCompatibility',
  ], 'RPGAgentRelease.json');
  if (root.schemaVersion !== 1) {
    throw new Error(`RPGAgentRelease.json schemaVersion must be 1; received ${String(root.schemaVersion)}.`);
  }
  const gameId = requireStableId(root.gameId, 'gameId', 128);
  const version = normalizeGameVersion(root.version);
  const channel = requireStableId(root.channel, 'channel', 64);

  const update = requireRecord(root.update, 'update');
  assertExactKeys(update, [
    'enabled', 'indexUrl', 'checkOnStart', 'backgroundDownload', 'policy', 'defaultLanguage', 'manifestSignature',
  ], 'update');
  const enabled = requireBoolean(update.enabled, 'update.enabled');
  const indexUrl = requireString(update.indexUrl, 'update.indexUrl', 2048);
  if (indexUrl) requireHttpUrl(indexUrl, 'update.indexUrl');
  if (enabled && !indexUrl) throw new Error('update.indexUrl is required when online updates are enabled.');
  const checkOnStart = requireBoolean(update.checkOnStart, 'update.checkOnStart');
  const backgroundDownload = update.backgroundDownload === undefined
    ? false
    : requireBoolean(update.backgroundDownload, 'update.backgroundDownload');
  if (backgroundDownload && !checkOnStart) {
    throw new Error('update.backgroundDownload requires update.checkOnStart.');
  }
  if (update.policy !== 'optional' && update.policy !== 'required') {
    throw new Error('update.policy must be optional or required.');
  }
  const defaultLanguage = update.defaultLanguage === undefined
    ? undefined
    : requireStableId(update.defaultLanguage, 'update.defaultLanguage', 32);
  const manifestSignature = update.manifestSignature === undefined
    ? undefined
    : validateGameManifestSignatureConfig(update.manifestSignature);
  if (manifestSignature?.enabled && !enabled) {
    throw new Error('update.manifestSignature cannot be enabled while online updates are disabled.');
  }

  const save = requireRecord(root.saveCompatibility, 'saveCompatibility');
  assertExactKeys(save, [...SAVE_KINDS, 'messages'], 'saveCompatibility');
  const saveCompatibility = Object.fromEntries(SAVE_KINDS.map((kind) => [
    kind,
    requireSaveAction(save[kind], `saveCompatibility.${kind}`),
  ])) as unknown as GameSaveCompatibilityConfig;
  if (save.messages !== undefined) {
    const messages = requireRecord(save.messages, 'saveCompatibility.messages');
    assertExactKeys(messages, SAVE_KINDS, 'saveCompatibility.messages');
    const normalizedMessages: Partial<Record<SaveCompatibilityKind, string>> = {};
    for (const kind of SAVE_KINDS) {
      if (messages[kind] === undefined) continue;
      const message = requireString(messages[kind], `saveCompatibility.messages.${kind}`, 4000).trim();
      if (!message) throw new Error(`saveCompatibility.messages.${kind} must not be empty.`);
      normalizedMessages[kind] = message;
    }
    if (Object.keys(normalizedMessages).length) saveCompatibility.messages = normalizedMessages;
  }

  return {
    schemaVersion: 1,
    gameId,
    version,
    channel,
    update: {
      enabled,
      indexUrl,
      checkOnStart,
      backgroundDownload,
      policy: update.policy,
      ...(defaultLanguage ? { defaultLanguage } : {}),
      ...(manifestSignature ? { manifestSignature } : {}),
    },
    saveCompatibility,
  };
}

export function readGameReleaseStatus(workflowRoot: string, project: string): GameReleaseStatus {
  const layout = resolveRmmvLayout(project);
  const relativePath = dataRelativePath(layout, RELEASE_FILE_NAME);
  const releaseFile = resolveProjectFileForRead(project, relativePath);
  const exists = Boolean(releaseFile);
  const config = exists
    ? validateGameReleaseConfig(JSON.parse(readProjectFile(project, relativePath).content.toString('utf8').replace(/^\uFEFF/, '')))
    : createDefaultGameReleaseConfig(project);
  const sourceHash = readProjectFileVersion(project, relativePath).sha256;
  const runtime = inspectManagedRuntime(workflowRoot, project, layout, config);
  const configChanges: GameReleaseManagedChange[] = exists ? [] : [{
    relativePath,
    kind: 'create',
    description: 'Create the game release configuration in the engine data directory.',
  }];
  return {
    exists,
    relativePath,
    config,
    sourceHash,
    runtimePluginsReady: runtime.changes.length === 0,
    managedChanges: [...configChanges, ...runtime.changes],
  };
}

export function inspectGameReleaseRuntimeChanges(
  workflowRoot: string,
  project: string,
  value: unknown,
): GameReleaseManagedChange[] {
  const layout = resolveRmmvLayout(project);
  const config = validateGameReleaseConfig(value);
  return inspectManagedRuntime(workflowRoot, project, layout, config).changes;
}

export function saveGameReleaseConfig(
  workflowRoot: string,
  project: string,
  request: GameReleaseSaveRequest,
): GameReleaseSaveResult {
  if (!request || typeof request !== 'object') throw new Error('Game release save request is required.');
  const layout = resolveRmmvLayout(project);
  const config = validateGameReleaseConfig(request.config);
  const releaseRelativePath = dataRelativePath(layout, RELEASE_FILE_NAME);
  const releaseContent = Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const currentRelease = readProjectFileVersion(project, releaseRelativePath);
  const expectedSourceHash = request.expectedSourceHash === undefined
    ? currentRelease.sha256
    : request.expectedSourceHash;
  const mutations: ProjectFileMutation[] = [];
  const changedRelativePaths: string[] = [];

  if (!bufferMatchesProjectFile(project, releaseRelativePath, releaseContent)) {
    mutations.push({ relativePath: releaseRelativePath, content: releaseContent, expectedSourceHash });
    changedRelativePaths.push(releaseRelativePath);
  } else if (request.expectedSourceHash !== undefined && request.expectedSourceHash !== currentRelease.sha256) {
    throw new Error('The game release configuration changed after it was loaded. Reload it before saving.');
  }

  if (request.installRuntimePlugins !== false) {
    const runtime = inspectManagedRuntime(workflowRoot, project, layout, config);
    mutations.push(...runtime.mutations);
    changedRelativePaths.push(...runtime.changedRelativePaths);
  }

  if (!mutations.length) {
    return { ...readGameReleaseStatus(workflowRoot, project), write: { project: path.resolve(project), files: [] } };
  }

  const backupDirectory = createBackupDirectoryName();
  const backupMutations = createBackupMutations(project, backupDirectory, changedRelativePaths);
  const write = writeProjectFilesAtomically(workflowRoot, project, [...backupMutations, ...mutations]);
  return {
    ...readGameReleaseStatus(workflowRoot, project),
    ...(backupMutations.length ? { backupDirectory } : {}),
    write,
  };
}

function inspectManagedRuntime(
  _workflowRoot: string,
  project: string,
  layout: RmmvProjectLayout,
  config: GameReleaseConfig,
): ManagedRuntimeState {
  const changes: GameReleaseManagedChange[] = [];
  const mutations: ProjectFileMutation[] = [];
  const changedRelativePaths: string[] = [];
  const runtimeFiles = [VERSION_PLUGIN_NAME, UPDATER_PLUGIN_NAME].map((name) => ({
    name,
    relativePath: resourceRelativePath(layout, `js/plugins/${name}.js`),
    content: fs.readFileSync(path.join(RUNTIME_SOURCE_DIRECTORY, `${name}.js`)),
  }));

  for (const runtimeFile of runtimeFiles) {
    if (bufferMatchesProjectFile(project, runtimeFile.relativePath, runtimeFile.content)) continue;
    const exists = Boolean(resolveProjectFileForRead(project, runtimeFile.relativePath));
    changes.push({
      relativePath: runtimeFile.relativePath,
      kind: exists ? 'update' : 'create',
      description: `${exists ? 'Update' : 'Install'} the managed ${runtimeFile.name} runtime plugin.`,
    });
    mutations.push({
      relativePath: runtimeFile.relativePath,
      content: runtimeFile.content,
      expectedSourceHash: readProjectFileVersion(project, runtimeFile.relativePath).sha256,
    });
    changedRelativePaths.push(runtimeFile.relativePath);
  }

  const pluginsRelativePath = resourceRelativePath(layout, 'js/plugins.js');
  const pluginFile = resolveProjectFileForRead(project, pluginsRelativePath);
  if (!pluginFile) throw new Error(`Project file does not exist: ${pluginsRelativePath}`);
  const pluginsSource = readProjectFile(project, pluginsRelativePath);
  const currentEntries = parsePluginsJs(pluginsSource.content.toString('utf8').replace(/^\uFEFF/, ''));
  const nextEntries = configureRuntimePlugins(currentEntries, config.update.enabled);
  const nextContent = Buffer.from(serializePluginsJs(nextEntries), 'utf8');
  if (!nextContent.equals(pluginsSource.content)) {
    changes.push({
      relativePath: pluginsRelativePath,
      kind: 'update',
      description: 'Place the version plugin before the updater and apply the configured update switch.',
    });
    mutations.push({
      relativePath: pluginsRelativePath,
      content: nextContent,
      expectedSourceHash: pluginsSource.version.sha256,
    });
    changedRelativePaths.push(pluginsRelativePath);
  }
  return { changes, mutations, changedRelativePaths };
}

function parsePluginsJs(source: string): PluginEntry[] {
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('plugins.js does not contain a readable $plugins array.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch (error) {
    throw new Error(`plugins.js could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('plugins.js $plugins must be an array.');
  return parsed.filter(Boolean).map((value, index) => {
    const entry = requireRecord(value, `plugins.js entry ${index + 1}`);
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!name) throw new Error(`plugins.js entry ${index + 1} has no plugin name.`);
    const parameters = entry.parameters === undefined ? {} : requireRecord(entry.parameters, `${name}.parameters`);
    return {
      name,
      status: Boolean(entry.status),
      description: typeof entry.description === 'string' ? entry.description : '',
      parameters: structuredClone(parameters),
    };
  });
}

function configureRuntimePlugins(entries: PluginEntry[], updaterEnabled: boolean): PluginEntry[] {
  const managedNames = new Set([VERSION_PLUGIN_NAME, UPDATER_PLUGIN_NAME]);
  for (const name of managedNames) {
    const count = entries.filter((entry) => entry.name === name).length;
    if (count > 1) throw new Error(`plugins.js contains duplicate managed plugin entries: ${name}.`);
  }
  const otherEntries = entries.filter((entry) => !managedNames.has(entry.name));
  return [
    {
      name: VERSION_PLUGIN_NAME,
      status: true,
      description: 'RPG Agent game version and save compatibility',
      parameters: {},
    },
    {
      name: UPDATER_PLUGIN_NAME,
      status: updaterEnabled,
      description: 'RPG Agent online game updater',
      parameters: {},
    },
    ...otherEntries,
  ];
}

function serializePluginsJs(entries: PluginEntry[]): string {
  return `var $plugins =\n${JSON.stringify(entries, null, 2)};\n`;
}

function createBackupMutations(
  project: string,
  backupDirectory: string,
  relativePaths: readonly string[],
): ProjectFileMutation[] {
  const uniquePaths = [...new Set(relativePaths)];
  return uniquePaths.flatMap((relativePath) => {
    const existing = resolveProjectFileForRead(project, relativePath);
    if (!existing) return [];
    return [{
      relativePath: `${backupDirectory}/${relativePath}`,
      content: fs.readFileSync(existing),
      expectedSourceHash: null,
    } satisfies ProjectFileMutation];
  });
}

function createBackupDirectoryName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `.luna_rpg/backups/release-runtime/${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function bufferMatchesProjectFile(project: string, relativePath: string, expected: Buffer): boolean {
  const file = resolveProjectFileForRead(project, relativePath);
  return Boolean(file) && fs.readFileSync(file!).equals(expected);
}

function defaultGameId(project: string): string {
  const source = path.basename(path.resolve(project)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const normalized = source.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 128);
  return normalized || 'game';
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}.`);
}

function requireString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  if (value.length > maximumLength) throw new Error(`${label} must not exceed ${maximumLength} characters.`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`);
  return value;
}

function requireStableId(value: unknown, label: string, maximumLength: number): string {
  const text = requireString(value, label, maximumLength);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(text)) {
    throw new Error(`${label} must contain only ASCII letters, digits, dots, underscores, or hyphens and must start and end with a letter or digit.`);
  }
  return text;
}

function requireSaveAction(value: unknown, label: string): SaveCompatibilityAction {
  if (!SAVE_ACTIONS.has(value as SaveCompatibilityAction)) {
    throw new Error(`${label} must be allow, warn, block, or callback.`);
  }
  return value as SaveCompatibilityAction;
}

function requireHttpUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
}
