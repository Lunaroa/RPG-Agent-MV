import fs from "fs";
import path from "path";

import { writeJson } from "../../rmmv/json.ts";
import { resolveShippedPath, resolveWorkflowRoot } from "../../workspace-paths.ts";
import * as providerRegistry from "../../llm/provider-registry.ts";
import { materializeOpencodeEnv } from "../../llm/opencode/materialize-env.ts";
import { buildEphemeralOpencodeProfile } from "../../llm/opencode/build-profile.ts";
import { resolveSessionBinding } from "../../llm/invocation/parse-profile-id.ts";
import {
  getAgentConfig,
  loadAgentRegistry,
  routeRepair,
  summarizeAgentForTrace
} from "./agent-registry.ts";
import { resolveAgentProfile } from "./profile-resolver.ts";
import {
  buildRuntimeCommandForEngine,
  buildRuntimeEnvForEngine,
  defaultEngine,
  resolveBindingStorageKey,
  resolveExecutableOverride,
  resolveRuntimeReadinessBlocker,
  usesOpencodeProviderBinding,
  type AgentExecutionEngine,
  type AgentExecutionSettingsLike,
  type EngineProviderBindingLike,
} from "./runtime-adapters/index.ts";
import {
  prepareKnowledgeContext,
  type DockerCommandResult,
  type KnowledgeContext,
  type KnowledgePreparationProgress
} from "./knowledge-context.ts";
import {
  assessAgentRuntimeOutcome,
} from "./runtime-issues.ts";
import { buildAgentOutputEnv } from "./agent-output-dirs.ts";
import { buildSessionPlanPathPromptLines } from "../../desktop/session-plan-path.ts";
import { AGENT_PROMPT_LANGUAGE } from "../../i18n/agent-prompt-locale.ts";
import { resolveMemoryPreamble } from "../../memory/memory-inject.ts";
import { readMemorySettings } from "../../memory/memory-settings.ts";
import {
  buildOpencodeRuntimeConfig,
} from "./opencode/config.ts";
import { runOpencodeSession } from "./opencode/runtime.ts";
import type { ProductLanguage } from "../../../../../contract/types.ts";
import { normalizeProductLanguage } from "../../../../../contract/i18n.ts";
import { backendText } from "../../i18n/messages.ts";

const DEFAULT_AGENT_TIMEOUT_MS: number = 30 * 60 * 1000;

interface DispatchOptions {
  workflowRoot?: string;
  agentId?: string;
  failureKind?: string;
  sessionId?: string;
  profileId?: string;
  providerId?: string;
  modelId?: string;
  executionEngine?: AgentExecutionEngine;
  agentExecutionSettings?: AgentExecutionSettingsLike | null;
  projectId?: string;
  contextMode?: string;
  skipKnowledgeRefresh?: boolean;
  knowledgeContextOutDir?: string;
  project?: string;
  files?: string[];
  intent?: string;
  productLanguage?: ProductLanguage;
  mapId?: string;
  taskId?: string;
  conversationHistory?: string;
  readOnlyTools?: boolean;
  thinkingLevel?: string;
  opencodeSessionId?: string;
  execute?: boolean;
  timeoutMs?: number;
  outDir?: string;
  signal?: AbortSignal;
  preparationTaskId?: string;
  onPreparationProgress?: (progress: KnowledgePreparationProgress) => void;
  /** Deprecated: legacy ask MCP gateway is disabled; kept for older callers. */
  askMcpGatewayPort?: number | null;
  /** Conversation-scoped plan file relative to the game project cwd. */
  planFilePath?: string;
  /** Current progress for compressed continuation prompts only; not part of memory recall. */
  currentProgressPreamble?: string;
  /** Memory slugs already surfaced earlier in this conversation (multi-turn recall dedup). */
  alreadySurfaced?: string[];
  /** Internal-only: expose the exact opencode run context to the desktop session runtime. */
  onOpencodeRunContext?: (context: OpencodeRunContext) => void;
}

export interface OpencodeRunContext {
  workflowRoot: string;
  cwd: string;
  providerId: string;
  modelId: string;
  env: Record<string, string>;
  config: Record<string, unknown>;
  timeoutMs: number;
}

interface AgentRuntime {
  defaultProfile?: string | null;
  defaultProfileConfig?: ProfileConfig;
  escalationProfiles?: string[];
  [key: string]: unknown;
}

interface AgentPaths {
  config: string;
  skills: string[];
  memory: string[];
  workspace: string | null;
}

interface AgentConfig {
  id: string;
  role?: string;
  description?: string;
  runtime?: AgentRuntime;
  skills?: string[];
  memory?: string[];
  workspace?: { root?: string };
  tools?: { allow?: string[]; deny?: string[]; [key: string]: unknown };
  permissions?: Record<string, unknown>;
  handoff?: Record<string, unknown>;
  paths?: AgentPaths;
  [key: string]: unknown;
}

interface ProfileConfig {
  runtime?: string | null;
  provider?: string;
  protocol?: string;
  model?: string;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  modelEnv?: string | null;
  baseUrlEnv?: string | null;
  tools?: string[];
  envFileHint?: string | null;
  mapsToRuntimeEnv?: Record<string, string>;
  dynamic?: boolean;
  [key: string]: unknown;
}

