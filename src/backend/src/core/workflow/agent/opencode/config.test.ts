import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { ProviderRecord } from "../../../llm/provider-registry.ts";
import { buildOpencodeRuntimeConfig } from "./config.ts";

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
  assert.equal((config.mcp as Record<string, Record<string, unknown>>).rmmv.enabled, true);
  assert.equal(config.instructions, undefined);
  assert.equal(config.skills, undefined);
  assert.equal(config.permission, undefined);
  assert.equal(config.agent, undefined);
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
