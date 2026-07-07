import { test } from "node:test";
import assert from "node:assert/strict";
import { SlashCommandService } from "./service.ts";

function createSession(overrides: Partial<{
  id: string;
  status: string;
  opencodeSessionId: string | null;
  providerId: string;
  modelId: string;
}> = {}) {
  return {
    id: "sess-1",
    status: "pass",
    project: "projects/demo_mod",
    opencodeSessionId: "oc-1",
    productLanguage: "en-US" as const,
    providerId: "provider-1",
    modelId: "model-1",
    opencodeRunContext: { env: {}, config: {} },
    ...overrides,
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
  assert.match(result.message, /\/tokens/);
  assert.match(result.message, /\/compact/);
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

test("tokens reports opencode context window usage", async () => {
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

test("tokens fails fast when model context window is unavailable", async () => {
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

  const result = await service.execute({ sessionId: "sess-1", command: "tokens" });
  assert.equal(result.ok, false);
  assert.equal(result.display, "composer_hint");
  assert.equal(result.messageKey, "slash.tokens.failed");
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
