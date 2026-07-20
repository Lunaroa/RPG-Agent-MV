import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { renderOpencodeUserPrompt } from "./agent-dispatch.ts";
import type { AgentProjectBindingSnapshot } from "../../desktop/agent-project-binding.ts";

test("injects a source-only project block once before the first task", () => {
  const binding = sourceBinding(1);
  const prompt = renderOpencodeUserPrompt(context(binding, "fresh"));
  assert.match(prompt, /## Current Project/);
  assert.match(prompt, /source-only editable project/);
  assert.match(prompt, /requires selecting a compatible runtime/);
  assert.ok(prompt.indexOf("## Current Project") < prompt.indexOf("Task:"));

  const continuation = renderOpencodeUserPrompt({
    ...context(binding, "none"),
    opencodeSessionId: "native-session",
  });
  assert.doesNotMatch(continuation, /## Current Project/);
});

test("injects one project-changed block without replaying the old binding", () => {
  const next = sourceBinding(2);
  const prompt = renderOpencodeUserPrompt({
    ...context(next, "changed"),
    opencodeSessionId: "native-session",
  });
  assert.match(prompt, /## Current Project Changed/);
  assert.match(prompt, /previous project are historical context only/);
  assert.equal((prompt.match(/Bound project:/g) || []).length, 1);
});

test("no-project prompt explicitly limits the turn to safe conversation", () => {
  const binding: AgentProjectBindingSnapshot = {
    ...sourceBinding(3),
    status: "none",
    canonicalPath: null,
    displayName: null,
    projectId: null,
    engine: null,
    engineVersion: null,
    editable: false,
    runtimeReason: "missing",
  };
  const prompt = renderOpencodeUserPrompt(context(binding, "fresh"));
  assert.match(prompt, /No RPG Maker project is currently selected/);
  assert.match(prompt, /project files, commands, subagents, project memory, and RPG Maker tools are disabled/);
});

function context(binding: AgentProjectBindingSnapshot, projectPromptKind: "fresh" | "changed" | "none") {
  return {
    task: {
      intent: "Inspect the selected project.",
      project: binding.canonicalPath,
      mapId: null,
      failureKind: null,
      taskId: null,
      files: [],
      conversationHistory: null,
    },
    productLanguage: "en-US" as const,
    registry: {} as never,
    agent: {} as never,
    profileId: "default",
    workflowRoot: path.join(os.tmpdir(), "workflow-root"),
    projectEngine: null,
    projectBinding: binding,
    projectPromptKind,
  };
}

function sourceBinding(version: number): AgentProjectBindingSnapshot {
  const project = path.join(os.tmpdir(), "projects", `source-project-${version}`);
  return {
    status: "bound",
    version,
    canonicalPath: project,
    displayName: `source-project-${version}`,
    projectId: `project-${version}`,
    engine: "rpg-maker-mv",
    engineVersion: "1.6.2",
    editable: true,
    runnableStructure: false,
    runtimeAvailable: false,
    runtimeSource: null,
    runtimeReason: "missing",
  };
}
