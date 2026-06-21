import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SessionRuntimeEvent } from "../../../../contract/types.ts";
import { withProductLanguage } from '../i18n/request-language.ts';
import { deriveSessionPlan, deriveSessionSubagents, planAskIdForRequest } from './session-derived-state.ts';

describe("session derived state", () => {
  const plan = (sessionId: string, events: SessionRuntimeEvent[]) =>
    withProductLanguage('zh-CN', () => deriveSessionPlan(sessionId, events, 'zh-CN'));
  const subagents = (sessionId: string, events: SessionRuntimeEvent[]) =>
    withProductLanguage('zh-CN', () => deriveSessionSubagents(sessionId, events, 'zh-CN'));

  test("derives opencode plan approval state from request and response events", () => {
    const baseEvents: SessionRuntimeEvent[] = [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-15T01:00:00.000Z",
        call_id: "call-enter",
        tool: "EnterPlanMode",
        input: {},
      },
      {
        type: "tool_result",
        sequence: 2,
        at: "2026-06-15T01:00:01.000Z",
        call_id: "call-enter",
        success: true,
        output: { message: "Plan mode enabled" },
      },
      {
        type: "opencode_permission_request",
        sequence: 3,
        at: "2026-06-15T01:00:02.000Z",
        request_id: "req-plan",
        request: {
          subtype: "can_use_tool",
          tool_name: "ExitPlanMode",
          input: {
            plan: "1. 读取事实\n2. 写入事件",
            planFilePath: "runtime/sessions/s1/plan.md",
          },
        },
      },
    ];

    const awaiting = plan("s1", baseEvents);
    assert.equal(awaiting.mode, "approval_requested");
    assert.equal(awaiting.askId, planAskIdForRequest("req-plan"));
    assert.equal(awaiting.requestId, "req-plan");
    assert.equal(awaiting.filePath, "runtime/sessions/s1/plan.md");
    assert.match(awaiting.planMarkdown, /读取事实/);

    const approved = plan("s1", [
      ...baseEvents,
      {
        type: "opencode_permission_response",
        sequence: 4,
        at: "2026-06-15T01:00:03.000Z",
        request_id: "req-plan",
        response: {
          request_id: "req-plan",
          subtype: "success",
          response: { behavior: "allow" },
        },
        success: true,
      },
    ]);
    assert.equal(approved.mode, "approved");
    assert.equal(approved.error, null);

    const rejected = plan("s1", [
      ...baseEvents,
      {
        type: "opencode_permission_response",
        sequence: 4,
        at: "2026-06-15T01:00:03.000Z",
        request_id: "req-plan",
        response: {
          request_id: "req-plan",
          subtype: "success",
          response: { behavior: "deny", message: "先补地图选择" },
        },
        success: true,
      },
    ]);
    assert.equal(rejected.mode, "rejected");
    assert.equal(rejected.feedback, "先补地图选择");
  });

  test("derives planning state from write/edit to opencode plan file", () => {
    const events: SessionRuntimeEvent[] = [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-15T01:10:00.000Z",
        call_id: "call-write",
        tool: "write",
        input: {
          path: ".opencode/plans/1710000000000-task.md",
          content: "# 计划\n\n1. 读取 Map001",
        },
      },
      {
        type: "tool_result",
        sequence: 2,
        at: "2026-06-15T01:10:01.000Z",
        call_id: "call-write",
        success: true,
        output: "ok",
      },
    ];

    const snapshot = plan("s1", events);
    assert.equal(snapshot.mode, "planning");
    assert.equal(snapshot.filePath, ".opencode/plans/1710000000000-task.md");
    assert.match(snapshot.planMarkdown, /读取 Map001/);
  });

  test("derives planning state from plan_enter tool", () => {
    const snapshot = plan("s1", [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-15T01:20:00.000Z",
        call_id: "call-enter",
        tool: "plan_enter",
        input: {},
      },
    ]);
    assert.equal(snapshot.mode, "planning");
    assert.equal(snapshot.title, "计划模式");
  });

  test("derives opencode subagent launch, output, failure, and stop state", () => {
    const events: SessionRuntimeEvent[] = [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-15T02:00:00.000Z",
        call_id: "call-agent",
        tool: "Agent",
        input: { description: "梳理地图事实", prompt: "读取当前地图" },
      },
      {
        type: "tool_result",
        sequence: 2,
        at: "2026-06-15T02:00:01.000Z",
        call_id: "call-agent",
        success: true,
        output: {
          status: "async_launched",
          taskId: "task-1",
          outputFile: "runtime/out/task-1.txt",
          sessionUrl: "https://example.invalid/session/task-1",
        },
      },
      {
        type: "tool_call",
        sequence: 3,
        at: "2026-06-15T02:00:02.000Z",
        call_id: "call-output",
        tool: "TaskOutput",
        input: { task_id: "task-1" },
      },
      {
        type: "tool_result",
        sequence: 4,
        at: "2026-06-15T02:00:03.000Z",
        call_id: "call-output",
        success: true,
        output: [
          "<retrieval_status>completed</retrieval_status>",
          "<task_id>task-1</task_id>",
          "<task_type>agent</task_type>",
          "<status>completed</status>",
          "<output>地图事实已整理</output>",
        ].join("\n"),
      },
      {
        type: "tool_call",
        sequence: 5,
        at: "2026-06-15T02:00:04.000Z",
        call_id: "call-failed-agent",
        tool: "Agent",
        input: { description: "失败子任务", prompt: "fail" },
      },
      {
        type: "tool_result",
        sequence: 6,
        at: "2026-06-15T02:00:05.000Z",
        call_id: "call-failed-agent",
        success: false,
        output: "subagent unavailable",
      },
      {
        type: "subagent_stop_requested",
        sequence: 7,
        at: "2026-06-15T02:00:06.000Z",
        taskId: "task-1",
        requestId: "stop-1",
      },
      {
        type: "opencode_permission_response",
        sequence: 8,
        at: "2026-06-15T02:00:07.000Z",
        request_id: "stop-1",
        response: {
          request_id: "stop-1",
          subtype: "success",
          response: { behavior: "allow" },
        },
      },
    ];

    const snapshot = subagents("s1", events);
    const task = snapshot.items.find((item) => item.id === "task-1");
    assert.equal(task?.description, "梳理地图事实");
    assert.equal(task?.background, true);
    assert.equal(task?.status, "stopped");
    assert.equal(task?.output, "地图事实已整理");
    assert.equal(task?.outputFile, "runtime/out/task-1.txt");
    assert.equal(task?.sessionUrl, "https://example.invalid/session/task-1");

    const failed = snapshot.items.find((item) => item.description === "失败子任务");
    assert.equal(failed?.status, "failed");
    assert.match(failed?.error || "", /subagent unavailable/);
  });

  test("derives native opencode subagent task events", () => {
    const runningEvents: SessionRuntimeEvent[] = [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-15T03:00:00.000Z",
        call_id: "call-agent",
        tool: "Agent",
        input: { description: "测试子 Agent 代码搜索", prompt: "搜索插件" },
      },
      {
        type: "tool_result",
        sequence: 2,
        at: "2026-06-15T03:00:01.000Z",
        call_id: "call-agent",
        success: true,
        output: { status: "async_launched", taskId: "task-search" },
      },
      {
        type: "subagent_task_started",
        sequence: 3,
        at: "2026-06-15T03:00:02.000Z",
        taskId: "task-search",
        callId: "call-agent",
        description: "测试子 Agent 代码搜索",
        prompt: "搜索插件",
        taskType: "agent",
      },
      {
        type: "subagent_task_progress",
        sequence: 4,
        at: "2026-06-15T03:00:03.000Z",
        taskId: "task-search",
        callId: "call-agent",
        description: "测试子 Agent 代码搜索",
        taskType: "agent",
        lastToolName: "Grep",
        detail: "搜索地图",
        toolInput: { pattern: "Map", path: "data" },
        toolOutput: "41 matches",
        toolStatus: "completed",
      },
    ];

    const running = subagents("s1", runningEvents).items.find((item) => item.id === "task-search");
    assert.equal(running?.description, "测试子 Agent 代码搜索");
    assert.equal(running?.status, "running");
    assert.equal(running?.taskType, "agent");
    assert.deepEqual(
      running?.activity?.map((entry) => entry.kind),
      ["started", "progress", "started", "progress"],
    );
    assert.equal(running?.activity?.at(-1)?.title, "正在使用 Grep");
    assert.equal(running?.activity?.at(-1)?.tool, "Grep");
    assert.deepEqual(running?.activity?.at(-1)?.input, { pattern: "Map", path: "data" });
    assert.equal(running?.activity?.at(-1)?.output, "41 matches");
    assert.equal(running?.activity?.at(-1)?.status, "completed");

    const completed = subagents("s1", [
      ...runningEvents,
      {
        type: "subagent_task_notification",
        sequence: 5,
        at: "2026-06-15T03:00:04.000Z",
        taskId: "task-search",
        callId: "call-agent",
        status: "completed",
        outputFile: "runtime/out/task-search.txt",
        output: "找到 5 个文件",
      },
    ]).items.find((item) => item.id === "task-search");
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.outputFile, "runtime/out/task-search.txt");
    assert.equal(completed?.output, "找到 5 个文件");
    assert.equal(completed?.activity?.at(-1)?.kind, "notification");
    assert.equal(completed?.activity?.at(-1)?.title, "子任务完成");
    assert.equal(completed?.activity?.at(-1)?.outputFile, "runtime/out/task-search.txt");

    const terminal = subagents("s1", [
      {
        type: "subagent_task_started",
        sequence: 1,
        at: "2026-06-15T04:00:00.000Z",
        taskId: "task-failed",
        description: "失败任务",
      },
      {
        type: "subagent_task_notification",
        sequence: 2,
        at: "2026-06-15T04:00:01.000Z",
        taskId: "task-failed",
        status: "failed",
        output: "执行失败",
      },
      {
        type: "subagent_task_started",
        sequence: 3,
        at: "2026-06-15T04:00:02.000Z",
        taskId: "task-stopped",
        description: "停止任务",
      },
      {
        type: "subagent_task_notification",
        sequence: 4,
        at: "2026-06-15T04:00:03.000Z",
        taskId: "task-stopped",
        status: "stopped",
        output: "已停止",
      },
      {
        type: "subagent_task_started",
        sequence: 5,
        at: "2026-06-15T04:00:04.000Z",
        taskId: "task-timeout",
        description: "超时任务",
      },
      {
        type: "subagent_task_notification",
        sequence: 6,
        at: "2026-06-15T04:00:05.000Z",
        taskId: "task-timeout",
        status: "timeout",
        output: "超时",
      },
    ]);
    assert.equal(terminal.items.find((item) => item.id === "task-failed")?.status, "failed");
    assert.match(terminal.items.find((item) => item.id === "task-failed")?.error || "", /执行失败/);
    assert.equal(terminal.items.find((item) => item.id === "task-stopped")?.status, "stopped");
    assert.equal(terminal.items.find((item) => item.id === "task-timeout")?.status, "timeout");
  });

  test("handles Agent tool_result with completed placeholder output", () => {
    const snapshot = subagents("s1", [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-17T12:00:00.000Z",
        call_id: "call-agent",
        tool: "Agent",
        input: { description: "子任务", prompt: "reply hello" },
      },
      {
        type: "tool_result",
        sequence: 2,
        at: "2026-06-17T12:00:01.000Z",
        call_id: "call-agent",
        success: true,
        output: "Agent completed.",
      },
    ]);

    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0]?.status, "completed");
    assert.equal(snapshot.items[0]?.output, null);
    assert.equal(snapshot.items[0]?.background, false);
  });

  test("handles Agent tool_result with null output during subagent tracking", () => {
    const snapshot = subagents("s1", [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-17T12:00:00.000Z",
        call_id: "call-agent",
        tool: "Agent",
        input: null as unknown as Record<string, unknown>,
      },
      {
        type: "tool_result",
        sequence: 2,
        at: "2026-06-17T12:00:01.000Z",
        call_id: "call-agent",
        success: true,
        output: null,
      },
    ]);

    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0]?.status, "completed");
    assert.equal(snapshot.items[0]?.background, false);
  });

  test("handles duplicate Agent tool_call with empty then populated input", () => {
    const snapshot = subagents("s1", [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-17T12:03:05.970Z",
        call_id: "call-agent",
        tool: "Agent",
        input: {},
      },
      {
        type: "subagent_task_started",
        sequence: 2,
        at: "2026-06-17T12:03:06.580Z",
        taskId: "ses_child",
        callId: "call-agent",
        description: "Subagent say hello",
        prompt: "reply hello",
        taskType: "general",
      },
      {
        type: "tool_call",
        sequence: 3,
        at: "2026-06-17T12:03:06.580Z",
        call_id: "call-agent",
        tool: "Agent",
        input: {
          description: "Subagent say hello",
          prompt: "reply hello",
          subagent_type: "general",
        },
      },
      {
        type: "subagent_task_notification",
        sequence: 4,
        at: "2026-06-17T12:03:08.261Z",
        taskId: "ses_child",
        callId: "call-agent",
        status: "completed",
        output: "hello",
      },
      {
        type: "tool_result",
        sequence: 5,
        at: "2026-06-17T12:03:08.262Z",
        call_id: "call-agent",
        success: true,
        output: "<task id=\"ses_child\" state=\"completed\">\n<task_result>\nhello\n</task_result>\n</task>",
      },
    ]);

    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0]?.id, "ses_child");
    assert.equal(snapshot.items[0]?.status, "completed");
    assert.equal(snapshot.items[0]?.output, "hello");
    assert.equal(snapshot.items[0]?.background, false);
  });

  test("queued opencode notification completes a launched subagent", () => {
    const snapshot = subagents("s1", [
      {
        type: "tool_call",
        sequence: 1,
        at: "2026-06-15T05:00:00.000Z",
        call_id: "call-agent",
        tool: "Agent",
        input: { description: "验证任务", prompt: "检查项目" },
      },
      {
        type: "tool_result",
        sequence: 2,
        at: "2026-06-15T05:00:01.000Z",
        call_id: "call-agent",
        success: true,
        output: { status: "async_launched", taskId: "task-queued" },
      },
      {
        type: "subagent_task_notification",
        sequence: 3,
        at: "2026-06-15T05:00:02.000Z",
        taskId: "task-queued",
        callId: "call-agent",
        status: "completed",
        outputFile: "runtime/out/task-queued.txt",
        output: "Agent completed",
      },
    ]);

    const item = snapshot.items.find((entry) => entry.id === "task-queued");
    assert.equal(item?.status, "completed");
    assert.equal(item?.output, null);
    assert.equal(item?.activity?.at(-1)?.kind, "notification");
  });
});
