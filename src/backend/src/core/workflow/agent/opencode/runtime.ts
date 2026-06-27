import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import {
  createOpencodeClient as createOpencodeV2Client,
  type OpencodeClient as OpencodeV2Client,
} from "@opencode-ai/sdk/v2";

import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from "../../../../../../contract/i18n.ts";
import { stripNativeTaskBlocks } from "../../../../../../contract/native-task-blocks.ts";
import type { ProductLanguage } from "../../../../../../contract/types.ts";
import { resolveOpencodeCli, resolveOpencodeConfigDir, resolveOpencodeRipgrep, resolveShippedRoot } from "../../../workspace-paths.ts";
import { ensureOpencodeRuntimeAssets } from "./runtime-assets.ts";
import { backendText } from "../../../i18n/messages.ts";

export { stripNativeTaskBlocks } from "../../../../../../contract/native-task-blocks.ts";

export interface RuntimeEvent {
  type: string;
  text?: string;
  tool?: string;
  inputTokens?: number;
  outputTokens?: number;
  at?: string;
  status?: string;
  command?: string;
  executable?: string;
  sessionID?: string;
  exitCode?: number | null;
  [key: string]: unknown;
}

export interface OpencodeRunInput {
  workflowRoot: string;
  cwd: string;
  prompt: string;
  sessionId: string;
  opencodeSessionId?: string | null;
  providerId: string;
  modelId: string;
  env: Record<string, string>;
  config: Record<string, unknown>;
  timeoutMs: number;
  productLanguage?: ProductLanguage | null;
  /** opencode agent to run the prompt under. Defaults to "build"; the memory scribe uses a sandboxed agent. */
  agentName?: string;
  signal?: AbortSignal;
}

export interface OpencodeRunResult {
  status: "pass" | "blocked" | "stopped" | "timeout";
  opencodeSessionId: string | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  blocker: string | null;
  inputTokens: number;
  outputTokens: number;
  executable: string;
}

interface StartedServer {
  client: OpencodeClient;
  questionClient: OpencodeV2Client;
  process: ChildProcess;
  url: string;
  executable: string;
  key: string;
}

export interface NormalizeState {
  emittedToolCalls: Set<string>;
  emittedQuestionRequests?: Map<string, string>;
  ignoredTextParts: Set<string>;
  promptText: string;
  rootSessionId?: string | null;
  productLanguage?: ProductLanguage | null;
  emittedSubagentStarts?: Set<string>;
  emittedSubagentToolCalls?: Set<string>;
  emittedSubagentToolResults?: Set<string>;
  subagentSessions?: Map<string, SubagentTaskRef>;
  subagentLastTextOutput?: Map<string, string>;
  pendingPermissionRequest?: boolean;
}

interface SubagentTaskRef {
  taskId: string;
  callId?: string | null;
  description?: string | null;
  prompt?: string | null;
  taskType?: string | null;
  background?: boolean;
}

const SERVER_START_TIMEOUT_MS = 15000;
let singleton: StartedServer | null = null;

