import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScriptModule, runScriptInSandbox } from "./script-runtime.ts";
import { runWorkflow } from "./runtime.ts";
import type { WorkflowAgentResult, WorkflowContext, WorkflowStage } from "./types.ts";

// 脚本在独立 vm realm 里跑，return 的对象原型与宿主不同，deepStrictEqual 的原型校验会失败。
// 报告的真实契约是「JSON 可序列化结构」（落 report.json 时就是 JSON.stringify），所以按 JSON 往返比较，
// 正是它被消费的方式。
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// 给沙箱单测用的最小 ctx：原语都是可观测的桩，不碰真实派发。
function fakeCtx(overrides: Partial<WorkflowContext> = {}): { ctx: WorkflowContext; logs: string[] } {
  const logs: string[] = [];
  const ctx: WorkflowContext = {
    agent: async (req) => ({ ok: true, text: `echo:${req.prompt}`, label: req.label }),
    parallel: async (thunks) => Promise.all(thunks.map((t) => t())),
    pipeline: async (items: unknown[], ...stages: WorkflowStage[]) =>
      Promise.all(
        items.map(async (item, index) => {
          let value: unknown = item;
          for (const stage of stages) value = await stage(value, item, index);
          return value;
        }),
      ),
    log: (m) => logs.push(m),
    signal: new AbortController().signal,
    args: { role: "示例角色" },
    workflowRoot: "/wf",
    project: "/p/demo",
    ...overrides,
  };
  return { ctx, logs };
}

test("脚本能 return 报告，并读到 args、用 log 发进度", async () => {
  const { ctx, logs } = fakeCtx();
  const report = await runScriptInSandbox(
    `log("开始审核 " + args.role);
     return { reviewed: args.role, ok: true };`,
    ctx,
  );
  assert.deepEqual(json(report), { reviewed: "示例角色", ok: true });
  assert.deepEqual(logs, ["开始审核 示例角色"]);
});

test("脚本能 await 注入的 agent() 并据结果汇总", async () => {
  const { ctx } = fakeCtx();
  const report = await runScriptInSandbox(
    `const r = await agent({ prompt: "审一段台词", label: "voice" });
     return { text: r.text, ok: r.ok };`,
    ctx,
  );
  assert.deepEqual(json(report), { text: "echo:审一段台词", ok: true });
});

test("脚本能用 parallel 扇出多个子 agent", async () => {
  const { ctx } = fakeCtx();
  const report = await runScriptInSandbox(
    `const rs = await parallel([
       () => agent({ prompt: "a", label: "l0" }),
       () => agent({ prompt: "b", label: "l1" }),
     ]);
     return rs.map(r => r.text);`,
    ctx,
  );
  assert.deepEqual(json(report), ["echo:a", "echo:b"]);
});

test("空脚本 / 纯空白 → fail fast", async () => {
  const { ctx } = fakeCtx();
  await assert.rejects(() => runScriptInSandbox("", ctx), /编排脚本为空/);
  await assert.rejects(() => runScriptInSandbox("   \n  ", ctx), /编排脚本为空/);
});

test("脚本拿不到 require / process / module（缩小逃逸面）", async () => {
  const { ctx } = fakeCtx();
  const report = await runScriptInSandbox(
    `return {
       hasRequire: typeof require,
       hasProcess: typeof process,
       hasModule: typeof module,
       hasGlobalProcess: typeof globalThis.process,
     };`,
    ctx,
  );
  assert.deepEqual(json(report), {
    hasRequire: "undefined",
    hasProcess: "undefined",
    hasModule: "undefined",
    hasGlobalProcess: "undefined",
  });
});

test("注入函数的原型链逃逸被阻断：agent.constructor/apply 为 undefined", async () => {
  const { ctx } = fakeCtx();
  const report = await runScriptInSandbox(
    `let leak = "none";
     try {
       const Fn = agent.constructor && agent.constructor.constructor;
       leak = Fn ? typeof Fn("return process")() : "blocked";
     } catch (e) { leak = "blocked"; }
     return { ctor: typeof agent.constructor, apply: typeof agent.apply, leak };`,
    ctx,
  );
  const r = json(report) as { ctor: string; apply: string; leak: string };
  assert.equal(r.ctor, "undefined", "agent.constructor must be blocked");
  assert.equal(r.apply, "undefined", "agent.apply must be blocked");
  assert.notEqual(r.leak, "object", "must not reach process via agent.constructor.constructor");
});

