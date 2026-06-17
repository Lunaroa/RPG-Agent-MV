import path from "node:path";

import { resolveCliOutRoot, resolveWorkflowRoot } from "../workspace-paths.ts";
import type { RmmvHandlerInput } from "./rmmv-handler-types.ts";

export function resolveWorkflowRootFromInput(input: RmmvHandlerInput): string {
  const raw = input.workflowRoot;
  if (typeof raw === "string" && raw.trim()) return path.resolve(raw);
  return resolveWorkflowRoot();
}

export function resolveProjectRoot(input: RmmvHandlerInput): string {
  if (typeof input.project === "string" && input.project.trim()) return path.resolve(input.project);
  return path.resolve(".");
}

export function resolveDefaultOut(workflowRoot: string, ...segments: string[]): string {
  return path.join(resolveCliOutRoot(workflowRoot), ...segments);
}

const FIELD_TO_FLAG: Record<string, string> = {
  project: "project",
  projectId: "project-id",
  out: "out",
  spec: "spec",
  evidence: "evidence",
  agent: "agent",
  agentId: "agent-id",
  profile: "profile",
  mapId: "map-id",
  eventId: "event-id",
  contractId: "contract-id",
  status: "status",
  notes: "notes",
  failureKind: "failure-kind",
  runtimeTest: "runtime-test",
  runtimeMode: "runtime-mode",
  playability: "playability",
  timeoutMs: "timeout-ms",
  browser: "browser",
  taskId: "task-id",
  mode: "mode",
  baselineProject: "baseline-project",
  baselineVersion: "baseline-version",
  outline: "outline",
  query: "query",
  nodeId: "node-id",
  edgeId: "edge-id",
  label: "label",
  predicate: "predicate",
  confirmReplaceOutline: "confirm-replace-outline",
  worldFile: "world-file",
  contextMode: "context-mode",
  files: "files",
  switches: "switches",
  variables: "variables",
  commonEvents: "common-events",
};

export function inputToCliArgs(input: RmmvHandlerInput, skip = new Set(["action", "workflowRoot", "summary"])): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (skip.has(key) || value === undefined || value === null) continue;
    const flag = FIELD_TO_FLAG[key] || key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    if (typeof value === "boolean") {
      if (value) args.push(`--${flag}`);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) args.push(`--${flag}`, String(item));
      continue;
    }
    args.push(`--${flag}`, String(value));
  }
  return args;
}

export async function captureConsole<T>(fn: () => T | Promise<T>): Promise<{ summary: string; result: T }> {
  const chunks: string[] = [];
  const log = console.log;
  const err = console.error;
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  console.log = (...parts: unknown[]) => {
    chunks.push(`${parts.map(String).join(" ")}\n`);
  };
  console.error = (...parts: unknown[]) => {
    chunks.push(`[stderr] ${parts.map(String).join(" ")}\n`);
  };
  // Several legacy workflow handlers (event-registry, map-events) print via
  // process.stdout.write instead of console.log. If we don't intercept those,
  // their output (a) never lands in the summary and (b) leaks onto the runner's
  // real stdout, concatenating with and corrupting its JSON envelope. Capture
  // them into the same buffer so the summary is faithful and stdout stays clean.
  const intercept =
    (): typeof process.stdout.write =>
    (chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
      chunks.push(typeof chunk === "string" ? chunk : String(chunk));
      const done = typeof encoding === "function" ? encoding : cb;
      if (typeof done === "function") (done as () => void)();
      return true;
    };
  process.stdout.write = intercept();
  process.stderr.write = intercept();
  try {
    const result = await fn();
    return { summary: chunks.join("").trimEnd(), result };
  } finally {
    console.log = log;
    console.error = err;
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
}


