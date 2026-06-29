// 动态工作流 — 提议与强制人工批准。
//
// 形态对齐 Claude Code：agent 调用「发起工作流」工具 = 只提交一个提议就立刻返回（不在那一轮
// 里同步跑）。桌面复用现有「计划审批卡」展示提议（人批准的是 summary 那段大白话计划，不看代码）；
// 人点头后由后台真正跑工作流（全程只读），跑完的报告作为一条普通聊天消息流回对话（不开报告卡）。
//
// 跨进程通道：提议是文件，落在 runtime/out/workflows/proposals/<id>.json。MCP server 进程负责
// 写入 pending 提议（proposeWorkflow，纯校验+落盘，不碰 LLM）；后端进程负责批准后执行
// （approveProposal → executeWorkflow，需要供应商/模型绑定）。两个进程共享同一 workflowRoot 文件系统。

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { executeWorkflow } from "./run.ts";
import type { WorkflowEvent, WorkflowRunRecord } from "./types.ts";

export type WorkflowProposalStatus =
  | "pending"   // 已提议，等人批
  | "running"   // 已批准，后台跑中
  | "completed" // 跑完，有报告
  | "rejected"  // 人拒绝
  | "aborted"   // 被中止（用户中止 / 工作流引擎判定 aborted）
  | "failed";   // 跑失败

export interface WorkflowProposal {
  proposalId: string;
  /** 短标题（审批卡标题、运行记录里的 workflow 字段）。 */
  title: string;
  /**
   * 脚本独立 `.js` 文件的绝对路径。脚本本体只存这个文件（单一事实源），提议 JSON 不再内嵌源码——
   * 这样人在批准前直接改这个文件，改动即生效（对齐「改脚本文件再复跑」）。读取见 readProposalScript。
   */
  scriptPath: string;
  /** 计划审批卡展示的大白话计划（markdown）：做什么、分几步、扇出多少、大概多少成本。人批准的是它，不看代码。 */
  summary: string;
  status: WorkflowProposalStatus;
  /** 目标 RMMV 工程绝对路径（提议时锚定，批准时照用，避免漂移）。 */
  project: string;
  /** 发起该提议的会话 id（可选，便于把结果接回对话）。 */
  sessionId: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** 批准跑完后的运行 id 与报告路径。 */
  runId: string | null;
  reportPath: string | null;
  /** 拒绝原因或失败原因。 */
  reason: string | null;
}

export interface ProposalDeps {
  makeId?: () => string;
  now?: () => Date;
}

function proposalsDir(workflowRoot: string): string {
  return path.join(workflowRoot, "runtime", "out", "workflows", "proposals");
}

const PROPOSAL_ID_RE = /^wp-[A-Za-z0-9_-]{1,64}$/;

function assertSafeProposalId(proposalId: string): void {
  if (typeof proposalId !== "string" || !PROPOSAL_ID_RE.test(proposalId)) {
    throw new Error(`非法 proposalId：${proposalId}`);
  }
}

function proposalPath(workflowRoot: string, proposalId: string): string {
  return path.join(proposalsDir(workflowRoot), `${proposalId}.json`);
}

/** 脚本独立 `.js` 文件路径，与提议 JSON 同目录、同 id。 */
function scriptFilePath(workflowRoot: string, proposalId: string): string {
  return path.join(proposalsDir(workflowRoot), `${proposalId}.js`);
}

/** 读取提议对应的脚本文件内容（单一事实源）。文件缺失时 fail fast。 */
export function readProposalScript(workflowRoot: string, proposalId: string): string {
  assertSafeProposalId(proposalId);
  const filePath = scriptFilePath(workflowRoot, proposalId);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`提议脚本文件缺失：${filePath}`);
  }
}

function makeProposalId(now: Date): string {
  const ts = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `wp-${ts}-${randomUUID().slice(0, 8)}`;
}

function writeProposal(workflowRoot: string, proposal: WorkflowProposal): void {
  const dir = proposalsDir(workflowRoot);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = proposalPath(workflowRoot, proposal.proposalId);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(proposal, null, 2), "utf8");
  fs.renameSync(tmpPath, finalPath);
}