interface Registry {
  version: number;
  workflowRoot: string;
  registryPath: string;
  runtimeRoot: string;
  defaultEnvFile: string | null;
  profilePath: string;
  profiles: Record<string, ProfileConfig>;
  workflow: Record<string, unknown>;
  agents: Record<string, AgentConfig>;
  [key: string]: unknown;
}

interface Task {
  intent: string | null;
  project: string | null;
  mapId: string | null;
  failureKind: string | null;
  taskId: string | null;
  files: string[];
  conversationHistory: string | null;
}

interface RuntimeCommand {
  command: string;
  args: string[];
  stdin?: string;
  display: string;
  streamFormat?: string;
}

interface SummarizedAgent {
  id: string;
  [key: string]: unknown;
}

interface SummarizedProfile {
  runtime?: string | null;
  provider?: string;
  protocol?: string;
  model?: string;
  baseUrl?: string | null;
  envFileHint?: string | null;
  apiKeyEnv?: string | null;
  modelEnv?: string | null;
  baseUrlEnv?: string | null;
  mapsToRuntimeEnv?: Record<string, string>;
  tools?: string[];
  [key: string]: unknown;
}

interface AgentRunRecord {
  status: "pass" | "blocked";
  stdout?: string;
  exitCode?: number;
  error?: string | null;
  stderr?: string;
}

interface BackendOutput {
  stdout: string;
  stderr: string;
  rawStdout?: string;
}

interface ExecutionInfo {
  requested: boolean;
  timeoutMs: number;
  command: RuntimeCommand | null;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
  timedOut?: boolean;
  executable?: string;
  envFile?: string | null;
  envKeysApplied?: string[];
  [key: string]: unknown;
}

interface DispatchResult {
  status: string;
  generatedAt: string;
  sessionId: string;
  workflowRoot: string;
  registryPath?: string;
  route?: unknown;
  task: Task;
  productLanguage?: ProductLanguage | null;
  agent?: SummarizedAgent | null;
  executionEngine?: AgentExecutionEngine;
  profileId?: string | null;
  sessionBinding?: EngineProviderBindingLike | null;
  profile?: SummarizedProfile | null;
  knowledgeContext?: KnowledgeContext;
  prompt?: { system: string; user: string };
  execution?: ExecutionInfo;
  blocker?: string | null;
  nextActions?: string[];
  agentRunRecord?: AgentRunRecord;
  backendOutput?: BackendOutput;
  planFilePath?: string | null;
  /** Memory slugs newly surfaced this dispatch (recall), for the caller's running surfaced set. */
  surfacedMemorySlugs?: string[];
}

interface PathResult {
  jsonPath: string;
  mdPath: string;
}

interface RuntimeEnvResult {
  env: Record<string, string>;
  keys: string[];
  envFile?: string | null;
}

