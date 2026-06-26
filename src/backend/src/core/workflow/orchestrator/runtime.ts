// 动态工作流引擎 — 运行时核心。
//
// 职责：① 用信号量把并发的 agent() 调用压在 maxConcurrency 以内；② 用总数上限
// maxTotalAgents 给跑飞的工作流兜底；③ 实现 parallel()/pipeline()/log() 原语；
// ④ 把每个子 agent 的开始/结束与最终运行记录发成事件。引擎本身不碰文件系统、不调 LLM，
// 只通过注入的 WorkflowAgentRunner 扇出子 agent —— 这让逻辑可以脱离真实派发被测试。

import os from "node:os";

import type {
  WorkflowAgentRequest,
  WorkflowAgentResult,
  WorkflowAgentRunner,
  WorkflowContext,
  WorkflowEvent,
  WorkflowLimits,
  WorkflowModule,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowStage,
} from "./types.ts";

const DEFAULT_MAX_TOTAL_AGENTS = 1000;

/** 默认并发：min(16, cpu核数-2)，至少 1。对齐 Claude Code 动态工作流的本地资源约束。 */
export function defaultMaxConcurrency(): number {
  const cores = Math.max(1, os.cpus()?.length || 1);
  return Math.max(1, Math.min(16, cores - 2));
}

export function defaultLimits(): WorkflowLimits {
  return { maxConcurrency: defaultMaxConcurrency(), maxTotalAgents: DEFAULT_MAX_TOTAL_AGENTS };
}

/** 极简计数信号量：acquire 拿不到就排队，release 唤醒下一个。 */
class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.permits += 1;
  }
}

export interface RunWorkflowOptions {
  /** 已构造好的工作流模块。 */
  module: WorkflowModule;
  /** 底层子 agent 执行器（生产=真实派发；测试=假实现）。 */
  agentRunner: WorkflowAgentRunner;
  workflowRoot: string;
  project: string;
  /** 工作流参数。 */
  args?: unknown;
  /** 护栏；缺省 defaultLimits()。 */
  limits?: Partial<WorkflowLimits>;
  /** 外部中止信号。 */
  signal?: AbortSignal;
  /** 事件回调（CLI 打印 / 未来 UI）。 */
  onEvent?: (event: WorkflowEvent) => void;
  /** 运行 id 生成（注入以便测试稳定）；缺省时间戳+随机。 */
  makeRunId?: () => string;
  /** 当前时间（注入以便测试）；缺省 () => new Date()。 */
  now?: () => Date;
}

/** 抛出此错误表示工作流自身逻辑失败（区别于子 agent 单点失败，后者只落 null/ok:false）。 */
export class WorkflowAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowAbortedError";
  }
}

function defaultRunId(now: () => Date): string {
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `wf-${stamp}-${rand}`;
}

/**
 * 跑一个工作流到底，返回运行记录。引擎保证：
 * - agent() 受 maxConcurrency 限流、受 maxTotalAgents 硬顶（超出抛 WorkflowAbortedError）；
 * - parallel() 是屏障，单个 thunk 抛错 → 该位 null，整体不 reject；
 * - pipeline() 阶段间无屏障，某项某阶段抛错 → 该项落 null 跳过余下阶段；
 * - 收到 abort 后，新的 agent() 调用直接抛错，已在跑的由 runner 经 signal 终止。
 */
export async function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowRunRecord> {
  const now = options.now ?? (() => new Date());
  const makeRunId = options.makeRunId ?? (() => defaultRunId(now));
  const limits: WorkflowLimits = {
    maxConcurrency: options.limits?.maxConcurrency ?? defaultMaxConcurrency(),
    maxTotalAgents: options.limits?.maxTotalAgents ?? DEFAULT_MAX_TOTAL_AGENTS,
  };
  const onEvent = options.onEvent ?? (() => {});
  const runId = makeRunId();

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const signal = controller.signal;

  const semaphore = new Semaphore(limits.maxConcurrency);
  let dispatched = 0; // 已发起的子 agent 总数（含失败），对 maxTotalAgents 计数
  let inputTokens = 0;
  let outputTokens = 0;

  const stamp = () => now().toISOString();

  async function agent(request: WorkflowAgentRequest): Promise<WorkflowAgentResult> {
    if (signal.aborted) {
      throw new WorkflowAbortedError("workflow aborted before agent dispatch");
    }
    if (dispatched >= limits.maxTotalAgents) {
      throw new WorkflowAbortedError(
        `workflow exceeded maxTotalAgents (${limits.maxTotalAgents}); aborting to prevent runaway`,
      );
    }
    const index = dispatched;
    dispatched += 1;

    await semaphore.acquire();
    onEvent({ type: "agent-start", label: request.label, index, at: stamp() });
    try {
      const result = await options.agentRunner(request, signal);
      inputTokens += result.inputTokens ?? 0;
      outputTokens += result.outputTokens ?? 0;
      onEvent({
        type: "agent-end",
        label: request.label,
        index,
        ok: result.ok,
        blocker: result.blocker ?? null,
        at: stamp(),
      });
      return result;
    } finally {
      semaphore.release();
    }
  }

  async function parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>> {
    return Promise.all(
      thunks.map(async (thunk) => {
        try {
          return await thunk();
        } catch (error) {
          if (error instanceof WorkflowAbortedError) throw error; // 跑飞/中止要冒泡
          return null;
        }
      }),
    );
  }

  async function pipeline(items: unknown[], ...stages: WorkflowStage[]): Promise<Array<unknown | null>> {
    return Promise.all(
      items.map(async (item, index) => {
        let value: unknown = item;
        for (const stage of stages) {
          try {
            value = await stage(value, item, index);
          } catch (error) {
            if (error instanceof WorkflowAbortedError) throw error;
            return null; // 该项在此阶段失败 → 落 null 跳过余下阶段
          }
        }
        return value;
      }),
    );
  }

  const log = (message: string) => onEvent({ type: "log", message, at: stamp() });

  const ctx: WorkflowContext = {
    agent,
    parallel,
    pipeline,
    log,
    signal,
    args: options.args,
    workflowRoot: options.workflowRoot,
    project: options.project,
  };

  const startedAt = stamp();
  onEvent({ type: "run-start", runId, workflow: options.module.name, at: startedAt });

  let status: WorkflowRunStatus = "completed";
  let report: unknown = null;
  let error: string | null = null;
  try {
    report = await options.module.run(ctx);
  } catch (err) {
    if (signal.aborted || err instanceof WorkflowAbortedError) {
      status = "aborted";
    } else {
      status = "failed";
    }
    error = err instanceof Error ? err.message : String(err);
  } finally {
    if (options.signal) options.signal.removeEventListener("abort", onExternalAbort);
  }

  const finishedAt = stamp();
  onEvent({ type: "run-end", runId, status, agents: dispatched, at: finishedAt });

  return {
    runId,
    workflow: options.module.name,
    status,
    startedAt,
    finishedAt,
    agentCount: dispatched,
    inputTokens,
    outputTokens,
    report,
    error,
  };
}
