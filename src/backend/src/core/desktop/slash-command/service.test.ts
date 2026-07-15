import { test } from "node:test";
import assert from "node:assert/strict";
import { SlashCommandService } from "./service.ts";

function createSession(overrides: Partial<{
  id: string;
  status: string;
  opencodeSessionId: string | null;
  providerId: string;
  modelId: string;
  opencodeRunContext: { env?: Record<string, string>; config?: Record<string, unknown> } | null;
}> = {}) {
  return {
    id: "sess-1",
    status: "pass",
    project: "projects/demo_mod",
    opencodeSessionId: "oc-1",
    productLanguage: "en-US" as const,
    providerId: "provider-1",
    modelId: "model-1",
    opencodeRunContext: { env: { LIVE: "1" }, config: { model: "provider-1/model-1" } },
    ...overrides,
  };
}

function stubBootstrap() {
  return {
    loadProviderDocument: async () => ({
      version: 1,
      providers: {
        "provider-1": {
          id: "provider-1",
          label: "Provider 1",
          protocol: "openai-compatible" as const,
          baseUrl: "https://example.test",
          credentialValue: "<API_KEY>",
          models: [{ id: "model-1", label: "Model 1", limit: { context: 1000 } }],
        },
      },
      profiles: {},
    }),
    materializeEnv: () => ({
      env: { OPENAI_API_KEY: "<API_KEY>" },
      envKeys: ["OPENAI_API_KEY"],
      blocker: null,
    }),
    buildRuntimeConfig: () => ({ model: "provider-1/model-1" }),
    readMemory: () => ({ enabled: false, autoExtractEnabled: false, recallModel: null }),
  };
}

test("help returns composer hint with command names", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession(),
    stopSession: () => {},
  });

  const result = await service.execute({ sessionId: "sess-1", command: "help" });
  assert.equal(result.ok, true);
  assert.equal(result.display, "composer_hint");
  assert.doesNotMatch(result.message, /\/tokens/);
  assert.match(result.message, /\/compact/);
  assert.match(result.message, /\/help/);
});

test("unknown command returns composer hint error", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession(),
    stopSession: () => {},
  });

  const result = await service.execute({ sessionId: "sess-1", command: "foo" });
  assert.equal(result.ok, false);
  assert.equal(result.display, "composer_hint");
});

test("tokens without opencode session fails fast", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession({ opencodeSessionId: null }),
    stopSession: () => {},
  });

  const result = await service.execute({ sessionId: "sess-1", command: "tokens" });
  assert.equal(result.ok, false);
  assert.equal(result.messageKey, "slash.tokens.noSession");
});

test("getContextUsage reports opencode context window usage", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession(),
    stopSession: () => {},
    fetchMessages: async () => ([
      {
        role: "assistant",
        providerID: "provider-1",
        modelID: "model-1",
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } },
      },
    ]),
    fetchModelLimit: async () => ({ context: 1000 }),
  });

  const result = await service.getContextUsage("sess-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.contextUsedTokens, 167);
  assert.equal(result.data.contextWindowTokens, 1000);
  assert.equal(result.data.contextPercent, 17);
});

test("getContextUsage rebuilds bootstrap after run context is cleared", async () => {
  let sawRebuiltEnv = false;
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession({ opencodeRunContext: null }),
    stopSession: () => {},
    resolveBootstrap: stubBootstrap(),
    fetchMessages: async (input) => {
      assert.equal(input.env?.OPENAI_API_KEY, "<API_KEY>");
      assert.equal(input.config?.model, "provider-1/model-1");
      sawRebuiltEnv = true;
      return [
        {
          role: "assistant",
          providerID: "provider-1",
          modelID: "model-1",
          tokens: { input: 200, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      ];
    },
    fetchModelLimit: async () => ({ context: 1000 }),
  });

  const result = await service.getContextUsage("sess-1");
  assert.equal(sawRebuiltEnv, true);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.contextUsedTokens, 250);
  assert.equal(result.data.contextPercent, 25);
});

test("tokens still works when typed manually", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession(),
    stopSession: () => {},
    fetchMessages: async () => ([
      {
        role: "assistant",
        providerID: "provider-1",
        modelID: "model-1",
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 2 } },
      },
    ]),
    fetchModelLimit: async () => ({ context: 1000 }),
  });

  const result = await service.execute({ sessionId: "sess-1", command: "tokens" });
  assert.equal(result.ok, true);
  assert.equal(result.data?.contextUsedTokens, 167);
  assert.equal(result.data?.contextWindowTokens, 1000);
  assert.equal(result.data?.contextPercent, 17);
});

test("getContextUsage fails fast when model context window is unavailable", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession(),
    stopSession: () => {},
    fetchMessages: async () => ([
      {
        role: "assistant",
        tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ]),
    fetchModelLimit: async () => {
      throw new Error("context limit missing");
    },
  });

  const result = await service.getContextUsage("sess-1");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.messageKey, "slash.tokens.failed");
});

test("getContextUsage without opencode session fails fast", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession({ opencodeSessionId: null }),
    stopSession: () => {},
  });

  const result = await service.getContextUsage("sess-1");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.messageKey, "slash.tokens.noSession");
});

test("compact stops running session before compacting", async () => {
  let status = "running";
  let stopped = false;
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession({ status }),
    stopSession: () => {
      stopped = true;
      status = "stopped";
    },
    compactSession: async () => {},
  });

  const result = await service.execute({ sessionId: "sess-1", command: "compact" });
  assert.equal(stopped, true);
  assert.equal(result.ok, true);
  assert.equal(result.display, "chat_status");
});

test("compact without bound model fails fast", async () => {
  const service = new SlashCommandService({
    workflowRoot: "/tmp/workflow",
    getSession: () => createSession({ providerId: "", modelId: "" }),
    stopSession: () => {},
    compactSession: async () => {
      throw new Error("compact should not be invoked without a model");
    },
  });

  const result = await service.execute({ sessionId: "sess-1", command: "compact" });
  assert.equal(result.ok, false);
  assert.equal(result.messageKey, "slash.compact.noModel");
});
