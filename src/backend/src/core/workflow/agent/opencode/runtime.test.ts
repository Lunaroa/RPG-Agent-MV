import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildOpencodeServerEnv,
  normalizeOpencodeEvent,
  shouldBlockEmptyOpencodePass,
  shouldFinishOpencodeRunOnSessionIdle,
  stripNativeTaskBlocks,
  type NormalizeState,
} from "./runtime.ts";

function state(promptText = "Project: C:/game\n\nTask:\n仅回复：hello"): NormalizeState {
  return {
    emittedToolCalls: new Set<string>(),
    ignoredTextParts: new Set<string>(),
    promptText,
  };
}

test("normalizes opencode plan tools to desktop plan mode names", () => {
  const enter = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-plan-enter",
        callID: "call-plan-enter",
        type: "tool",
        tool: "plan_enter",
        state: { status: "running", input: {} },
      },
    },
  }, state());
  assert.equal(enter[0]?.type, "tool_call");
  assert.equal(enter[0]?.tool, "EnterPlanMode");

  const exit = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-plan-exit",
        callID: "call-plan-exit",
        type: "tool",
        tool: "plan_exit",
        state: { status: "running", input: {} },
      },
    },
  }, state());
  assert.equal(exit[0]?.type, "tool_call");
  assert.equal(exit[0]?.tool, "ExitPlanMode");
});

test("opencode user prompt echo is not emitted as assistant text", () => {
  const current = state();
  const events = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-user-text",
        type: "text",
        text: "Project: C:/game\n\nTask:\n仅回复：hello",
      },
    },
  }, current);

  assert.deepEqual(events, []);
  assert.equal(current.ignoredTextParts.has("part-user-text"), true);
});

test("ignored prompt echo text part stays ignored across later chunks", () => {
  const current = state();
  normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-user-text",
        type: "text",
        text: "Project: C:/game",
      },
    },
  }, current);

  const events = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      delta: "\n\nTask:\n仅回复：hello",
      part: {
        id: "part-user-text",
        type: "text",
      },
    },
  }, current);

  assert.deepEqual(events, []);
});

test("assistant text that is not the submitted prompt is emitted", () => {
  const events = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-assistant-text",
        type: "text",
        text: "hello",
      },
    },
  }, state());

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "text_delta");
  assert.equal(events[0].text, "hello");
});

test("native task completion blocks are stripped from assistant text", () => {
  const taskBlock = [
    '<task id="ses_child" state="completed">',
    "<summary>Background task completed</summary>",
    "<task_result>",
    "hello from subagent!",
    "</task_result>",
    "</task>",
  ].join("\n");

  const standalone = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-task-text",
        type: "text",
        text: taskBlock,
      },
    },
  }, state());

  assert.deepEqual(standalone, []);

  const mixed = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-mixed-task-text",
        type: "text",
        text: `前文${taskBlock}后文`,
      },
    },
  }, state());

  assert.equal(mixed.length, 1);
  assert.equal(mixed[0]?.type, "text_delta");
  assert.equal(mixed[0]?.text, "前文后文");
});

test("native task stripping does not remove unrelated markup", () => {
  assert.equal(stripNativeTaskBlocks("<note>keep</note>"), "<note>keep</note>");
  assert.equal(stripNativeTaskBlocks("<task>keep</task>"), "<task>keep</task>");
  assert.equal(stripNativeTaskBlocks("<agent-console-ask>{}</agent-console-ask>"), "<agent-console-ask>{}</agent-console-ask>");
  const fenced = '```xml\n<task id="example" state="completed">keep</task>\n```';
  assert.equal(stripNativeTaskBlocks(fenced), fenced);
});