/** 锁文件最长存活时间：超过即视为崩溃残留，允许抢占。 */
const STALE_LOCK_MS = 60 * 60 * 1000;

function isProcessAlive(pid: number): boolean {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claimProposal(workflowRoot: string, proposalId: string): () => void {
  const lockPath = `${proposalPath(workflowRoot, proposalId)}.lock`;
  const payload = JSON.stringify({ pid: process.pid, at: Date.now() });
  const tryAcquire = (): boolean => {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      return false;
    }
  };

  if (tryAcquire()) {
    return () => {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // 锁文件已被清理或不存在。
      }
    };
  }

  // 锁已存在：判定是否为陈旧锁（持有进程已死 或 超过 STALE_LOCK_MS）。
  let stale = false;
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const info = JSON.parse(raw) as { pid?: number; at?: number };
    const age = Date.now() - (typeof info.at === "number" ? info.at : 0);
    if (age >= STALE_LOCK_MS) stale = true;
    else if (typeof info.pid === "number" && !isProcessAlive(info.pid)) stale = true;
  } catch {
    // 锁内容损坏：保守起见按陈旧处理（读不出就抢不了会更糟）。
    stale = true;
  }
  if (!stale) {
    throw new Error(`提议 ${proposalId} 正在被另一个进程处理（锁占用中）。`);
  }
  // 抢占陈旧锁：unlink 后重新 wx 创建，避免与并发抢占者竞争。
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
  if (!tryAcquire()) {
    throw new Error(`提议 ${proposalId} 正在被另一个进程处理（锁占用中）。`);
  }
  return () => {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // 锁文件已被清理或不存在。
    }
  };
}

export function readProposal(workflowRoot: string, proposalId: string): WorkflowProposal | null {
  assertSafeProposalId(proposalId);
  try {
    const raw = fs.readFileSync(proposalPath(workflowRoot, proposalId), "utf8");
    return JSON.parse(raw) as WorkflowProposal;
  } catch {
    return null;
  }
}

export function listProposals(
  workflowRoot: string,
  filter?: { status?: WorkflowProposalStatus },
): WorkflowProposal[] {
  const dir = proposalsDir(workflowRoot);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const proposals: WorkflowProposal[] = [];
  for (const name of entries) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), "utf8");
      const proposal = JSON.parse(raw) as WorkflowProposal;
      if (filter?.status && proposal.status !== filter.status) continue;
      proposals.push(proposal);
    } catch {
      // 损坏文件跳过，不影响其余提议。
    }
  }
  return proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 提议一个工作流（MCP 工具调用走这里）。纯校验 + 落盘 pending，不碰 LLM、不跑脚本。
 * 脚本为空时直接抛错——agent 当场看到，不会留下半截提议。
 */
export function proposeWorkflow(
  input: {
    workflowRoot: string;
    project: string;
    script: string;
    summary?: string;
    title?: string;
    sessionId?: string | null;
  },
  deps: ProposalDeps = {},
): WorkflowProposal {
  const script = typeof input.script === "string" ? input.script.trim() : "";
  if (!script) {
    throw new Error("workflow.propose 需要一段非空的编排脚本（script）。");
  }
  const now = deps.now ?? (() => new Date());
  const makeId = deps.makeId ?? (() => makeProposalId(now()));
  const proposalId = makeId();

  // 把内联交上来的脚本落成独立 .js 文件（单一事实源）；提议 JSON 只存路径。
  const scriptPath = scriptFilePath(input.workflowRoot, proposalId);
  fs.mkdirSync(proposalsDir(input.workflowRoot), { recursive: true });
  fs.writeFileSync(scriptPath, script.endsWith("\n") ? script : `${script}\n`, "utf8");

  const createdAt = now().toISOString();
  const proposal: WorkflowProposal = {
    proposalId,
    title: input.title?.trim() || "工作流脚本",
    scriptPath,
    summary: input.summary?.trim() || "AI 现写的只读编排脚本",
    status: "pending",
    project: input.project,
    sessionId: input.sessionId ?? null,
    createdAt,
    decidedAt: null,
    runId: null,
    reportPath: null,
    reason: null,
  };
  writeProposal(input.workflowRoot, proposal);
  return proposal;
}

