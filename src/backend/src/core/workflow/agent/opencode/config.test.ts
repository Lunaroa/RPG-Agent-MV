import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { ProviderRecord } from "../../../llm/provider-registry.ts";
import { buildOpencodeRuntimeConfig } from "./config.ts";
import { loadToolManifest } from "../agent-capabilities.ts";

const WORKFLOW_ROOT = path.resolve(import.meta.dirname, "../../../../../../..");

function provider(protocol: string, baseUrl = "https://example.invalid/api"): ProviderRecord {
  return {
    label: "Test Provider",
    protocol,
    baseUrl,
    credentialValue: "test-key",
    models: [],
    opencodeAuth: {
      enabled: true,
      envVar: "ANTHROPIC_API_KEY",
    },
  };
}

test("opencode config returns dynamic fields including agent tool policy", () => {
  const config = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
  });

  assert.equal(config.model, "zhipu-glm/glm-4.5-air");
  assert.ok(config.provider);
  assert.ok(config.mcp);
  assert.equal(typeof config.tools, "object");
  assert.equal((config.tools as Record<string, boolean>).rmmv_RmmvReadContext, true);
  assert.equal((config.tools as Record<string, boolean>).rmmv_RmmvDatabase, true);
  assert.equal((config.tools as Record<string, boolean>).rmmv_RmmvDatabaseApply, true);
  assert.equal((config.mcp as Record<string, Record<string, unknown>>).rmmv.enabled, true);
  assert.equal(config.instructions, undefined);
  assert.equal(config.skills, undefined);
  const normalPermission = config.permission as Record<string, unknown>;
  assert.equal(normalPermission.rmmv_RmmvWorkflow, "ask");
  assert.equal(normalPermission.rmmv_RmmvDatabaseApply, "ask");
  const bashRules = normalPermission.bash as Record<string, string>;
  assert.equal(bashRules["*"], "allow");
  assert.equal(bashRules["rm -rf *"], "deny");

  const scribe = (config.agent as Record<string, Record<string, unknown>>)["memory-scribe"];
  assert.ok(scribe);
  const scribeTools = scribe.tools as Record<string, boolean>;
  assert.equal(scribeTools.rmmv_RmmvMemory, true);
  for (const [tool, enabled] of Object.entries(scribeTools)) {
    if (tool === "rmmv_RmmvMemory") continue;
    assert.equal(enabled, false, `${tool} must be disabled for memory-scribe`);
  }
});

test("master memory switch OFF hard-removes the memory write tool, leaving others intact", () => {
  const base = {
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
  };
  const on = buildOpencodeRuntimeConfig(base);
  const off = buildOpencodeRuntimeConfig({ ...base, memoryEnabled: false });

  // Default (switch ON) leaves the memory tool allowed; OFF forces it false.
  assert.equal((on.tools as Record<string, boolean>).rmmv_RmmvMemory, true);
  assert.equal((off.tools as Record<string, boolean>).rmmv_RmmvMemory, false);
  // A non-memory tool is untouched by the switch.
  assert.equal((off.tools as Record<string, boolean>).rmmv_RmmvReadContext, true);
});

test("read-only session hard-disables every mutating tool but keeps read-only ones", () => {
  const config = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
    readOnlyTools: true,
  });

  const tools = config.tools as Record<string, boolean>;
  // Read-only tools stay on.
  assert.equal(tools.rmmv_RmmvReadContext, true);
  assert.equal(tools.read, true);
  assert.equal(tools.grep, true);
  // Mutating tools (project writes, event placement, file edits, shell, subagent spawn) all off.
  assert.equal(tools.rmmv_RmmvMap, false);
  assert.equal(tools.rmmv_RmmvEvent, false);
  assert.equal(tools.rmmv_RmmvMemory, false);
  assert.equal(tools.rmmv_RmmvDatabase, false);
  assert.equal(tools.rmmv_RmmvDatabaseApply, false);
  assert.equal(tools.edit, false);
  assert.equal(tools.write, false);
  assert.equal(tools.bash, false);
  assert.equal(tools.task, false);
});

test("workflow-launch tool ships default-OFF: absent from the agent allow-list, so a normal session does not grant it", () => {
  const normal = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
  });
  // Shipped config does NOT enable it — the user must opt in via the tool-capabilities toggle
  // (which pushes it into the agent allow-list). Until then it is off even for the top-level agent.
  assert.equal((normal.tools as Record<string, boolean>).rmmv_RmmvWorkflow, false);
});

test("recursion guard: even if the launch tool were enabled, read-only subagents force it OFF (it is flagged readOnly:false)", () => {
  // The guard does not depend on the shipped allow-state: a read-only session keeps a tool only when
  // tool.readOnly === true. The launch tool is flagged readOnly:false in the manifest, so the read-only
  // filter strips it regardless of opt-in — workflow-spawned subagents can never propose, so workflows never nest.
  const manifest = loadToolManifest(WORKFLOW_ROOT);
  const launch = manifest.tools.find((t) => t.id === "rmmv_RmmvWorkflow");
  assert.ok(launch, "rmmv_RmmvWorkflow must exist in the manifest");
  assert.equal(launch?.readOnly, false);
  assert.equal(launch?.defaultAllow, false);

  const readOnly = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
    readOnlyTools: true,
  });
  assert.equal((readOnly.tools as Record<string, boolean>).rmmv_RmmvWorkflow, false);
});