test("task tool metadata links child session events into subagent activity", () => {
  const current = state();
  current.rootSessionId = "ses_parent";

  const launched = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-task",
        callID: "call-task",
        sessionID: "ses_parent",
        type: "tool",
        tool: "task",
        state: {
          status: "running",
          title: "读取地图",
          input: {
            description: "读取地图",
            prompt: "列出地图文件",
            subagent_type: "general",
          },
          metadata: {
            sessionId: "ses_child",
          },
        },
      },
    },
  }, current);

  assert.equal(launched.some((event) => event.type === "tool_call" && event.tool === "Agent"), true);
  const started = launched.find((event) => event.type === "subagent_task_started");
  assert.equal(started?.taskId, "ses_child");
  assert.equal(started?.callId, "call-task");
  assert.equal(started?.prompt, "列出地图文件");

  const childTool = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-child-tool",
        callID: "call-grep",
        sessionID: "ses_child",
        type: "tool",
        tool: "grep",
        state: {
          status: "running",
          title: "搜索 Map 文件",
          input: { pattern: "Map", path: "data" },
        },
      },
    },
  }, current);

  assert.deepEqual(childTool.map((event) => event.type), ["subagent_task_progress"]);
  assert.equal(childTool[0]?.taskId, "ses_child");
  assert.equal(childTool[0]?.lastToolName, "grep");
  assert.deepEqual(childTool[0]?.toolInput, { pattern: "Map", path: "data" });

  const childToolDone = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-child-tool",
        callID: "call-grep",
        sessionID: "ses_child",
        type: "tool",
        tool: "grep",
        state: {
          status: "completed",
          title: "搜索 Map 文件",
          input: { pattern: "Map", path: "data" },
          output: "41 matches",
        },
      },
    },
  }, current);

  assert.equal(childToolDone[0]?.type, "subagent_task_progress");
  assert.equal(childToolDone[0]?.toolStatus, "completed");
  assert.equal(childToolDone[0]?.toolOutput, "41 matches");
});

test("child session idle emits subagent completion notification", () => {
  const current = state();
  current.rootSessionId = "ses_parent";
  current.subagentSessions = new Map([[
    "ses_child",
    {
      taskId: "ses_child",
      callId: "call-task",
      description: "Subagent hello test",
      prompt: "reply hello",
      taskType: "general",
    },
  ]]);
  current.subagentLastTextOutput = new Map([["ses_child", "hello"]]);

  const events = normalizeOpencodeEvent({
    type: "session.idle",
    properties: {
      sessionID: "ses_child",
    },
  }, current);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "subagent_task_notification");
  assert.equal(events[0]?.taskId, "ses_child");
  assert.equal(events[0]?.status, "completed");
  assert.equal(events[0]?.output, "hello");
});

test("only parent session idle should finish opencode run", () => {
  assert.equal(shouldFinishOpencodeRunOnSessionIdle({
    type: "session.idle",
    properties: { sessionID: "ses_parent" },
  }, "ses_parent"), true);
  assert.equal(shouldFinishOpencodeRunOnSessionIdle({
    type: "session.idle",
    properties: { sessionID: "ses_child" },
  }, "ses_parent"), false);
  assert.equal(shouldFinishOpencodeRunOnSessionIdle({
    type: "session.idle",
    properties: {},
  }, "ses_parent"), true);
});

test("subagent child todos do not become parent task board updates", () => {
  const current = state();
  current.rootSessionId = "ses_parent";
  current.subagentSessions = new Map([[
    "ses_child",
    { taskId: "ses_child", callId: "call-task", description: "读取地图" },
  ]]);

  const childTodo = normalizeOpencodeEvent({
    type: "todo.updated",
    properties: {
      sessionID: "ses_child",
      todos: [{ id: "child-todo", content: "子任务自己的 TODO", status: "pending" }],
    },
  }, current);

  assert.deepEqual(childTodo, []);

  const parentTodo = normalizeOpencodeEvent({
    type: "todo.updated",
    properties: {
      sessionID: "ses_parent",
      todos: [{ id: "parent-todo", content: "父 agent TODO", status: "pending" }],
    },
  }, current);

  assert.equal(parentTodo.some((event) => event.type === "todo_updated"), true);
  assert.equal(parentTodo.some((event) => event.tool === "TaskUpdate"), true);
});

