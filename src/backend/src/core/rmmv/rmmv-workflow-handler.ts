// MCP 工具 handler：发起动态工作流（提议一段 AI 现写的编排脚本）。
//
// 工具本身的权限审批由 opencode 的 approvalHandler 在执行前完成（config 里配了 "ask" 规则）：
// agent 一调用就阻塞在 LLM 执行循环内部，桌面弹高危审批卡，批准后才执行本 handler。
// 本 handler 只负责 propose（落盘 pending 提议）并立即返回；后端在 tool_result 到达时自动批准
// 并异步运行工作流，报告通过 workflow_run 事件推回会话。

import { proposeWorkflow } from "../workflow/orchestrator/proposals.ts";
import type { ProductLanguage } from "../../../../contract/i18n.ts";
import { backendText } from "../i18n/messages.ts";
import { resolveLanguage } from "../i18n/request-language.ts";
import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import { resolveProjectRoot, resolveWorkflowRootFromInput } from "./rmmv-handler-utils.ts";

export async function runRmmvWorkflow(input: RmmvHandlerInput): Promise<RmmvHandlerResult> {
  const productLanguage = resolveLanguage(input.productLanguage as ProductLanguage | null | undefined);
  const action = String(input.action ?? "propose");
  if (action !== "propose") {
    throw new Error(backendText("workflow.proposal.unknownAction", productLanguage, { action }));
  }

  const workflowRoot = resolveWorkflowRootFromInput(input);
  const project = resolveProjectRoot(input);
  const script = typeof input.script === "string" ? input.script : "";
  if (!script.trim()) {
    throw new Error(backendText("workflow.proposal.scriptRequired", productLanguage));
  }
  const summary = typeof input.summary === "string" ? input.summary : undefined;
  const title = typeof input.title === "string" ? input.title : undefined;
  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.trim()
      ? input.sessionId.trim()
      : (process.env.AIWF_SESSION_ID || null);

  const proposal = proposeWorkflow({
    workflowRoot,
    project,
    script,
    summary,
    title,
    sessionId,
    productLanguage,
  });

  return {
    summary: [
      backendText("workflow.proposal.created", productLanguage, { title: proposal.title }),
      backendText("workflow.proposal.scriptQueued", productLanguage, { path: proposal.scriptPath }),
    ].join("\n"),
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