test("staging carve-out: the pending-event tool is ON for read-only subagents but OFF for a normal session", () => {
  const base = {
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
  };
  const normal = buildOpencodeRuntimeConfig(base);
  const readOnly = buildOpencodeRuntimeConfig({ ...base, readOnlyTools: true });

  // The manifest marks it stagingSafe (the single read-only write carve-out) and not read-only.
  const manifest = loadToolManifest(WORKFLOW_ROOT);
  const stage = manifest.tools.find((t) => t.id === "rmmv_RmmvStage");
  assert.ok(stage, "rmmv_RmmvStage must exist in the manifest");
  assert.equal(stage?.stagingSafe, true);
  assert.equal(stage?.readOnly, false);

  // Read-only workflow subagents CAN stage pending events…
  assert.equal((readOnly.tools as Record<string, boolean>).rmmv_RmmvStage, true);
  // …but the full mutating event tool (placement / edits) stays OFF for them.
  assert.equal((readOnly.tools as Record<string, boolean>).rmmv_RmmvEvent, false);
  // The normal top-level agent does NOT get the staging tool (it uses the full event tool instead).
  assert.equal((normal.tools as Record<string, boolean>).rmmv_RmmvStage, false);
});

test("read-only session adds permission denies; normal session does not", () => {
  const base = {
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
  };
  const readOnly = buildOpencodeRuntimeConfig({ ...base, readOnlyTools: true });
  const normal = buildOpencodeRuntimeConfig(base);

  assert.deepEqual(readOnly.permission, {
    edit: "deny",
    bash: "deny",
    webfetch: "deny",
    external_directory: "deny",
  });
  // 非 read-only 会话：工作流工具走 ask，并按命令串粒度 deny 危险 shell 命令。
  const normalPermission = normal.permission as Record<string, unknown>;
  assert.equal(normalPermission.rmmv_RmmvWorkflow, "ask");
  assert.equal(normalPermission.rmmv_RmmvDatabaseApply, "ask");
  const bashRules = normalPermission.bash as Record<string, string>;
  assert.equal(bashRules["*"], "allow");
  assert.equal(bashRules["rm -rf *"], "deny");
  assert.equal(bashRules["rm -rf"], "deny");
  assert.equal(bashRules["git reset --hard *"], "deny");
  assert.equal(bashRules["git clean *"], "deny");
});

test("anthropic-compatible providers use the anthropic AI SDK package", () => {
  const config = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "zhipu-glm",
    modelId: "glm-4.5-air",
    provider: provider("anthropic", "https://open.bigmodel.cn/api/anthropic"),
  });

  const providerConfig = (config.provider as Record<string, Record<string, unknown>>)["zhipu-glm"];
  assert.equal(providerConfig.npm, "@ai-sdk/anthropic");
  assert.equal(providerConfig.api, "https://open.bigmodel.cn/api/anthropic/v1");
  assert.deepEqual(providerConfig.options, {
    baseURL: "https://open.bigmodel.cn/api/anthropic/v1",
  });
  assert.deepEqual(providerConfig.env, ["ANTHROPIC_API_KEY"]);
});

test("anthropic-compatible providers keep non-zhipu base urls unchanged", () => {
  const config = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "deepseek",
    modelId: "deepseek-v4-pro",
    provider: provider("anthropic", "https://api.deepseek.com/anthropic"),
  });

  const providerConfig = (config.provider as Record<string, Record<string, unknown>>)["deepseek"];
  assert.equal(providerConfig.npm, "@ai-sdk/anthropic");
  assert.equal(providerConfig.api, "https://api.deepseek.com/anthropic");
  assert.deepEqual(providerConfig.options, {
    baseURL: "https://api.deepseek.com/anthropic",
  });
});

test("openai-compatible providers use the openai-compatible AI SDK package", () => {
  const config = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "deepseek",
    modelId: "deepseek-chat",
    provider: provider("openai-compatible", "https://api.deepseek.com"),
  });

  const providerConfig = (config.provider as Record<string, Record<string, unknown>>)["deepseek"];
  assert.equal(providerConfig.npm, "@ai-sdk/openai-compatible");
  assert.equal(providerConfig.api, "https://api.deepseek.com");
  assert.deepEqual(providerConfig.env, ["OPENAI_API_KEY"]);
});

test("opencode config carries model context limits from provider metadata", () => {
  const providerRecord = provider("openai-compatible", "https://example.invalid");
  providerRecord.models = [
    {
      id: "glm-5.2",
      label: "GLM 5.2",
      limit: {
        context: 262144,
        output: 131072,
      },
    },
  ];
  const config = buildOpencodeRuntimeConfig({
    workflowRoot: WORKFLOW_ROOT,
    providerId: "agentplan",
    modelId: "glm-5.2",
    provider: providerRecord,
  });

  const providerConfig = (config.provider as Record<string, Record<string, unknown>>).agentplan;
  const models = providerConfig.models as Record<string, Record<string, unknown>>;
  assert.deepEqual(models["glm-5.2"].limit, {
    context: 262144,
    output: 131072,
  });
});
