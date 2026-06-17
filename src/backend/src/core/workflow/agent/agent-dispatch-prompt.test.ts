import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { renderOpencodeUserPrompt } from "./agent-dispatch.ts";

const PLAN_PATH = ".opencode/plans/conversations/root-session.md";

describe("renderOpencodeUserPrompt plan path injection", () => {
  test("injects session plan file on first turn", () => {
    const prompt = renderOpencodeUserPrompt({
      task: {
        intent: "规划酒馆剧情",
        project: "projects/Demo",
        mapId: null,
        failureKind: null,
        taskId: null,
        files: [],
        conversationHistory: null,
      },
      registry: { registryPath: "", agents: {}, profiles: {} } as never,
      agent: { id: "default" } as never,
      profileId: "default",
      knowledgeContext: { status: "skipped", mode: "off" },
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: null,
      planFilePath: PLAN_PATH,
    });

    assert.match(prompt, /Session plan file: \.opencode\/plans\/conversations\/root-session\.md/);
    assert.match(prompt, /Task:\n规划酒馆剧情/);
    assert.match(prompt, /Project: projects\/Demo/);
  });

  test("injects session plan file on opencode continuation turns", () => {
    const prompt = renderOpencodeUserPrompt({
      task: {
        intent: "继续写计划第二节",
        project: "projects/Demo",
        mapId: null,
        failureKind: null,
        taskId: null,
        files: [],
        conversationHistory: null,
      },
      registry: { registryPath: "", agents: {}, profiles: {} } as never,
      agent: { id: "default" } as never,
      profileId: "default",
      knowledgeContext: { status: "skipped", mode: "off" },
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: "opencode-session-123",
      planFilePath: PLAN_PATH,
    });

    assert.match(prompt, /Session plan file: \.opencode\/plans\/conversations\/root-session\.md/);
    assert.doesNotMatch(prompt, /Project: projects\/Demo/);
    assert.match(prompt, /Task:\n继续写计划第二节/);
  });

  test("injects session plan file when conversation history is replayed without native session", () => {
    const prompt = renderOpencodeUserPrompt({
      task: {
        intent: "续接任务",
        project: "projects/Demo",
        mapId: null,
        failureKind: null,
        taskId: null,
        files: [],
        conversationHistory: "User: 上一轮\nAssistant: 好的",
      },
      registry: { registryPath: "", agents: {}, profiles: {} } as never,
      agent: { id: "default" } as never,
      profileId: "default",
      knowledgeContext: { status: "skipped", mode: "off" },
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: null,
      planFilePath: PLAN_PATH,
    });

    assert.match(prompt, /## 对话历史（本轮之前）/);
    assert.match(prompt, /Session plan file: \.opencode\/plans\/conversations\/root-session\.md/);
    assert.doesNotMatch(prompt, /Project: projects\/Demo/);
  });
});