interface RuntimeEvent {
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

interface DispatchProcessHandle {
  promise: Promise<DispatchResult>;
  stop: () => void;
}

interface UserPromptContext {
  task: Task;
  productLanguage?: ProductLanguage | null;
  registry: Registry;
  agent: AgentConfig;
  profileId: string | null;
  knowledgeContext: KnowledgeContext;
  workflowRoot: string;
}

interface BuildRuntimeCommandContext {
  userPrompt: string;
  project?: string;
  files: string[];
  thinkingLevel?: string | null;
  opencodeSessionId?: string | null;
  executableOverride?: string | null;
  bindingModelId?: string | null;
  sessionId?: string | null;
  /** Deprecated: legacy ask MCP gateway is disabled; kept for older callers. */
  askMcpGatewayPort?: number | null;
  workflowRoot?: string | null;
  readOnlyTools?: boolean;
}

async function buildAgentDispatch(options: DispatchOptions): Promise<DispatchResult> {
  const workflowRoot: string = path.resolve(
    options?.workflowRoot || resolveWorkflowRoot(import.meta.dirname),
  );
  const registry = loadAgentRegistry({ workflowRoot }) as unknown as Registry;
  const route = options.failureKind && !options.agentId ? routeRepair(registry as unknown as Parameters<typeof routeRepair>[0], options.failureKind) : null;
  const agentId: string | undefined = options.agentId || (route && route.agentId) || undefined;
  const agent: AgentConfig | null = agentId ? getAgentConfig(registry as unknown as Parameters<typeof getAgentConfig>[0], agentId) : null;
  const generatedAt: string = new Date().toISOString();
  const sessionId: string = options.sessionId || makeSessionId(generatedAt, agentId || "unrouted");
  const task = buildTask(options, workflowRoot);
  const productLanguage = normalizeProductLanguage(options.productLanguage);

  if (!agent) {
    return {
      status: "blocked",
      generatedAt,
      sessionId,
      workflowRoot,
      route,
      task,
      blocker: agentId
        ? `Unknown agent: ${agentId}`
        : "No --agent was supplied and --failure-kind did not resolve to an agent.",
      nextActions: ["Pass --agent <id>, or configure agents/registry.yaml workflow.repairRoutes."]
    };
  }

  const executionEngine: AgentExecutionEngine = options.executionEngine || defaultEngine();
  const executableOverride = resolveExecutableOverride(executionEngine, options.agentExecutionSettings || null);
  const bindingKey = resolveBindingStorageKey(executionEngine);
  const settingsBinding = options.agentExecutionSettings?.bindings?.[bindingKey] || null;
  const sessionBinding = resolveSessionBinding({
    providerId: options.providerId,
    modelId: options.modelId,
    profileId: options.profileId,
    settingsBinding,
  });
  const bindingModelId = sessionBinding?.modelId || null;

  let profileId: string | null = null;
  let profile: ProfileConfig | null = null;
  let profileBlocker: string | null = null;
  if (usesOpencodeProviderBinding(executionEngine)) {
    // opencode path: drive the runtime straight from the selected provider/model binding.
    const providerId = sessionBinding?.providerId || null;
    const modelId = sessionBinding?.modelId || null;
    if (!providerId || !modelId) {
      profileBlocker = backendText(
        'dispatch.noProviderOrModel',
        productLanguage,
      );
    } else {
      const document = await providerRegistry.loadDocument(workflowRoot);
      const providerRecord = document.providers[providerId] || null;
      const envCheck = materializeOpencodeEnv(providerRecord, { modelId });
      if (envCheck.blocker || !providerRecord) {
        profileBlocker = envCheck.blocker;
      } else {
        profile = buildEphemeralOpencodeProfile(providerRecord, providerId, modelId) as unknown as ProfileConfig;
        profileId = `opencode:${providerId}:${modelId}`;
      }
    }
  } else {
    const profileResolution = resolveAgentProfile({
      executionEngine,
      profileId: options.profileId || null,
      agent,
      profiles: registry.profiles,
      agentExecutionSettings: options.agentExecutionSettings || null,
    });
    profileId = profileResolution.profileId;
    profile = profileResolution.profile as ProfileConfig | null;
    profileBlocker = profileResolution.blocker;
  }
  const credentialBlocker: string | null = null;
  const knowledgeContext: KnowledgeContext = profileBlocker ? {
    status: "skipped",
    mode: "off",
    reason: "profile-blocked"
  } : await prepareKnowledgeContext({
    workflowRoot,
    agentId: agent.id,
    task,
    projectId: options.projectId,
    contextMode: options.contextMode,
    skipKnowledgeRefresh: options.skipKnowledgeRefresh,
    outDir: options.knowledgeContextOutDir,
    signal: options.signal,
    taskId: options.preparationTaskId || sessionId,
    onProgress: options.onPreparationProgress
  });
  // Multi-turn recall: memory resolves every turn. Fresh sessions get the full preamble
  // (profile + index + bodies); continuations get only the newly-surfaced bodies, excluding
  // topics already surfaced earlier in this conversation (passed in via options.alreadySurfaced).
  const isFreshSession = !options.opencodeSessionId?.trim() && !task.conversationHistory?.trim();
  const memory = await resolveMemoryPreamble({
    workflowRoot,
    projectPath: task.project,
    taskIntent: task.intent || "",
    mode: isFreshSession ? "full" : "incremental",
    alreadySurfaced: options.alreadySurfaced || [],
    // Preview/dry-run (execute === false) skips the recall side-query: its result would be
    // discarded and the real execution turn recalls again. Anything but an explicit false
    // (i.e. execute true/undefined) keeps the default recall behavior.
    runRecall: options.execute !== false,
    signal: options.signal,
  });
  const memoryPreamble = memory.preamble;
  const surfacedMemorySlugs = memory.surfacedSlugs;
  const userPrompt = renderOpencodeUserPrompt({
    task,
    productLanguage,
    registry,
    agent,
    profileId,
    knowledgeContext,
    workflowRoot,
    opencodeSessionId: options.opencodeSessionId ?? null,
    planFilePath: options.planFilePath ?? null,
    currentProgressPreamble: options.currentProgressPreamble ?? null,
    memoryPreamble,
  });
  const runtimeCommand: RuntimeCommand | null = profile && knowledgeContext.status !== "blocked"
    ? buildRuntimeCommand(profile, executionEngine, {
        userPrompt,
        project: options.project,
        files: task.files,
        thinkingLevel: options.thinkingLevel || null,
        opencodeSessionId: options.opencodeSessionId || null,
        executableOverride,
        bindingModelId,
        sessionId,
        askMcpGatewayPort: null,
        workflowRoot,
        readOnlyTools: Boolean(options.readOnlyTools),
      })
    : null;
  const runtimeReadinessBlocker: string | null = profile && knowledgeContext.status !== "blocked" && !runtimeCommand
    ? resolveRuntimeReadinessBlocker(executionEngine, workflowRoot)
    : null;
  const blocker: string | null = profileBlocker
    || credentialBlocker
    || knowledgeContext.blocker
    || runtimeReadinessBlocker
    || (runtimeCommand ? null : profile
      ? `Unsupported profile runtime: ${profile.runtime || "(none)"} for engine ${executionEngine}.`
      : null);

  return {
    status: blocker ? "blocked" : options.execute ? "pending" : "prepared",
    generatedAt,
    sessionId,
    workflowRoot,
    registryPath: registry.registryPath,
    route,
    task,
    productLanguage,
    agent: summarizeAgentForTrace(agent as unknown as Parameters<typeof summarizeAgentForTrace>[0]) as unknown as SummarizedAgent,
    executionEngine,
    profileId,
    sessionBinding,
    profile: summarizeDispatchProfile(profile),
    knowledgeContext,
    prompt: {
      system: "",
      user: userPrompt
    },
    execution: {
      requested: Boolean(options.execute),
      timeoutMs: options.timeoutMs || DEFAULT_AGENT_TIMEOUT_MS,
      command: runtimeCommand
    },
    blocker,
    planFilePath: options.planFilePath || null,
    surfacedMemorySlugs,
    nextActions: options.execute
      ? []
      : ["This was prepared without execution. Start a desktop opencode session to execute it."]
  };
}

async function executeAgentDispatch(dispatch: DispatchResult, options: DispatchOptions): Promise<DispatchResult> {
  if (!dispatch || dispatch.status === "blocked") return dispatch;
  if (!dispatch.profile || !dispatch.execution || !dispatch.execution.command) {
    return {
      ...dispatch,
      status: "blocked",
      blocker: dispatch.blocker || "Cannot execute because no backend command was built."
    };
  }

  let envInfo: RuntimeEnvResult;
  try {
    envInfo = await buildRuntimeEnv(
      dispatch.profile,
      dispatch.workflowRoot,
      dispatch.executionEngine || defaultEngine(),
      dispatch.sessionBinding
        || options.agentExecutionSettings?.bindings?.[resolveBindingStorageKey(dispatch.executionEngine || defaultEngine())]
        || null,
      options.thinkingLevel || null,
    );
  } catch (err) {
    return {
      ...dispatch,
      status: "blocked",
      blocker: err instanceof Error ? err.message : String(err),
    };
  }
  const command = dispatch.execution.command;
  const agentCwd: string = resolveAgentCwd(dispatch);
  const spawnEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...envInfo.env,
    ...buildAgentScopeEnv(dispatch, agentCwd),
    ...buildTaskListEnv(dispatch),
    AIWF_AGENT_ID: (dispatch.agent && dispatch.agent.id) || process.env.AIWF_AGENT_ID || "",
    AIWF_SESSION_ID: dispatch.sessionId || process.env.AIWF_SESSION_ID || ""
  };
  if (command.streamFormat === "opencode-sse") {
    const executable = resolveExecutable(command.command, spawnEnv);
    try {
      const opencodeConfig = await resolveOpencodeConfig(dispatch);
      const providerId = dispatch.sessionBinding?.providerId || String(dispatch.profile.provider || "");
      const modelId = dispatch.sessionBinding?.modelId || String(dispatch.profile.model || "");
      const timeoutMs = options.timeoutMs || dispatch.execution.timeoutMs || 600000;
      options.onOpencodeRunContext?.({
        workflowRoot: dispatch.workflowRoot,
        cwd: agentCwd,
        providerId,
        modelId,
        env: { ...spawnEnv },
        config: opencodeConfig,
        timeoutMs,
      });
      const result = await runOpencodeSession({
        workflowRoot: dispatch.workflowRoot,
        cwd: agentCwd,
        prompt: command.stdin || dispatch.prompt?.user || "",
        sessionId: dispatch.sessionId,
        opencodeSessionId: options.opencodeSessionId || null,
        providerId,
        modelId,
        env: spawnEnv,
        config: opencodeConfig,
        timeoutMs,
        productLanguage: dispatch.productLanguage,
        signal: options.signal,
      }, () => {});
      return recordAgentRunBestEffort({
        ...dispatch,
        status: result.status === "pass" ? "pass" : "blocked",
        execution: {
          ...dispatch.execution,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          exitCode: null,
          signal: null,
          error: result.blocker,
          timedOut: result.status === "timeout",
          executable,
          envFile: envInfo.envFile ?? null,
          envKeysApplied: envInfo.keys,
        },
        backendOutput: {
          stdout: result.stdout,
          stderr: result.stderr,
          rawStdout: "",
        },
        blocker: result.blocker,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return recordAgentRunBestEffort({
        ...dispatch,
        status: "blocked",
        blocker: message,
        execution: { ...dispatch.execution, error: message, executable },
        backendOutput: { stdout: "", stderr: `${message}\n`, rawStdout: "" },
      });
    }
  }
  return recordAgentRunBestEffort({
    ...dispatch,
    status: "blocked",
    execution: {
      ...dispatch.execution,
      error: "unsupported stream format",
      envFile: envInfo.envFile ?? null,
      envKeysApplied: envInfo.keys
    },
    backendOutput: {
      stdout: "",
      stderr: "Unsupported agent stream format; opencode-sse is required.\n",
      rawStdout: ""
    },
    blocker: "Unsupported agent stream format; opencode-sse is required.",
  });
}

async function resolveOpencodeConfig(dispatch: DispatchResult): Promise<Record<string, unknown>> {
  const binding = dispatch.sessionBinding;
  const providerId = binding?.providerId || String(dispatch.profile?.provider || "").trim();
  const modelId = binding?.modelId || String(dispatch.profile?.model || "").trim();
  if (!providerId || !modelId) {
    throw new Error(backendText(
      'dispatch.missingProviderOrModel',
      normalizeProductLanguage(dispatch.productLanguage),
    ));
  }
  const document = await providerRegistry.loadDocument(dispatch.workflowRoot);
  const provider = document.providers[providerId] || null;
  if (!provider) {
    throw new Error(backendText(
      'dispatch.providerNotFound',
      normalizeProductLanguage(dispatch.productLanguage),
      { providerId },
    ));
  }
  return buildOpencodeRuntimeConfig({
    workflowRoot: dispatch.workflowRoot,
    providerId,
    modelId,
    provider,
    productLanguage: dispatch.productLanguage,
    memoryEnabled: readMemorySettings().enabled,
  });
}

function startOpencodeDispatchProcess(
  dispatch: DispatchResult,
  options: DispatchOptions = {},
  onEvent: (event: RuntimeEvent) => void = () => {},
): DispatchProcessHandle {
  let stopped = false;
  const controller = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
  }
  const promise = new Promise<DispatchResult>(async (resolve) => {
    let envInfo: RuntimeEnvResult;
    try {
      envInfo = await buildRuntimeEnv(
        dispatch.profile!,
        dispatch.workflowRoot,
        dispatch.executionEngine || defaultEngine(),
        dispatch.sessionBinding
          || options.agentExecutionSettings?.bindings?.[resolveBindingStorageKey(dispatch.executionEngine || defaultEngine())]
          || null,
        options.thinkingLevel || null,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve(recordAgentRunBestEffort({
        ...dispatch,
        status: "blocked",
        blocker: message,
        execution: { ...dispatch.execution!, error: message },
      }));
      return;
    }

    const command = dispatch.execution!.command!;
    const agentCwd = resolveAgentCwd(dispatch);
    const spawnEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...envInfo.env,
      ...buildAgentScopeEnv(dispatch, agentCwd),
      ...buildTaskListEnv(dispatch),
      AIWF_AGENT_ID: (dispatch.agent && dispatch.agent.id) || process.env.AIWF_AGENT_ID || "",
      AIWF_SESSION_ID: dispatch.sessionId || process.env.AIWF_SESSION_ID || "",
    };

    try {
      const opencodeConfig = await resolveOpencodeConfig(dispatch);
      const providerId = dispatch.sessionBinding?.providerId || String(dispatch.profile?.provider || "");
      const modelId = dispatch.sessionBinding?.modelId || String(dispatch.profile?.model || "");
      const timeoutMs = options.timeoutMs || dispatch.execution!.timeoutMs || 600000;
      options.onOpencodeRunContext?.({
        workflowRoot: dispatch.workflowRoot,
        cwd: agentCwd,
        providerId,
        modelId,
        env: { ...spawnEnv },
        config: opencodeConfig,
        timeoutMs,
      });
      const result = await runOpencodeSession({
        workflowRoot: dispatch.workflowRoot,
        cwd: agentCwd,
        prompt: command.stdin || dispatch.prompt?.user || "",
        sessionId: dispatch.sessionId,
        opencodeSessionId: options.opencodeSessionId || null,
        providerId,
        modelId,
        env: spawnEnv,
        config: opencodeConfig,
        timeoutMs,
        productLanguage: dispatch.productLanguage,
        signal: controller.signal,
      }, onEvent);
      const finalStatus = result.status === "pass" ? "pass" : stopped ? "stopped" : "blocked";
      resolve(recordAgentRunBestEffort({
        ...dispatch,
        status: finalStatus,
        execution: {
          ...dispatch.execution!,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          exitCode: null,
          signal: stopped ? "SIGTERM" : null,
          error: result.blocker,
          timedOut: result.status === "timeout",
          executable: result.executable,
          envFile: envInfo.envFile ?? null,
          envKeysApplied: envInfo.keys,
        },
        backendOutput: {
          stdout: result.stdout,
          stderr: result.stderr,
          rawStdout: "",
        },
        blocker: result.blocker,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: "stderr", text: `${message}\n`, at: new Date().toISOString() });
      onEvent({ type: "status", status: "blocked", blocker: message, at: new Date().toISOString() });
      resolve(recordAgentRunBestEffort({
        ...dispatch,
        status: "blocked",
        blocker: message,
        execution: { ...dispatch.execution!, error: message },
        backendOutput: {
          stdout: "",
          stderr: `${message}\n`,
          rawStdout: "",
        },
      }));
    }
  });

  return {
    promise,
    stop: () => {
      stopped = true;
      controller.abort(new Error("opencode session stopped"));
    },
  };
}

function startAgentDispatchProcess(dispatch: DispatchResult, options: DispatchOptions = {}, onEvent: (event: RuntimeEvent) => void = () => {}): DispatchProcessHandle {
  if (!dispatch || dispatch.status === "blocked") {
    return {
      promise: Promise.resolve(dispatch),
      stop: () => {}
    };
  }
  if (!dispatch.profile || !dispatch.execution || !dispatch.execution.command) {
    const blocked: DispatchResult = {
      ...dispatch,
      status: "blocked",
      blocker: dispatch.blocker || "Cannot execute because no backend command was built."
    };
    return {
      promise: Promise.resolve(blocked),
      stop: () => {}
    };
  }
  if (dispatch.execution.command.streamFormat === "opencode-sse") {
    return startOpencodeDispatchProcess(dispatch, options, onEvent);
  }
  const blocked = recordAgentRunBestEffort({
    ...dispatch,
    status: "blocked",
    blocker: `Unsupported agent stream format: ${dispatch.execution.command.streamFormat || "(none)"}. opencode-sse is required.`,
    execution: {
      ...dispatch.execution,
      error: "unsupported stream format",
    },
  });
  return {
    promise: Promise.resolve(blocked),
    stop: () => {},
  };
}

// Agent 运行目录隔离：cwd 设为 RMMV 游戏工程，让 agent 把“项目”识别为游戏本身。
// 无有效项目目录时回退产品根，保持原行为。
function resolveAgentCwd(dispatch: DispatchResult): string {
  const projectPath: string | null = dispatch.task ? dispatch.task.project : null;
  try {
    if (projectPath && fs.statSync(projectPath).isDirectory()) return projectPath;
  } catch {
    // 项目路径不存在/不可读时回退。
  }
  return dispatch.workflowRoot;
}

// opencode 与 MCP server 需要定位 workflowRoot；cwd 改到游戏目录后，
// 通过环境变量把工作流根与游戏目录告知 agent。正斜杠归一，Node 接受正斜杠路径。
function buildAgentScopeEnv(dispatch: DispatchResult, agentCwd: string): Record<string, string> {
  const productRoot = dispatch.workflowRoot.replace(/\\/g, "/");
  const installRoot = resolveShippedPath(dispatch.workflowRoot, ".").replace(/\\/g, "/");
  const env: Record<string, string> = {
    AGENT_RPG_ROOT: productRoot,
    AGENT_RPG_INSTALL_ROOT: installRoot,
    AIWF_WORKFLOW_ROOT: productRoot,
    AIWF_PROJECT_DIR: agentCwd.replace(/\\/g, "/"),
    ...buildAgentOutputEnv(dispatch.workflowRoot),
  };
  const planFilePath = String(dispatch.planFilePath || "").trim();
  if (planFilePath) env.AGENT_RPG_SESSION_PLAN_PATH = planFilePath;
  return env;
}

/**
 * 让 opencode 的待办任务（TaskCreate/TaskList/TaskUpdate）在非交互会话下可用，
 * 并把任务列表锚定到桌面 session id——这样后端能确定性定位会话任务状态
 * 做人工回写（勾选完成 / 删除），与 agent 自身的写入指向同一目录。
 * 非 opencode 引擎不需要这些。
 */
function buildTaskListEnv(dispatch: DispatchResult): Record<string, string> {
  void dispatch;
  return {};
}

function resolveExecutable(command: string, env: Record<string, string>): string {
  if (!command || process.platform !== "win32") return command;
  if (/[\\/]/.test(command) || path.extname(command)) return command;
  const pathEntries: string[] = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const extensions: string[] = [".cmd", ".exe", ".bat", ".ps1", ""];
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate: string = path.join(entry, `${command}${extension}`);
      if (fs.existsSync(candidate)) {
        if (/\.cmd$/i.test(candidate)) {
          const shimTarget: string | null = resolveWindowsCmdShim(candidate);
          if (shimTarget) return shimTarget;
        }
        return candidate;
      }
    }
  }
  return command;
}

