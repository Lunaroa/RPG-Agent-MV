import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { ProductLanguage } from "../../../../contract/i18n.ts";
import { withProductLanguage } from "../i18n/request-language.ts";
import { runRmmvWorkflow } from "./rmmv-workflow-handler.ts";
import { listProposals, readProposalScript } from "../workflow/orchestrator/proposals.ts";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-handler-"));
}

const SCRIPT = `const r = await agent({ prompt: "审一段台词", label: "voice" }); return { ok: r.ok };`;

function runWithLanguage(
  input: Parameters<typeof runRmmvWorkflow>[0],
  language: ProductLanguage = "zh-CN",
): ReturnType<typeof runRmmvWorkflow> {
  return withProductLanguage(language, () => runRmmvWorkflow(input));
}

test("workflow.propose 落盘 pending 提议并立即返回（非阻塞）", async () => {
  const root = tmpRoot();
  const result = await runWithLanguage({
    action: "propose",
    script: SCRIPT,
    summary: "审 示例角色 的台词",
    title: "写作审核",
    workflowRoot: root,
    project: path.join(root, "project"),
  });
  const data = result.data as { kind: string; status: string; proposalId: string };
  assert.equal(data.kind, "workflow-proposal");
  assert.equal(data.status, "pending");

  const proposals = listProposals(root, { status: "pending" });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].title, "写作审核");
  assert.equal(proposals[0].productLanguage, "zh-CN");
  assert.equal(proposals[0].proposalId, data.proposalId);
  assert.match(readProposalScript(root, data.proposalId), /agent\(/);
});

test("workflow.propose 缺 action 时默认按 propose 处理", async () => {
  const root = tmpRoot();
  const result = await runWithLanguage({ script: SCRIPT, workflowRoot: root });
  assert.equal((result.data as { kind: string }).kind, "workflow-proposal");
  assert.equal(listProposals(root).length, 1);
});

test("workflow.propose 空脚本 → 抛错、不留提议", async () => {
  const root = tmpRoot();
  await assert.rejects(
    () => runWithLanguage({ action: "propose", script: "   ", workflowRoot: root }),
    /非空的编排脚本/,
  );
  assert.equal(listProposals(root).length, 0);
});

test("workflow.propose 缺脚本字段 → 抛错", async () => {
  await assert.rejects(
    () => runWithLanguage({ action: "propose", workflowRoot: tmpRoot() }),
    /非空的编排脚本/,
  );
});

test("未知 action → 抛错", async () => {
  await assert.rejects(
    () => runWithLanguage({ action: "nope", script: SCRIPT }, "en-US"),
    /Unknown workflow action/,
  );
});

test("workflow.propose 默认英文文案并将语言写入提议", async () => {
  const root = tmpRoot();
  const result = await runWithLanguage({ script: SCRIPT, workflowRoot: root }, "en-US");
  assert.match(result.summary, /Workflow proposal/);
  const [proposal] = listProposals(root);
  assert.equal(proposal.productLanguage, "en-US");
  assert.equal(proposal.title, "Workflow script");
});
