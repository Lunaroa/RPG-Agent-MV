import assert from "node:assert/strict";
import os from "node:os";
import { describe, test } from "node:test";

import {
  assessDispatchBackendOutput,
  assessAgentRuntimeOutcome,
  buildExternalDirectoryAllowList,
  buildPermissionFailureUserMessage,
  containsNativeSessionResumeFailure,
  containsRuntimePermissionDenial,
  isPermissionSkippedToolResult,
  PERMISSION_DENIAL_MODEL_HINT,
} from "./runtime-issues.ts";

describe("runtime-issues", () => {
  test("detects native session resume failures in stderr", () => {
    assert.equal(containsNativeSessionResumeFailure("session not found for --resume abc\n"), true);
    assert.equal(containsNativeSessionResumeFailure("could not resume session"), true);
    assert.equal(containsNativeSessionResumeFailure("Agent finished normally"), false);
  });

  test("detects external_directory permission denial", () => {
    assert.equal(
      containsRuntimePermissionDenial(
        "permission requested: external_directory (C:\\repo\\); auto-rejecting"
      ),
      true
    );
    assert.equal(containsRuntimePermissionDenial("List failed"), false);
  });

  test("buildExternalDirectoryAllowList includes workflow only", () => {
    const allow = buildExternalDirectoryAllowList("/tmp/app");
    const keys = Object.keys(allow);
    const home = os.homedir().replace(/\\/g, "/");
    assert.ok(keys.some((k) => k.includes("/wf/RPG-Agent-MV/**")));
    assert.ok(!keys.some((k) => k.endsWith("/wf/rules/**")));
    assert.ok(!keys.some((k) => k.startsWith(`${home}/`)));
    assert.ok(keys.every((k) => allow[k] === "allow"));
  });

  test("isPermissionSkippedToolResult detects denial in tool output", () => {
    assert.equal(
      isPermissionSkippedToolResult("permission requested: external_directory (C:/x/); auto-rejecting", false),
      true
    );
    assert.equal(isPermissionSkippedToolResult("file not found", false), false);
  });

  test("upgrades silent pass to blocked when permission denied without assistant text", () => {
    const outcome = assessAgentRuntimeOutcome({
      exitCode: 0,
      stopped: false,
      timedOut: false,
      renderedStdout: "permission requested: external_directory (C:/x/); auto-rejecting\n",
      stderr: "",
    });
    assert.equal(outcome.status, "blocked");
    assert.equal(outcome.hadPermissionDenial, true);
    assert.equal(outcome.hadAssistantText, false);
    assert.match(outcome.blocker || "", /目录权限/);
    assert.match(outcome.userMessage || "", /external_directory/);
    assert.match(buildPermissionFailureUserMessage(), /地图编辑/);
    assert.match(buildPermissionFailureUserMessage(), /RPG-Agent-MV/);
    assert.doesNotMatch(buildPermissionFailureUserMessage(), /rules\/\*\*/);
    assert.match(PERMISSION_DENIAL_MODEL_HINT, /AGENT_GUIDE/);
  });

  test("keeps pass when assistant produced text despite permission noise", () => {
    const outcome = assessAgentRuntimeOutcome({
      exitCode: 0,
      stopped: false,
      timedOut: false,
      renderedStdout:
        "permission requested: external_directory (C:/x/); auto-rejecting\n\n" +
        "Sample assistant output for chapter outline.\n",
      stderr: "",
    });
    assert.equal(outcome.status, "pass");
    assert.equal(outcome.hadAssistantText, true);
    assert.ok(outcome.userMessage);
  });

  test("keeps successful daemon turn as pass when no process exit code exists", () => {
    const outcome = assessDispatchBackendOutput({
      status: "pass",
      blocker: null,
      execution: { exitCode: null, timedOut: false },
      backendOutput: {
        stdout: "三个测试全部完成，汇总如下：事件注册成功，Task 系统正常。\n",
        stderr: "",
      },
    });

    assert.equal(outcome?.status, "pass");
    assert.equal(outcome?.blocker, null);
  });

  test("still blocks successful daemon turn when permission denial produced no reply", () => {
    const outcome = assessDispatchBackendOutput({
      status: "pass",
      blocker: null,
      execution: { exitCode: null, timedOut: false },
      backendOutput: {
        stdout: "permission requested: external_directory (C:/x/); auto-rejecting\n",
        stderr: "",
      },
    });

    assert.equal(outcome?.status, "blocked");
    assert.match(outcome?.blocker || "", /目录权限/);
  });
});