function resolveWindowsCmdShim(filePath: string): string | null {
  try {
    const text: string = fs.readFileSync(filePath, "utf8");
    const match = text.match(/"%dp0%\\([^"]+\.exe)"/i);
    if (!match) return null;
    const target: string = path.join(path.dirname(filePath), match[1]);
    return fs.existsSync(target) ? target : null;
  } catch (e) {
    console.warn('[agent-dispatch] Failed to read cmd shim:', filePath, e);
    return null;
  }
}

function writeAgentDispatchOutputs(dispatch: DispatchResult, outDir: string): PathResult {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath: string = path.join(outDir, "agent-dispatch.json");
  const mdPath: string = path.join(outDir, "agent-dispatch.md");
  writeJson(jsonPath, stripLargeRuntimeText(dispatch));
  fs.writeFileSync(mdPath, renderDispatchMarkdown(dispatch), "utf8");
  if (dispatch.backendOutput) {
    fs.writeFileSync(path.join(outDir, "stdout.txt"), dispatch.backendOutput.stdout || "", "utf8");
    fs.writeFileSync(path.join(outDir, "stderr.txt"), dispatch.backendOutput.stderr || "", "utf8");
    if (dispatch.backendOutput.rawStdout) fs.writeFileSync(path.join(outDir, "raw-stdout.txt"), dispatch.backendOutput.rawStdout, "utf8");
  }
  fs.writeFileSync(path.join(outDir, "prompt.txt"), `${dispatch.prompt && dispatch.prompt.system || ""}\n\n${dispatch.prompt && dispatch.prompt.user || ""}`, "utf8");
  return { jsonPath, mdPath };
}

