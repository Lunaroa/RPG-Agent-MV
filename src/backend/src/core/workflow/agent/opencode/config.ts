import path from "node:path";

import type { ProviderRecord } from "../../../llm/provider-registry.ts";
import {
  buildOpencodeToolPolicyFromAgentAllow,
  hasEnabledRmmvMcpTools,
} from "../agent-capabilities.ts";
import {
  resolveAgentNodeCommand,
} from "../../../workspace-paths.ts";

const RMMV_MCP_SERVER_PATH = "src/backend/src/core/rmmv/rmmv-mcp-server.ts";

export interface OpencodeRuntimeConfigInput {
  workflowRoot: string;
  providerId: string;
  modelId: string;
  provider: ProviderRecord;
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
  return baseUrl;
}

function buildProviderConfig(
  providerId: string,
  provider: ProviderRecord,
  modelId: string,
): Record<string, unknown> {
  const baseUrl = providerBaseUrlForOpencode(providerId, provider);
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
      [modelId]: {
        id: modelId,
        name: modelId,
        tool_call: true,
        reasoning: true,
      },
    },
  };
}

export function buildOpencodeRmmvMcpConfig(workflowRoot: string, enabled = true): Record<string, unknown> {
  const rmmvServerPath = path.resolve(workflowRoot, RMMV_MCP_SERVER_PATH);
  return {
    type: "local",
    command: [
      resolveAgentNodeCommand(workflowRoot),
      "--experimental-strip-types",
      rmmvServerPath,
    ],
    environment: {
      AGENT_RPG_ROOT: workflowRoot,
      AIWF_WORKFLOW_ROOT: workflowRoot,
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
  if (!providerId) throw new Error("缺少 opencode 供应商 ID。");
  if (!modelId) throw new Error("缺少 opencode 模型 ID。");
  if (!String(input.provider.baseUrl || "").trim()) {
    throw new Error(`供应商「${input.provider.label || providerId}」缺少接口地址（Base URL）。`);
  }
  const rmmvMcpEnabled = hasEnabledRmmvMcpTools(workflowRoot);

  return {
    model: `${providerId}/${modelId}`,
    provider: {
      [providerId]: buildProviderConfig(providerId, input.provider, modelId),
    },
    tools: buildOpencodeToolPolicyFromAgentAllow(workflowRoot),
    mcp: {
      rmmv: buildOpencodeRmmvMcpConfig(workflowRoot, rmmvMcpEnabled),
    },
  };
}