export interface ApproveProposalOptions {
  onEvent?: (event: WorkflowEvent) => void;
  signal?: AbortSignal;
  /** Keep the proposal running but defer agent dispatch until the originating foreground turn settles. */
  beforeExecute?: () => Promise<void>;
  /** 测试可注入；缺省走真实 executeWorkflow（解析绑定 + 只读派发）。 */
  execute?: typeof executeWorkflow;
}

/**
 * 批准并执行提议（后端进程，人点头后调）。把提议置 running → 跑工作流（只读）→ completed/failed。
 * 只能批准 pending 提议；重复批准或批准已决提议会抛错。
 */
export async function approveProposal(
  workflowRoot: string,
  proposalId: string,
  options: ApproveProposalOptions = {},
  deps: ProposalDeps = {},
): Promise<{ proposal: WorkflowProposal; record: WorkflowRunRecord }> {
  assertSafeProposalId(proposalId);
  const releaseLock = claimProposal(workflowRoot, proposalId);
  try {
    const proposal = readProposal(workflowRoot, proposalId);
    if (!proposal) throw new Error(`提议不存在：${proposalId}`);
    if (proposal.status !== "pending") {
      throw new Error(`提议 ${proposalId} 当前状态为 ${proposal.status}，不能再批准。`);
    }
    const now = deps.now ?? (() => new Date());
    const execute = options.execute ?? executeWorkflow;

    const script = readProposalScript(workflowRoot, proposalId);

    proposal.status = "running";
    proposal.decidedAt = now().toISOString();
    writeProposal(workflowRoot, proposal);

    try {
      if (options.beforeExecute) await options.beforeExecute();
      const record = await execute({
        workflowRoot,
        project: proposal.project,
        script,
        summary: proposal.summary,
        title: proposal.title,
        sessionId: proposal.sessionId ?? undefined,
        signal: options.signal,
        onEvent: options.onEvent,
      });
      proposal.runId = record.runId;
      proposal.reportPath = path.join(workflowRoot, "runtime", "out", "workflows", record.runId, "report.json");
      // 区分 aborted（用户/引擎中止）与 failed（真正失败），语义更准、便于 UI 与统计区分。
      proposal.status = record.status === "completed"
        ? "completed"
        : record.status === "aborted"
          ? "aborted"
          : "failed";
      if (record.status !== "completed") {
        proposal.reason = record.error
          ?? (record.status === "aborted" ? "工作流被中止" : "工作流未正常完成");
      }
      writeProposal(workflowRoot, proposal);
      return { proposal, record };
    } catch (error) {
      // execute 抛 WorkflowAbortedError 时算中止；其余算失败。
      const isAborted = options.signal?.aborted || (error instanceof Error && error.name === "WorkflowAbortedError");
      proposal.status = isAborted ? "aborted" : "failed";
      proposal.reason = error instanceof Error ? error.message : String(error);
      writeProposal(workflowRoot, proposal);
      throw error;
    }
  } finally {
    releaseLock();
  }
}

/** 拒绝提议（后端进程，人点拒绝后调）。只能拒绝 pending 提议。 */
export function rejectProposal(
  workflowRoot: string,
  proposalId: string,
  reason?: string,
  deps: ProposalDeps = {},
): WorkflowProposal {
  assertSafeProposalId(proposalId);
  const releaseLock = claimProposal(workflowRoot, proposalId);
  try {
    const proposal = readProposal(workflowRoot, proposalId);
    if (!proposal) throw new Error(`提议不存在：${proposalId}`);
    if (proposal.status !== "pending") {
      throw new Error(`提议 ${proposalId} 当前状态为 ${proposal.status}，不能拒绝。`);
    }
    const now = deps.now ?? (() => new Date());
    proposal.status = "rejected";
    proposal.decidedAt = now().toISOString();
    proposal.reason = reason?.trim() || "用户拒绝";
    writeProposal(workflowRoot, proposal);
    return proposal;
  } finally {
    releaseLock();
  }
}
