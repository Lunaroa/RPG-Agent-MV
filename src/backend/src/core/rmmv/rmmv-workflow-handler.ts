// MCP 工具 handler：发起动态工作流（提议一段 AI 现写的编排脚本）。
//
// 工具本身的权限审批由 opencode 的 approvalHandler 在执行前完成（config 里配了 "ask" 规则）：
// agent 一调用就阻塞在 LLM 执行循环内部，桌面弹高危审批卡，批准后才执行本 handler。
// 本 handler 只负责 propose（落盘 pending 提议）并立即返回；桌面在 tool_result 到达后自动批准
// 并异步运行工作流，报告通过 workflow_run 事件推回会话。

import { proposeWorkflow } from "../workflow/orchestrator/proposals.ts";
import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import { resolveProjectRoot, resolveWorkflowRootFromInput } from "./rmmv-handler-utils.ts";

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

  const proposal = proposeWorkflow({ workflowRoot, project, script, summary, title, sessionId });

  return {
    summary:
      `工作流提议「${proposal.title}」已创建并自动批准（用户已通过权限审批）。`
      + `\n脚本已存为独立文件：${proposal.scriptPath}，即将异步运行。`,
    data: {
      kind: "workflow-proposal",
      proposalId: proposal.proposalId,
      status: "pending",
      scriptPath: proposal.scriptPath,
      title: proposal.title,
      summary: proposal.summary,
    },
  };
}