test("parent todo updates without ids still emit task update events", () => {
  const current = state();
  current.rootSessionId = "ses_parent";

  const events = normalizeOpencodeEvent({
    type: "todo.updated",
    properties: {
      sessionID: "ses_parent",
      todos: [
        { content: "读取项目事实", status: "completed", priority: "high" },
        { content: "注册事件草稿", status: "in_progress", priority: "medium" },
      ],
    },
  }, current);

  assert.equal(events[0]?.type, "todo_updated");
  assert.deepEqual(events.filter((event) => event.tool === "TaskUpdate").map((event) => event.call_id), [
    "todo:1",
    "todo:2",
  ]);
});

test("opencode question waits for complete input before emitting ASK", () => {
  const current = state();
  current.rootSessionId = "ses_parent";

  const pending = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-question",
        callID: "call-question",
        sessionID: "ses_parent",
        type: "tool",
        tool: "question",
        state: {
          status: "pending",
          input: {},
        },
      },
    },
  }, current);

  assert.equal(pending.some((event) => event.type === "tool_call" && event.tool === "AskUserQuestion"), true);
  assert.equal(pending.some((event) => event.type === "opencode_question_request"), false);

  const running = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-question",
        callID: "call-question",
        sessionID: "ses_parent",
        type: "tool",
        tool: "question",
        state: {
          status: "running",
          input: {
            questions: [{
              header: "事件放置",
              question: "请选择下一步。",
              options: [
                { label: "立即放置", description: "在地图上拖放事件。" },
                { label: "先预览", description: "查看事件内容。" },
              ],
              multiple: true,
            }],
          },
        },
      },
    },
  }, current);

  assert.equal(running.some((event) => event.type === "tool_call"), false);
  const ask = running.find((event) => event.type === "opencode_question_request") as any;
  assert.ok(ask);
  assert.equal(ask.request_id, "call-question");
  assert.equal(ask.request.description, "请选择下一步。");
  assert.deepEqual(ask.request.input.questions, [{
    header: "事件放置",
    question: "请选择下一步。",
    multiSelect: true,
    options: [
      { label: "立即放置", description: "在地图上拖放事件。" },
      { label: "先预览", description: "查看事件内容。" },
    ],
  }]);

  const duplicate = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-question",
        callID: "call-question",
        sessionID: "ses_parent",
        type: "tool",
        tool: "question",
        state: {
          status: "running",
          input: {
            questions: [{
              header: "事件放置",
              question: "请选择下一步。",
              options: [
                { label: "立即放置", description: "在地图上拖放事件。" },
                { label: "先预览", description: "查看事件内容。" },
              ],
              multiple: true,
            }],
          },
        },
      },
    },
  }, current);

  assert.equal(duplicate.some((event) => event.type === "opencode_question_request"), false);

  const refreshed = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-question",
        callID: "call-question",
        sessionID: "ses_parent",
        type: "tool",
        tool: "question",
        state: {
          status: "running",
          input: {
            questions: [{
              header: "事件放置",
              question: "请选择下一步。",
              options: [
                { label: "立即放置", description: "在地图上拖放事件。" },
                { label: "先预览", description: "查看事件内容。" },
                { label: "取消", description: "暂不继续。" },
              ],
              multiple: true,
            }],
          },
        },
      },
    },
  }, current);

  const refreshedAsk = refreshed.find((event) => event.type === "opencode_question_request") as any;
  assert.ok(refreshedAsk);
  assert.deepEqual(refreshedAsk.request.input.questions[0].options.map((option: any) => option.label), [
    "立即放置",
    "先预览",
    "取消",
  ]);
});

