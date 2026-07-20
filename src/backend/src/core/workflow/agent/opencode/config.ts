import path from "node:path";

import type { ProviderRecord } from "../../../llm/provider-registry.ts";
import type { ProductLanguage } from "../../../../../../contract/types.ts";
import { normalizeProductLanguage } from "../../../../../../contract/i18n.ts";
import { backendText } from "../../../i18n/messages.ts";
import {
  buildOpencodeToolPolicyFromAgentAllow,
  type AgentProjectToolState,
} from "../agent-capabilities.ts";
import {
  resolveAgentNodeCommand,
  resolveShippedPath,
  resolveShippedRoot,
} from "../../../workspace-paths.ts";

const RMMV_MCP_SERVER_PATH = "src/backend/src/core/rmmv/rmmv-mcp-server.ts";

/** MCP tool id for the agent's durable-memory write tool (see config/capabilities/tool-manifest.json). */
const RMMV_MEMORY_TOOL_ID = "rmmv_RmmvMemory";

/**
 * opencode agent name for the sandboxed background memory extractor (Phase 2c).
 * Forked turns run under this agent so the scribe can ONLY touch durable memory.
 */
export const MEMORY_SCRIBE_AGENT = "memory-scribe";

/**
 * Build the sandboxed `memory-scribe` agent config: every tool hard-denied except the
 * durable-memory write tool, plus permission denies as a second layer. The scribe forks
 * the live conversation to distill memories — it must never read/edit/run anything in the
 * real game project, so the sandbox is enforced here, not via prompt instructions.
 */
function buildMemoryScribeAgentConfig(toolKeys: string[]): Record<string, unknown> {
  const tools: Record<string, boolean> = {};
  for (const key of toolKeys) tools[key] = false;
  tools[RMMV_MEMORY_TOOL_ID] = true;
  return {
    mode: "all",
    description: "Sandboxed background extractor that distills durable memories from a forked conversation.",
    tools,
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "deny",
      external_directory: "deny",
    },
  };
}

export interface OpencodeRuntimeConfigInput {
  workflowRoot: string;
  providerId: string;
  modelId: string;
  provider: ProviderRecord;
  productLanguage?: ProductLanguage | null;
  /** Master memory switch. When false, the memory write tool is hard-removed from the policy. */
  memoryEnabled?: boolean;
  /**
   * Read-only session (isolated workflow subagents). Every non-read-only tool is hard-disabled
   * and the builtin edit/bash/network/external-directory capabilities are permission-denied, so a
   * read-only subagent can never mutate the game project, place events, or spawn further subagents.
   */
  readOnlyTools?: boolean;
  imageInputRequired?: boolean;
  projectState?: AgentProjectToolState;
  projectDirectory?: string | null;
  projectBindingVersion?: number;
  privateRuntime?: {
    engine: string;
    executable: string;
    runtimeRoot: string;
    source: string;
    launchStyle: string;
  };
  runtimeReason?: "missing" | "invalid" | null;
  sessionId?: string | null;
}

function normalizeProviderId(providerId: string): string {
  return String(providerId || "").trim();
}

function normalizeModelId(modelId: string): string {
  return String(modelId || "").trim();
}

function providerNpmForOpencode(provider: ProviderRecord): string {
  return provider.protocol === "openai-compatible"
    ? "@ai-sdk/openai-compatible"
    : "@ai-sdk/anthropic";
}

function providerEnvForOpencode(provider: ProviderRecord): string[] {
  return provider.protocol === "openai-compatible"
    ? ["OPENAI_API_KEY"]
    : [String(provider.opencodeAuth?.envVar || "ANTHROPIC_API_KEY")];
}

function providerBaseUrlForOpencode(providerId: string, provider: ProviderRecord): string {
  const baseUrl = String(provider.baseUrl || "").trim().replace(/\/+$/, "");
  if (provider.protocol === "anthropic" && providerId === "zhipu-glm" && baseUrl === "https://open.bigmodel.cn/api/anthropic") {
    return `${baseUrl}/v1`;
  }
  if (providerId === "deepseek" && provider.protocol === "openai-compatible" && !baseUrl.endsWith("/v1")) {
    return `${baseUrl}/v1`;
  }
  return baseUrl;
}