function now(): string {
  return new Date().toISOString();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function serverKey(input: Pick<OpencodeRunInput, "workflowRoot" | "env" | "config">): string {
  const envSubset: Record<string, string> = {};
  for (const key of Object.keys(input.env).sort()) {
    if (/^(OPENCODE|OPENAI|ANTHROPIC|AGENT_RPG|AIWF)/.test(key)) {
      envSubset[key] = input.env[key];
    }
  }
  return stableStringify({
    workflowRoot: input.workflowRoot,
    env: envSubset,
    config: input.config,
  });
}

function normalizeForPromptCompare(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function isPromptEcho(text: string, prompt: string): boolean {
  const normalizedText = normalizeForPromptCompare(text);
  const normalizedPrompt = normalizeForPromptCompare(prompt);
  if (!normalizedText || !normalizedPrompt) return false;
  return normalizedText === normalizedPrompt
    || normalizedPrompt.startsWith(normalizedText)
    || normalizedText.startsWith(normalizedPrompt);
}

function copyDefinedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Prepend a directory to the env's PATH so the opencode runtime's `which("rg")`
 * resolves the bundled ripgrep before reaching its download fallback. Windows
 * exposes PATH as `Path`; mutate the existing key in place so the child sees a
 * single, unambiguous variable.
 */
function prependToPathEnv(env: Record<string, string>, dir: string): void {
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  const current = env[key];
  env[key] = current ? `${dir}${path.delimiter}${current}` : dir;
}

export interface OpencodeIsolationPaths {
  configDir: string;
  databasePath: string;
  homeDir: string;
  xdgDataHome: string;
  xdgCacheHome: string;
  xdgConfigHome: string;
  xdgStateHome: string;
}

/** Resolve project-local directories that fully replace ~/.opencode and XDG opencode paths. */
export function resolveOpencodeIsolationPaths(workflowRoot: string): OpencodeIsolationPaths {
  const configDir = path.resolve(resolveOpencodeConfigDir(workflowRoot));
  const xdgRoot = path.join(configDir, "xdg");
  return {
    configDir,
    databasePath: path.join(configDir, "runtime", "opencode.db"),
    homeDir: path.join(configDir, "home"),
    xdgDataHome: path.join(xdgRoot, "data"),
    xdgCacheHome: path.join(xdgRoot, "cache"),
    xdgConfigHome: path.join(xdgRoot, "config"),
    xdgStateHome: path.join(xdgRoot, "state"),
  };
}

export function ensureOpencodeIsolationDirs(workflowRoot: string): OpencodeIsolationPaths {
  const paths = resolveOpencodeIsolationPaths(workflowRoot);
  for (const dir of [
    paths.configDir,
    path.dirname(paths.databasePath),
    paths.homeDir,
    paths.xdgDataHome,
    paths.xdgCacheHome,
    paths.xdgConfigHome,
    paths.xdgStateHome,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  ensureOpencodeRuntimeAssets(resolveShippedRoot(workflowRoot), workflowRoot);
  return paths;
}

export function buildOpencodeServerEnv(
  input: Pick<OpencodeRunInput, "workflowRoot" | "env" | "config">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const paths = resolveOpencodeIsolationPaths(input.workflowRoot);
  const env: Record<string, string> = {
    ...copyDefinedEnv(baseEnv),
    ...input.env,
    HOME: paths.homeDir,
    OPENCODE_TEST_HOME: paths.homeDir,
    XDG_DATA_HOME: paths.xdgDataHome,
    XDG_CACHE_HOME: paths.xdgCacheHome,
    XDG_CONFIG_HOME: paths.xdgConfigHome,
    XDG_STATE_HOME: paths.xdgStateHome,
    OPENCODE_CONFIG_DIR: paths.configDir,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(input.config),
    OPENCODE_DB: paths.databasePath,
  };
  prependToPathEnv(env, path.dirname(resolveOpencodeRipgrep(input.workflowRoot)));
  return env;
}

async function ensureServer(input: OpencodeRunInput): Promise<StartedServer> {
  const key = serverKey(input);
  if (singleton && singleton.key === key && singleton.process.exitCode === null) return singleton;
  await stopOpencodeServer();

  const executable = resolveOpencodeCli(input.workflowRoot);
  if (!fs.existsSync(executable)) {
    throw new Error(`opencode runtime file is missing: ${executable}`);
  }
  // Packaged installs must ship ripgrep so file search works fully offline.
  // Fail fast instead of letting the opencode runtime silently download it.
  if (process.env.AGENT_RPG_RESOURCES_PATH?.trim()) {
    const ripgrep = resolveOpencodeRipgrep(input.workflowRoot);
    if (!fs.existsSync(ripgrep)) {
      throw new Error(`Bundled ripgrep is missing: ${ripgrep}. The package did not include rg correctly; rebuild the release package with npm run build:opencode-runtime.`);
    }
  }
  ensureOpencodeIsolationDirs(input.workflowRoot);
  const env = buildOpencodeServerEnv(input);
  const args = ["serve", "--hostname=127.0.0.1", "--port=0", "--log-level=INFO"];
  const proc = childProcess.spawn(executable, args, {
    cwd: input.workflowRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await waitForServerUrl(proc);
  singleton = {
    client: createOpencodeClient({ baseUrl: url, directory: input.cwd }),
    questionClient: createOpencodeV2Client({ baseUrl: url, directory: input.cwd }),
    process: proc,
    url,
    executable,
    key,
  };
  return singleton;
}

function waitForServerUrl(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopProcess(proc);
      reject(new Error(`Timed out waiting for opencode server to start.\n${output.trim()}`));
    }, SERVER_START_TIMEOUT_MS);
    const finish = (err: Error | null, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(url || "");
    };
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/opencode server listening.*?(https?:\/\/[^\s]+)/i);
        if (match) finish(null, match[1]);
      }
    };
    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);
    proc.once("error", (error) => finish(error));
    proc.once("exit", (code) => {
      finish(new Error(`opencode server failed to start with exit code ${code}.\n${output.trim()}`));
    });
  });
}

export async function stopOpencodeServer(): Promise<void> {
  const current = singleton;
  singleton = null;
  if (!current) return;
  stopProcess(current.process);
}

