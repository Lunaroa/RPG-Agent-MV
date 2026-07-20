import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { RpgMakerEngine } from "../rmmv/rpg-maker-engine.ts";
import { inspectRmmvProject, type RmmvProjectManifest } from "../rmmv/rmmv-layout.ts";
import type {
  InteractiveProjectRuntime,
  InteractiveProjectRuntimeResolution,
} from "./interactive-playtest-runtime.ts";

export type AgentProjectBindingStatus = "bound" | "none" | "invalid";

export interface AgentProjectBindingSnapshot {
  status: AgentProjectBindingStatus;
  version: number;
  canonicalPath: string | null;
  displayName: string | null;
  projectId: string | null;
  engine: RpgMakerEngine | null;
  engineVersion: string | null;
  editable: boolean;
  runnableStructure: boolean;
  runtimeAvailable: boolean;
  runtimeSource: InteractiveProjectRuntime["source"] | null;
  runtimeReason: "missing" | "invalid" | null;
  /** Process-private runtime details. Never serialize this field into model-visible output. */
  runtime?: InteractiveProjectRuntime;
  errorCode?: "project-invalid";
  error?: string;
}

export type ResolveAgentProjectRuntime = (
  project: string,
  engine: RpgMakerEngine,
) => InteractiveProjectRuntimeResolution;

export interface ResolveAgentProjectBindingOptions {
  version: number;
  resolveRuntime?: ResolveAgentProjectRuntime;
  baseDirectory?: string;
}

export function resolveAgentProjectBinding(
  projectInput: string | null | undefined,
  options: ResolveAgentProjectBindingOptions,
): AgentProjectBindingSnapshot {
  const raw = String(projectInput || "").trim();
  if (!raw) return emptyBinding("none", options.version);

  const requested = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(options.baseDirectory || process.cwd(), raw);
  let canonicalPath: string;
  try {
    if (!fs.statSync(requested).isDirectory()) {
      return invalidBinding(requested, options.version, "Selected project is not a directory.");
    }
    canonicalPath = fs.realpathSync.native(requested);
  } catch {
    return invalidBinding(requested, options.version, "Selected project cannot be read.");
  }

  let manifest: RmmvProjectManifest;
  try {
    manifest = inspectRmmvProject(canonicalPath);
  } catch {
    return invalidBinding(canonicalPath, options.version, "Selected directory is not a supported RPG Maker project.");
  }
  if (!manifest.editable) {
    return invalidBinding(canonicalPath, options.version, "Selected project is not an editable RPG Maker project.");
  }
  let runtimeResolution: InteractiveProjectRuntimeResolution | undefined;
  try {
    runtimeResolution = options.resolveRuntime?.(canonicalPath, manifest.engine);
  } catch {
    runtimeResolution = { selectionRequired: { engine: manifest.engine, reason: "invalid" } };
  }
  const runtime = runtimeResolution?.runtime;
  return {
    status: "bound",
    version: options.version,
    canonicalPath,
    displayName: path.basename(canonicalPath),
    projectId: stableProjectId(canonicalPath),
    engine: manifest.engine,
    engineVersion: manifest.engineVersion,
    editable: manifest.editable,
    runnableStructure: manifest.runnableStructure,
    runtimeAvailable: Boolean(runtime),
    runtimeSource: runtime?.source || null,
    runtimeReason: runtime ? null : runtimeResolution?.selectionRequired?.reason || "missing",
    ...(runtime ? { runtime } : {}),
  };
}

export function sameAgentProjectIdentity(
  left: AgentProjectBindingSnapshot | null | undefined,
  right: AgentProjectBindingSnapshot | null | undefined,
): boolean {
  if (!left || !right || left.status !== right.status) return false;
  if (left.status === "none") return true;
  return normalizeIdentityPath(left.canonicalPath) === normalizeIdentityPath(right.canonicalPath);
}

export function serializableAgentProjectBinding(
  binding: AgentProjectBindingSnapshot,
): Omit<AgentProjectBindingSnapshot, "runtime"> {
  const { runtime: _runtime, ...safe } = binding;
  return safe;
}

function emptyBinding(
  status: "none",
  version: number,
): AgentProjectBindingSnapshot {
  return {
    status,
    version,
    canonicalPath: null,
    displayName: null,
    projectId: null,
    engine: null,
    engineVersion: null,
    editable: false,
    runnableStructure: false,
    runtimeAvailable: false,
    runtimeSource: null,
    runtimeReason: "missing",
  };
}

function invalidBinding(
  canonicalPath: string,
  version: number,
  error: string,
): AgentProjectBindingSnapshot {
  return {
    status: "invalid",
    version,
    canonicalPath,
    displayName: path.basename(canonicalPath) || null,
    projectId: stableProjectId(canonicalPath),
    engine: null,
    engineVersion: null,
    editable: false,
    runnableStructure: false,
    runtimeAvailable: false,
    runtimeSource: null,
    runtimeReason: "invalid",
    errorCode: "project-invalid",
    error,
  };
}

function stableProjectId(projectPath: string): string {
  return crypto.createHash("sha256").update(normalizeIdentityPath(projectPath)).digest("hex").slice(0, 24);
}

function normalizeIdentityPath(value: string | null): string {
  const normalized = path.normalize(String(value || "")).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
