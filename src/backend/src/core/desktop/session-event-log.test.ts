import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  appendSessionEvent,
  finalizeSessionEventLog,
  readSessionEvents,
  updateConversationTurnIndex,
} from "./session-event-log.ts";
import type { AgentProjectBindingSnapshot } from "./agent-project-binding.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test("writes one input and output per tool call, links diagnostics, and compresses terminal logs", () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-event-log-"));
  roots.push(workflowRoot);
  const sessionId = "turn-001";
  const outDir = path.join(workflowRoot, "runtime", "sessions", sessionId, "agent-console");
  const binding = boundBinding();
  const context = { outDir, sessionId, conversationRootId: sessionId, opencodeSessionId: "native-001", binding };

  appendSessionEvent(context, { type: "tool_call", call_id: "call-1", tool: "example", status: "pending", input: {}, sequence: 1, at: "2026-01-01T00:00:00.000Z" });
  appendSessionEvent(context, { type: "tool_call", call_id: "call-1", tool: "example", status: "running", input: { action: "read" }, sequence: 2, at: "2026-01-01T00:00:00.100Z" });
  appendSessionEvent(context, { type: "tool_result", call_id: "call-1", tool: "example", output: JSON.stringify({ ok: false, code: "example-failed", stage: "read", diagnosticId: "diag-1" }), isError: true, sequence: 3, at: "2026-01-01T00:00:00.250Z" });
  finalizeSessionEventLog(context, "blocked", "example failed");

  assert.equal(fs.existsSync(path.join(outDir, "events.jsonl")), false);
  assert.equal(fs.existsSync(path.join(outDir, "events.jsonl.gz")), true);
  const events = readSessionEvents(outDir, 100);
  assert.equal(events.filter((event) => event.input !== undefined).length, 1);
  assert.equal(events.filter((event) => event.output !== undefined).length, 1);
  const index = JSON.parse(fs.readFileSync(path.join(outDir, "diagnostic-index.json"), "utf8"));
  assert.equal(index.failedTools[0].errorCode, "example-failed");
  assert.equal(index.failedTools[0].diagnosticId, "diag-1");
  assert.equal(index.incompleteTools.length, 0);

  updateConversationTurnIndex(workflowRoot, sessionId, {
    sessionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    status: "blocked",
    binding,
  });
  const conversation = JSON.parse(fs.readFileSync(path.join(workflowRoot, "runtime", "sessions", sessionId, "conversation-index.json"), "utf8"));
  assert.equal(conversation.turns.length, 1);
});

test("ignores an incomplete final JSONL line while preserving earlier events", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-event-log-corrupt-"));
  roots.push(root);
  const outDir = path.join(root, "agent-console");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "events.jsonl"), `${JSON.stringify({ event: { type: "message", text: "kept", sequence: 1 } })}\n{"event":`, "utf8");
  const events = readSessionEvents(outDir, 10);
  assert.equal(events.length, 1);
  assert.equal(events[0].text, "kept");
});

function boundBinding(): AgentProjectBindingSnapshot {
  return {
    status: "bound",
    version: 1,
    canonicalPath: path.join(os.tmpdir(), "projects", "source-project"),
    displayName: "source-project",
    projectId: "project-001",
    engine: "rpg-maker-mv",
    engineVersion: "1.6.2",
    editable: true,
    runnableStructure: false,
    runtimeAvailable: false,
    runtimeSource: null,
    runtimeReason: "missing",
  };
}
