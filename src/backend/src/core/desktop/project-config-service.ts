import fs from 'node:fs';
import path from 'node:path';

import type { LunaRpgProjectConfig, LunaRpgSearchSettings } from '../../../../contract/types.ts';

/**
 * `.luna_rpg/` is the product's per-project configuration folder. Everything
 * the editor persists inside a game project (editor map notes, plugin preview
 * switches, future search indexes) lives under this folder so it travels with
 * the project while the stock RM editor never touches it.
 */
export const LUNA_RPG_DIR = '.luna_rpg';
const PROJECT_CONFIG_FILE = 'config.json';

export function lunaRpgDirPath(project: string): string {
  return path.join(path.resolve(project), LUNA_RPG_DIR);
}

export function projectConfigFilePath(project: string): string {
  return path.join(lunaRpgDirPath(project), PROJECT_CONFIG_FILE);
}

export function readProjectConfig(project: string): LunaRpgProjectConfig {
  const file = projectConfigFilePath(project);
  if (!fs.existsSync(file)) return {};
  // A corrupt config must surface instead of being silently replaced.
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as LunaRpgProjectConfig;
  const config: LunaRpgProjectConfig = {};
  if (Array.isArray(parsed?.previewDisabledPlugins)) {
    const names = parsed.previewDisabledPlugins
      .filter((name): name is string => typeof name === 'string' && name.trim() !== '');
    if (names.length) config.previewDisabledPlugins = names;
  }
  const search = normalizeSearchSettings(parsed?.search);
  if (search) config.search = search;
  return config;
}

function normalizeSearchSettings(value: unknown): LunaRpgSearchSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const settings: LunaRpgSearchSettings = {};
  if (Array.isArray(raw.extraFolders)) {
    const folders = raw.extraFolders
      .filter((folder): folder is string => typeof folder === 'string' && folder.trim() !== '');
    if (folders.length) settings.extraFolders = folders;
  }
  const maxResults = Number(raw.maxResults);
  if (Number.isInteger(maxResults) && maxResults > 0) settings.maxResults = maxResults;
  if (Array.isArray(raw.history)) {
    const history = raw.history
      .filter((term): term is string => typeof term === 'string' && term.trim() !== '')
      .slice(0, 50);
    if (history.length) settings.history = history;
  }
  return Object.keys(settings).length ? settings : undefined;
}

export function patchProjectConfig(
  project: string,
  patch: Partial<LunaRpgProjectConfig>,
): LunaRpgProjectConfig {
  const config = { ...readProjectConfig(project), ...patch };
  // Drop empty fields so the config file stays minimal or disappears entirely.
  if (!config.previewDisabledPlugins?.length) delete config.previewDisabledPlugins;
  const search = normalizeSearchSettings(config.search);
  if (search) config.search = search;
  else delete config.search;
  const file = projectConfigFilePath(project);
  if (Object.keys(config).length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file);
    removeLunaRpgDirIfEmpty(project);
    return {};
  }
  fs.mkdirSync(lunaRpgDirPath(project), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

/** Keep projects clean: an empty .luna_rpg folder should not linger. */
export function removeLunaRpgDirIfEmpty(project: string): void {
  const dir = lunaRpgDirPath(project);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmSync(dir, { recursive: true });
}