function recordAgentRunBestEffort(dispatch: DispatchResult): DispatchResult {
  return {
    ...dispatch,
    agentRunRecord: {
      status: "blocked",
      error: "GraphRAG/knowledge-db run records have been removed.",
    },
  };
}

function buildTask(options: DispatchOptions, workflowRoot?: string): Task {
  return {
    intent: options.intent || null,
    project: options.project
      ? (workflowRoot ? path.resolve(workflowRoot, options.project) : path.resolve(options.project))
      : null,
    mapId: options.mapId || null,
    failureKind: options.failureKind || null,
    taskId: options.taskId || null,
    files: (options.files || []).map((filePath: string) => path.resolve(filePath)),
    conversationHistory: options.conversationHistory || null,
  };
}

function buildRuntimeCommand(
  profile: ProfileConfig,
  engine: AgentExecutionEngine,
  context: BuildRuntimeCommandContext,
): RuntimeCommand | null {
  return buildRuntimeCommandForEngine(engine, profile, context);
}

async function buildRuntimeEnv(
  profile: ProfileConfig,
  workflowRoot: string,
  engine: AgentExecutionEngine = defaultEngine(),
  binding: EngineProviderBindingLike | null = null,
  thinkingLevel: string | null | undefined = null,
): Promise<RuntimeEnvResult> {
  const base = await buildRuntimeEnvForEngine(engine, profile, workflowRoot);
  if (!usesOpencodeProviderBinding(engine) || !binding?.providerId) {
    return base;
  }
  void thinkingLevel;
  try {
    const document = await providerRegistry.loadDocument(workflowRoot);
    const provider = document.providers[binding.providerId] || null;
    const opencode = materializeOpencodeEnv(provider, { modelId: binding.modelId });
    if (opencode.blocker) {
      return base;
    }
    const env = { ...base.env, ...opencode.env };
    const keys = [...new Set([...base.keys, ...opencode.envKeys])];
    return { ...base, env, keys };
  } catch {
    return base;
  }
}

