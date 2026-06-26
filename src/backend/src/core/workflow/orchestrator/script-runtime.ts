// 动态工作流 — AI 现写编排脚本的受控运行时。
//
// 对齐 Claude Code 的 ultracode：agent 为任务现写一段 JS 编排脚本，脚本里用 agent()/parallel()/
// pipeline()/log() 扇出子 agent。脚本跑在一个受控 vm 上下文里，只能拿到这几个原语 + args + 纯计算
// 内置，**拿不到 require / process / 文件系统 / 网络**。其中唯一有副作用的 agent() 被引擎强按成只读
// （见 createProductionAgentRunner 与 opencode 配置层），所以脚本无论怎么写都配不出会改工程的子 agent。
//
// 诚实边界：node:vm 不是铜墙铁壁的沙箱——注入的宿主函数仍可经原型链触达宿主 Function，存在逃逸面。
// 真正兜底的是三道闸：发起工具默认关闭（需用户手动开）、每次运行前人工批准且审批卡摆出脚本原文、
// 脚本唯一的副作用能力是只读派发。要更硬的隔离（独立进程/worker、零宿主对象）属于后续加固，非本期。

import vm from "node:vm";

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
  // 只注入原语 + 数据 + console 垫片；纯计算内置（JSON/Math/Array…）由 vm 上下文自带的领域提供，
  // 不从宿主注入，缩小逃逸面。
  const sandbox: Record<string, unknown> = {
    agent: ctx.agent,
    parallel: ctx.parallel,
    pipeline: ctx.pipeline,
    log: ctx.log,
    args: ctx.args,
    project: ctx.project,
    console: { log: (...parts: unknown[]) => ctx.log(parts.map(String).join(" ")) },
  };
  const context = vm.createContext(sandbox, { name: "workflow-script" });

  // async IIFE 包裹：脚本体可直接 await，并用顶层 `return` 交回报告。
  const wrapped = `(async () => {\n"use strict";\n${script}\n})()`;
  let pending: unknown;
  try {
    pending = vm.runInContext(wrapped, context, {
      filename: "workflow-script.js",
      timeout: options.syncTimeoutMs ?? SYNC_GUARD_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(`编排脚本编译/启动失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return await (pending as Promise<unknown>);
}
