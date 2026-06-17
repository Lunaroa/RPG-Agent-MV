import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

import {
  AGENT_SKILL_OUTPUT_DIR_REL,
  AGENT_TMP_DIR_REL,
  buildAgentOutputEnv,
} from "./agent-output-dirs.ts";
import { resolveWorkflowRoot } from "../../workspace-paths.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("agent output dirs", () => {
  test("builds scoped env vars and creates project-local output dirs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-output-dirs-"));
    roots.push(root);

    const env = buildAgentOutputEnv(root);

    assert.equal(env.AGENT_RPG_TMP_DIR, path.join(root, AGENT_TMP_DIR_REL).replace(/\\/g, "/"));
    assert.equal(env.AGENT_RPG_SKILL_OUTPUT_DIR, path.join(root, AGENT_SKILL_OUTPUT_DIR_REL).replace(/\\/g, "/"));
    assert.equal(fs.statSync(path.join(root, AGENT_TMP_DIR_REL)).isDirectory(), true);
    assert.equal(fs.statSync(path.join(root, AGENT_SKILL_OUTPUT_DIR_REL)).isDirectory(), true);
    assert.equal(env.AGENT_RPG_TMP_DIR.includes("runtime/sessions"), false);
  });

  test("default agent scratch points at project-local opencode tmp logs", () => {
    const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
    const config = fs.readFileSync(path.join(workflowRoot, "config", "agents", "default", "agent.yaml"), "utf8");

    assert.match(config, /"scratch": "\.opencode\/logs\/tmp"/);
    assert.doesNotMatch(config, /runtime\/sessions\/\{session_id\}\/default/);
  });

  test("native agent rules point temporary and skill outputs at opencode logs", () => {
    const workflowRoot = resolveWorkflowRoot(import.meta.dirname);
    const rules = fs.readFileSync(path.join(workflowRoot, "config", "opencode", "AGENTS.md"), "utf8");

    assert.match(rules, /AGENT_RPG_TMP_DIR/);
    assert.match(rules, /AGENT_RPG_SKILL_OUTPUT_DIR/);
    assert.match(rules, /\.opencode\/logs\/tmp/);
    assert.match(rules, /\.opencode\/logs\/skills/);
    assert.match(rules, /config\/opencode\/skills\/` 是正式 skill 区/);
    assert.match(rules, /AGENT_RPG_SESSION_PLAN_PATH/);
    assert.match(rules, /每轮 Task/);
    assert.match(rules, /禁止.*AGENT_RPG_TMP_DIR/);
    assert.match(rules, /禁止元流程提问/);
    assert.match(rules, /应用到待放置队列/);
    assert.match(rules, /桌面端地图画布/);
    assert.match(rules, /禁止.*editor\.update/);
    assert.match(rules, /只有用户明确要求直接写入地图 JSON/);
    assert.match(rules, /TASK 只指父 Agent 当前会话的 todo-list/);
    assert.match(rules, /`task` 工具是 subagent 调用/);
  });
});