interface OpencodeUserPromptContext extends UserPromptContext {
  opencodeSessionId?: string | null;
  planFilePath?: string | null;
  /** Current progress injected only after compression-style continuation. */
  currentProgressPreamble?: string | null;
  /** Pre-resolved durable-memory preamble (async + DB-backed); "" ⇒ nothing to inject. */
  memoryPreamble?: string | null;
}

function isOpencodeContinuation(context: OpencodeUserPromptContext): boolean {
  if (context.opencodeSessionId?.trim()) return true;
  return Boolean(context.task.conversationHistory?.trim());
}

/** opencode: rules, skills, and product instructions are loaded by native instruction/skill config; user prompt only carries the task. */
export function renderOpencodeUserPrompt(context: OpencodeUserPromptContext): string {
  const intent = context.task.intent || "Prepare a concise status report for this agent.";
  const lines: string[] = [];
  if (context.task.conversationHistory?.trim() && !context.opencodeSessionId?.trim()) {
    lines.push(backendText('dispatch.conversationHistoryHeader', AGENT_PROMPT_LANGUAGE));
    lines.push(context.task.conversationHistory);
    lines.push("");
  }
  const currentProgress = (context.currentProgressPreamble || "").trim();
  if (currentProgress) {
    lines.push("## Current Progress");
    lines.push(currentProgress);
    lines.push("");
  }
  // Durable-memory preamble: full on a fresh session, incremental (newly-recalled bodies only)
  // on continuations. Resolved upstream (async, DB-backed: master switch + recall) per mode and
  // passed in; "" ⇒ inject nothing. Placed after conversation history, before the task labels.
  const memoryPreamble = (context.memoryPreamble || "").trim();
  if (memoryPreamble) {
    lines.push(memoryPreamble);
    lines.push("");
  }
  if (!isOpencodeContinuation(context)) {
    if (context.task.project) {
      lines.push(`${backendText('prompt.projectLabel', AGENT_PROMPT_LANGUAGE)}: ${context.task.project}`);
    }
    if (context.task.mapId) {
      lines.push(`${backendText('prompt.mapIdLabel', AGENT_PROMPT_LANGUAGE)}: ${context.task.mapId}`);
    }
  }
  const planLines = buildSessionPlanPathPromptLines(String(context.planFilePath || ""));
  if (planLines.length > 0) lines.push(...planLines);
  if (lines.length > 0) lines.push("");
  lines.push(`${backendText('prompt.taskLabel', AGENT_PROMPT_LANGUAGE)}:`);
  lines.push(intent);
  return lines.join("\n");
}

