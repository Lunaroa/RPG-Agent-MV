import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runRmmvWorkflow } from "./rmmv-workflow-handler.ts";
import { listProposals, readProposalScript } from "../workflow/orchestrator/proposals.ts";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-handler-"));
}

const SCRIPT = `const r = await agent({ prompt: "审一段台词", label: "voice" }); return { ok: r.ok };`;

test("workflow.propose 落盘 pending 提议、返回审批卡数据（含脚本，不直接运行）", () => {
  const root = tmpRoot();
  const result = runRmmvWorkflow({
    action: "propose",
    script: SCRIPT,
    summary: "审 示例角色 的台词",
    title: "写作审核",
    workflowRoot: root,
    project: "/p/demo",
  });
  const data = result.data as { kind: string; proposalId: string; status: string; title: string; scriptPath: string };
  assert.equal(data.kind, "workflow-proposal");
  assert.equal(data.status, "pending");
  assert.equal(data.title, "写作审核");
  assert.match(data.scriptPath, /\.js$/);
  assert.match(result.summary, /批准/);
  // 真落了一条 pending 提议，脚本存成独立 .js 文件，且没运行任何东西。
  const proposals = listProposals(root, { status: "pending" });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].proposalId, data.proposalId);
  assert.match(readProposalScript(root, data.proposalId), /agent\(/);
});

test("workflow.propose 缺 action 时默认按 propose 处理", () => {
  const root = tmpRoot();
  const result = runRmmvWorkflow({ script: SCRIPT, workflowRoot: root });
  assert.equal((result.data as { kind: string }).kind, "workflow-proposal");
});

test("workflow.propose 空脚本 → 抛错、不留提议", () => {
  const root = tmpRoot();
  assert.throws(
    () => runRmmvWorkflow({ action: "propose", script: "   ", workflowRoot: root }),
    /非空的编排脚本/,
  );
  assert.equal(listProposals(root).length, 0);
});

test("workflow.propose 缺脚本字段 → 抛错", () => {
  assert.throws(() => runRmmvWorkflow({ action: "propose", workflowRoot: tmpRoot() }), /非空的编排脚本/);
});

test("未知 action → 抛错", () => {
  assert.throws(() => runRmmvWorkflow({ action: "nope", script: SCRIPT }), /Unknown workflow action/);
});
