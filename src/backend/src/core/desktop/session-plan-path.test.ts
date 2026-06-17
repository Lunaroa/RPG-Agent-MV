import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  allocateSessionPlanFilePath,
  buildConversationPlanRelativePath,
  buildSessionPlanPathPromptLines,
  isConversationPlanPath,
  resolveConversationRootSessionId,
  resolveSessionPlanFilePath,
} from "./session-plan-path.ts";

describe("session plan path isolation", () => {
  test("builds conversation-scoped plan path from root session id", () => {
    assert.equal(
      buildConversationPlanRelativePath("20260617115026655-session-4c9c91c5"),
      ".opencode/plans/conversations/20260617115026655-session-4c9c91c5.md",
    );
    assert.equal(isConversationPlanPath(".opencode/plans/conversations/20260617115026655-session-4c9c91c5.md"), true);
    assert.equal(isConversationPlanPath(".opencode/plans/1710000000000-task.md"), false);
  });

  test("resolves conversation root across parentSessionId chain", () => {
    const sessions = new Map([
      ["root", { id: "root", parentSessionId: null, planFilePath: ".opencode/plans/conversations/root.md" }],
      ["child", { id: "child", parentSessionId: "root", planFilePath: null }],
      ["leaf", { id: "leaf", parentSessionId: "child", planFilePath: null }],
    ]);
    const getSession = (id: string) => sessions.get(id);

    assert.equal(resolveConversationRootSessionId("leaf", getSession), "root");
    assert.equal(
      resolveSessionPlanFilePath(sessions.get("leaf")!, getSession),
      ".opencode/plans/conversations/root.md",
    );
  });

  test("fresh conversation allocates root-scoped plan path", () => {
    const path = allocateSessionPlanFilePath("fresh-root", undefined, () => undefined);
    assert.equal(path, ".opencode/plans/conversations/fresh-root.md");
  });

  test("continuation inherits parent conversation plan path", () => {
    const sessions = new Map([
      ["root", { id: "root", parentSessionId: null, planFilePath: ".opencode/plans/conversations/root.md" }],
      ["child", { id: "child", parentSessionId: "root", planFilePath: ".opencode/plans/conversations/root.md" }],
    ]);
    const getSession = (id: string) => sessions.get(id);
    const path = allocateSessionPlanFilePath("grandchild", sessions.get("child"), getSession);
    assert.equal(path, ".opencode/plans/conversations/root.md");
  });

  test("buildSessionPlanPathPromptLines returns empty for blank path", () => {
    assert.deepEqual(buildSessionPlanPathPromptLines(""), []);
    assert.deepEqual(buildSessionPlanPathPromptLines("   "), []);
  });

  test("buildSessionPlanPathPromptLines anchors plan writes to session file", () => {
    const lines = buildSessionPlanPathPromptLines(".opencode/plans/conversations/root.md");
    assert.equal(lines[0], "Session plan file: .opencode/plans/conversations/root.md");
    assert.match(lines[1], /AGENT_RPG_TMP_DIR/);
    assert.match(lines[1], /logs\/tmp/);
  });
});
