// MCP 工具 handler：发起动态工作流（提议一段 AI 现写的编排脚本）。
//
// 形态对齐 Claude Code 的权限提示：agent 一调用本工具就阻塞在这里，桌面在 tool_call 瞬间弹出
// 高危操作审批卡（取代对话框）。人批准 → 后端进程跑工作流（全程只读）→ 本 handler 轮询到完成、
// 读回报告作为 tool_result 返回，agent 这一轮直接拿到报告。人拒绝/超时 → 返回相应结果。
//
// 跨进程通道：提议是文件，落在 runtime/out/workflows/proposals/<id>.json。MCP server 进程写 pending
// 提议（proposeWorkflow，纯校验+落盘）并阻塞轮询其状态；后端进程在人批准时执行（approveProposal →
// executeWorkflow，需要供应商/模型绑定）并把状态翻到 running→completed/failed。两进程共享同一文件系统。

import fs from "node:fs";

import { proposeWorkflow, readProposal } from "../workflow/orchestrator/proposals.ts";
import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import { resolveProjectRoot, resolveWorkflowRootFromInput } from "./rmmv-handler-utils.ts";

/** 等人批准的上限：超时自动作废，避免 agent 永久挂起。 */
const APPROVAL_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
/** 等后端跑完工作流的上限（工作流自身 10min + 缓冲）。 */
const EXECUTION_WAIT_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_INTERVAL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runRmmvWorkflow(input: RmmvHandlerInput): Promise<RmmvHandlerResult> {
  const action = String(input.action ?? "propose");
  if (action !== "propose") {
    throw new Error(`Unknown workflow action: ${action}`);
  }

  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const script = typeof input.script === "string" ? input.script : "";
  if (!script.trim()) {
    throw new Error("workflow.propose 需要一段非空的编排脚本（script）。");
  }
  const summary = typeof input.summary === "string" ? input.summary : undefined;
  const title = typeof input.title === "string" ? input.title : undefined;
  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.trim()
      ? input.sessionId.trim()
      : (process.env.AIWF_SESSION_ID || null);

  // 脚本为空 → proposeWorkflow 抛错，agent 当场看到，不留半截提议。
  const proposal = proposeWorkflow({ workflowRoot, project, script, summary, title, sessionId });
  const proposalId = proposal.proposalId;

  // 阻塞等用户决定：轮询提议状态，直到离开 pending（批准→running / 拒绝→rejected）或超时。
  let current: typeof proposal = proposal;
  const approvalStart = Date.now();
  while (current.status === "pending") {
    if (Date.now() - approvalStart > APPROVAL_WAIT_TIMEOUT_MS) {
      return {
        summary:
          `工作流提议「${proposal.title}」等待批准超时（${APPROVAL_WAIT_TIMEOUT_MS / 60000} 分钟），已自动作废。`
          + `\n脚本已存为独立文件：${proposal.scriptPath}，如需复跑可在桌面重新发起。`,
        data: { kind: "workflow-proposal", proposalId, status: "timeout" },
      };
    }
    await sleep(POLL_INTERVAL_MS);
    const next = readProposal(workflowRoot, proposalId);
    if (!next) {
      return {
        summary: `工作流提议「${proposal.title}」已失效（提议文件被移除）。`,
        data: { kind: "workflow-proposal", proposalId, status: "aborted" },
      };
    }
    current = next;
  }

  if (current.status === "rejected") {
    return {
      summary: `工作流提议「${proposal.title}」已被用户拒绝：${current.reason ?? "无原因"}`,
      data: { kind: "workflow-proposal", proposalId, status: "rejected", reason: current.reason },
    };
  }

  // 已批准（status=running）：后端进程在跑工作流，轮询等完成。
  const execStart = Date.now();
  while (current.status === "running") {
    if (Date.now() - execStart > EXECUTION_WAIT_TIMEOUT_MS) {
      return {
        summary:
          `工作流「${proposal.title}」运行超时（${EXECUTION_WAIT_TIMEOUT_MS / 60000} 分钟），状态留为 running。`
          + `\n运行 id：${current.runId ?? "(未生成)"}，可在后台查看。`,
        data: { kind: "workflow-proposal", proposalId, status: "running", runId: current.runId },
      };
    }
    await sleep(POLL_INTERVAL_MS);
    const next = readProposal(workflowRoot, proposalId);
    if (!next) break;
    current = next;
  }

  let reportText: string | null = null;
  if (current.reportPath) {
    try {
      reportText = fs.readFileSync(current.reportPath, "utf8");
    } catch {
      reportText = null;
    }
  }

  if (current.status === "completed") {
    return {
      summary:
        `工作流「${proposal.title}」已运行完成（子 agent 全程只读，未改工程）。报告：\n${reportText ?? "(无报告)"}`,
      data: { kind: "workflow-proposal", proposalId, status: "completed", runId: current.runId, report: reportText },
    };
  }
  return {
    summary:
      `工作流「${proposal.title}」未正常完成（${current.status}）：${current.reason ?? "(无原因)"}`,
    data: { kind: "workflow-proposal", proposalId, status: current.status, runId: current.runId, reason: current.reason },
  };
}