function stopProcess(proc: ChildProcess | null): void {
  if (!proc || proc.exitCode !== null) return;
  try {
    proc.kill();
  } catch {
    // Fall through to taskkill on Windows.
  }
  if (process.platform === "win32" && proc.pid) {
    childProcess.spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasMeaningfulToolInput(input: Record<string, unknown>): boolean {
  return Object.keys(input).length > 0;
}

function parseToolInput(stateRecord: Record<string, unknown>): Record<string, unknown> {
  const direct = asRecord(stateRecord.input);
  if (hasMeaningfulToolInput(direct)) return direct;
  const raw = asString(stateRecord.raw).trim();
  if (!raw) return direct;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the direct (possibly empty) input object.
  }
  return direct;
}

function shouldEmitToolCallUpdate(
  tool: string,
  alreadyEmitted: boolean,
  hasInput: boolean,
): boolean {
  if (!alreadyEmitted) return true;
  if (tool === "AskUserQuestion") return false;
  return hasInput;
}

function shouldFinalizeToolCallEmission(tool: string, hasInput: boolean): boolean {
  return hasInput || tool === "AskUserQuestion";
}

function ensureSubagentSessions(state: NormalizeState): Map<string, SubagentTaskRef> {
  if (!state.subagentSessions) state.subagentSessions = new Map<string, SubagentTaskRef>();
  return state.subagentSessions;
}

function ensureSet(state: NormalizeState, key: "emittedSubagentStarts" | "emittedSubagentToolCalls" | "emittedSubagentToolResults"): Set<string> {
  if (!state[key]) state[key] = new Set<string>();
  return state[key]!;
}

function ensureQuestionRequests(state: NormalizeState): Map<string, string> {
  if (!state.emittedQuestionRequests) state.emittedQuestionRequests = new Map<string, string>();
  return state.emittedQuestionRequests;
}

function sessionIdFromEvent(event: Record<string, unknown>): string | null {
  const properties = asRecord(event.properties);
  const part = asRecord(properties.part);
  const info = asRecord(properties.info);
  return asString(properties.sessionID)
    || asString(part.sessionID)
    || asString(info.id)
    || null;
}

function normalizeToolName(tool: string): string {
  const value = tool.trim();
  const lower = value.toLowerCase();
  if (lower === "todowrite") return "TaskUpdate";
  if (lower === "todoread") return "TaskList";
  if (lower === "task") return "Agent";
  if (lower === "question") return "AskUserQuestion";
  if (lower === "plan_enter") return "EnterPlanMode";
  if (lower === "plan_exit") return "ExitPlanMode";
  return value || "tool";
}

function toolStateMetadata(stateRecord: Record<string, unknown>): Record<string, unknown> {
  return asRecord(stateRecord.metadata);
}

function taskSessionIdFromToolState(stateRecord: Record<string, unknown>): string {
  const metadata = toolStateMetadata(stateRecord);
  return asString(metadata.sessionId) || asString(metadata.sessionID);
}

function rememberSubagentSession(
  state: NormalizeState,
  sessionId: string,
  patch: Partial<SubagentTaskRef>,
): SubagentTaskRef {
  const sessions = ensureSubagentSessions(state);
  const existing = sessions.get(sessionId);
  const next: SubagentTaskRef = {
    taskId: sessionId,
    callId: patch.callId ?? existing?.callId ?? null,
    description: patch.description ?? existing?.description ?? null,
    prompt: patch.prompt ?? existing?.prompt ?? null,
    taskType: patch.taskType ?? existing?.taskType ?? null,
    background: patch.background ?? existing?.background ?? false,
  };
  sessions.set(sessionId, next);
  return next;
}

function subagentStartEvent(input: {
  ref: SubagentTaskRef;
  at: string;
}): RuntimeEvent {
  return {
    type: "subagent_task_started",
    taskId: input.ref.taskId,
    callId: input.ref.callId || undefined,
    description: input.ref.description || undefined,
    prompt: input.ref.prompt || undefined,
    taskType: input.ref.taskType || undefined,
    background: input.ref.background ? true : undefined,
    at: input.at,
  };
}

function maybeEmitSubagentStart(
  state: NormalizeState,
  ref: SubagentTaskRef,
  at: string,
  out: RuntimeEvent[],
): void {
  const emitted = ensureSet(state, "emittedSubagentStarts");
  if (emitted.has(ref.taskId)) return;
  emitted.add(ref.taskId);
  out.push(subagentStartEvent({ ref, at }));
}

function subagentRefForEvent(event: Record<string, unknown>, state: NormalizeState): SubagentTaskRef | null {
  const eventSessionId = sessionIdFromEvent(event);
  if (!eventSessionId || eventSessionId === state.rootSessionId) return null;
  return state.subagentSessions?.get(eventSessionId) || null;
}

function normalizeSubagentEvent(
  event: Record<string, unknown>,
  state: NormalizeState,
  ref: SubagentTaskRef,
  at: string,
): RuntimeEvent[] {
  const type = asString(event.type);
  const properties = asRecord(event.properties);
  const out: RuntimeEvent[] = [];

  if (type !== "message.part.updated") return out;

  const part = asRecord(properties.part);
  const partType = asString(part.type);
  if (partType === "text" || partType === "reasoning") {
    const text = asString(properties.delta) || asString(part.text);
    if (!text.trim()) return out;
    if (partType === "text") {
      if (!state.subagentLastTextOutput) state.subagentLastTextOutput = new Map<string, string>();
      state.subagentLastTextOutput.set(ref.taskId, text);
    }
    out.push({
      type: "subagent_task_progress",
      taskId: ref.taskId,
      callId: ref.callId || undefined,
      description: ref.description || undefined,
      prompt: ref.prompt || undefined,
      taskType: ref.taskType || undefined,
      logType: partType,
      detail: text,
      at,
    });
    return out;
  }

  if (partType !== "tool") return out;
  const stateRecord = asRecord(part.state);
  const status = asString(stateRecord.status);
  const rawCallId = asString(part.callID) || asString(part.id);
  const scopedCallId = `${ref.taskId}:${rawCallId}`;
  const tool = normalizeToolName(asString(part.tool));
  const input = parseToolInput(stateRecord);
  const title = asString(stateRecord.title);

  if ((status === "pending" || status === "running") && !ensureSet(state, "emittedSubagentToolCalls").has(scopedCallId)) {
    ensureSet(state, "emittedSubagentToolCalls").add(scopedCallId);
    out.push({
      type: "subagent_task_progress",
      taskId: ref.taskId,
      callId: ref.callId || undefined,
      description: ref.description || undefined,
      prompt: ref.prompt || undefined,
      taskType: ref.taskType || undefined,
      lastToolName: tool,
      detail: title || undefined,
      toolInput: input,
      toolStatus: "running",
      at,
    });
  } else if ((status === "completed" || status === "error") && !ensureSet(state, "emittedSubagentToolResults").has(scopedCallId)) {
    ensureSet(state, "emittedSubagentToolResults").add(scopedCallId);
    out.push({
      type: "subagent_task_progress",
      taskId: ref.taskId,
      callId: ref.callId || undefined,
      description: ref.description || undefined,
      prompt: ref.prompt || undefined,
      taskType: ref.taskType || undefined,
      lastToolName: tool,
      detail: title || undefined,
      toolInput: input,
      toolOutput: status === "error" ? asString(stateRecord.error) : asString(stateRecord.output),
      toolStatus: status === "error" ? "failed" : "completed",
      at,
    });
  }

  return out;
}

export function normalizeOpencodeEvent(
  event: Record<string, unknown>,
  state: NormalizeState,
): RuntimeEvent[] {
  const at = now();
  const type = asString(event.type);
  const properties = asRecord(event.properties);
  const out: RuntimeEvent[] = [];
  if (type === "session.idle") {
    const idleSessionId = sessionIdFromEvent(event);
    if (idleSessionId && idleSessionId !== state.rootSessionId) {
      const ref = state.subagentSessions?.get(idleSessionId);
      const notificationKey = `idle:${idleSessionId}`;
      if (ref && !ensureSet(state, "emittedSubagentToolResults").has(notificationKey)) {
        ensureSet(state, "emittedSubagentToolResults").add(notificationKey);
        out.push({
          type: "subagent_task_notification",
          taskId: ref.taskId,
          callId: ref.callId || undefined,
          description: ref.description || undefined,
          taskType: ref.taskType || undefined,
          status: "completed",
          output: state.subagentLastTextOutput?.get(ref.taskId) || "",
          at,
        });
      }
    }
    return out;
  }
  const subagentRef = subagentRefForEvent(event, state);
  if (subagentRef) return normalizeSubagentEvent(event, state, subagentRef, at);

  if (type === "message.part.updated") {
    const part = asRecord(properties.part);
    const partType = asString(part.type);
    if (partType === "text") {
      const text = asString(properties.delta) || asString(part.text);
      const partId = asString(part.id);
      if (partId && state.ignoredTextParts.has(partId)) return out;
      if (isPromptEcho(text, state.promptText)) {
        if (partId) state.ignoredTextParts.add(partId);
        return out;
      }
      const visibleText = stripNativeTaskBlocks(text);
      if (visibleText.trim()) out.push({ type: "text_delta", segment_id: asString(part.id), text: visibleText, at });
    } else if (partType === "reasoning") {
      const text = asString(properties.delta) || asString(part.text);
      if (text) out.push({ type: "reasoning_delta", segment_id: asString(part.id), text, at });
    } else if (partType === "tool") {
      const stateRecord = asRecord(part.state);
      const status = asString(stateRecord.status);
      const callId = asString(part.callID) || asString(part.id);
      const tool = normalizeToolName(asString(part.tool));
      if (tool === "Agent") {
        const childSessionId = taskSessionIdFromToolState(stateRecord);
        if (childSessionId) {
          const input = asRecord(stateRecord.input);
          const ref = rememberSubagentSession(state, childSessionId, {
            callId,
            description: asString(input.description) || asString(stateRecord.title) || childSessionId,
            prompt: asString(input.prompt),
            taskType: asString(input.subagent_type),
            background: input.background === true,
          });
          maybeEmitSubagentStart(state, ref, at, out);
        }
      }
      const input = parseToolInput(stateRecord);
      const hasInput = hasMeaningfulToolInput(input);
      const alreadyEmitted = state.emittedToolCalls.has(callId);
      if (status === "pending" || status === "running") {
        if (shouldEmitToolCallUpdate(tool, alreadyEmitted, hasInput)) {
          out.push({
            type: "tool_call",
            call_id: callId,
            tool,
            input,
            title: asString(stateRecord.title),
            at,
          });
          if (shouldFinalizeToolCallEmission(tool, hasInput)) {
            state.emittedToolCalls.add(callId);
          }
        }
        if (tool === "AskUserQuestion") {
          maybePushQuestionRequest(state, callId, stateRecord, at, out);
        }
      } else if (status === "completed" || status === "error") {
        if (tool === "Agent") {
          const childSessionId = taskSessionIdFromToolState(stateRecord);
          const ref = childSessionId ? state.subagentSessions?.get(childSessionId) : null;
          const notificationKey = childSessionId ? `agent:${callId}:${childSessionId}` : "";
          if (ref && notificationKey && !ensureSet(state, "emittedSubagentToolResults").has(notificationKey)) {
            ensureSet(state, "emittedSubagentToolResults").add(notificationKey);
            out.push({
              type: "subagent_task_notification",
              taskId: ref.taskId,
              callId: ref.callId || callId,
              description: ref.description || undefined,
              taskType: ref.taskType || undefined,
              status: status === "error" ? "failed" : "completed",
              output: status === "error" ? asString(stateRecord.error) : asString(stateRecord.output),
              error: status === "error" ? asString(stateRecord.error) : undefined,
              at,
            });
          }
        }
        out.push({
          type: "tool_result",
          call_id: callId,
          tool,
          input,
          output: status === "error" ? asString(stateRecord.error) : asString(stateRecord.output),
          success: status !== "error",
          at,
        });
      }
    } else if (partType === "step-finish") {
      const tokens = asRecord(part.tokens);
      out.push({
        type: "usage",
        inputTokens: Number(tokens.input || 0),
        outputTokens: Number(tokens.output || 0),
        reasoningTokens: Number(tokens.reasoning || 0),
        cost: Number(part.cost || 0),
        at,
      });
    } else if (partType === "subtask") {
      out.push({
        type: "subagent_task_started",
        taskId: asString(part.id),
        prompt: asString(part.prompt),
        description: asString(part.description),
        taskType: asString(part.agent),
        at,
      });
    }
  } else if (type === "todo.updated") {
    const todos = Array.isArray(properties.todos) ? properties.todos : [];
    out.push({ type: "todo_updated", todos, at });
    for (const [index, todo] of todos.map(asRecord).entries()) {
      out.push({
        type: "tool_result",
        call_id: `todo:${asString(todo.id) || index + 1}`,
        tool: "TaskUpdate",
        output: JSON.stringify(todo),
        success: true,
        at,
      });
    }
  } else if (type === "permission.updated" || type === "permission.asked") {
    state.pendingPermissionRequest = true;
    console.error(`[perm-diag] permission event received: type=${type} id=${asString(properties.id)} permission=${asString(properties.permission) || asString(properties.type)}`);
    out.push(buildPermissionRequest(properties, at, state.productLanguage));
  } else if (type === "permission.replied") {
    state.pendingPermissionRequest = false;
    console.error(`[perm-diag] permission.replied received: id=${asString(properties.permissionID)} reply=${asString(properties.reply) || asString(properties.response)}`);
    out.push({
      type: "opencode_permission_response",
      request_id: asString(properties.permissionID),
      response: {
        subtype: "success",
        request_id: asString(properties.permissionID),
        response: { behavior: asString(properties.response) === "reject" ? "deny" : "allow" },
      },
      success: true,
      at,
    });
  } else if (type === "session.status") {
    const status = asRecord(properties.status);
    console.error(`[perm-diag] session.status: ${asString(status.type)} sessionID=${asString(properties.sessionID)}`);
    if (asString(status.type) === "busy" || asString(status.type) === "retry") {
      out.push({ type: "status", status: "running", at });
    }
  } else if (type === "session.error") {
    out.push({
      type: "stderr",
      text: `${formatOpencodeError(properties.error)}\n`,
      at,
    });
    out.push({
      type: "status",
      status: "blocked",
      blocker: formatOpencodeError(properties.error),
      at,
    });
  }

  return out;
}

export function shouldFinishOpencodeRunOnSessionIdle(
  event: Record<string, unknown>,
  parentSessionId: string | null,
): boolean {
  if (asString(event.type) !== "session.idle") return false;
  const idleSessionId = sessionIdFromEvent(event);
  return !idleSessionId || idleSessionId === parentSessionId;
}

interface NormalizedQuestion {
  header: string;
  question: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
}

function maybePushQuestionRequest(
  state: NormalizeState,
  requestId: string,
  stateRecord: Record<string, unknown>,
  at: string,
  out: RuntimeEvent[],
): void {
  const request = buildQuestionRequest(requestId, stateRecord, at, state.productLanguage);
  if (!request) return;
  const requestKey = stableStringify(asRecord(request.request));
  const emitted = ensureQuestionRequests(state);
  if (emitted.get(requestId) === requestKey) return;
  emitted.set(requestId, requestKey);
  out.push(request);
}

function normalizeQuestionOption(option: Record<string, unknown>, index: number, language?: ProductLanguage | null): { label: string; description: string } | null {
  const resolvedLanguage = normalizeProductLanguage(language);
  const label = asString(option.label) || asString(option.value) || backendText('runtime.optionFallback', resolvedLanguage, { index: index + 1 });
  if (!label) return null;
  return {
    label,
    description: asString(option.description),
  };
}

function normalizeQuestion(input: Record<string, unknown>, index: number, language?: ProductLanguage | null): NormalizedQuestion | null {
  const resolvedLanguage = normalizeProductLanguage(language);
  const question = asString(input.question) || asString(input.prompt);
  if (!question) return null;
  const options = Array.isArray(input.options)
    ? input.options
      .map(asRecord)
      .map((option, optionIndex) => normalizeQuestionOption(option, optionIndex, resolvedLanguage))
      .filter((option): option is { label: string; description: string } => Boolean(option))
    : [];
  if (options.length < 2) return null;
  return {
    header: asString(input.header) || asString(input.title) || backendText('runtime.questionFallback', resolvedLanguage, { index: index + 1 }),
    question,
    multiSelect: input.multiple === true || input.multiSelect === true,
    options,
  };
}

function normalizeQuestionsInput(input: Record<string, unknown>, language?: ProductLanguage | null): NormalizedQuestion[] {
  const questions = Array.isArray(input.questions)
    ? input.questions
      .map(asRecord)
      .map((question, index) => normalizeQuestion(question, index, language))
      .filter((question): question is NormalizedQuestion => Boolean(question))
    : [];
  if (questions.length) return questions;
  const single = normalizeQuestion(input, 0, language);
  return single ? [single] : [];
}

function buildQuestionRequest(
  requestId: string,
  stateRecord: Record<string, unknown>,
  at: string,
  language: ProductLanguage | null | undefined = DEFAULT_PRODUCT_LANGUAGE,
): RuntimeEvent | null {
  const resolvedLanguage = normalizeProductLanguage(language);
  const questions = normalizeQuestionsInput(asRecord(stateRecord.input), resolvedLanguage);
  if (questions.length === 0) return null;
  const description = questions[0]?.question || backendText('runtime.waitingForInput', resolvedLanguage);
  return {
    type: "opencode_question_request",
    request_id: requestId,
      request: {
        subtype: "can_use_tool",
        tool_name: "AskUserQuestion",
        description,
        input: {
        questions,
      },
      },
      at,
    };
}

function buildPermissionRequest(permission: Record<string, unknown>, at: string, language?: ProductLanguage | null): RuntimeEvent {
  const resolvedLanguage = normalizeProductLanguage(language);
  const requestId = asString(permission.id);
  // plan 模式事件用 type 字段（plan_exit/plan_enter）；approvalHandler 事件用 permission 字段（workflow_tool_approval）。
  const type = asString(permission.type) || asString(permission.permission);
  const title = asString(permission.title) || type || backendText('runtime.permissionRequired', resolvedLanguage);
  const metadata = asRecord(permission.metadata);
  const planFilePath = asString(metadata.planFilePath) || asString(metadata.planPath) || asString(metadata.path) || null;

  // approvalHandler 的 metadata.tools 是 [{name, args}]，args 是工具入参的 JSON 文本。
  // 从中提取工具名和入参，让桌面能渲染高危审批卡（展示脚本等实际内容）。
  const toolsRaw = Array.isArray(metadata.tools) ? metadata.tools : [];
  const firstTool = toolsRaw.length > 0 ? asRecord(toolsRaw[0]) : null;
  const toolNameFromMeta = firstTool ? asString(firstTool.name) : "";
  let toolInput: Record<string, unknown> = {};
  if (firstTool) {
    try {
      const parsed = JSON.parse(asString(firstTool.args));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        toolInput = parsed as Record<string, unknown>;
      }
    } catch { /* 非 JSON，忽略 */ }
  }

  const toolName = type === "plan_exit"
    ? "ExitPlanMode"
    : type === "plan_enter"
      ? "EnterPlanMode"
      : (toolNameFromMeta || title);
  return {
    type: "opencode_permission_request",
    request_id: requestId,
    request: {
      subtype: "can_use_tool",
      tool_name: toolName,
      description: title,
      input: Object.keys(toolInput).length > 0
        ? toolInput
        : {
            plan: asString(metadata.plan) || title,
            planFilePath,
            permissionType: type,
            pattern: permission.pattern,
          },
    },
    at,
  };
}

