import fs from "node:fs";
import path from "node:path";

export interface AgentOutputDirs {
  tmpDir: string;
  skillOutputDir: string;
}

export const AGENT_TMP_DIR_REL = path.join(".opencode", "logs", "tmp");
export const AGENT_SKILL_OUTPUT_DIR_REL = path.join(".opencode", "logs", "skills");

export function resolveAgentOutputDirs(workflowRoot: string): AgentOutputDirs {
  const root = path.resolve(workflowRoot);
  return {
    tmpDir: path.join(root, AGENT_TMP_DIR_REL),
    skillOutputDir: path.join(root, AGENT_SKILL_OUTPUT_DIR_REL),
  };
}

export function ensureAgentOutputDirs(workflowRoot: string): AgentOutputDirs {
  const dirs = resolveAgentOutputDirs(workflowRoot);
  fs.mkdirSync(dirs.tmpDir, { recursive: true });
  fs.mkdirSync(dirs.skillOutputDir, { recursive: true });
  return dirs;
}

export function buildAgentOutputEnv(workflowRoot: string): Record<string, string> {
  const dirs = ensureAgentOutputDirs(workflowRoot);
  return {
    AGENT_RPG_TMP_DIR: normalizeForEnv(dirs.tmpDir),
    AGENT_RPG_SKILL_OUTPUT_DIR: normalizeForEnv(dirs.skillOutputDir),
  };
}

function normalizeForEnv(value: string): string {
  return path.resolve(value).replace(/\\/g, "/");
}
