import fs from "node:fs";
import path from "node:path";

import type { SessionPlanSnapshot } from "../../../../contract/types.ts";
import { resolveProjectPath } from "./project-service.ts";

const PLAN_PATH_PATTERN = /(?:^|[/\\])\.opencode[/\\]plans[/\\](?:conversations[/\\][^/\\]+\.md|[^/\\]+\.md)$/i;
const PLAN_FILE_NAMES = new Set(["plan.md", "PLAN.md"]);

export function isOpencodePlanPath(filePath: string): boolean {
  const normalized = String(filePath || "").replace(/\\/g, "/").trim();
  if (!normalized) return false;
  if (PLAN_PATH_PATTERN.test(normalized)) return true;
  const base = path.posix.basename(normalized);
  return PLAN_FILE_NAMES.has(base);
}

export function planPathFromToolInput(input: Record<string, unknown>): string | null {
  const candidate = [
    input.path,
    input.file_path,
    input.filePath,
    input.filename,
  ].map((value) => (typeof value === "string" ? value.trim() : "")).find(Boolean);
  if (!candidate || !isOpencodePlanPath(candidate)) return null;
  return candidate;
}

export function planContentFromWriteInput(input: Record<string, unknown>): string {
  return typeof input.content === "string"
    ? input.content
    : typeof input.contents === "string"
      ? input.contents
      : "";
}

export function resolvePlanAbsolutePath(
  workflowRoot: string,
  project: string | undefined,
  filePath: string,
): string {
  const projectRoot = resolveProjectPath(workflowRoot, project);
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectRoot, filePath);
}

export function readPlanFile(
  workflowRoot: string,
  project: string | undefined,
  filePath: string,
): string | null {
  const absolutePath = resolvePlanAbsolutePath(workflowRoot, project, filePath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }
}

export function ensurePlanDirectory(
  workflowRoot: string,
  project: string | undefined,
  filePath: string,
): void {
  const absolutePath = resolvePlanAbsolutePath(workflowRoot, project, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
}

export function hydrateSessionPlanFromFile(
  workflowRoot: string,
  project: string | undefined,
  snapshot: SessionPlanSnapshot,
): SessionPlanSnapshot {
  if (!snapshot.filePath) return snapshot;
  const fromDisk = readPlanFile(workflowRoot, project, snapshot.filePath);
  if (fromDisk === null) return snapshot;
  return {
    ...snapshot,
    planMarkdown: fromDisk,
  };
}
