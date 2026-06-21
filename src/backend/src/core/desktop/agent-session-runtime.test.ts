import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import { AgentSessionRuntime, type AgentRuntimeEvent } from "./agent-session-runtime.ts";
import { KnowledgeContextAbortedError } from "../workflow/agent/knowledge-context.ts";

const roots: string[] = [];
const runtimes: AgentSessionRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AgentSessionRuntime", () => {
  test("streams starting, running and summary events with replay support", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "inspect project", project: "projects/Project" });
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    const unsubscribed: AgentRuntimeEvent[] = [];

    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });
    harness.runtime.subscribe(sessionId, { id: "temporary", write: (event) => unsubscribed.push(event) });
    harness.runtime.unsubscribe(sessionId, "temporary");
    await waitForSessionStatus(harness.runtime, sessionId, "running");
    assert.deepEqual(
      received.filter((event) => event.type === "status").slice(0, 3).map((event) => event.status),
      ["preparing", "starting", "running"],
    );

    harness.emit({ type: "text_delta", text: "done" });
    harness.finish({ status: "pass" });
    await harness.flush();

    assert.equal(harness.runtime.get(sessionId)?.status, "pass");
    assert.equal(received.some((event) => event.type === "artifact"), true);
    assert.equal(received.some((event) => event.type === "summary" && event.status === "pass"), true);
    assert.equal(received.find((event) => event.type === "artifact")?.sessionId, sessionId);
    assert.equal(received.find((event) => event.type === "summary")?.sessionId, sessionId);
    assert.deepEqual(received.map((event) => event.sequence), received.map((_event, index) => index + 1));
    assert.equal(unsubscribed.some((event) => event.type === "text_delta"), false);
  });

  test("allows final pass while a background subagent is still pending", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "spawn worker", project: "projects/Project" });
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "tool_call",
      call_id: "call-agent",
      tool: "Agent",
      input: { description: "测试子 Agent 代码搜索", prompt: "搜索插件", background: true },
      at: "2026-06-01T00:00:02.000Z",
    });
    harness.emit({
      type: "tool_result",
      call_id: "call-agent",
      success: true,
      output: { status: "async_launched", taskId: "task-search" },
      at: "2026-06-01T00:00:03.000Z",
    });
    harness.finish({ status: "pass" });
    await harness.flush();

    const current = harness.runtime.get(sessionId);
    assert.equal(current?.status, "pass");
    assert.equal(received.some((event) => event.type === "status" && event.status === "blocked"), false);
    assert.equal(received.some((event) => event.type === "summary" && event.status === "pass"), true);
  });

  test("blocks final pass while a foreground subagent is still pending", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "spawn worker", project: "projects/Project" });
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "tool_call",
      call_id: "call-agent",
      tool: "Agent",
      input: { description: "测试子 Agent 代码搜索", prompt: "搜索插件" },
      at: "2026-06-01T00:00:02.000Z",
    });
    harness.finish({ status: "pass" });
    await harness.flush();

    const current = harness.runtime.get(sessionId);
    assert.equal(current?.status, "blocked");
    assert.match(String(current?.blocker || ""), /foreground subagent still running/i);
    assert.equal(received.some((event) => event.type === "status" && event.status === "blocked"), true);
    assert.equal(received.some((event) => event.type === "summary" && event.status === "blocked"), true);
  });

  test("blocks final pass with English foreground subagent blocker in English mode", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "spawn worker", project: "projects/Project", productLanguage: "en-US" });
    const sessionId = String(session.id);
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "tool_call",
      call_id: "call-agent",
      tool: "Agent",
      input: { description: "search code", prompt: "search plugins" },
      at: "2026-06-01T00:00:02.000Z",
    });
    harness.finish({ status: "pass" });
    await harness.flush();

    const current = harness.runtime.get(sessionId);
    assert.equal(current?.status, "blocked");
    assert.match(String(current?.blocker || ""), /foreground subagent still running/);
  });

  test("allows final pass after native subagent completion notification", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "spawn worker", project: "projects/Project" });
    const sessionId = String(session.id);
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "tool_call",
      call_id: "call-agent",
      tool: "Agent",
      input: { description: "测试子 Agent 代码搜索", prompt: "搜索插件" },
      at: "2026-06-01T00:00:02.000Z",
    });
    harness.emit({
      type: "tool_result",
      call_id: "call-agent",
      success: true,
      output: { status: "async_launched", taskId: "task-search" },
      at: "2026-06-01T00:00:03.000Z",
    });
    harness.emit({
      type: "subagent_task_notification",
      taskId: "task-search",
      callId: "call-agent",
      status: "completed",
      outputFile: "runtime/out/task-search.txt",
      output: "找到 5 个文件",
      at: "2026-06-01T00:00:04.000Z",
    });
    harness.finish({ status: "pass" });
    await harness.flush();

    assert.equal(harness.runtime.get(sessionId)?.status, "pass");
  });

  test("allows final pass when child session idle notification arrives without agent tool_result", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "register and hello subagent", project: "projects/Project" });
    const sessionId = String(session.id);
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "subagent_task_started",
      taskId: "ses_child",
      callId: "call-agent",
      description: "Subagent hello test",
      prompt: "reply hello",
      taskType: "general",
      at: "2026-06-17T11:50:49.063Z",
    });
    harness.emit({
      type: "subagent_task_progress",
      taskId: "ses_child",
      callId: "call-agent",
      description: "Subagent hello test",
      logType: "text",
      detail: "hello",
      at: "2026-06-17T11:50:50.376Z",
    });
    harness.emit({
      type: "subagent_task_notification",
      taskId: "ses_child",
      callId: "call-agent",
      status: "completed",
      output: "hello",
      at: "2026-06-17T11:50:50.500Z",
    });
    harness.finish({ status: "pass" });
    await harness.flush();

    assert.equal(harness.runtime.get(sessionId)?.status, "pass");
    assert.equal(harness.runtime.listSubagents(sessionId).items[0]?.status, "completed");
  });

  test("preserves pass when Agent tool_result is plain text during finalize guard", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "run tools test", project: "projects/Project" });
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "tool_call",
      call_id: "call-agent",
      tool: "Agent",
      input: { description: "子任务", prompt: "reply hello" },
      at: "2026-06-17T12:00:00.000Z",
    });
    harness.emit({
      type: "tool_result",
      call_id: "call-agent",
      success: true,
      output: "Agent completed.",
      at: "2026-06-17T12:00:01.000Z",
    });
    harness.finish({ status: "pass" });
    await harness.flush();

    assert.equal(harness.runtime.get(sessionId)?.status, "pass");
    assert.equal(received.some((event) => event.type === "status" && event.status === "error"), false);
    assert.equal(received.some((event) => event.type === "summary" && event.status === "pass"), true);
  });

  test("preserves pass when finalize throws after dispatch pass", async () => {
    const harness = await createHarness(undefined, undefined, {
      writeOutputs: () => {
        throw new TypeError("Cannot read properties of null (reading 'background')");
      },
    });
    const session = await harness.runtime.create({ intent: "run tools test", project: "projects/Project" });
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "tool_call",
      call_id: "call-agent",
      tool: "Agent",
      input: {},
      at: "2026-06-17T12:03:05.970Z",
    });
    harness.emit({
      type: "tool_result",
      call_id: "call-agent",
      success: true,
      output: null,
      at: "2026-06-17T12:03:08.262Z",
    });
    harness.finish({ status: "pass" });
    await harness.flush();

    assert.equal(harness.runtime.get(sessionId)?.status, "pass");
    assert.equal(received.some((event) => event.type === "status" && event.status === "error"), false);
    assert.equal(received.filter((event) => event.type === "summary").at(-1)?.status, "pass");
  });

  test("creates project-local agent output dirs when a session starts", async () => {
    const root = makeRoot();
    const harness = await createHarness(root);

    await harness.runtime.create({ intent: "inspect project", project: "projects/Project" });

    assert.equal(fs.statSync(path.join(root, ".opencode", "logs", "tmp")).isDirectory(), true);
    assert.equal(fs.statSync(path.join(root, ".opencode", "logs", "skills")).isDirectory(), true);
  });

  test("lists opencode todos without native ids", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "track todo", project: "projects/Project" });
    const sessionId = String(session.id);
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "todo_updated",
      todos: [
        { content: "读取项目事实", status: "completed", priority: "high" },
        { content: "注册事件草稿", status: "in_progress", priority: "medium" },
      ],
      at: "2026-06-01T00:00:02.000Z",
    });

    assert.deepEqual(harness.runtime.listTasks(sessionId).map((task) => ({
      id: task.id,
      content: task.content,
      status: task.status,
      priority: task.priority,
    })), [
      { id: "todo:1", content: "读取项目事实", status: "completed", priority: "high" },
      { id: "todo:2", content: "注册事件草稿", status: "in_progress", priority: "medium" },
    ]);
  });

  test("redacts credential values and sensitive event fields", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "inspect project" });
    await harness.flush();
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    (harness.runtime as any).secrets = ["credential-value"];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });

    harness.emit({
      type: "tool_call",
      tool: "inspect",
      input: { apiKey: "field-value", note: "contains credential-value" },
    });
    harness.emit({
      type: "usage",
      inputTokens: 12,
      outputTokens: 5,
      reasoningTokens: 3,
    });

    const serialized = JSON.stringify(received);
    assert.doesNotMatch(serialized, /credential-value|field-value/);
    assert.match(serialized, /\[REDACTED\]/);
    const usage = received.find((event) => event.type === "usage") as any;
    assert.equal(usage.inputTokens, 12);
    assert.equal(usage.outputTokens, 5);
    assert.equal(usage.reasoningTokens, 3);
  });

  test("stops the child runner and rejects legacy ASK MCP answers", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "wait for user" });
    await harness.flush();
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });

    const legacyAsk = await harness.runtime.submitAskResult(sessionId, "ask-1", { decision: "approve" });
    assert.equal(legacyAsk.ok, false);
    assert.match(String(legacyAsk.reason || ""), /legacy ASK MCP is disabled/);
    const stopped = harness.runtime.stop(sessionId);

    assert.equal(harness.stopCalled, true);
    assert.equal(stopped?.status, "stopped");
    assert.equal(harness.destroyed.includes(sessionId), true);
    assert.equal(received.filter((event) => event.type === "summary" && event.status === "stopped").length, 1);

    harness.finish({ status: "pass" });
    await harness.flush();
    assert.equal(harness.runtime.get(sessionId)?.status, "stopped");
    assert.equal(received.filter((event) => event.type === "summary").length, 1);
  });

  test("opencode plan ASK responses are reflected in plan state", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "plan work" });
    const sessionId = String(session.id);
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "opencode_permission_request",
      request_id: "req-plan",
      request: {
        subtype: "can_use_tool",
        tool_name: "ExitPlanMode",
        input: { plan: "1. 查事实\n2. 写事件" },
      },
      at: "2026-06-01T00:00:02.000Z",
    });

    const response = await harness.runtime.submitAskResult(sessionId, "agent-runtime-plan:req-plan", { decision: "approve" });
    const plan = harness.runtime.getPlan(sessionId);

    assert.deepEqual(response, { ok: true, askType: "plan-approval" });
    const opencodeEvent = (harness.runtime.get(sessionId)?.events as AgentRuntimeEvent[])
      .find((event) => event.type === "opencode_permission_response" && event.request_id === "req-plan") as any;
    assert.ok(opencodeEvent);
    const opencodeResponse = opencodeEvent.response.response as Record<string, unknown>;
    assert.equal(opencodeResponse.behavior, "allow");
    assert.equal(plan.mode, "approved");
  });

  test("opencode plan ASK default rejection message follows English product language", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "plan work", productLanguage: "en-US" });
    const sessionId = String(session.id);
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "opencode_permission_request",
      request_id: "req-plan",
      request: {
        subtype: "can_use_tool",
        tool_name: "ExitPlanMode",
        input: { plan: "1. Inspect\n2. Edit" },
      },
      at: "2026-06-01T00:00:02.000Z",
    });

    await harness.runtime.submitAskResult(sessionId, "agent-runtime-plan:req-plan", { decision: "reject" });

    const opencodeEvent = (harness.runtime.get(sessionId)?.events as AgentRuntimeEvent[])
      .find((event) => event.type === "opencode_permission_response" && event.request_id === "req-plan") as any;
    assert.equal(opencodeEvent.response.response.message, "The user rejected this plan.");
  });

  test("allocates isolated plan path per conversation and reuses it on continuation", async () => {
    let lastBuildOptions: Record<string, unknown> | undefined;
    const harness = await createHarness(undefined, async (options) => {
      lastBuildOptions = options;
      return {
        status: "pending",
        generatedAt: "2026-06-01T00:00:00.000Z",
        sessionId: options.sessionId,
        workflowRoot: "",
        task: {
          intent: options.intent,
          project: options.project,
          mapId: null,
          failureKind: null,
          taskId: null,
          files: [],
          conversationHistory: null,
        },
        profileId: "default",
        execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
      };
    });
    const project = "projects/PlanIsolation";
    const projectDir = path.join((harness.runtime as unknown as { workflowRoot: string }).workflowRoot, project);
    fs.mkdirSync(path.join(projectDir, ".opencode", "plans", "conversations"), { recursive: true });

    const root = await harness.runtime.create({ intent: "plan root", project });
    const rootId = String(root.id);
    const rootPlanPath = `.opencode/plans/conversations/${rootId}.md`;
    assert.equal(root.planFilePath, rootPlanPath);
    await waitForSessionStatus(harness.runtime, rootId, "running");
    assert.equal(lastBuildOptions?.planFilePath, rootPlanPath);

    const child = await harness.runtime.create({ intent: "plan follow-up", project, continuationOf: rootId });
    const childId = String(child.id);
    assert.equal(child.planFilePath, rootPlanPath);
    await waitForSessionStatus(harness.runtime, childId, "running");
    assert.equal(lastBuildOptions?.planFilePath, rootPlanPath);

    const other = await harness.runtime.create({ intent: "other chat", project });
    const otherPlanPath = `.opencode/plans/conversations/${String(other.id)}.md`;
    assert.notEqual(otherPlanPath, rootPlanPath);

    fs.writeFileSync(path.join(projectDir, rootPlanPath), "# Root plan\n", "utf8");
    fs.writeFileSync(path.join(projectDir, otherPlanPath), "# Other plan\n", "utf8");

    assert.match(harness.runtime.getPlan(rootId).planMarkdown || "", /Root plan/);
    assert.match(harness.runtime.getPlan(childId).planMarkdown || "", /Root plan/);
    assert.match(harness.runtime.getPlan(String(other.id)).planMarkdown || "", /Other plan/);
  });

  test("opencode AskUserQuestion responses are projected as native answers", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "ask user" });
    const sessionId = String(session.id);
    await waitForSessionStatus(harness.runtime, sessionId, "running");

    harness.emit({
      type: "opencode_question_request",
      request_id: "req-ask",
      request: {
        subtype: "can_use_tool",
        tool_name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "今天天气？",
              header: "天气",
              options: [{ label: "晴天" }, { label: "下雨" }],
              multiSelect: false,
            },
            {
              question: "还要演示哪些？",
              header: "演示",
              options: [{ label: "PLAN" }, { label: "子 Agent" }],
              multiSelect: true,
            },
          ],
        },
      },
      at: "2026-06-01T00:00:02.000Z",
    });

    const response = await harness.runtime.submitAskResult(sessionId, "agent-runtime-ask:req-ask", {
      answers: {
        "今天天气？": { selected: ["晴天"], other: "" },
        "还要演示哪些？": { selected: ["PLAN", "子 Agent"], other: "" },
      },
    });

    assert.deepEqual(response, { ok: true, askType: "multi-choice-clarify" });
    const opencodeEvent = (harness.runtime.get(sessionId)?.events as AgentRuntimeEvent[])
      .find((event) => event.type === "opencode_question_response" && event.request_id === "req-ask") as any;
    assert.ok(opencodeEvent);
    const opencodeResponse = opencodeEvent.response.response as Record<string, any>;
    assert.equal(opencodeResponse.behavior, "allow");
    assert.deepEqual(opencodeResponse.updatedInput.answers, {
      "今天天气？": "晴天",
      "还要演示哪些？": "PLAN, 子 Agent",
    });
  });

  test("subagent stop records a local opencode stop request projection", async () => {
    const missingHarness = await createHarness();
    const missingSession = await missingHarness.runtime.create({ intent: "spawn worker" });
    const missingSessionId = String(missingSession.id);
    await waitForSessionStatus(missingHarness.runtime, missingSessionId, "running");

    assert.deepEqual(missingHarness.runtime.stopSubagent("missing", "task-1"), {
      ok: false,
      reason: "session not found",
    });
    const result = missingHarness.runtime.stopSubagent(missingSessionId, "task-1");
    const subagents = missingHarness.runtime.listSubagents(missingSessionId);

    assert.equal(result.ok, true);
    assert.match(String(result.requestId || ""), /^stop:task-1:/);
    assert.equal(subagents.items[0]?.id, "task-1");
    assert.equal(subagents.items[0]?.stopRequestId, result.requestId);
  });

  test("restores non-terminal sessions from session-meta as interrupted", async () => {
    const root = makeRoot();
    const outDir = path.join(root, "runtime", "sessions", "session-idle", "agent-console");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "session-meta.json"), JSON.stringify({
      id: "session-idle",
      status: "idle",
      displayText: "Idle session",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      profileId: "default",
      project: "projects/Project",
    }));
    const harness = await createHarness(root);

    const restored = harness.runtime.get("session-idle");
    assert.equal(restored?.status, "interrupted");
    assert.match(String(restored?.blocker), /did not finish cleanly before the app restarted/i);
  });

  test("restores interrupted session blocker in English mode", async () => {
    const root = makeRoot();
    const outDir = path.join(root, "runtime", "sessions", "session-idle-en", "agent-console");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "session-meta.json"), JSON.stringify({
      id: "session-idle-en",
      status: "idle",
      displayText: "Idle session",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      profileId: "default",
      project: "projects/Project",
      productLanguage: "en-US",
    }));
    const harness = await createHarness(root);

    const restored = harness.runtime.get("session-idle-en");
    assert.equal(restored?.status, "interrupted");
    assert.equal(restored?.blocker, "The session did not finish cleanly before the app restarted.");
  });

  test("restores persisted runtime events after restart", async () => {
    const root = makeRoot();
    {
      const harness = await createHarness(root);
      const session = await harness.runtime.create({ intent: "inspect project", project: "projects/Project" });
      const sessionId = String(session.id);
      await waitForSessionStatus(harness.runtime, sessionId, "running");
      harness.emit({ type: "tool_call", tool: "RmmvReadContext", at: "2026-06-01T00:00:02.000Z" });
      harness.finish({ status: "pass" });
      await harness.flush();
      await harness.runtime.close();
      runtimes.splice(runtimes.indexOf(harness.runtime), 1);
    }

    const restarted = await createHarness(root);
    const restoredId = String(restarted.runtime.list()[0]?.id);
    const restored = restarted.runtime.get(restoredId) as { events?: AgentRuntimeEvent[] };
    assert.equal(restored.events?.some((event) => event.type === "tool_call" && event.tool === "RmmvReadContext"), true);
  });

  test("returns a preparing session before dispatch preparation finishes", async () => {
    const harness = await createPreparingHarness();
    const session = await harness.runtime.create({ intent: "inspect project" });
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });

    let timerFired = false;
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true;
        resolve();
      }, 0);
    });

    assert.equal(session.status, "preparing");
    assert.equal(timerFired, true);
    assert.equal(harness.startDispatchCalls, 0);
    assert.equal(received[0]?.status, "preparing");

    await harness.buildStarted;
    harness.releaseBuild();
    await harness.flush();
    assert.equal(harness.startDispatchCalls, 1);
    assert.deepEqual(received.filter((event) => event.type === "status").map((event) => event.status), [
      "preparing",
      "starting",
      "running",
    ]);
  });

  test("continuation passes opencodeSessionId to startDispatch for native session reuse", async () => {
    let lastStartOptions: Record<string, unknown> | undefined;
    const harness = await createHarness(undefined, async (options) => ({
      status: "pending",
      generatedAt: "2026-06-01T00:00:00.000Z",
      sessionId: options.sessionId,
      workflowRoot: "",
      task: {
        intent: options.intent,
        project: options.project,
        mapId: null,
        failureKind: null,
        taskId: null,
        files: [],
        conversationHistory: options.conversationHistory ?? null,
      },
      profileId: "default",
      execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock", streamFormat: "opencode-sse" } },
    }), {
      startDispatch: (_dispatch: unknown, options: Record<string, unknown>, onEvent: (event: AgentRuntimeEvent) => void) => {
        lastStartOptions = options;
        onEvent({ type: "status", status: "running", at: "2026-06-01T00:00:01.000Z" });
        return {
          promise: Promise.resolve({ status: "pass", execution: { finishedAt: "2026-06-01T00:00:03.000Z" } }),
          stop: () => {},
        };
      },
    });
    const parent = await harness.runtime.create({
      intent: "first turn",
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();
    const parentSession = (harness.runtime as unknown as { sessions: Map<string, { opencodeSessionId: string }> }).sessions.get(String(parent.id));
    assert.ok(parentSession);
    parentSession!.opencodeSessionId = "opencode-persisted-id";

    await harness.runtime.create({
      intent: "follow-up",
      continuationOf: String(parent.id),
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();

    assert.equal(lastStartOptions?.opencodeSessionId, "opencode-persisted-id");
  });

  test("continuation inherits native opencode session id and skips prompt conversation history", async () => {
    let lastBuildOptions: Record<string, unknown> | undefined;
    const harness = await createHarness(undefined, async (options) => {
      lastBuildOptions = options;
      return {
        status: "pending",
        generatedAt: "2026-06-01T00:00:00.000Z",
        sessionId: options.sessionId,
        workflowRoot: "",
        task: {
          intent: options.intent,
          project: options.project,
          mapId: null,
          failureKind: null,
          taskId: null,
          files: [],
          conversationHistory: options.conversationHistory ?? null,
        },
        profileId: "default",
        execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
      };
    });
    const parent = await harness.runtime.create({
      intent: "first turn",
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();
    const parentSession = (harness.runtime as unknown as { sessions: Map<string, { opencodeSessionId: string }> }).sessions.get(String(parent.id));
    assert.ok(parentSession);
    parentSession!.opencodeSessionId = "opencode-persisted-id";
    harness.runtime.saveChatLog(String(parent.id), {
      segments: [{ type: "user", content: "上一句" }, { type: "text", content: "回复" }],
    });

    await harness.runtime.create({
      intent: "follow-up",
      continuationOf: String(parent.id),
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();

    assert.equal(lastBuildOptions?.opencodeSessionId, "opencode-persisted-id");
    assert.equal(lastBuildOptions?.conversationHistory, undefined);
  });

  test("continuation without opencodeSessionId injects conversationHistory from chat log", async () => {
    let lastBuildOptions: Record<string, unknown> | undefined;
    const harness = await createHarness(undefined, async (options) => {
      lastBuildOptions = options;
      return {
        status: "pending",
        generatedAt: "2026-06-01T00:00:00.000Z",
        sessionId: options.sessionId,
        workflowRoot: "",
        task: {
          intent: options.intent,
          project: options.project,
          mapId: null,
          failureKind: null,
          taskId: null,
          files: [],
          conversationHistory: options.conversationHistory ?? null,
        },
        profileId: "default",
        execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
      };
    });
    const parent = await harness.runtime.create({
      intent: "first turn",
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();
    harness.runtime.saveChatLog(String(parent.id), {
      segments: [{ type: "user", content: "上一句" }, { type: "text", content: "回复" }],
    });

    await harness.runtime.create({
      intent: "follow-up",
      continuationOf: String(parent.id),
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();

    assert.equal(lastBuildOptions?.opencodeSessionId, undefined);
    const history = String(lastBuildOptions?.conversationHistory || "");
    assert.match(history, /User: 上一句/);
    assert.match(history, /Assistant: 回复/);
  });

  test("opencode continuation injects conversationHistory without native session id", async () => {
    let lastBuildOptions: Record<string, unknown> | undefined;
    const harness = await createHarness(undefined, async (options) => {
      lastBuildOptions = options;
      return {
        status: "pending",
        generatedAt: "2026-06-01T00:00:00.000Z",
        sessionId: options.sessionId,
        workflowRoot: "",
        task: {
          intent: options.intent,
          project: options.project,
          mapId: null,
          failureKind: null,
          taskId: null,
          files: [],
          conversationHistory: options.conversationHistory ?? null,
        },
        profileId: "default",
        execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
      };
    });
    const parent = await harness.runtime.create({
      intent: "first turn",
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();
    harness.runtime.saveChatLog(String(parent.id), {
      segments: [{ type: "user", content: "上一句" }],
    });

    await harness.runtime.create({
      intent: "follow-up",
      continuationOf: String(parent.id),
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();

    assert.match(String(lastBuildOptions?.conversationHistory || ""), /User: 上一句/);
  });

  test("clears native opencode session id on resume failure for next continuation", async () => {
    const harness = await createHarness();
    const parent = await harness.runtime.create({
      intent: "first",
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();
    const parentId = String(parent.id);
    const parentSession = (harness.runtime as unknown as { sessions: Map<string, { opencodeSessionId: string | null }> }).sessions.get(parentId);
    parentSession!.opencodeSessionId = "stale-opencode-id";

    const child = await harness.runtime.create({
      intent: "follow-up",
      continuationOf: parentId,
      project: "projects/Project",
      executionEngine: "opencode",
    });
    await harness.flush();
    const childId = String(child.id);
    const childSession = (harness.runtime as unknown as { sessions: Map<string, { opencodeSessionId: string | null }> }).sessions.get(childId);
    assert.equal(childSession?.opencodeSessionId, "stale-opencode-id");

    harness.finish({
      status: "blocked",
      executionEngine: "opencode",
      execution: { exitCode: 1, finishedAt: "2026-06-01T00:00:03.000Z" },
      backendOutput: { stderr: "session not found for --resume stale-opencode-id\n", stdout: "" },
    });
    await harness.flush();

    assert.equal(parentSession?.opencodeSessionId, null);
    assert.equal(childSession?.opencodeSessionId, null);
  });

  test("persists native session id from opencode_session stream event", async () => {
    const harness = await createHarness();
    const session = await harness.runtime.create({ intent: "run opencode" });
    await harness.flush();
    const sessionId = String(session.id);
    harness.emit({ type: "opencode_session", sessionID: "opencode-from-stream", at: "2026-06-03T00:00:00.000Z" });
    const metaPath = path.join(
      (harness.runtime.get(sessionId) as { outDir: string }).outDir,
      "session-meta.json",
    );
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { opencodeSessionId?: string };
    assert.equal(meta.opencodeSessionId, "opencode-from-stream");
  });

  test("desktop create skips knowledge refresh during preparation", async () => {
    let skipKnowledgeRefresh: boolean | undefined;
    const harness = await createHarness(undefined, async (options: { skipKnowledgeRefresh?: boolean; intent?: unknown; project?: unknown }) => {
      skipKnowledgeRefresh = options.skipKnowledgeRefresh;
      return {
        status: "pending",
        generatedAt: "2026-06-01T00:00:00.000Z",
        sessionId: "runtime-session",
        workflowRoot: "",
        task: { intent: options.intent, project: options.project, mapId: null, failureKind: null, taskId: null, files: [], conversationHistory: null },
        profileId: "default",
        execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
      };
    });
    await harness.runtime.create({ intent: "inspect project" });
    await harness.flush();
    assert.equal(skipKnowledgeRefresh, true);
  });

  test("stops preparation without starting the agent backend", async () => {
    const harness = await createPreparingHarness();
    const session = await harness.runtime.create({ intent: "inspect project" });
    const sessionId = String(session.id);
    const received: AgentRuntimeEvent[] = [];
    harness.runtime.subscribe(sessionId, { id: "renderer", write: (event) => received.push(event) });
    await harness.buildStarted;

    const stopped = harness.runtime.stop(sessionId);
    await harness.flush();

    assert.equal(stopped?.status, "stopped");
    assert.equal(harness.preparationAborted, true);
    assert.equal(harness.startDispatchCalls, 0);
    assert.equal(received.filter((event) => event.type === "summary" && event.status === "stopped").length, 1);
  });
});

async function createHarness(
  existingRoot?: string,
  buildDispatchImpl?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>,
  extraDeps: Record<string, unknown> = {},
) {
  const root = existingRoot || makeRoot();
  let emit: (event: AgentRuntimeEvent) => void = () => {};
  let finishDispatch: (dispatch: Record<string, unknown>) => void = () => {};
  let stopCalled = false;
  const destroyed: string[] = [];
  const askGateway = {
    port: 43123,
    async initSession(_sessionId: string, _push: (event: Record<string, unknown>) => void) {},
    registerPushEvent(_sessionId: string, _push: (event: Record<string, unknown>) => void) {},
    async destroySession(sessionId: string) { destroyed.push(sessionId); },
    resolveAnswer(_sessionId: string, askId: string) {
      return askId === "ask-1" ? { ok: true, askType: "plan-approval" } : { ok: false, reason: "missing" };
    },
    async injectEvent() { return { askId: "mock-inject" }; },
    async close() {},
  };
  const defaultBuildDispatch = async (options: Record<string, unknown>) => ({
    status: "pending",
    generatedAt: "2026-06-01T00:00:00.000Z",
    sessionId: "runtime-session",
    workflowRoot: root,
    task: { intent: options.intent, project: options.project, mapId: null, failureKind: null, taskId: null, files: [], conversationHistory: null },
    profileId: options.profileId || "default",
    execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
  });
  const runtime = new AgentSessionRuntime(root, {
    askGateway,
    activateForSession: async () => ({}),
    writeOutputs: () => ({ jsonPath: "", mdPath: "" }),
    buildDispatch: buildDispatchImpl || defaultBuildDispatch,
    startDispatch: (_dispatch: any, _options: any, onEvent: (event: AgentRuntimeEvent) => void) => {
      emit = onEvent;
      emit({ type: "status", status: "running", at: "2026-06-01T00:00:01.000Z" });
      const promise = new Promise<Record<string, unknown>>((resolve) => {
        finishDispatch = (patch) => resolve({
          status: "pass",
          execution: { finishedAt: "2026-06-01T00:00:03.000Z" },
          ...patch,
        });
      });
      return {
        promise,
        stop: () => { stopCalled = true; },
      };
    },
    ...extraDeps,
  } as any);
  await runtime.initialize();
  runtimes.push(runtime);
  return {
    runtime,
    destroyed,
    emit: (event: AgentRuntimeEvent) => emit(event),
    finish: (dispatch: Record<string, unknown>) => finishDispatch(dispatch),
    get stopCalled() { return stopCalled; },
    flush: () => waitForIdle(),
  };
}

async function waitForIdle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function createPreparingHarness() {
  const root = makeRoot();
  let releaseBuild: () => void = () => {};
  let markBuildStarted: () => void = () => {};
  const buildStarted = new Promise<void>((resolve) => { markBuildStarted = resolve; });
  let preparationAborted = false;
  let startDispatchCalls = 0;
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
    buildDispatch: async (options: any) => {
      markBuildStarted();
      await new Promise<void>((resolve, reject) => {
        releaseBuild = resolve;
        options.signal.addEventListener("abort", () => {
          preparationAborted = true;
          reject(new KnowledgeContextAbortedError());
        }, { once: true });
      });
      return {
        status: "pending",
        generatedAt: "2026-06-01T00:00:00.000Z",
        sessionId: options.sessionId,
        workflowRoot: root,
        task: { intent: options.intent, project: options.project, mapId: null, failureKind: null, taskId: null, files: [], conversationHistory: null },
        profileId: options.profileId || "default",
        execution: { timeoutMs: 1000, command: { command: "mock", args: [], display: "mock" } },
      };
    },
    startDispatch: (_dispatch: any, _options: any, onEvent: (event: AgentRuntimeEvent) => void) => {
      startDispatchCalls += 1;
      onEvent({ type: "status", status: "running", at: "2026-06-01T00:00:01.000Z" });
      return { promise: new Promise(() => {}), stop: () => {} };
    },
  } as any);
  await runtime.initialize();
  runtimes.push(runtime);
  return {
    runtime,
    buildStarted,
    releaseBuild: () => releaseBuild(),
    get preparationAborted() { return preparationAborted; },
    get startDispatchCalls() { return startDispatchCalls; },
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-agent-runtime-"));
  roots.push(root);
  return root;
}

async function waitForSessionStatus(
  runtime: AgentSessionRuntime,
  sessionId: string,
  status: string,
  maxTicks = 100,
): Promise<void> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (runtime.get(sessionId)?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`timed out waiting for session ${sessionId} status ${status}`);
}