test("tool call input is emitted after opencode fills arguments", () => {
  const current = state();
  current.rootSessionId = "ses_parent";

  const pending = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-bash",
        callID: "call-bash",
        sessionID: "ses_parent",
        type: "tool",
        tool: "bash",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      },
    },
  }, current);

  assert.equal(pending.some((event) => event.type === "tool_call" && event.tool === "bash"), true);
  assert.deepEqual(pending.find((event) => event.type === "tool_call")?.input, {});
  assert.equal(current.emittedToolCalls.has("call-bash"), false);

  const running = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-bash",
        callID: "call-bash",
        sessionID: "ses_parent",
        type: "tool",
        tool: "bash",
        state: {
          status: "running",
          title: "git status",
          input: { command: "git status" },
          raw: "{\"command\":\"git status\"}",
        },
      },
    },
  }, current);

  assert.equal(running.some((event) => event.type === "tool_call"), true);
  assert.deepEqual(running.find((event) => event.type === "tool_call")?.input, { command: "git status" });
  assert.equal(current.emittedToolCalls.has("call-bash"), true);

  const completed = normalizeOpencodeEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-bash",
        callID: "call-bash",
        sessionID: "ses_parent",
        type: "tool",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "git status" },
          output: "On branch main",
        },
      },
    },
  }, current);

  assert.equal(completed.some((event) => event.type === "tool_result"), true);
  assert.deepEqual(completed.find((event) => event.type === "tool_result")?.input, { command: "git status" });
});

test("opencode API errors include available status details", () => {
  const events = normalizeOpencodeEvent({
    type: "session.error",
    properties: {
      error: {
        name: "APIError",
        message: "APIError",
        statusCode: 401,
      },
    },
  }, state());

  assert.equal(events[0].type, "stderr");
  assert.match(String(events[0].text), /APIError \(status 401\)/);
  assert.equal(events[1].status, "blocked");
  assert.equal(events[1].blocker, "APIError (status 401)");
});

test("opencode server env isolates config, database, home and xdg paths under project .opencode", () => {
  const workflowRoot = path.resolve("/tmp/app");
  const opencodeRoot = path.join(workflowRoot, ".opencode");
  const env = buildOpencodeServerEnv({
    workflowRoot,
    env: {},
    config: { model: "provider/model" },
  }, {
    XDG_DATA_HOME: "/tmp/host/.local/share",
    XDG_CONFIG_HOME: "/tmp/host/.config",
    HOME: "/tmp/host",
  });

  assert.equal(env.OPENCODE_CONFIG_DIR, opencodeRoot);
  assert.equal(env.OPENCODE_DB, path.join(opencodeRoot, "runtime", "opencode.db"));
  assert.equal(env.HOME, path.join(opencodeRoot, "home"));
  assert.equal(env.OPENCODE_TEST_HOME, path.join(opencodeRoot, "home"));
  assert.equal(env.XDG_DATA_HOME, path.join(opencodeRoot, "xdg", "data"));
  assert.equal(env.XDG_CACHE_HOME, path.join(opencodeRoot, "xdg", "cache"));
  assert.equal(env.XDG_CONFIG_HOME, path.join(opencodeRoot, "xdg", "config"));
  assert.equal(env.XDG_STATE_HOME, path.join(opencodeRoot, "xdg", "state"));
  assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE, "true");
  assert.equal(env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "true");
  assert.equal(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS, "true");
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, undefined);
  assert.equal(env.OPENCODE_DISABLE_EXTERNAL_SKILLS, undefined);
  assert.match(env.OPENCODE_CONFIG_CONTENT, /provider\/model/);
});

test("empty opencode pass is treated as blocked", () => {
  assert.equal(shouldBlockEmptyOpencodePass({
    status: "pass",
    sawAssistantContent: false,
    sawToolActivity: false,
    inputTokens: 0,
    outputTokens: 0,
  }), true);
  assert.equal(shouldBlockEmptyOpencodePass({
    status: "pass",
    sawAssistantContent: true,
    sawToolActivity: false,
    inputTokens: 0,
    outputTokens: 0,
  }), false);
  assert.equal(shouldBlockEmptyOpencodePass({
    status: "pass",
    sawAssistantContent: false,
    sawToolActivity: true,
    inputTokens: 0,
    outputTokens: 0,
  }), false);
});
