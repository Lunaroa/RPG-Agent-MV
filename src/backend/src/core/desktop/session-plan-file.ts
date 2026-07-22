import fs from "node:fs";
import path from "node:path";

import type { SessionPlanSnapshot } from "../../../../contract/types.ts";
import { resolveProjectPath } from "./project-service.ts";

const PLAN_PATH_PATTERN = /(?:^|[/\\])\.opencode[/\\]plans[/\\](?:conversations[/\\][^/\\]+\.md|[^/\\]+\.md)$/i;
const PLAN_FILE_NAMES = new Set(["plan.md", "PLAN.md"]);

export const SESSION_PLAN_DIRECTORY_ERROR_CODES = {
  notWritable: "SESSION_PLAN_DIRECTORY_NOT_WRITABLE",
  pathConflict: "SESSION_PLAN_DIRECTORY_PATH_CONFLICT",
  createFailed: "SESSION_PLAN_DIRECTORY_CREATE_FAILED",
} as const;

export type SessionPlanDirectoryErrorCode =
  (typeof SESSION_PLAN_DIRECTORY_ERROR_CODES)[keyof typeof SESSION_PLAN_DIRECTORY_ERROR_CODES];

export class SessionPlanDirectoryError extends Error {
  readonly code: SessionPlanDirectoryErrorCode;
  readonly relativePath: string;

  constructor(code: SessionPlanDirectoryErrorCode, relativePath: string) {
    super(`[${code}] ${normalizeRelativePath(relativePath)}`);
    this.name = "SessionPlanDirectoryError";
    this.code = code;
    this.relativePath = normalizeRelativePath(relativePath);
  }
}

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
  const projectRoot = resolveProjectPath(workflowRoot, project);
  const absolutePath = resolvePlanAbsolutePath(workflowRoot, project, filePath);
  const directory = path.dirname(absolutePath);
  const relativeDirectory = normalizeRelativePath(path.relative(projectRoot, directory));
  try {
    const conflict = firstNonDirectoryPath(projectRoot, directory);
    if (conflict) {
      throw new SessionPlanDirectoryError(
        SESSION_PLAN_DIRECTORY_ERROR_CODES.pathConflict,
        path.relative(projectRoot, conflict),
      );
    }
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    if (error instanceof SessionPlanDirectoryError) throw error;
    throw new SessionPlanDirectoryError(classifyPlanDirectoryError(error), relativeDirectory);
  }
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

export function classifyPlanDirectoryError(error: unknown): SessionPlanDirectoryErrorCode {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code || "").toUpperCase()
    : "";
  return ["EACCES", "EPERM", "EROFS"].includes(code)
    ? SESSION_PLAN_DIRECTORY_ERROR_CODES.notWritable
    : SESSION_PLAN_DIRECTORY_ERROR_CODES.createFailed;
}

function firstNonDirectoryPath(projectRoot: string, directory: string): string | null {
  const relative = path.relative(projectRoot, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;

  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (!fs.statSync(current).isDirectory()) return current;
    } catch (error) {
      if (isMissingPathError(error)) return null;
      throw error;
    }
  }
  return null;
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && String((error as NodeJS.ErrnoException).code || "").toUpperCase() === "ENOENT",
  );
}

function normalizeRelativePath(value: string): string {
  return String(value || "").replace(/\\/g, "/");
}
