import fs from "node:fs";
import path from "node:path";

import {
  resolveOpencodeAgentsMdRuntime,
  resolveOpencodeAgentsMdSource,
  resolveOpencodeConfigDir,
  resolveOpencodePersonalPreferencesPath,
  resolveOpencodeProductConfigDir,
  resolveOpencodeSkillsSourceDir,
} from "../../../workspace-paths.ts";

function normalizeForJsonPath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/");
}

function shouldRefreshFile(source: string, target: string): boolean {
  if (!fs.existsSync(target)) return true;
  if (!fs.existsSync(source)) {
    throw new Error(`Missing opencode rules source file: ${source}`);
  }
  return fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs;
}

export function buildOpencodeStaticConfig(installRoot: string, userDataRoot: string): Record<string, unknown> {
  const preferences = resolveOpencodePersonalPreferencesPath(installRoot);
  if (!fs.existsSync(preferences)) {
    throw new Error(`Missing personal preferences file: ${preferences}`);
  }
  const skillsDir = resolveOpencodeSkillsSourceDir(installRoot);
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Missing opencode skills directory: ${skillsDir}`);
  }
  void userDataRoot;
  return {
    $schema: "https://opencode.ai/config.json",
    instructions: [normalizeForJsonPath(preferences)],
    skills: {
      paths: [normalizeForJsonPath(skillsDir)],
    },
  };
}

/** Materialize shipped opencode assets into user-local `.opencode/` before server start. */
export function ensureOpencodeRuntimeAssets(installRoot: string, userDataRoot: string): void {
  const install = path.resolve(installRoot);
  const userData = path.resolve(userDataRoot);
  const configDir = resolveOpencodeConfigDir(userData);
  fs.mkdirSync(configDir, { recursive: true });

  const agentsSource = resolveOpencodeAgentsMdSource(install);
  const agentsTarget = resolveOpencodeAgentsMdRuntime(userData);
  if (!fs.existsSync(agentsSource)) {
    throw new Error(`Missing opencode rules source file: ${agentsSource}`);
  }
  if (shouldRefreshFile(agentsSource, agentsTarget)) {
    fs.copyFileSync(agentsSource, agentsTarget);
  }

  const staticConfig = buildOpencodeStaticConfig(install, userData);
  const staticConfigPath = path.join(configDir, "opencode.json");
  const next = `${JSON.stringify(staticConfig, null, 2)}\n`;
  const current = fs.existsSync(staticConfigPath) ? fs.readFileSync(staticConfigPath, "utf8") : "";
  if (current !== next) {
    fs.writeFileSync(staticConfigPath, next, "utf8");
  }

  const productConfigDir = resolveOpencodeProductConfigDir(install);
  if (!fs.existsSync(productConfigDir)) {
    throw new Error(`Missing opencode product config directory: ${productConfigDir}`);
  }
}
