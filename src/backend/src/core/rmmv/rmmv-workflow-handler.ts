// MCP 工具 handler：发起动态工作流（提议一段 AI 现写的编排脚本）。
//
// 这是「agent 提议 → 强制人工批准」里 agent 那一端的入口。propose 只校验脚本非空 + 落盘一个
// pending 提议就立刻返回（不在 agent 这一轮里跑脚本）。桌面复用现有的「计划审批卡」渲染这条提议：
// 展示 summary 里那段大白话计划（人批准的是计划，不看代码），人点头后由后端在受控沙箱里真正跑
// （子 agent 全程只读，绝不改工程、不放置事件）。
// 工具在 tool-manifest 标 readOnly:false，因此只读子 agent 的工具集天然不含它——防套娃由只读集兜底。

import { proposeWorkflow } from "../workflow/orchestrator/proposals.ts";
import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import { resolveProjectRoot, resolveWorkflowRootFromInput } from "./rmmv-handler-utils.ts";

export function runRmmvWorkflow(input: RmmvHandlerInput): RmmvHandlerResult {
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

  return {
    summary:
      `已提交工作流提议「${proposal.title}」，脚本已存为独立文件：${proposal.scriptPath}。`
      + `\n等待用户在桌面点「批准」后才会运行（全程只读，不改工程、不放置事件）。批准前可直接编辑该脚本文件。`
      + `\n${proposal.summary}`,
    data: {
      // 桌面据此 kind 把这条工具结果渲染成「计划审批卡」（复用现有计划卡，展示 summary 计划正文，不展示代码）。
      kind: "workflow-proposal",
      proposalId: proposal.proposalId,
      title: proposal.title,
      status: proposal.status,
      summary: proposal.summary,
      scriptPath: proposal.scriptPath,
    },
  };
}
