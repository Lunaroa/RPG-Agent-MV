import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import {
  buildConversationHistoryFromChain,
  extractChatLogSegments,
  formatSegmentsAsConversationHistory,
  loadPersistedSegmentsFromChain,
  patchAskInSegments,
  pickBestPersistedSegments,
  shouldPersistChatLog,
} from "../../../../contract/session-transcript.ts";
import { AgentSessionRuntime } from "./agent-session-runtime.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("session-transcript helpers", () => {
  test("shouldPersistChatLog rejects empty in-memory transcripts", () => {
    assert.equal(shouldPersistChatLog(0), false);
    assert.equal(shouldPersistChatLog(2), true);
  });

  test("extractChatLogSegments accepts wrapped and bare arrays", () => {
    const segments = [{ type: "user", content: "hi" }];
    assert.deepEqual(extractChatLogSegments({ segments }), segments);
    assert.deepEqual(extractChatLogSegments(segments), segments);
    assert.equal(extractChatLogSegments(null), null);
  });

  test("pickBestPersistedSegments prefers the longest transcript", () => {
    const short = [{ type: "user", content: "a" }];
    const long = [
      { type: "user", content: "a" },
      { type: "ask", ask: { askId: "ask-1", type: "plan-approval", result: { decision: "approve" } } },
    ];
    const picked = pickBestPersistedSegments([
      { chatLog: { segments: short } },
      { chatLog: { segments: long } },
    ]);
    assert.deepEqual(picked, long);
  });

  test("loadPersistedSegmentsFromChain merges parent user bubble missing from child copy", () => {
    const parent = [
      { type: "user", content: "hello" },
      { type: "text", content: "reply" },
    ];
    const child = [
      { type: "text", content: "reply" },
      { type: "user", content: "follow up" },
      { type: "text", content: "reply2" },
      { type: "text", content: "extra detail" },
    ];
    const merged = loadPersistedSegmentsFromChain([
      { chatLog: { segments: parent } },
      { chatLog: { segments: child } },
    ]);
    assert.ok(merged?.some((segment) => segment.type === "user" && segment.content === "hello"));
    assert.equal(merged?.length, 5);
  });

  test("formatSegmentsAsConversationHistory maps user and assistant segments", () => {
    const formatted = formatSegmentsAsConversationHistory([
      { type: "user", content: "上一句" },
      { type: "reasoning", content: "内部分析" },
      { type: "text", content: "回复" },
      { type: "meta", content: "ignored" },
    ]);
    assert.match(formatted, /User: 上一句/);
    assert.match(formatted, /Assistant: 回复/);
    assert.doesNotMatch(formatted, /内部分析/);
    assert.doesNotMatch(formatted, /ignored/);
  });

  test("buildConversationHistoryFromChain merges turns and falls back to intent", () => {
    const history = buildConversationHistoryFromChain([
      {
        intent: "only intent",
        chatLog: { segments: [{ type: "user", content: "a" }, { type: "text", content: "b" }] },
      },
      { intent: "follow-up parent" },
    ]);
    assert.match(history, /User: a/);
    assert.match(history, /Assistant: b/);
    assert.match(history, /User: follow-up parent/);
  });

  test("patchAskInSegments merges ask fields without touching other segments", () => {
    const segments = [
      { type: "ask", ask: { askId: "a1", events: [{ contractId: "e1", status: "draft" }] } },
      { type: "text", content: "ok" },
    ];
    const next = patchAskInSegments(segments, "a1", (ask) => ({
      ...ask,
      events: [{ contractId: "e1", status: "placed" }],
    }));
    assert.equal((next[0].ask as any).events[0].status, "placed");
    assert.equal(next[1], segments[1]);
  });
});

describe("AgentSessionRuntime chat log persistence", () => {
  test("saveChatLog round-trips ask results for session reload", async () => {
    const harness = await createMinimalHarness();
    const session = await harness.runtime.create({ intent: "plan", project: "projects/Project" });
    await harness.flush();
    const sessionId = String(session.id);
    const segments = [
      {
        type: "ask",
        content: "",
        ask: {
          type: "plan-approval",
          askId: "ask-plan-1",
          title: "计划",
          prompt: "批准？",
          result: { decision: "approve", submittedAt: "2026-06-02T00:00:00.000Z" },
        },
      },
    ];
    harness.runtime.saveChatLog(sessionId, { segments });
    const loaded = harness.runtime.get(sessionId) as { chatLog?: { segments?: unknown[] } };
    const saved = extractChatLogSegments(loaded.chatLog);
    assert.equal(saved?.length, 1);
    assert.equal((saved?.[0] as any).ask.result.decision, "approve");
  });
});

async function createMinimalHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-session-transcript-"));
  roots.push(root);
  const askGateway = {
    port: 43123,
    async initSession() {},
    registerPushEvent() {},
    async destroySession() {},
    resolveAnswer() { return { ok: false, reason: "missing" }; },
    async injectEvent() { return { askId: "mock-inject" }; },
    async close() {},
  };
  const runtime = new AgentSessionRuntime(root, {
    askGateway,
    activateForSession: async () => ({}),
    writeOutputs: () => ({ jsonPath: "", mdPath: "" }),
    buildDispatch: async (options: any) => ({
      status: "pending",
      generatedAt: "2026-06-02T00:00:00.000Z",
      sessionId: options.sessionId,
      workflowRoot: root,
      task: { intent: options.intent, project: options.project, mapId: null, failureKind: null, taskId: null, files: [] },
      profileId: options.profileId || "default",
      execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
    }),
    startDispatch: () => ({
      promise: new Promise(() => {}),
      stop: () => {},
    }),
  } as any);
  await runtime.initialize();
  return {
    runtime,
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}
