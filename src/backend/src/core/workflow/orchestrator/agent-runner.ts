// 动态工作流引擎 — 生产环境子 agent 执行器。
//
// 把引擎的 agent() 原语绑到产品既有的派发链路（buildAgentDispatch + startAgentDispatchProcess），
// 不绕架构、不另起进程模型。铁律：强制 readOnlyTools，子 agent 只能读、不能改工程、不能放置事件。
// 带 schema 时要求子 agent 只输出一个 JSON 块，抽取并交给校验器；校验失败有一次带纠正提示的重试。

import {
  buildAgentDispatch,
  startAgentDispatchProcess,
} from "../agent/agent-dispatch.ts";
import type { AgentExecutionEngine, AgentExecutionSettingsLike } from "../agent/runtime-adapters/index.ts";
import type { ProductLanguage } from "../../../../../contract/types.ts";
import type { WorkflowAgentRequest, WorkflowAgentResult, WorkflowAgentRunner } from "./types.ts";

const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const WORKFLOW_AGENT_ID = "default";

export interface ProductionRunnerConfig {
  workflowRoot: string;
  project: string;
  /** 选定的供应商/模型绑定（与桌面会话同源）。 */
  providerId: string;
  modelId: string;
  executionEngine?: AgentExecutionEngine;
  agentExecutionSettings?: AgentExecutionSettingsLike | null;
  productLanguage?: ProductLanguage;
  /** 单个子 agent 超时缺省值。 */
  defaultTimeoutMs?: number;
}

/** 从子 agent 文本输出里抽取一个 JSON 对象：优先 ```json 围栏块，否则取首个平衡的 {...}。 */
export function extractJsonObject(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const fenced = matchLastFencedJson(text);
  const candidate = fenced ?? matchFirstBalancedObject(text);
  if (!candidate) return { ok: false, error: "no JSON object found in agent output" };
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function matchLastFencedJson(text: string): string | null {
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let last: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const body = match[1].trim();
    if (body.startsWith("{") || body.startsWith("[")) last = body;
  }
  return last;
}

function matchFirstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function buildSchemaInstruction(prompt: string): string {
  return `${prompt}

# 输出格式（严格）
只输出一个 JSON 对象，用 \`\`\`json 围栏块包起来，块外不要写任何解释、前后缀或 Markdown。`;
}

/** 构造生产环境 runner：每次调用走一次完整的只读派发。 */
export function createProductionAgentRunner(config: ProductionRunnerConfig): WorkflowAgentRunner {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;

  async function dispatchOnce(
    prompt: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ status: string; text: string; blocker: string | null; inputTokens: number; outputTokens: number }> {
    const dispatch = await buildAgentDispatch({
      workflowRoot: config.workflowRoot,
      agentId: WORKFLOW_AGENT_ID,
      project: config.project,
      intent: prompt,
      providerId: config.providerId,
      modelId: config.modelId,
      executionEngine: config.executionEngine,
      agentExecutionSettings: config.agentExecutionSettings ?? null,
      productLanguage: config.productLanguage,
      readOnlyTools: true, // 铁律：只读
      skipKnowledgeRefresh: true,
      execute: true,
      timeoutMs,
      signal,
    });
    if (dispatch.status === "blocked") {
      return { status: "blocked", text: "", blocker: dispatch.blocker ?? "dispatch blocked", inputTokens: 0, outputTokens: 0 };
    }
    let inputTokens = 0;
    let outputTokens = 0;
    const handle = startAgentDispatchProcess(dispatch, { signal, timeoutMs }, (event) => {
      if (typeof event.inputTokens === "number") inputTokens += event.inputTokens;
      if (typeof event.outputTokens === "number") outputTokens += event.outputTokens;
    });
    const onAbort = () => handle.stop();
    if (signal.aborted) handle.stop();
    else signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await handle.promise;
      return {
        status: result.status,
        text: result.backendOutput?.stdout ?? "",
        blocker: result.blocker ?? null,
        inputTokens,
        outputTokens,
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  return async function runAgent(
    request: WorkflowAgentRequest,
    signal: AbortSignal,
  ): Promise<WorkflowAgentResult> {
    const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
    const wantsJson = Boolean(request.schema);
    const basePrompt = wantsJson ? buildSchemaInstruction(request.prompt) : request.prompt;

    let attemptPrompt = basePrompt;
    let lastText = "";
    let lastBlocker: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    // 无 schema：1 次；有 schema：最多 2 次（校验失败后带纠正提示重试一次）。
    const maxAttempts = wantsJson ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const run = await dispatchOnce(attemptPrompt, timeoutMs, signal);
      inputTokens += run.inputTokens;
      outputTokens += run.outputTokens;
      lastText = run.text;
      lastBlocker = run.blocker;

      if (run.status !== "pass") {
        // 派发层失败（含 stopped/blocked/timeout）：不重试，直接返回失败。
        return { ok: false, text: run.text, blocker: run.blocker ?? `agent ${run.status}`, label: request.label, inputTokens, outputTokens };
      }
      if (!request.schema) {
        return { ok: true, text: run.text, label: request.label, inputTokens, outputTokens };
      }

      const extracted = extractJsonObject(run.text);
      if (extracted.ok) {
        const validated = request.schema(extracted.value);
        if (validated.ok) {
          return { ok: true, text: run.text, data: validated.data, label: request.label, inputTokens, outputTokens };
        }
        attemptPrompt = `${basePrompt}

# 上一次输出不符合要求
原因：${validated.error}
请只重新输出修正后的 JSON 对象（同样用 \`\`\`json 围栏块），不要解释。`;
        lastBlocker = `schema validation failed: ${validated.error}`;
      } else {
        attemptPrompt = `${basePrompt}

# 上一次没解析到 JSON
原因：${extracted.error}
请只输出一个 JSON 对象，用 \`\`\`json 围栏块包起来。`;
        lastBlocker = `json extraction failed: ${extracted.error}`;
      }
    }

    return { ok: false, text: lastText, blocker: lastBlocker, label: request.label, inputTokens, outputTokens };
  };
}
