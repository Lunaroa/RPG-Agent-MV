// 动态工作流引擎 — 类型契约。
//
// 引擎把「编排」从 agent 上下文搬进真实 TS 代码：一个内置工作流模块用 ctx 暴露的
// agent()/parallel()/pipeline()/log() 原语扇出只读子 agent，中间结果留在工作流变量里，
// 只把最终报告交回 CLI / 上层。子 agent 一律只读（readOnlyTools），绝不落地。

/** 单次子 agent 调用请求。prompt 是子 agent 的任务；schema 在时强制结构化输出。 */
export interface WorkflowAgentRequest {
  /** 子 agent 的任务描述（system+user 合一，交给 opencode 派发）。 */
  prompt: string;
  /** 进度/记录里显示的短标签，例如 `review:voice`、`debate:0`。 */
  label: string;
  /**
   * 可选结构化输出：子 agent 被要求只输出一个匹配该 schema 的 JSON 块；
   * 引擎解析并校验，失败时有一次带纠正提示的重试。校验器是 validate 回调，
   * 不绑定具体校验库（生产用 zod，测试用裸函数）。
   */
  schema?: SchemaValidator;
  /** 子 agent 超时（毫秒）。缺省走引擎默认。 */
  timeoutMs?: number;
}

/** schema 校验器：拿到 JSON.parse 后的值，返回 {ok,data} 或 {ok:false,error}。 */
export type SchemaValidator = (value: unknown) =>
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/** 单次子 agent 调用结果。 */
export interface WorkflowAgentResult {
  /** 是否拿到可用结果（pass 且 schema 校验通过）。 */
  ok: boolean;
  /** 子 agent 的原始文本输出（backendOutput.stdout）。 */
  text: string;
  /** schema 校验通过后的结构化数据；无 schema 时为 undefined。 */
  data?: unknown;
  /** 失败原因（blocked / 校验失败 / abort）。 */
  blocker?: string | null;
  /** 回显请求标签，便于在 parallel 结果里对位。 */
  label: string;
  /** 该次调用消耗的 token（若派发层提供）。 */
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * 底层子 agent 执行器。引擎只依赖这个函数签名：
 * 生产实现绑 buildAgentDispatch + startAgentDispatchProcess（强制只读）；
 * 测试实现返回假结果。signal 用于整体中止。
 */
export type WorkflowAgentRunner = (
  request: WorkflowAgentRequest,
  signal: AbortSignal,
) => Promise<WorkflowAgentResult>;

/** 引擎向工作流模块暴露的编排原语与运行上下文。 */
export interface WorkflowContext {
  /** 扇出一个只读子 agent（受并发与总数上限约束）。 */
  agent: (request: WorkflowAgentRequest) => Promise<WorkflowAgentResult>;
  /** 并发跑一批任务（屏障：等齐才返回）；单个 thunk 抛错 → 该项为 null。 */
  parallel: <T>(thunks: Array<() => Promise<T>>) => Promise<Array<T | null>>;
  /** 流水线：每项独立穿过各阶段，阶段间无屏障；某阶段抛错 → 该项落 null 并跳过余下阶段。 */
  pipeline: (items: unknown[], ...stages: WorkflowStage[]) => Promise<Array<unknown | null>>;
  /** 向上层发一条进度叙述行。 */
  log: (message: string) => void;
  /** 整体中止信号。 */
  signal: AbortSignal;
  /** 工作流模块主动中止本次运行；用于脚本总超时等模块级护栏。 */
  abort: (reason?: unknown) => void;
  /** 工作流参数（来自 CLI / 调用方）。 */
  args: unknown;
  /** 产品仓根。 */
  workflowRoot: string;
  /** 目标 RMMV 工程绝对路径。 */
  project: string;
}

/** pipeline 的单个阶段：拿到上一阶段结果、原始项、下标。 */
export type WorkflowStage = (
  previous: unknown,
  item: unknown,
  index: number,
) => Promise<unknown> | unknown;

/**
 * 一个可运行的工作流模块。只留脚本后，模块由 buildScriptModule 从 AI 现写的编排脚本包装而来：
 * name/description 是审批卡上的标题与一句话说明，run 在受控沙箱里跑脚本本体。
 */
export interface WorkflowModule {
  /** 短标题（审批卡显示、运行记录里的 workflow 字段）。 */
  name: string;
  /** 一句话说明（审批卡显示）。 */
  description: string;
  /** 主体编排逻辑，返回最终报告（任意可 JSON 序列化的结构）。 */
  run: (ctx: WorkflowContext) => Promise<unknown>;
}

/** 引擎运行期对外发出的事件（供 CLI 打印 / 未来 UI 进度行消费）。 */
export type WorkflowEvent =
  | { type: "run-start"; runId: string; workflow: string; at: string }
  | { type: "log"; message: string; at: string }
  | { type: "agent-start"; label: string; index: number; prompt: string; at: string }
  | { type: "agent-end"; label: string; index: number; ok: boolean; blocker?: string | null; output: string; inputTokens?: number; outputTokens?: number; at: string }
  | { type: "run-end"; runId: string; status: WorkflowRunStatus; agents: number; at: string };

export type WorkflowRunStatus = "completed" | "aborted" | "failed";

/** 一次工作流运行的最终记录。 */
export interface WorkflowRunRecord {
  runId: string;
  workflow: string;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string;
  /** 本次实际派发的子 agent 总数。 */
  agentCount: number;
  inputTokens: number;
  outputTokens: number;
  /** 工作流返回的报告（只读结论）。 */
  report: unknown;
  /** 失败时的原因。 */
  error?: string | null;
}

/** 引擎护栏配置。 */
export interface WorkflowLimits {
  /** 同时在跑的子 agent 上限。缺省 min(16, cpu-2)。 */
  maxConcurrency: number;
  /** 单次运行子 agent 总数硬上限（防跑飞）。缺省 1000。 */
  maxTotalAgents: number;
}