function formatOpencodeError(value: unknown): string {
  const record = asRecord(value);
  const name = asString(record.name);
  const message = asString(record.message);
  const status = Number(record.statusCode || record.status || 0);
  const responseBody = asString(record.responseBody);
  const metadata = asRecord(record.metadata);
  const details = [
    status ? `status ${status}` : "",
    responseBody,
    Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : "",
  ].filter(Boolean);
  const summary = message && message !== name ? message : name;
  if (summary && details.length > 0) return `${summary} (${details.join("; ")})`;
  return summary || (value ? JSON.stringify(value) : "opencode session error");
}

export function shouldBlockEmptyOpencodePass(input: {
  status: OpencodeRunResult["status"];
  sawAssistantContent: boolean;
  sawToolActivity: boolean;
  inputTokens: number;
  outputTokens: number;
}): boolean {
  return input.status === "pass"
    && !input.sawAssistantContent
    && !input.sawToolActivity
    && input.inputTokens === 0
    && input.outputTokens === 0;
}

function emitTerminalStatus(
  status: OpencodeRunResult["status"],
  blocker: string | null,
  finishedAt: string,
  onEvent: (event: RuntimeEvent) => void,
): void {
  if (status === "pass") {
    onEvent({ type: "status", status: "pass", at: finishedAt, exitCode: null });
  } else if (status !== "timeout") {
    onEvent({ type: "status", status, blocker, at: finishedAt, exitCode: null });
  }
}