function renderDispatchMarkdown(dispatch: DispatchResult): string {
  const lines: string[] = [];
  lines.push("# Agent Dispatch");
  lines.push("");
  lines.push(`- Status: ${dispatch.status}`);
  lines.push(`- Agent: ${dispatch.agent && dispatch.agent.id || "(none)"}`);
  lines.push(`- Profile: ${dispatch.profileId || "(none)"}`);
  lines.push(`- Generated: ${dispatch.generatedAt}`);
  lines.push(`- Session: ${dispatch.sessionId}`);
  if (dispatch.task && dispatch.task.project) lines.push(`- Project: ${dispatch.task.project}`);
  if (dispatch.task && dispatch.task.mapId) lines.push(`- Map: ${dispatch.task.mapId}`);
  if (dispatch.task && dispatch.task.intent) lines.push(`- Intent: ${dispatch.task.intent}`);
  if (dispatch.blocker) lines.push(`- Blocker: ${dispatch.blocker}`);
  if (dispatch.knowledgeContext) {
    lines.push("");
    lines.push("## GraphRAG Context");
    lines.push("");
    lines.push(`- Mode: ${dispatch.knowledgeContext.mode || "(none)"}`);
    lines.push(`- Status: ${dispatch.knowledgeContext.status || "(none)"}`);
    if (dispatch.knowledgeContext.projectId) lines.push(`- Project id: ${dispatch.knowledgeContext.projectId}`);
    if (dispatch.knowledgeContext.markdownPath) lines.push(`- Markdown: ${dispatch.knowledgeContext.markdownPath}`);
    if (dispatch.knowledgeContext.jsonPath) lines.push(`- JSON: ${dispatch.knowledgeContext.jsonPath}`);
    if (dispatch.knowledgeContext.summary) {
      const summary = dispatch.knowledgeContext.summary as Record<string, unknown>;
      lines.push(`- Summary: nodes=${summary.nodes || 0}; graphNodes=${summary.graphNodeCount || summary.nodes || 0}; eventPages=${summary.eventPageCount || 0}; edges=${summary.edges || 0}; slots=${summary.slots || 0}; chunks=${summary.chunks || 0}; diagnostics=${summary.diagnostics || 0}; warnings=${summary.warningDiagnostics || 0}; critical=${summary.criticalDiagnostics || 0}`);
    }
    if (dispatch.knowledgeContext.blocker) lines.push(`- Blocker: ${dispatch.knowledgeContext.blocker}`);
    if (dispatch.knowledgeContext.warning) lines.push(`- Warning: ${dispatch.knowledgeContext.warning}`);
  }
  lines.push("");
  lines.push("## Backend");
  lines.push("");
  if (dispatch.execution && dispatch.execution.command) {
    lines.push(`- Command: ${dispatch.execution.command.display}`);
    lines.push(`- Execute requested: ${dispatch.execution.requested ? "yes" : "no"}`);
    if (typeof dispatch.execution.exitCode === "number") lines.push(`- Exit code: ${dispatch.execution.exitCode}`);
    if (dispatch.execution.envKeysApplied) lines.push(`- Env keys applied: ${dispatch.execution.envKeysApplied.join(", ") || "(none)"}`);
  } else {
    lines.push("- Command: (none)");
  }
  if (dispatch.nextActions && dispatch.nextActions.length) {
    lines.push("");
    lines.push("## Next Actions");
    lines.push("");
    for (const action of dispatch.nextActions) lines.push(`- ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

function summarizeDispatchProfile(profile: ProfileConfig | null): SummarizedProfile | null {
  if (!profile) return null;
  return {
    runtime: profile.runtime || null,
    provider: profile.provider || undefined,
    protocol: profile.protocol || undefined,
    model: profile.model || undefined,
    baseUrl: profile.baseUrl || null,
    envFileHint: profile.envFileHint || null,
    apiKeyEnv: profile.apiKeyEnv || null,
    modelEnv: profile.modelEnv || null,
    baseUrlEnv: profile.baseUrlEnv || null,
    mapsToRuntimeEnv: profile.mapsToRuntimeEnv || {},
    tools: profile.tools || []
  };
}

function stripLargeRuntimeText(dispatch: DispatchResult): DispatchResult {
  const copy: DispatchResult = JSON.parse(JSON.stringify(dispatch));
  if (copy.prompt) {
    copy.prompt.system = summarizeText(copy.prompt.system);
    copy.prompt.user = summarizeText(copy.prompt.user);
  }
  if (copy.knowledgeContext) {
    if (copy.knowledgeContext.markdown) copy.knowledgeContext.markdown = summarizeText(copy.knowledgeContext.markdown);
    if (copy.knowledgeContext.commands) {
      copy.knowledgeContext.commands = copy.knowledgeContext.commands.map((command: DockerCommandResult) => ({
        ...command,
        stdout: summarizeText(command.stdout || ""),
        stderr: summarizeText(command.stderr || "")
      }));
    }
  }
  if (copy.execution && copy.execution.command && copy.execution.command.args) {
    copy.execution.command.args = copy.execution.command.args.map((arg: string) => arg && arg.length > 200 ? `${arg.slice(0, 200)}... <truncated>` : arg);
  }
  if (copy.backendOutput) {
    copy.backendOutput = {
      stdout: "stdout.txt",
      stderr: "stderr.txt",
      rawStdout: copy.backendOutput.rawStdout ? "raw-stdout.txt" : ""
    };
  }
  return copy;
}

function summarizeText(text: string): string {
  if (!text || text.length <= 2000) return text || "";
  return `${text.slice(0, 2000)}\n... <truncated; see prompt.txt>`;
}

function makeSessionId(iso: string, agentId: string): string {
  return `${iso.replace(/[-:.TZ]/g, "").slice(0, 14)}-${agentId}`;
}

export {
  buildAgentDispatch,
  executeAgentDispatch,
  startAgentDispatchProcess,
  writeAgentDispatchOutputs,
  buildRuntimeCommand,
  buildRuntimeEnv,
};
export type { AgentExecutionEngine, AgentExecutionSettingsLike } from "./runtime-adapters/index.ts";
