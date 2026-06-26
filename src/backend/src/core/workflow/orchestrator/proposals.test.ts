import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  approveProposal,
  listProposals,
  proposeWorkflow,
  readProposal,
  readProposalScript,
  rejectProposal,
} from "./proposals.ts";
import type { WorkflowRunRecord } from "./types.ts";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-proposals-"));
}

const fixedNow = () => new Date("2026-06-25T00:00:00.000Z");
let idSeq = 0;
const seqId = () => `wp-test-${++idSeq}`;

const SCRIPT = `const r = await agent({ prompt: "审一段台词", label: "voice" }); return { ok: r.ok };`;

function fakeRecord(runId: string, status: WorkflowRunRecord["status"] = "completed"): WorkflowRunRecord {
  return {
    runId,
    workflow: "工作流脚本",
    status,
    startedAt: "2026-06-25T00:00:00.000Z",
    finishedAt: "2026-06-25T00:00:01.000Z",
    agentCount: 1,
    inputTokens: 0,
    outputTokens: 0,
    report: { ok: true },
    error: status === "completed" ? null : "boom",
  };
}

test("proposeWorkflow 落盘 pending：脚本存成独立 .js 文件，JSON 只存路径", () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow(
    { workflowRoot: root, project: "/p/demo", script: SCRIPT, summary: "审 示例角色 的台词", title: "写作审核", sessionId: "s1" },
    { makeId: seqId, now: fixedNow },
  );
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.title, "写作审核");
  assert.equal(proposal.summary, "审 示例角色 的台词");
  assert.equal(proposal.project, "/p/demo");
  assert.equal(proposal.sessionId, "s1");
  // 脚本是独立 .js 文件（单一事实源），路径以 .js 结尾且文件真实存在、内容含脚本。
  assert.match(proposal.scriptPath, /\.js$/);
  assert.ok(fs.existsSync(proposal.scriptPath));
  assert.match(fs.readFileSync(proposal.scriptPath, "utf8"), /agent\(/);
  // 提议 JSON 里不再内嵌脚本源码，但能按 id 读回脚本文件。
  const reread = readProposal(root, proposal.proposalId) as Record<string, unknown>;
  assert.equal(reread?.proposalId, proposal.proposalId);
  assert.equal(reread?.script, undefined);
  assert.match(readProposalScript(root, proposal.proposalId), /agent\(/);
});

test("readProposalScript：脚本文件缺失时 fail fast", () => {
  const root = tmpRoot();
  assert.throws(() => readProposalScript(root, "wp-missing"), /脚本文件缺失/);
});

test("approveProposal 跑的是脚本文件的当前内容（批准前的编辑生效）", async () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  // 模拟用户在批准前编辑了脚本文件。
  fs.writeFileSync(proposal.scriptPath, `return { edited: true };\n`, "utf8");
  let executedScript: string | null = null;
  await approveProposal(
    root,
    proposal.proposalId,
    { execute: async (opts) => { executedScript = opts.script; return fakeRecord("run-edit"); } },
    { now: fixedNow },
  );
  assert.match(String(executedScript), /edited: true/);
});

test("proposeWorkflow 标题/说明缺省回落，不报错", () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow(
    { workflowRoot: root, project: "/p", script: SCRIPT },
    { makeId: seqId, now: fixedNow },
  );
  assert.equal(proposal.title, "工作流脚本");
  assert.match(proposal.summary, /只读/);
});

test("proposeWorkflow 空脚本直接抛、不留半截提议", () => {
  const root = tmpRoot();
  assert.throws(
    () => proposeWorkflow(
      { workflowRoot: root, project: "/p/demo", script: "   " },
      { makeId: seqId, now: fixedNow },
    ),
    /非空的编排脚本/,
  );
  assert.equal(listProposals(root).length, 0);
});

test("listProposals 按状态过滤", () => {
  const root = tmpRoot();
  proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  assert.equal(listProposals(root).length, 2);
  assert.equal(listProposals(root, { status: "pending" }).length, 2);
  assert.equal(listProposals(root, { status: "completed" }).length, 0);
});

test("approveProposal：pending → running → completed，挂上 runId/reportPath，并把脚本传给执行器", async () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  let executedScript: string | null = null;
  const { proposal: done } = await approveProposal(
    root,
    proposal.proposalId,
    { execute: async (opts) => { executedScript = opts.script; return fakeRecord("run-1"); } },
    { now: fixedNow },
  );
  assert.equal(String(executedScript).trim(), SCRIPT);
  assert.equal(done.status, "completed");
  assert.equal(done.runId, "run-1");
  assert.match(String(done.reportPath), /run-1[/\\]report\.json$/);
  assert.equal(readProposal(root, proposal.proposalId)?.status, "completed");
});

test("approveProposal：执行失败 → failed + 原因，并 rethrow", async () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  await assert.rejects(
    approveProposal(
      root,
      proposal.proposalId,
      { execute: async () => { throw new Error("派发炸了"); } },
      { now: fixedNow },
    ),
    /派发炸了/,
  );
  const after = readProposal(root, proposal.proposalId);
  assert.equal(after?.status, "failed");
  assert.match(String(after?.reason), /派发炸了/);
});

test("approveProposal：record 非 completed → failed + 原因", async () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  const { proposal: done } = await approveProposal(
    root,
    proposal.proposalId,
    { execute: async () => fakeRecord("run-2", "aborted") },
    { now: fixedNow },
  );
  assert.equal(done.status, "failed");
  assert.match(String(done.reason), /boom/);
});

test("approveProposal：不能重复批准已决提议", async () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  await approveProposal(root, proposal.proposalId, { execute: async () => fakeRecord("run-3") }, { now: fixedNow });
  await assert.rejects(
    approveProposal(root, proposal.proposalId, { execute: async () => fakeRecord("run-4") }),
    /不能再批准/,
  );
});

test("rejectProposal：pending → rejected；非 pending 抛错", () => {
  const root = tmpRoot();
  const proposal = proposeWorkflow({ workflowRoot: root, project: "/p", script: SCRIPT }, { makeId: seqId, now: fixedNow });
  const rejected = rejectProposal(root, proposal.proposalId, "先不跑", { now: fixedNow });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "先不跑");
  assert.throws(() => rejectProposal(root, proposal.proposalId), /不能拒绝/);
});