export async function runOpencodeSession(
  input: OpencodeRunInput,
  onEvent: (event: RuntimeEvent) => void,
): Promise<OpencodeRunResult> {
  const startedAt = now();
  const server = await ensureServer(input);
  const client = createOpencodeClient({ baseUrl: server.url, directory: input.cwd });
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  let stdout = "";
  let stderr = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finalStatus: OpencodeRunResult["status"] = "pass";
  let blocker: string | null = null;
  let opencodeSessionId = input.opencodeSessionId || null;
  let done = false;
  let sawAssistantContent = false;
  let sawToolActivity = false;
  const productLanguage = normalizeProductLanguage(input.productLanguage);
  const state: NormalizeState = {
    emittedToolCalls: new Set<string>(),
    ignoredTextParts: new Set<string>(),
    promptText: input.prompt,
    rootSessionId: opencodeSessionId,
    productLanguage,
  };

  const finish = (status: OpencodeRunResult["status"], reason?: string | null) => {
    if (done) return;
    done = true;
    console.error(`[perm-diag] finish called: status=${status} reason=${reason || "null"} pendingPermission=${state.pendingPermissionRequest}`);
    finalStatus = status;
    blocker = reason || null;
  };

  const timeout = setTimeout(() => {
    const seconds = Math.round(input.timeoutMs / 1000);
    const reason = backendText(
      'runtime.timeout',
      productLanguage,
      { seconds },
    );
    stderr += `${reason}\n`;
    onEvent({ type: "stderr", text: `${reason}\n`, at: now() });
    onEvent({ type: "status", status: "timeout", blocker: reason, at: now() });
    finish("timeout", reason);
    controller.abort(new Error(reason));
  }, input.timeoutMs);
  if (timeout.unref) timeout.unref();

  try {
    onEvent({ type: "status", status: "running", at: startedAt });
    onEvent({ type: "command", command: "opencode serve + session.promptAsync", executable: server.executable, at: startedAt });

    if (!opencodeSessionId) {
      const created = await client.session.create({
        query: { directory: input.cwd },
        body: { title: input.prompt.split(/\r?\n/)[0]?.slice(0, 80) || "RPG Agent MV" },
        signal: controller.signal,
      });
      if (created.error || !created.data) throw created.error || new Error("opencode session create failed");
      opencodeSessionId = created.data.id;
      state.rootSessionId = opencodeSessionId;
    }
    onEvent({ type: "opencode_session", sessionID: opencodeSessionId, at: now() });

    const subscribed = await client.event.subscribe({
      query: { directory: input.cwd },
      signal: controller.signal,
      sseMaxRetryAttempts: 0,
    });

    const streamTask = (async () => {
      console.error(`[perm-diag] SSE stream loop started`);
      for await (const raw of subscribed.stream as AsyncGenerator<Record<string, unknown>>) {
        if (!raw || done) {
          if (done) console.error(`[perm-diag] SSE loop: skipping raw because done=true`);
          continue;
        }
        const rawType = asString(raw.type);
        console.error(`[perm-diag] SSE event: type=${rawType}`);
        const eventSessionId = sessionIdFromEvent(raw);
        if (
          eventSessionId
          && eventSessionId !== opencodeSessionId
          && !state.subagentSessions?.has(eventSessionId)
        ) continue;
        for (const event of normalizeOpencodeEvent(raw, state)) {
          if (event.type === "text_delta" || event.type === "reasoning_delta") stdout += event.text || "";
          if (event.type === "stderr") stderr += event.text || "";
          if ((event.type === "text_delta" || event.type === "reasoning_delta") && String(event.text || "").trim()) {
            sawAssistantContent = true;
          }
          if (event.type === "tool_call" || event.type === "tool_result") {
            sawToolActivity = true;
          }
          if (event.type === "usage") {
            inputTokens += Number(event.inputTokens || 0);
            outputTokens += Number(event.outputTokens || 0);
          }
          onEvent(event);
          if (event.type === "status" && ["blocked", "error", "failed"].includes(String(event.status || ""))) {
            console.error(`[perm-diag] status blocked/error/failed → finish("blocked")`);
            finish("blocked", asString(event.blocker) || "opencode session failed");
          }
        }
        if (shouldFinishOpencodeRunOnSessionIdle(raw, opencodeSessionId)) {
          if (state.pendingPermissionRequest) {
            console.error(`[perm-diag] session.idle received but pendingPermissionRequest=true, NOT terminating`);
          } else {
            console.error(`[perm-diag] session.idle received, terminating with pass`);
            finish("pass", null);
            break;
          }
        }
      }
      console.error(`[perm-diag] SSE stream loop ENDED naturally (stream closed). done=${done}`);
    })();

    const promptResult = await client.session.promptAsync({
      path: { id: opencodeSessionId },
      query: { directory: input.cwd },
      body: {
        model: {
          providerID: input.providerId,
          modelID: input.modelId,
        },
        agent: input.agentName || "build",
        parts: [{ type: "text", text: input.prompt }],
      },
      signal: controller.signal,
    });
    if (promptResult.error) {
      console.error(`[perm-diag] promptAsync returned error: ${JSON.stringify(promptResult.error)}`);
      throw promptResult.error;
    }
    console.error(`[perm-diag] promptAsync succeeded, awaiting streamTask`);

    await streamTask;
  } catch (error) {
    console.error(`[perm-diag] CATCH block: error=${error instanceof Error ? error.message : String(error)} done=${done}`);
    if (!done) {
      const message = error instanceof Error ? error.message : String(error);
      stderr += `${message}\n`;
      onEvent({ type: "stderr", text: `${message}\n`, at: now() });
      finish(input.signal?.aborted ? "stopped" : "blocked", message);
    }
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
    if (opencodeSessionId && controller.signal.aborted) {
      await client.session.abort({ path: { id: opencodeSessionId }, query: { directory: input.cwd } }).catch(() => {});
    }
  }

  const finishedAt = now();
  if (shouldBlockEmptyOpencodePass({ status: finalStatus, sawAssistantContent, sawToolActivity, inputTokens, outputTokens })) {
    const reason = [
      backendText(
        'runtime.emptyOutput',
        productLanguage,
      ),
      `provider=${input.providerId}`,
      `model=${input.modelId}`,
      opencodeSessionId ? `opencodeSessionId=${opencodeSessionId}` : "",
    ].filter(Boolean).join(" ");
    stderr += `${reason}\n`;
    onEvent({ type: "stderr", text: `${reason}\n`, at: finishedAt });
    finalStatus = "blocked";
    blocker = reason;
  }
  if (inputTokens || outputTokens) {
    onEvent({ type: "usage_summary", inputTokens, outputTokens, at: finishedAt });
  }
  emitTerminalStatus(finalStatus, blocker, finishedAt, onEvent);

  return {
    status: finalStatus,
    opencodeSessionId,
    stdout,
    stderr,
    startedAt,
    finishedAt,
    blocker,
    inputTokens,
    outputTokens,
    executable: server.executable,
  };
}


