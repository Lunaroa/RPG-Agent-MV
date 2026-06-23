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
      knowledgeContext: { status: "skipped", mode: "off" } as const,
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
      knowledgeContext: { status: "skipped", mode: "off" } as const,
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
      knowledgeContext: { status: "skipped", mode: "off" } as const,
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: null,
      planFilePath: PLAN_PATH,
    });

    assert.match(prompt, /## Conversation History \(Before This Turn\)/);
    assert.match(prompt, /Session plan file: \.opencode\/plans\/conversations\/root-session\.md/);
    assert.doesNotMatch(prompt, /Project: projects\/Demo/);
  });

  test("produces identical prompt skeleton for zh-CN and en-US product language", () => {
    const baseContext = {
      task: {
        intent: "Create an inn event, but keep character dialogue in Japanese.",
        project: "projects/Demo",
        mapId: "12",
        failureKind: null,
        taskId: null,
        files: [],
        conversationHistory: null,
      },
      registry: { registryPath: "", agents: {}, profiles: {} } as never,
      agent: { id: "default" } as never,
      profileId: "default",
      knowledgeContext: { status: "skipped", mode: "off" } as const,
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: null,
      planFilePath: null,
    };

    const englishPrompt = renderOpencodeUserPrompt({
      ...baseContext,
      productLanguage: "en-US",
    });
    const chinesePrompt = renderOpencodeUserPrompt({
      ...baseContext,
      productLanguage: "zh-CN",
    });

    assert.equal(englishPrompt, chinesePrompt);
    assert.doesNotMatch(englishPrompt, /Product language:/);
  });

  test("uses English conversation history heading regardless of product language", () => {
    const prompt = renderOpencodeUserPrompt({
      task: {
        intent: "Continue the plan",
        project: "projects/Demo",
        mapId: null,
        failureKind: null,
        taskId: null,
        files: [],
        conversationHistory: "User: previous turn\nAssistant: acknowledged",
      },
      registry: { registryPath: "", agents: {}, profiles: {} } as never,
      agent: { id: "default" } as never,
      profileId: "default",
      knowledgeContext: { status: "skipped", mode: "off" } as const,
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: null,
      planFilePath: null,
      productLanguage: "en-US",
    });

    assert.match(prompt, /## Conversation History \(Before This Turn\)/);
    assert.doesNotMatch(prompt, /## 对话历史/);
  });

  test("injects current progress as its own block on compressed continuation prompts", () => {
    const prompt = renderOpencodeUserPrompt({
      task: {
        intent: "Continue from compressed context",
        project: "projects/Demo",
        mapId: null,
        failureKind: null,
        taskId: null,
        files: [],
        conversationHistory: "User: previous\nAssistant: compressed summary",
      },
      registry: { registryPath: "", agents: {}, profiles: {} } as never,
      agent: { id: "default" } as never,
      profileId: "default",
      knowledgeContext: { status: "skipped", mode: "off" } as const,
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: null,
      planFilePath: null,
      currentProgressPreamble: "Previous session: runtime-session-1\nCurrent: Phase 4 progress storage is wired.",
    });

    assert.match(prompt, /## Conversation History \(Before This Turn\)/);
    assert.match(prompt, /## Current Progress/);
    assert.match(prompt, /Phase 4 progress storage is wired/);
    assert.ok(prompt.indexOf("## Conversation History") < prompt.indexOf("## Current Progress"));
    assert.ok(prompt.indexOf("## Current Progress") < prompt.indexOf("Task:\nContinue from compressed context"));
  });

  test("injects the incremental memory preamble on opencode continuation turns", () => {
    const prompt = renderOpencodeUserPrompt({
      task: {
        intent: "继续推进",
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
      knowledgeContext: { status: "skipped", mode: "off" } as const,
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: "opencode-session-123",
      planFilePath: null,
      memoryPreamble: "## Newly relevant memory (for this turn)\n\n### Topic T\n\nINCREMENTAL_BODY",
    });

    // Continuation now carries the incremental recall section...
    assert.match(prompt, /Newly relevant memory/);
    assert.match(prompt, /INCREMENTAL_BODY/);
    // ...while still suppressing the fresh-only project label.
    assert.doesNotMatch(prompt, /Project: projects\/Demo/);
    assert.match(prompt, /Task:\n继续推进/);
  });

  test("injects the full memory preamble before the project label on a fresh session", () => {
    const prompt = renderOpencodeUserPrompt({
      task: {
        intent: "开新会话",
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
      knowledgeContext: { status: "skipped", mode: "off" } as const,
      workflowRoot: "/tmp/workflow",
      opencodeSessionId: null,
      planFilePath: null,
      memoryPreamble: "# Memory (persistent across sessions)\n\nFULL_PREAMBLE_BODY",
    });

    assert.match(prompt, /FULL_PREAMBLE_BODY/);
    assert.match(prompt, /Project: projects\/Demo/);
    // The memory preamble precedes the project label.
    assert.ok(prompt.indexOf("FULL_PREAMBLE_BODY") < prompt.indexOf("Project: projects/Demo"));
  });
});
