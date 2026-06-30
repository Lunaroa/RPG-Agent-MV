// 动态工作流 — AI 现写编排脚本的受控运行时。
//
// 脚本在独立 Worker 线程里经 node:vm 执行；agent/log 经 RPC 回主进程真实 WorkflowContext。
// 主进程保留 agent 派发与 createProductionAgentRunner；挂死时 worker.terminate() 不阻塞主事件循环。

import { Worker } from "node:worker_threads";

import { WorkflowAbortedError } from "./runtime.ts";
import type { WorkflowAgentRequest, WorkflowContext, WorkflowModule } from "./types.ts";

export interface ScriptWorkflowInput {
  /** AI 现写的编排脚本源码（JS，async 体，可 `return` 报告）。 */
  script: string;
  /** AI 写的一句话说明，给审批卡显示，让人快速判断这脚本要干嘛。 */
  summary?: string;
  /** 可选短标题。 */
  title?: string;
  /** 异步段总超时（毫秒）。缺省 DEFAULT_OVERALL_TIMEOUT_MS（挂死兜底）；按工作流规模传入更贴切的预算。 */
  scriptTimeoutMs?: number;
}

/** 同步段（编译 + 首个 await 之前）的保护超时：防脚本写出无 await 的死循环卡死 Worker。 */
const SYNC_GUARD_TIMEOUT_MS = 5_000;

/**
 * 异步段总超时兜底：覆盖首个 await 之后的整段执行，防永不 resolve 的 Promise / 死循环挂死后端。
 * 注意这是「挂死兜底」而非「合法运行时长限制」——单个子 agent 默认 10 分钟、maxTotalAgents 默认 1000，
 * 多阶段扇出工作流的 wall time 远超 10 分钟。故放大到 6 小时仅作挂死保险；调用方可按工作流规模
 * 经 RunScriptOptions.scriptTimeoutMs / RunWorkflowOptions.scriptTimeoutMs 传入更贴切的预算。
 */
const DEFAULT_OVERALL_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const WORKER_URL = new URL("./script-runtime.worker.ts", import.meta.url);
const WORKER_EXEC_ARGV = ["--experimental-strip-types", "--experimental-transform-types"] as const;

/** 把宿主 args 序列化为字符串，供 Worker vm 上下文内 JSON.parse 重建（切断宿主原型链）。 */
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
  const scriptTimeoutMs = input.scriptTimeoutMs;
  return {
    name: input.title?.trim() || "script",
    description: input.summary?.trim() || "AI 现写的只读编排脚本",
    run: (ctx) => runScriptInSandbox(input.script, ctx, scriptTimeoutMs != null ? { scriptTimeoutMs } : {}),
  };
}

export interface RunScriptOptions {
  /** 同步段保护超时（毫秒）。缺省 SYNC_GUARD_TIMEOUT_MS；测试可调小以快速验证死循环护栏。 */
  syncTimeoutMs?: number;
  /** 异步段总超时（毫秒）。缺省 DEFAULT_OVERALL_TIMEOUT_MS（挂死兜底）；按工作流规模传入更贴切的预算。 */
  scriptTimeoutMs?: number;
}

type WorkerOutbound =
  | { type: "rpc"; id: number; method: "agent" | "log"; args: unknown }
  | { type: "done"; value: unknown }
  | { type: "fail"; message: string; name?: string };

/** 在 Worker + vm 隔离里跑脚本，返回脚本 `return` 的报告。 */
export async function runScriptInSandbox(
  script: string,
  ctx: WorkflowContext,
  options: RunScriptOptions = {},
): Promise<unknown> {
  if (typeof script !== "string" || !script.trim()) {
    throw new Error("编排脚本为空。");
  }

  const overallTimeoutMs = options.scriptTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
  const syncTimeoutMs = options.syncTimeoutMs ?? SYNC_GUARD_TIMEOUT_MS;

  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_URL, { execArgv: [...WORKER_EXEC_ARGV] });
    const inFlightAgents = new Set<Promise<unknown>>();

    const settle = (fn: () => void | Promise<void>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
      void worker.terminate();
      void Promise.resolve(fn()).catch(() => undefined);
    };

    const onAbort = () => {
      worker.postMessage({ type: "abort" });
      settle(async () => {
        await Promise.allSettled([...inFlightAgents]);
        reject(new WorkflowAbortedError("workflow aborted during script execution"));
      });
    };

    const timer = setTimeout(() => {
      const timeoutError = new Error("编排脚本执行超时");
      worker.postMessage({ type: "abort" });
      settle(async () => {
        await Promise.allSettled([...inFlightAgents]);
        reject(timeoutError);
      });
      ctx.abort(timeoutError);
    }, overallTimeoutMs);

    if (ctx.signal.aborted) {
      void worker.terminate();
      reject(new WorkflowAbortedError("workflow aborted during script execution"));
      return;
    }
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    worker.on("message", (msg: WorkerOutbound) => {
      if (msg.type === "rpc") {
        if (msg.method === "log") {
          ctx.log(String(msg.args));
          worker.postMessage({ type: "rpc-result", id: msg.id, value: null });
          return;
        }
        if (msg.method === "agent") {
          const flight = ctx
            .agent(msg.args as WorkflowAgentRequest)
            .then((value) => {
              inFlightAgents.delete(flight);
              worker.postMessage({ type: "rpc-result", id: msg.id, value });
            })
            .catch((error: unknown) => {
              inFlightAgents.delete(flight);
              worker.postMessage({
                type: "rpc-error",
                id: msg.id,
                message: error instanceof Error ? error.message : String(error),
                name: error instanceof Error ? error.name : undefined,
              });
            });
          inFlightAgents.add(flight);
        }
        return;
      }
      if (msg.type === "done") {
        settle(async () => {
          await Promise.all([...inFlightAgents]);
          resolve(msg.value);
        });
        return;
      }
      if (msg.type === "fail") {
        settle(async () => {
          if (msg.name === "WorkflowAbortedError") {
            reject(new WorkflowAbortedError(msg.message));
          } else {
            reject(new Error(msg.message));
          }
          await Promise.allSettled([...inFlightAgents]);
        });
      }
    });

    worker.on("error", (error) => {
      settle(() => reject(error));
    });

    worker.on("exit", (code) => {
      if (settled) return;
      settle(() =>
        reject(
          code === 0
            ? new Error("编排脚本 worker 意外退出")
            : new Error("编排脚本执行超时"),
        ),
      );
    });

    worker.postMessage({
      type: "run",
      script,
      argsJson: safeStringifyArgs(ctx.args),
      project: ctx.project,
      syncTimeoutMs,
    });
  });
}
