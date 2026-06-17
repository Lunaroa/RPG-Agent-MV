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
    throw new Error(`缺少 opencode 规则源文件：${source}`);
  }
  return fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs;
}

export function buildOpencodeStaticConfig(workflowRoot: string): Record<string, unknown> {
  const preferences = resolveOpencodePersonalPreferencesPath(workflowRoot);
  if (!fs.existsSync(preferences)) {
    throw new Error(`缺少个人偏好文件：${preferences}`);
  }
  const skillsDir = resolveOpencodeSkillsSourceDir(workflowRoot);
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`缺少 opencode skills 目录：${skillsDir}`);
  }
  return {
    $schema: "https://opencode.ai/config.json",
    instructions: [normalizeForJsonPath(preferences)],
    skills: {
      paths: [normalizeForJsonPath(skillsDir)],
    },
  };
}

/** Materialize shipped opencode assets into project-local `.opencode/` before server start. */
export function ensureOpencodeRuntimeAssets(workflowRoot: string): void {
  const root = path.resolve(workflowRoot);
  const configDir = resolveOpencodeConfigDir(root);
  fs.mkdirSync(configDir, { recursive: true });

  const agentsSource = resolveOpencodeAgentsMdSource(root);
  const agentsTarget = resolveOpencodeAgentsMdRuntime(root);
  if (!fs.existsSync(agentsSource)) {
    throw new Error(`缺少 opencode 规则源文件：${agentsSource}`);
  }
  if (shouldRefreshFile(agentsSource, agentsTarget)) {
    fs.copyFileSync(agentsSource, agentsTarget);
  }

  const staticConfig = buildOpencodeStaticConfig(root);
  const staticConfigPath = path.join(configDir, "opencode.json");
  const next = `${JSON.stringify(staticConfig, null, 2)}\n`;
  const current = fs.existsSync(staticConfigPath) ? fs.readFileSync(staticConfigPath, "utf8") : "";
  if (current !== next) {
    fs.writeFileSync(staticConfigPath, next, "utf8");
  }

  const productConfigDir = resolveOpencodeProductConfigDir(root);
  if (!fs.existsSync(productConfigDir)) {
    throw new Error(`缺少 opencode 产品配置目录：${productConfigDir}`);
  }
}
