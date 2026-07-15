import assert from "node:assert/strict";
import { test } from "node:test";

import { runWorkflow, WorkflowAbortedError, defaultMaxConcurrency } from "./runtime.ts";
import { buildScriptModule } from "./script-runtime.ts";
import type { WorkflowAgentRunner, WorkflowContext, WorkflowEvent, WorkflowModule } from "./types.ts";

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

async function settleBefore<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

test("abort 时排队中的 waiter 被快速 reject，不逐个耗尽也不死锁", async () => {
  const controller = new AbortController();
  let fastCalls = 0;
  const runner: WorkflowAgentRunner = async (request, signal) => {
    if (request.label === "slow") {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new WorkflowAbortedError("slow aborted")), { once: true });
      });
      return { ok: true, text: "ok", label: request.label };
    }
    fastCalls += 1;
    return { ok: true, text: "ok", label: request.label };
  };
  const module = moduleOf(async (ctx) => {
    const slow = ctx.agent({ label: "slow", prompt: "p" });
    const fast = ctx.agent({ label: "fast", prompt: "p" });
    controller.abort();
    try { await fast; } catch { /* expected: queued waiter rejected on abort */ }
    try { await slow; } catch { /* slow aborted via signal */ }
    return "done";
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: runner, signal: controller.signal, limits: { maxConcurrency: 1 } });
  assert.equal(record.status, "aborted");
  assert.equal(fastCalls, 0, "queued agent must not execute after abort");
});

test("onEvent(agent-start) 抛错时 permit 不泄漏，后续 agent 仍能执行", async () => {
  let callCount = 0;
  const runner: WorkflowAgentRunner = async (request) => {
    callCount += 1;
    return { ok: true, text: "ok", label: request.label };
  };
  let startCount = 0;
  const throwingOnEvent = (event: WorkflowEvent) => {
    if (event.type === "agent-start") {
      startCount += 1;
      if (startCount === 1) throw new Error("onEvent boom");
    }
  };
  const module = moduleOf(async (ctx) => {
    try { await ctx.agent({ label: "a0", prompt: "p" }); } catch { /* onEvent threw before runner started; swallowed by workflow script */ }
    await ctx.agent({ label: "a1", prompt: "p" });
    return "done";
  });
  const record = await Promise.race([
    runWorkflow({ ...baseOptions, module, agentRunner: runner, onEvent: throwingOnEvent, limits: { maxConcurrency: 1 } }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("deadlock: permit leaked via onEvent throw")), 3000)),
  ]);
  assert.equal(callCount, 1, "first agent's runner never started (onEvent threw before it); second agent must still run, proving no permit leak");
  assert.equal(record.status, "completed");
});

test("runner 抛错时仍发 agent-end(ok:false) 事件", async () => {
  const events: WorkflowEvent[] = [];
  const runner: WorkflowAgentRunner = async () => { throw new Error("runner boom"); };
  const module = moduleOf(async (ctx) => {
    try { await ctx.agent({ label: "a0", prompt: "p" }); } catch { /* expected */ }
    return "done";
  });
  await runWorkflow({ ...baseOptions, module, agentRunner: runner, onEvent: (e) => events.push(e) });
  const ends = events.filter((e) => e.type === "agent-end");
  assert.equal(ends.length, 1, "agent-end should fire even when runner throws");
  assert.equal(ends[0].ok, false);
  assert.match(ends[0].blocker ?? "", /runner boom/);
});

test("module 未 await 子 agent 时，工作流等待子 agent 完成后再结束", async () => {
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let releaseAgent: () => void = () => {};
  const agentGate = new Promise<void>((resolve) => {
    releaseAgent = resolve;
  });
  const runner: WorkflowAgentRunner = async (request) => {
    markStarted();
    await agentGate;
    return { ok: true, text: "done", label: request.label };
  };
  const module = moduleOf(async (ctx) => {
    void ctx.agent({ label: "background", prompt: "p" });
    return "module-done";
  });

  let workflowSettled = false;
  const running = runWorkflow({ ...baseOptions, module, agentRunner: runner })
    .then((record) => {
      workflowSettled = true;
      return record;
    });
  try {
    await started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(workflowSettled, false, "workflow must remain active while its child agent is running");
  } finally {
    releaseAgent();
  }

  const record = await running;
  assert.equal(record.status, "completed");
  assert.equal(record.agentCount, 1);
});

test("module 失败时取消仍在运行的子 agent，并等待其退出", async () => {
  const external = new AbortController();
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let runnerObservedAbort = false;
  const runner: WorkflowAgentRunner = async (_request, signal) => {
    markStarted();
    await new Promise<void>((_resolve, reject) => {
      const onAbort = () => {
        runnerObservedAbort = true;
        reject(new WorkflowAbortedError("child aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    throw new Error("unreachable");
  };
  const module = moduleOf(async (ctx) => {
    void ctx.agent({ label: "background", prompt: "p" });
    await started;
    throw new Error("module boom");
  });

  try {
    const outcome = await settleBefore(
      runWorkflow({ ...baseOptions, module, agentRunner: runner, signal: external.signal }),
      500,
    );
    assert.notEqual(outcome, null, "workflow must not hang while a failed module leaves a child agent running");
    assert.equal(runnerObservedAbort, true);
    assert.equal(outcome?.status, "failed");
    assert.match(String(outcome?.error), /module boom/);
  } finally {
    external.abort();
  }
});

test("脚本总超时时取消已派发的子 agent", async () => {
  const external = new AbortController();
  let runnerObservedAbort = false;
  const runner: WorkflowAgentRunner = async (_request, signal) => {
    await new Promise<void>((_resolve, reject) => {
      const onAbort = () => {
        runnerObservedAbort = true;
        reject(new WorkflowAbortedError("child aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    throw new Error("unreachable");
  };
  const module = buildScriptModule({
    script: `await agent({ label: "slow", prompt: "p" }); return "never";`,
    scriptTimeoutMs: 1_000,
    productLanguage: "zh-CN",
  });

  try {
    const outcome = await settleBefore(
      runWorkflow({ ...baseOptions, module, agentRunner: runner, signal: external.signal }),
      2_500,
    );
    assert.notEqual(outcome, null, "script timeout must cancel its child agent instead of waiting forever");
    assert.equal(runnerObservedAbort, true);
    assert.equal(outcome?.status, "aborted");
    assert.match(String(outcome?.error), /编排脚本执行超时/);
  } finally {
    external.abort();
  }
});

test("abort 后 module.run 正常返回时 status 仍为 aborted（非 completed）", async () => {
  const controller = new AbortController();
  const module = moduleOf(async () => {
    controller.abort();
    return "done";
  });
  const record = await runWorkflow({ ...baseOptions, module, agentRunner: okRunner(), signal: controller.signal });
  assert.equal(record.status, "aborted");
});