function buildProviderConfig(
  providerId: string,
  provider: ProviderRecord,
  modelId: string,
  imageInputRequired = false,
): Record<string, unknown> {
  const baseUrl = providerBaseUrlForOpencode(providerId, provider);
  const modelConfig = buildModelConfig(provider, modelId, imageInputRequired);
  return {
    id: providerId,
    name: provider.label || providerId,
    npm: providerNpmForOpencode(provider),
    api: baseUrl,
    env: providerEnvForOpencode(provider),
    options: {
      baseURL: baseUrl,
    },
    models: {
      [modelId]: modelConfig,
    },
  };
}

function buildModelConfig(
  provider: ProviderRecord,
  modelId: string,
  imageInputRequired: boolean,
): Record<string, unknown> {
  const model = (provider.models || []).find((entry) => {
    if (!entry) return false;
    if (typeof entry === "string") return entry === modelId;
    return String(entry.id || "") === modelId;
  });
  const label = model && typeof model === "object" && "label" in model
    ? String(model.label || modelId)
    : modelId;
  const config: Record<string, unknown> = {
    id: modelId,
    name: label,
    tool_call: true,
    reasoning: true,
  };
  const limit = model && typeof model === "object" && "limit" in model
    ? normalizeModelLimit(model.limit)
    : undefined;
  if (limit) config.limit = limit;
  const inputModalities = model && typeof model === 'object' && 'inputModalities' in model
    && Array.isArray(model.inputModalities)
    ? model.inputModalities.map(String)
    : undefined;
  if (inputModalities !== undefined || imageInputRequired) {
    config.modalities = {
      input: inputModalities ?? ['text', 'image'],
      output: ['text'],
    };
  }
  return config;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

function normalizeModelLimit(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const context = positiveInteger(record.context);
  const output = positiveInteger(record.output);
  if (!context && !output) return undefined;
  return {
    ...(context ? { context } : {}),
    ...(output ? { output } : {}),
  };
}

export function buildOpencodeRmmvMcpConfig(
  workflowRoot: string,
  enabled = true,
  productLanguage?: ProductLanguage | null,
  project?: {
    state?: AgentProjectToolState;
    directory?: string | null;
    bindingVersion?: number;
    privateRuntime?: OpencodeRuntimeConfigInput["privateRuntime"];
    runtimeReason?: OpencodeRuntimeConfigInput["runtimeReason"];
    sessionId?: string | null;
  },
): Record<string, unknown> {
  const rmmvServerPath = resolveShippedPath(workflowRoot, RMMV_MCP_SERVER_PATH);
  const installRoot = resolveShippedRoot(workflowRoot);
  return {
    type: "local",
    command: [
      resolveAgentNodeCommand(workflowRoot),
      "--experimental-strip-types",
      rmmvServerPath,
    ],
    environment: {
      AGENT_RPG_ROOT: workflowRoot,
      AGENT_RPG_INSTALL_ROOT: installRoot,
      AIWF_WORKFLOW_ROOT: workflowRoot,
      RMMV_PRODUCT_LANGUAGE: normalizeProductLanguage(productLanguage),
      ...(project?.sessionId ? {
        AIWF_SESSION_ID: project.sessionId,
        AIWF_SESSION_LOG_DIR: path.join(workflowRoot, "runtime", "sessions", project.sessionId, "agent-console"),
      } : {}),
      AIWF_PROJECT_BINDING_STATUS: project?.state || "none",
      AIWF_PROJECT_BINDING_VERSION: String(project?.bindingVersion || 0),
      ...(project?.state === "bound" && project.directory
        ? { AIWF_PROJECT_DIR: path.resolve(project.directory) }
        : {}),
      ...(project?.privateRuntime ? {
        AIWF_PROJECT_RUNTIME_ENGINE: project.privateRuntime.engine,
        AIWF_PROJECT_RUNTIME_EXECUTABLE: project.privateRuntime.executable,
        AIWF_PROJECT_RUNTIME_ROOT: project.privateRuntime.runtimeRoot,
        AIWF_PROJECT_RUNTIME_SOURCE: project.privateRuntime.source,
        AIWF_PROJECT_RUNTIME_LAUNCH_STYLE: project.privateRuntime.launchStyle,
      } : project?.state === "bound" ? {
        AIWF_PROJECT_RUNTIME_REASON: project.runtimeReason || "missing",
      } : {}),
      // command[0] 是宿主进程的 process.execPath；桌面端运行时它是 Electron 可执行文件，
      // 必须置位此变量才能让它以内置 Node 方式执行 MCP server，否则会当成应用启动而不连 stdio。
      ELECTRON_RUN_AS_NODE: "1",
    },
    enabled,
    timeout: 10000,
  };
}

/**
 * Build the dynamic portion of the opencode runtime config.
 *
 * Static config (instructions, skills.paths, synced AGENTS.md) lives in `.opencode/`
 * and is materialized from `config/opencode/` before server start. Per-session
 * dynamic fields are injected via `OPENCODE_CONFIG_CONTENT` and merged on top.
 */
export function buildOpencodeRuntimeConfig(input: OpencodeRuntimeConfigInput): Record<string, unknown> {
  const workflowRoot = path.resolve(input.workflowRoot);
  const providerId = normalizeProviderId(input.providerId);
  const modelId = normalizeModelId(input.modelId);
  if (!providerId) throw new Error(backendText('dispatch.missingProviderOrModel', input.productLanguage));
  if (!modelId) throw new Error(backendText('dispatch.missingProviderOrModel', input.productLanguage));
  if (!String(input.provider.baseUrl || "").trim()) {
    throw new Error(backendText('dispatch.providerMissingBaseUrl', input.productLanguage));
  }
  const readOnly = input.readOnlyTools === true;
  const tools = buildOpencodeToolPolicyFromAgentAllow(workflowRoot, {
    readOnly,
    projectState: input.projectState,
  });
  const rmmvMcpEnabled = Object.entries(tools).some(([id, enabled]) => id.startsWith("rmmv_") && enabled);
  // Master memory switch OFF ⇒ hard-remove the memory write tool (true off, not just hidden text).
  if (input.memoryEnabled === false) {
    tools[RMMV_MEMORY_TOOL_ID] = false;
  }

  const config: Record<string, unknown> = {
    model: `${providerId}/${modelId}`,
    provider: {
      [providerId]: buildProviderConfig(providerId, input.provider, modelId, input.imageInputRequired),
    },
    tools,
    agent: {
      [MEMORY_SCRIBE_AGENT]: buildMemoryScribeAgentConfig(Object.keys(tools)),
    },
    mcp: {
      rmmv: buildOpencodeRmmvMcpConfig(workflowRoot, rmmvMcpEnabled, input.productLanguage, {
        state: input.projectState,
        directory: input.projectDirectory,
        bindingVersion: input.projectBindingVersion,
        privateRuntime: input.privateRuntime,
        runtimeReason: input.runtimeReason,
        sessionId: input.sessionId,
      }),
    },
  };

  // Defense-in-depth alongside the tool toggles: deny the builtin mutating/network capabilities
  // outright so a read-only subagent cannot edit files, run shell commands, fetch the network, or
  // reach outside its directory even if a tool slips through the policy.
  if (readOnly) {
    config.permission = {
      edit: "deny",
      bash: "deny",
      webfetch: "deny",
      external_directory: "deny",
    };
  } else {
    // 工作流发起工具配 "ask"：agent 一调用就阻塞在 opencode 的 approvalHandler，
    // 发 permission 事件→桌面弹高危审批卡（取代对话框）→批准后才执行工具。
    // 这是 opencode 原生权限机制（同 ExitPlanMode），在 LLM 执行循环内部阻塞，不发 session.idle。
    config.permission = {
      rmmv_RmmvWorkflow: "ask",
      rmmv_RmmvDatabaseApply: "ask",
      // 危险 shell 命令按命令串粒度 deny（opencode permission 对象形态）。
      // bash 工具把整条命令串作为 pattern 送进 Permission.evaluate，Wildcard.match 全匹配，
      // 结尾 " *" 既匹配无参也匹配带参形态。放在 "*": "allow" 之后的 deny 条目由 findLast 命中。
      bash: {
        "*": "allow",
        "rm -rf *": "deny",
        "rm -rf": "deny",
        "git reset --hard *": "deny",
        "git reset --hard": "deny",
        "git checkout -- *": "deny",
        "git clean *": "deny",
      },
    };
  }

  return config;
}