test("args 经 JSON 往返切断宿主原型链，不触达宿主 process", async () => {
  const { ctx } = fakeCtx();
  const report = await runScriptInSandbox(
    `let leak = "none";
     try {
       const Fn = args.constructor && args.constructor.constructor;
       leak = Fn ? typeof Fn("return process")() : "blocked";
     } catch (e) { leak = "blocked"; }
     return { leak, role: args.role };`,
    ctx,
  );
  const r = json(report) as { leak: string; role: string };
  assert.notEqual(r.leak, "object", "must not reach process via args.constructor.constructor");
  assert.equal(r.role, "示例角色", "args data still readable after JSON round-trip");
});

test("abort 能中断永不 resolve 的脚本（不死锁）", async () => {
  const controller = new AbortController();
  const { ctx } = fakeCtx({ signal: controller.signal });
  const promise = runScriptInSandbox(`await new Promise(() => {}); return "never";`, ctx);
  controller.abort();
  const settled = await Promise.race([
    promise.then(
      () => "resolved",
      (e) => (e instanceof Error ? e.message : String(e)),
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("__timeout__"), 2000)),
  ]);
  assert.match(settled, /aborted/i, `abort must interrupt the hanging script; got: ${settled}`);
});

test("纯计算内置（JSON/Math/Array）在沙箱里可用", async () => {
  const { ctx } = fakeCtx();
  const report = await runScriptInSandbox(
    `return JSON.parse('[1,2,3]').reduce((a, b) => a + b, 0) + Math.max(4, 5);`,
    ctx,
  );
  assert.equal(report, 11);
});

test("无 await 的同步死循环被同步段超时护栏截断", async () => {
  const { ctx } = fakeCtx();
  await assert.rejects(
    () => runScriptInSandbox("while (true) {}", ctx, { syncTimeoutMs: 50 }),
    /编排脚本编译\/启动失败/,
  );
});

test("脚本编译错误被包装成清晰错误", async () => {
  const { ctx } = fakeCtx();
  await assert.rejects(() => runScriptInSandbox("return (", ctx), /编排脚本编译\/启动失败/);
});

test("buildScriptModule：标题/说明回落默认，run 跑脚本", async () => {
  const empty = buildScriptModule({ script: "return 1;" });
  assert.equal(empty.name, "script");
  assert.match(empty.description, /只读/);

  const named = buildScriptModule({ script: "return 1;", title: " 审稿 ", summary: " 审一段台词 " });
  assert.equal(named.name, "审稿");
  assert.equal(named.description, "审一段台词");
});

test("端到端：脚本模块经引擎 runWorkflow 跑通，子 agent 计数/报告归集", async () => {
  let dispatched = 0;
  const fakeRunner = async (): Promise<WorkflowAgentResult> => {
    dispatched += 1;
    return { ok: true, text: "ok", label: "x", inputTokens: 2, outputTokens: 3 };
  };
  const module = buildScriptModule({
    script: `const rs = await parallel([
       () => agent({ prompt: "a", label: "l0" }),
       () => agent({ prompt: "b", label: "l1" }),
     ]);
     log("审完 " + rs.length + " 段");
     return { count: rs.length };`,
    title: "写作审核",
  });
  const events: string[] = [];
  const record = await runWorkflow({
    module,
    agentRunner: fakeRunner,
    workflowRoot: "/wf",
    project: "/p/demo",
    onEvent: (e) => events.push(e.type),
    makeRunId: () => "run-script-1",
    now: () => new Date("2026-06-26T00:00:00.000Z"),
  });
  assert.equal(record.status, "completed");
  assert.equal(record.workflow, "写作审核");
  assert.equal(record.agentCount, 2);
  assert.equal(dispatched, 2);
  assert.deepEqual(json(record.report), { count: 2 });
  assert.equal(record.inputTokens, 4);
  assert.equal(record.outputTokens, 6);
  assert.ok(events.includes("run-start") && events.includes("run-end"));
});
