import fs from 'node:fs';
import path from 'node:path';

import type { LunaRpgProjectConfig } from '../../../../contract/types.ts';

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
  return config;
}

export function patchProjectConfig(
  project: string,
  patch: Partial<LunaRpgProjectConfig>,
): LunaRpgProjectConfig {
  const config = { ...readProjectConfig(project), ...patch };
  // Drop empty fields so the config file stays minimal or disappears entirely.
  if (!config.previewDisabledPlugins?.length) delete config.previewDisabledPlugins;
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
