// 动态工作流 — AI 现写编排脚本的受控运行时。
//
// 对齐 Claude Code 的 ultracode：agent 为任务现写一段 JS 编排脚本，脚本里用 agent()/parallel()/
// pipeline()/log() 扇出子 agent。脚本跑在一个受控 vm 上下文里，只能拿到这几个原语 + args + 纯计算
// 内置，**拿不到 require / process / 文件系统 / 网络**。其中唯一有副作用的 agent() 被引擎强按成只读
// （见 createProductionAgentRunner 与 opencode 配置层），所以脚本无论怎么写都配不出会改工程的子 agent。
//
// 诚实边界：node:vm 不是铜墙铁壁的沙箱——注入的宿主函数仍可经原型链触达宿主 Function，存在逃逸面。
// 本运行时对注入函数做了原型链加固（Proxy 拦截 constructor/apply 访问）并经 JSON 往返切断 args 的
// 宿主原型链，提高了逃逸门槛，但仍非完全阻断（函数返回的 Promise 等宿主对象仍是潜在逃逸入口）。
// 真正兜底的是：发起工具默认关闭（需用户手动开）、每次运行前人工批准、脚本唯一副作用能力是只读派发。
// 要更硬的隔离（独立进程/worker、零宿主对象）属于后续加固，非本期。

import vm from "node:vm";

import { WorkflowAbortedError } from "./runtime.ts";
import type { WorkflowContext, WorkflowModule } from "./types.ts";

export interface ScriptWorkflowInput {
  /** AI 现写的编排脚本源码（JS，async 体，可 `return` 报告）。 */
  script: string;
  /** AI 写的一句话说明，给审批卡显示，让人快速判断这脚本要干嘛。 */
  summary?: string;
  /** 可选短标题。 */
  title?: string;
}

/** 同步段（编译 + 首个 await 之前）的保护超时：防脚本写出无 await 的死循环卡死运行时。 */
const SYNC_GUARD_TIMEOUT_MS = 5_000;

/** 异步段总超时：覆盖首个 await 之后的整段执行，防永不 resolve 的 Promise 挂死后端。 */
const OVERALL_TIMEOUT_MS = 10 * 60 * 1000;

/** 把宿主函数包成 Proxy：阻断 `fn.constructor.constructor` 这类原型链逃逸，但保留可调用性。 */
function hardenFn<T>(fn: T): T {
  if (typeof fn !== "function") return fn;
  return new Proxy(fn as object, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "constructor" || prop === "apply" || prop === "call" || prop === "bind") return undefined;
      if (prop === "toString") return () => "function";
      if (prop === "name") return "";
      if (prop === "length") return 0;
      return undefined;
    },
    apply(target, thisArg, args) {
      return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
    },
  }) as T;
}

/** 把宿主 args 序列化为字符串，供 vm 上下文内 JSON.parse 重建（切断宿主原型链）。循环引用等异常时返回 undefined。 */
function safeStringifyArgs(args: unknown): string | undefined {
  if (args === undefined) return undefined;
  try {
    return JSON.stringify(args);
  } catch {
    return undefined;
  }
}

/** 把一段 AI 脚本包装成引擎可跑的工作流模块。 */
export function buildScriptModule(input: ScriptWorkflowInput): WorkflowModule {
  return {
    name: input.title?.trim() || "script",
    description: input.summary?.trim() || "AI 现写的只读编排脚本",
    run: (ctx) => runScriptInSandbox(input.script, ctx),
  };
}

export interface RunScriptOptions {
  /** 同步段保护超时（毫秒）。缺省 SYNC_GUARD_TIMEOUT_MS；测试可调小以快速验证死循环护栏。 */
  syncTimeoutMs?: number;
}

/** 在受控 vm 上下文里跑脚本，返回脚本 `return` 的报告。 */
export async function runScriptInSandbox(
  script: string,
  ctx: WorkflowContext,
  options: RunScriptOptions = {},
): Promise<unknown> {
  if (typeof script !== "string" || !script.trim()) {
    throw new Error("编排脚本为空。");
  }
  const consoleShim = Object.assign(Object.create(null), {
    log: hardenFn((...parts: unknown[]) => ctx.log(parts.map(String).join(" "))),
  });
  const sandbox: Record<string, unknown> = {
    agent: hardenFn(ctx.agent),
    parallel: hardenFn(ctx.parallel),
    pipeline: hardenFn(ctx.pipeline),
    log: hardenFn(ctx.log),
    __argsJson: safeStringifyArgs(ctx.args),
    project: ctx.project,
    console: consoleShim,
  };
  const context = vm.createContext(sandbox, { name: "workflow-script" });

  // async IIFE 包裹：脚本体可直接 await，并用顶层 `return` 交回报告。
  // args 经 JSON 往返在 vm 上下文内重建，切断宿主原型链（阻断 args.constructor.constructor 逃逸）。
  const wrapped = `(async () => {\n"use strict";\nconst args = typeof __argsJson === "undefined" ? undefined : JSON.parse(__argsJson);\n${script}\n})()`;
  let pending: unknown;
  try {
    pending = vm.runInContext(wrapped, context, {
      filename: "workflow-script.js",
      timeout: options.syncTimeoutMs ?? SYNC_GUARD_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(`编排脚本编译/启动失败：${error instanceof Error ? error.message : String(error)}`);
  }

  // 异步段总超时 + abort 主动 reject：覆盖首个 await 之后的整段执行，防永不 resolve 的 Promise 挂死后端。
  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
      reject(new WorkflowAbortedError("workflow aborted during script execution"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener("abort", onAbort);
      reject(new Error("编排脚本执行超时"));
    }, OVERALL_TIMEOUT_MS);
    if (ctx.signal.aborted) {
      settled = true;
      clearTimeout(timer);
      reject(new WorkflowAbortedError("workflow aborted during script execution"));
      return;
    }
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    (pending as Promise<unknown>).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
