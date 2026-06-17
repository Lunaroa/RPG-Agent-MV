import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  hydrateSessionPlanFromFile,
  isOpencodePlanPath,
  planPathFromToolInput,
  readPlanFile,
} from "./session-plan-file.ts";

describe("session plan file helpers", () => {
  test("detects opencode plan paths", () => {
    assert.equal(isOpencodePlanPath(".opencode/plans/1710000000000-task.md"), true);
    assert.equal(isOpencodePlanPath(".opencode/plans/conversations/root-session.md"), true);
    assert.equal(isOpencodePlanPath("PLAN.md"), true);
    assert.equal(isOpencodePlanPath("data/Map001.json"), false);
  });

  test("extracts plan path from write tool input", () => {
    assert.equal(
      planPathFromToolInput({ path: ".opencode/plans/1710000000000-task.md", content: "# Plan" }),
      ".opencode/plans/1710000000000-task.md",
    );
    assert.equal(planPathFromToolInput({ path: "Map001.json" }), null);
  });

  test("hydrates plan markdown from project-local plan file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-plan-"));
    const project = path.join(root, "projects", "Demo");
    const planRelative = ".opencode/plans/1710000000000-task.md";
    fs.mkdirSync(path.join(project, ".opencode", "plans"), { recursive: true });
    fs.writeFileSync(path.join(project, planRelative), "# 测试计划\n\n1. 读取事实", "utf8");

    const hydrated = hydrateSessionPlanFromFile(root, "projects/Demo", {
      sessionId: "s1",
      mode: "planning",
      title: "计划模式",
      planMarkdown: "",
      askId: null,
      requestId: null,
      filePath: planRelative,
      feedback: null,
      error: null,
      updatedAt: null,
    });

    assert.match(hydrated.planMarkdown, /测试计划/);
    assert.equal(readPlanFile(root, "projects/Demo", planRelative), hydrated.planMarkdown);
  });
});