/**
 * Fork an existing opencode session into a fresh isolated session that inherits the full
 * conversation history (Phase 2c memory scribe). Requires the server singleton to be live —
 * extraction runs right after the parent turn finished, so the server is always up. Returns
 * the new session id, or null if the server is gone or the fork fails (caller fails soft).
 */
export async function forkOpencodeSession(
  opencodeSessionId: string,
  directory: string,
  messageID?: string,
): Promise<string | null> {
  if (!singleton || singleton.process.exitCode !== null) return null;
  const result = await singleton.client.session.fork({
    path: { id: opencodeSessionId },
    query: { directory },
    body: messageID ? { messageID } : {},
  });
  if (result.error || !result.data) return null;
  return result.data.id || null;
}

/** Best-effort delete of a (forked) opencode session so scribe forks don't pile up in the db. */
export async function deleteOpencodeSession(sessionId: string, directory: string): Promise<void> {
  if (!singleton || singleton.process.exitCode !== null) return;
  await singleton.client.session.delete({ path: { id: sessionId }, query: { directory } }).catch(() => {});
}

export async function replyOpencodePermission(
  sessionId: string,
  permissionID: string,
  response: "once" | "always" | "reject",
  directory: string,
): Promise<boolean> {
  if (!singleton) {
    console.error(`[perm-diag] replyOpencodePermission: no singleton`);
    return false;
  }
  console.error(`[perm-diag] replyOpencodePermission: sessionId=${sessionId} permissionID=${permissionID} response=${response}`);
  const result = await singleton.client.postSessionIdPermissionsPermissionId({
    path: { id: sessionId, permissionID },
    query: { directory },
    body: { response },
  });
  console.error(`[perm-diag] replyOpencodePermission result: data=${Boolean(result.data)} error=${result.error ? JSON.stringify(result.error) : "none"}`);
  return Boolean(result.data);
}

export async function replyOpencodeQuestion(
  sessionId: string,
  requestId: string,
  answers: string[][],
  directory: string,
): Promise<boolean> {
  if (!singleton) return false;
  let targetRequestId = requestId;
  const pending = await singleton.questionClient.question.list({ directory });
  if (Array.isArray(pending.data)) {
    const pendingQuestions = pending.data.map(asRecord);
    const match = pendingQuestions.find((question) => {
      const tool = asRecord(question.tool);
      return asString(question.id) === requestId
        || (asString(question.sessionID) === sessionId && asString(tool.callID) === requestId);
    });
    targetRequestId = asString(match?.id) || targetRequestId;
  }
  const result = await singleton.questionClient.question.reply({
    requestID: targetRequestId,
    directory,
    answers,
  });
  return Boolean(result.data);
}
