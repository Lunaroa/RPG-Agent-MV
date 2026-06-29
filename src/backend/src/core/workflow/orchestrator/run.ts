// 动态工作流引擎 — 高层运行入口（CLI / 未来 IPC 共用）。
//
// 负责：把 AI 现写的编排脚本包成工作流模块、从 console 设置解析供应商/模型绑定（缺则 fail fast）、
// 构造只读生产 runner、跑工作流、把运行记录与报告落到 runtime/out/workflows/<runId>/。

import fs from "node:fs";
import path from "node:path";

import { ConsoleSettingsDao } from "../../db/dao/console-settings-dao.ts";
import { activateForSession, resolveSessionBinding } from "../../llm/invocation/index.ts";
import type { EngineProviderBinding } from "../../llm/invocation/types.ts";
import {
  defaultEngine,
  type AgentExecutionEngine,
  type AgentExecutionSettingsLike,
} from "../agent/runtime-adapters/index.ts";
import { resolveExecutionEngineForProduct } from "../../../../../contract/opencode-only.ts";
import type { ProductLanguage } from "../../../../../contract/types.ts";
import { createProductionAgentRunner } from "./agent-runner.ts";
import { buildScriptModule } from "./script-runtime.ts";
import { runWorkflow } from "./runtime.ts";
import type { WorkflowEvent, WorkflowLimits, WorkflowRunRecord } from "./types.ts";

export interface ResolvedCliBinding {
  providerId: string;
  modelId: string;
  executionEngine: AgentExecutionEngine;
  agentExecutionSettings: AgentExecutionSettingsLike;
}

/** 从保存的 agentExecution 设置解析「与桌面同源」的供应商/模型绑定；缺供应商/模型则 fail fast。 */
export async function resolveCliBinding(workflowRoot: string): Promise<ResolvedCliBinding> {
  let settings: AgentExecutionSettingsLike = { engine: defaultEngine() };
  try {
    const stored = ConsoleSettingsDao.get("agentExecution");
    if (stored && typeof stored === "object") settings = stored as AgentExecutionSettingsLike;
  } catch {
    // DB 未就绪等冷启动路径：退回默认引擎，下面会因缺绑定 fail fast。
  }
  const executionEngine = resolveExecutionEngineForProduct(settings.engine);
  const bindings = settings.bindings as Record<string, EngineProviderBinding | undefined> | undefined;
  const binding = resolveSessionBinding({ settingsBinding: bindings?.[executionEngine] || null });
  if (!binding?.providerId || !binding?.modelId) {
    throw new Error(
      "未找到可用的供应商/模型绑定。请先在桌面应用里选好供应商与模型（或配置 agentExecution 设置）后再运行工作流。",
    );
  }
  await activateForSession(workflowRoot, executionEngine, binding);
  return { providerId: binding.providerId, modelId: binding.modelId, executionEngine, agentExecutionSettings: settings };
}

export interface ExecuteWorkflowOptions {
  workflowRoot: string;
  project: string;
  /** AI 现写的编排脚本源码（async 体，可 return 报告）。 */
  script: string;
  /** 计划审批卡展示的大白话计划（markdown）。 */
  summary?: string;
  /** 短标题（运行记录里的 workflow 字段）。 */
  title?: string;
  /** 可选脚本参数（脚本里 `args` 可读）。 */
  args?: unknown;
  productLanguage?: ProductLanguage;
  limits?: Partial<WorkflowLimits>;
  /** 脚本异步段总超时（毫秒）。缺省挂死兜底值；按工作流规模传入更贴切的预算。 */
  scriptTimeoutMs?: number;
  /** 发起会话 ID：传给子 agent 使 opencode serverKey 一致，避免并行子 agent 互杀 server。 */
  sessionId?: string;
  signal?: AbortSignal;
  onEvent?: (event: WorkflowEvent) => void;
}

/** 跑一段 AI 编排脚本到底（真实派发，全程只读），并把记录落盘。 */
export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<WorkflowRunRecord> {
  const module = buildScriptModule({ script: options.script, summary: options.summary, title: options.title, scriptTimeoutMs: options.scriptTimeoutMs });
  const binding = await resolveCliBinding(options.workflowRoot);
  const agentRunner = createProductionAgentRunner({
    workflowRoot: options.workflowRoot,
    project: options.project,
    providerId: binding.providerId,
    modelId: binding.modelId,
    executionEngine: binding.executionEngine,
    agentExecutionSettings: binding.agentExecutionSettings,
    productLanguage: options.productLanguage,
    sessionId: options.sessionId,
  });
  const record = await runWorkflow({
    module,
    agentRunner,
    workflowRoot: options.workflowRoot,
    project: options.project,
    args: options.args,
    limits: options.limits,
    signal: options.signal,
    onEvent: options.onEvent,
  });
  persistRunRecord(options.workflowRoot, record);
  return record;
}

const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;

function cleanReport(report: unknown): unknown {
  try {
    const text = JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    if (text === undefined) return null;
    return JSON.parse(text);
  } catch {
    return { error: "report not serializable (circular or non-JSON value)" };
  }
}

function stringifyWithCap(value: unknown, maxBytes: number): string {
  let text: string;
  try {
    text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  } catch {
    text = JSON.stringify({ error: "value not serializable" }, null, 2);
  }
  if (text.length > maxBytes) {
    return JSON.stringify({ truncated: true, byteLength: text.length, preview: text.slice(0, maxBytes) }, null, 2);
  }
  return text;
}

/** 把运行记录与报告写入 runtime/out/workflows/<runId>/。返回报告路径。 */
export function persistRunRecord(workflowRoot: string, record: WorkflowRunRecord): { recordPath: string; reportPath: string } {
  if (!RUN_ID_RE.test(record.runId)) {
    throw new Error(`非法 runId：${record.runId}`);
  }
  const dir = path.join(workflowRoot, "runtime", "out", "workflows", record.runId);
  const workflowsRoot = path.resolve(path.join(workflowRoot, "runtime", "out", "workflows"));
  const resolvedDir = path.resolve(dir);
  if (resolvedDir !== workflowsRoot && !resolvedDir.startsWith(workflowsRoot + path.sep)) {
    throw new Error(`runId 解析越界：${record.runId}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const recordPath = path.join(dir, "record.json");
  const reportPath = path.join(dir, "report.json");
  const safeReport = cleanReport(record.report);
  const safeRecord = { ...record, report: safeReport };
  try {
    fs.writeFileSync(recordPath, stringifyWithCap(safeRecord, MAX_REPORT_BYTES), "utf8");
    fs.writeFileSync(reportPath, stringifyWithCap(safeReport, MAX_REPORT_BYTES), "utf8");
  } catch (error) {
    console.error(`[workflow] persistRunRecord 落盘失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return { recordPath, reportPath };
}
