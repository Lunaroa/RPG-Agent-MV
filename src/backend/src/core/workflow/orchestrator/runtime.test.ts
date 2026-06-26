import assert from "node:assert/strict";
import { test } from "node:test";

import { runWorkflow, WorkflowAbortedError, defaultMaxConcurrency } from "./runtime.ts";
import type { WorkflowAgentRunner, WorkflowContext, WorkflowModule } from "./types.ts";

function okRunner(text = "ok"): WorkflowAgentRunner {
  return async (request) => ({ ok: true, text, label: request.label });
}

function moduleOf(run: (ctx: WorkflowContext) => Promise<unknown>): WorkflowModule {
  return { name: "test-wf", description: "test", run };
}

const baseOptions = {
  workflowRoot: "/wf",
  project: "/wf/projects/demo",
  makeRunId: () => "wf-fixed",
  now: () => new Date("2026-06-25T00:00:00.000Z"),
};

test("agent() 受 maxConcurrency 限流", async () => {
  let active = 0;
  let maxActive = 0;
  const runner: WorkflowAgentRunner = async (request) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true, text: "ok", label: request.label };
  };
  const module = moduleOf(async (ctx) => {
    await ctx.parallel(Array.from({ length: 8 }, (_v, i) => () => ctx.agent({ label: `a${i}`, prompt: "p" })));
    return "done";
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: runner, limits: { maxConcurrency: 2 } });
  assert.equal(record.status, "completed");
  assert.equal(record.agentCount, 8);
  assert.ok(maxActive <= 2, `maxActive ${maxActive} should be <= 2`);
});

test("超过 maxTotalAgents 抛 WorkflowAbortedError，运行状态 aborted", async () => {
  const module = moduleOf(async (ctx) => {
    await ctx.agent({ label: "a0", prompt: "p" });
    await ctx.agent({ label: "a1", prompt: "p" });
    await ctx.agent({ label: "a2", prompt: "p" }); // 第三次应被硬顶
    return "should-not-reach";
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: okRunner(), limits: { maxTotalAgents: 2 } });
  assert.equal(record.status, "aborted");
  assert.equal(record.agentCount, 2);
  assert.match(String(record.error), /maxTotalAgents/);
});

test("parallel() 是屏障，单个 thunk 抛错 → 该位 null，整体不 reject", async () => {
  const module = moduleOf(async (ctx) => {
    return ctx.parallel<string>([
      async () => "a",
      async () => { throw new Error("boom"); },
      async () => "c",
    ]);
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: okRunner() });
  assert.equal(record.status, "completed");
  assert.deepEqual(record.report, ["a", null, "c"]);
});

test("pipeline() 阶段间无屏障，某项某阶段抛错 → 该项 null", async () => {
  const module = moduleOf(async (ctx) => {
    return ctx.pipeline(
      ["x", "y"],
      (_prev, item) => (item === "y" ? Promise.reject(new Error("bad y")) : `s1:${item}`),
      (prev) => `s2:${prev}`,
    );
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: okRunner() });
  assert.deepEqual(record.report, ["s2:s1:x", null]);
});

test("WorkflowAbortedError 在 parallel 内冒泡（不被吞成 null）", async () => {
  const module = moduleOf(async (ctx) => {
    return ctx.parallel([
      async () => { throw new WorkflowAbortedError("runaway"); },
      async () => "c",
    ]);
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: okRunner() });
  assert.equal(record.status, "aborted");
});

test("外部 abort 后新 agent() 调用抛错", async () => {
  const controller = new AbortController();
  const module = moduleOf(async (ctx) => {
    controller.abort();
    await ctx.agent({ label: "a0", prompt: "p" });
    return "should-not-reach";
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: okRunner(), signal: controller.signal });
  assert.equal(record.status, "aborted");
  assert.equal(record.agentCount, 0);
});

test("token 与 agent 计数汇总", async () => {
  const runner: WorkflowAgentRunner = async (request) => ({ ok: true, text: "ok", label: request.label, inputTokens: 10, outputTokens: 3 });
  const module = moduleOf(async (ctx) => {
    await ctx.agent({ label: "a0", prompt: "p" });
    await ctx.agent({ label: "a1", prompt: "p" });
    return "done";
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: runner });
  assert.equal(record.agentCount, 2);
  assert.equal(record.inputTokens, 20);
  assert.equal(record.outputTokens, 6);
});

test("defaultMaxConcurrency 在 [1,16] 区间", () => {
  const value = defaultMaxConcurrency();
  assert.ok(value >= 1 && value <= 16, `got ${value}`);
});
