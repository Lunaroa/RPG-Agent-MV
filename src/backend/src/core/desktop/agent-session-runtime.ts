import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { activateForSession, resolveSessionBinding } from "../llm/invocation/index.ts";
import type { EngineProviderBinding } from "../llm/invocation/types.ts";
import {
  assessDispatchBackendOutput,
  containsNativeSessionResumeFailure,
} from "../workflow/agent/runtime-issues.ts";
import { buildConversationHistoryFromChain } from "../../../../contract/session-transcript.ts";
import * as providerRegistry from "../llm/provider-registry.ts";
import {
  buildAgentDispatch,
  startAgentDispatchProcess,
  writeAgentDispatchOutputs,
  type OpencodeRunContext,
} from "../workflow/agent/agent-dispatch.ts";
import { resolveActiveProjectId } from "../memory/active-project.ts";
import { readCurrentProgressEntry } from "../memory/memory-store.ts";
import { readMemorySettings } from "../memory/memory-settings.ts";
import { runMemoryScribe } from "../memory/memory-scribe.ts";
import { loadAgentRegistry } from "../workflow/agent/agent-registry.ts";
import {
  defaultEngine,
  listExecutionEngineMeta,
  usesOpencodeProviderBinding,
  type AgentExecutionEngine,
  type AgentExecutionSettingsLike,
} from "../workflow/agent/runtime-adapters/index.ts";
import { resolveExecutionEngineForProduct } from "../../../../contract/opencode-only.ts";
import { ConsoleSettingsDao } from "../db/dao/console-settings-dao.ts";
import { ensureAgentOutputDirs } from "../workflow/agent/agent-output-dirs.ts";
import { replyOpencodePermission, replyOpencodeQuestion } from "../workflow/agent/opencode/runtime.ts";
import { SlashCommandService } from "./slash-command/service.ts";
import type { SlashCommandResult } from "./slash-command/types.ts";
import type { ProductLanguage, SessionPlanSnapshot, SessionSubagentSnapshot } from "../../../../contract/types.ts";
import { normalizeProductLanguage } from "../../../../contract/i18n.ts";
import { backendText } from "../i18n/messages.ts";
import {
  AGENT_RUNTIME_PLAN_ASK_PREFIX,
  AGENT_RUNTIME_QUESTION_ASK_PREFIX,
  deriveSessionPlan,
  deriveSessionSubagents,
} from "./session-derived-state.ts";
import { DEFAULT_PRODUCT_LANGUAGE } from "../../../../contract/i18n.ts";
import {
  ensurePlanDirectory,
  hydrateSessionPlanFromFile,
} from "./session-plan-file.ts";
import {
  allocateSessionPlanFilePath,
  buildConversationPlanRelativePath,
  resolveSessionPlanFilePath,
  type ConversationPlanSessionRef,
} from "./session-plan-path.ts";
import {
  approveProposal as executeApprovedWorkflowProposal,
  failUnfinishedProposal,
  listProposals as listWorkflowProposals,
  readProposal as readWorkflowProposal,
  type WorkflowProposal,
} from "../workflow/orchestrator/proposals.ts";
import type { WorkflowEvent, WorkflowRunRecord } from "../workflow/orchestrator/types.ts";

const MAX_EVENTS = 5000;
const TERMINAL = new Set(["pass", "blocked", "failed", "error", "stopped", "interrupted", "timeout"]);
const PENDING_SUBAGENT_STATUSES = new Set(["running", "not_ready", "unknown"]);
const DEFAULT_AGENT_ID = "default";
const EVENTS_FILE = "events.json";
const LEGACY_ASK_MCP_DISABLED_REASON = "legacy ASK MCP is disabled; use opencode AskUserQuestion or ExitPlanMode";
/** 桌面「正在读取工程」阶段上限；超时后 abort 并推送 error。可用 RMMV_PREPARATION_TIMEOUT_MS 覆盖。 */
const DEFAULT_PREPARATION_TIMEOUT_MS = Number(process.env.RMMV_PREPARATION_TIMEOUT_MS || 120_000);

type TaskStatus = "pending" | "in_progress" | "completed";

interface Task {
  id: string;
  content: string;
  status: TaskStatus;
  priority?: string;
  updatedAt?: string;
}

export interface AgentRuntimeEvent {
  type: string;
  sequence?: number;
  at?: string;
  [key: string]: unknown;
}

interface ExternalWorkState {
  cancel: (() => void) | null;
}

interface ForegroundWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface AgentSession {
  id: string;
  status: string;
  agentId: string;
  profileId: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  outDir: string;
  intent: string;
  displayText: string;
  productLanguage: ProductLanguage;
  project: string;
  parentSessionId: string | null;
  planFilePath: string | null;
  opencodeSessionId: string | null;
  blocker: string | null;
  dispatch: Record<string, any> | null;
  events: AgentRuntimeEvent[];
  seq: number;
  runner: { promise: Promise<Record<string, any>>; stop: () => void } | null;
  preparationController: AbortController | null;
  startedAt: string | null;
  finishedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Memory topic slugs surfaced so far in this conversation (multi-turn recall dedup). */
  surfacedMemorySlugs: string[];
  /** Internal-only opencode context used by the background memory scribe. Never persisted. */
  opencodeRunContext: OpencodeRunContext | null;
  /** External work that must finish before this turn may emit terminal artifacts/summary. */
  externalWork: Map<string, ExternalWorkState>;
  externalWorkFailures: string[];
  pendingFinalDispatch: Record<string, any> | null;
  foregroundSettled: boolean;
  foregroundWaiters: Set<ForegroundWaiter>;
  /** Proposal IDs whose backend approval kickoff already started this process lifetime. */
  startedWorkflowApprovals: Set<string>;
}

export interface SessionCreateInput {
  profileId?: string;
  providerId?: string;
  modelId?: string;
  executionEngine?: AgentExecutionEngine;
  intent?: string;
  displayText?: string;
  productLanguage?: ProductLanguage;
  project?: string;
  continuationOf?: string;
  mapId?: number;
  taskId?: string;
  files?: string[];
  thinkingLevel?: string;
  timeoutMs?: number;
  /** Internal-only: inject the complete persisted chain when native session resume is unavailable. */
  completeConversationHistory?: boolean;
  /** Internal-only: expose only non-mutating runtime tools for isolated evaluation sessions. */
  readOnlyTools?: boolean;
}

export interface SessionSubscriber {
  id: string;
  write: (event: AgentRuntimeEvent) => void;
}

interface AgentAskGateway {
  port: number;
  initSession(sessionId: string, push: (event: Record<string, unknown>) => void): Promise<void>;
  registerPushEvent(sessionId: string, push: (event: Record<string, unknown>) => void): void;
  destroySession(sessionId: string): Promise<void>;
  resolveAnswer(
    sessionId: string,
    askId: string,
    result?: unknown,
  ): { ok: boolean; askType?: string; reason?: string };
  injectEvent(sessionId: string, event: Record<string, unknown>): Promise<{ askId: string }>;
  close(): Promise<void>;
}

interface RuntimeDependencies {
  askGateway?: AgentAskGateway;
  buildDispatch?: typeof buildAgentDispatch;
  startDispatch?: typeof startAgentDispatchProcess;
  writeOutputs?: typeof writeAgentDispatchOutputs;
  activateForSession?: typeof activateForSession;
  loadRegistry?: typeof loadAgentRegistry;
  runMemoryScribe?: typeof runMemoryScribe;
  // 可注入的 opencode 回复通道，测试用来替代真实 singleton（singleton 在测试环境为 null，
  // 会让 reply 静默返回 false）。默认用 runtime.ts 的真实实现。
  replyPermission?: typeof replyOpencodePermission;
  replyQuestion?: typeof replyOpencodeQuestion;
  approveWorkflowProposal?: typeof executeApprovedWorkflowProposal;
  readWorkflowProposal?: typeof readWorkflowProposal;
}

export class AgentSessionRuntime {
  private readonly workflowRoot: string;
  private readonly deps: RuntimeDependencies;
  private sessions = new Map<string, AgentSession>();
  private subscribers = new Map<string, Map<string, SessionSubscriber>>();
  private secrets: string[] = [];
  private askGateway!: AgentAskGateway;
  private readonly buildDispatch: typeof buildAgentDispatch;
  private readonly startDispatch: typeof startAgentDispatchProcess;
  private readonly writeOutputs: typeof writeAgentDispatchOutputs;
  private readonly activateForSession: typeof activateForSession;
  private readonly loadRegistry: typeof loadAgentRegistry;
  private readonly runMemoryScribe: typeof runMemoryScribe;
  private readonly replyPermission: typeof replyOpencodePermission;
  private readonly replyQuestion: typeof replyOpencodeQuestion;
  private readonly approveWorkflowProposalFn: typeof executeApprovedWorkflowProposal;
  private readonly readWorkflowProposalFn: typeof readWorkflowProposal;
  private readonly slashCommandService: SlashCommandService;

  constructor(workflowRoot: string, deps: RuntimeDependencies = {}) {
    this.workflowRoot = workflowRoot;
    this.deps = deps;
    this.buildDispatch = deps.buildDispatch || buildAgentDispatch;
    this.startDispatch = deps.startDispatch || startAgentDispatchProcess;
    this.writeOutputs = deps.writeOutputs || writeAgentDispatchOutputs;
    this.activateForSession = deps.activateForSession || activateForSession;
    this.loadRegistry = deps.loadRegistry || loadAgentRegistry;
    this.runMemoryScribe = deps.runMemoryScribe || runMemoryScribe;
    this.replyPermission = deps.replyPermission || replyOpencodePermission;
    this.replyQuestion = deps.replyQuestion || replyOpencodeQuestion;
    this.approveWorkflowProposalFn = deps.approveWorkflowProposal || executeApprovedWorkflowProposal;
    this.readWorkflowProposalFn = deps.readWorkflowProposal || readWorkflowProposal;
    this.slashCommandService = new SlashCommandService({
      workflowRoot,
      getSession: (sessionId) => {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        return {
          id: session.id,
          status: session.status,
          project: session.project,
          opencodeSessionId: session.opencodeSessionId,
          productLanguage: session.productLanguage,
          opencodeRunContext: session.opencodeRunContext,
          providerId: session.providerId,
          modelId: session.modelId,
        };
      },
      stopSession: (sessionId) => {
        this.stop(sessionId);
      },
    });
  }

  async initialize(): Promise<void> {
    this.askGateway = this.deps.askGateway || createDisabledAskGateway();
    await this.refreshSecrets();
    this.sessions = this.loadPersistedSessions();
    this.failRestoredWorkflowProposals();
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.preparationController?.abort();
      if (session.runner) session.runner.stop();
      this.cancelExternalWork(session);
    }
    await this.askGateway.close();
  }

  getBootstrap(): Record<string, unknown> {
    const registry = this.loadRegistry({ workflowRoot: this.workflowRoot });
    const agentExecution = this.getAgentExecutionSettings();
    return {
      workflowRoot: this.workflowRoot,
      executionEngines: listExecutionEngineMeta(),
      currentExecution: agentExecution.engine || defaultEngine(),
      profiles: Object.fromEntries(Object.entries(registry.profiles).map(([id, profile]) => [id, {
        id,
        runtime: profile.runtime || null,
        provider: profile.provider || null,
        model: profile.model || null,
        label: profile.label || null,
        dynamic: Boolean(profile.dynamic),
      }])),
    };
  }

  list(): Record<string, unknown>[] {
    return [...this.sessions.values()].map((session) => this.summarize(session));
  }

  get(id: string): Record<string, unknown> | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return { ...this.summarize(session), chatLog: this.loadChatLog(session), events: session.events };
  }

  history(id: string): Record<string, unknown>[] {
    return this.serializeHistory(id, 10);
  }

  snapshot(id: string): Record<string, unknown>[] {
    return this.serializeHistory(id, Number.POSITIVE_INFINITY);
  }

  private serializeHistory(id: string, maxDepth: number): Record<string, unknown>[] {
    const chain: AgentSession[] = [];
    const seen = new Set<string>();
    let current = this.sessions.get(id);
    while (current && chain.length < maxDepth) {
      if (seen.has(current.id)) throw new Error(`Session history contains cycle at ${current.id}`);
      seen.add(current.id);
      chain.unshift(current);
      current = current.parentSessionId ? this.sessions.get(current.parentSessionId) : undefined;
    }
    return chain.map((session) => ({ ...this.summarize(session), chatLog: this.loadChatLog(session) }));
  }

  async create(input: SessionCreateInput): Promise<Record<string, unknown>> {
    ensureAgentOutputDirs(this.workflowRoot);
    const parent = input.continuationOf ? this.sessions.get(input.continuationOf) : undefined;
    const generatedAt = new Date().toISOString();
    const sessionId = makeRuntimeSessionId(generatedAt);
    const planFilePath = allocateSessionPlanFilePath(
      sessionId,
      parent,
      (id) => this.sessions.get(id),
    );
    const session: AgentSession = {
      id: sessionId,
      status: "preparing",
      agentId: DEFAULT_AGENT_ID,
      profileId: input.profileId || "default",
      providerId: input.providerId || "",
      modelId: input.modelId || "",
      createdAt: generatedAt,
      updatedAt: generatedAt,
      outDir: path.join(this.workflowRoot, "runtime", "sessions", sessionId, "agent-console"),
      intent: input.intent || "",
      displayText: input.displayText || (input.intent || "").split("\n")[0].slice(0, 200),
      productLanguage: normalizeProductLanguage(input.productLanguage),
      project: input.project || "projects/Project",
      parentSessionId: input.continuationOf || null,
      planFilePath,
      opencodeSessionId: parent?.opencodeSessionId || null,
      blocker: null,
      dispatch: null,
      events: [],
      seq: 0,
      runner: null,
      preparationController: new AbortController(),
      startedAt: null,
      finishedAt: null,
      inputTokens: 0,
      outputTokens: 0,
      // Inherit the parent turn's surfaced set (copied, not shared) so continuations dedup recall.
      surfacedMemorySlugs: parent ? [...(parent.surfacedMemorySlugs || [])] : [],
      opencodeRunContext: null,
      externalWork: new Map(),
      externalWorkFailures: [],
      pendingFinalDispatch: null,
      foregroundSettled: false,
      foregroundWaiters: new Set(),
      startedWorkflowApprovals: new Set(),
    };
    this.sessions.set(session.id, session);
    ensurePlanDirectory(this.workflowRoot, session.project, planFilePath);
    this.push(session, { type: "status", status: session.status, blocker: session.blocker, at: generatedAt });
    this.persistMeta(session);
    void this.prepareAndStart(session, input, parent).catch((error: Error) => this.fail(session, error));
    return this.summarize(session);
  }

  async preview(input: SessionCreateInput): Promise<Record<string, unknown>> {
    const executionEngine = this.resolveExecutionEngine(input);
    const sessionBinding = this.resolveInputSessionBinding(input);
    await this.activateForSession(this.workflowRoot, executionEngine, sessionBinding);
    const parent = input.continuationOf ? this.sessions.get(input.continuationOf) : undefined;
    const conversationHistory = this.resolveConversationHistory(
      input.continuationOf,
      executionEngine,
      parent,
      input.completeConversationHistory,
    );
    const dispatch = await this.buildDispatch({
      workflowRoot: this.workflowRoot,
      agentId: DEFAULT_AGENT_ID,
      profileId: input.profileId,
      providerId: input.providerId,
      modelId: input.modelId,
      executionEngine,
      agentExecutionSettings: await this.getAgentExecutionSettingsForDispatch(),
      intent: input.intent || "",
      productLanguage: normalizeProductLanguage(input.productLanguage),
      project: input.project || "projects/Project",
      mapId: input.mapId ? String(input.mapId) : undefined,
      files: input.files || [],
      execute: false,
      thinkingLevel: input.thinkingLevel || undefined,
      opencodeSessionId: parent?.opencodeSessionId || undefined,
      alreadySurfaced: parent?.surfacedMemorySlugs || [],
      conversationHistory,
      currentProgressPreamble: this.resolveCurrentProgressPreamble(input, parent, conversationHistory),
      readOnlyTools: input.readOnlyTools,
    });
    return {
      status: dispatch.status,
      blocker: dispatch.blocker || null,
      profileId: dispatch.profileId || null,
      executionEngine: dispatch.executionEngine || executionEngine,
      command: dispatch.execution?.command?.display || null,
    };
  }

  stop(id: string): Record<string, unknown> | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (!TERMINAL.has(session.status)) {
      session.status = "stopped";
      session.updatedAt = new Date().toISOString();
      session.finishedAt = session.updatedAt;
      session.preparationController?.abort();
      session.preparationController = null;
      session.runner?.stop();
      this.cancelExternalWork(session);
      session.pendingFinalDispatch = null;
      this.markForegroundSettled(session);
      this.push(session, { type: "status", status: "stopped", at: session.updatedAt });
      this.persistMeta(session);
      this.pushSummary(session);
      this.askGateway.destroySession(session.id).catch(() => {});
    }
    return this.summarize(session);
  }

  listSlashCommands(): Record<string, unknown>[] {
    return this.slashCommandService.listCommands();
  }

  async slashCommand(sessionId: string, command: string, args?: string): Promise<SlashCommandResult> {
    return this.slashCommandService.execute({ sessionId, command, args });
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.stop(id);
    this.sessions.delete(id);
    this.subscribers.delete(id);
    fs.rmSync(path.join(this.workflowRoot, "runtime", "sessions", id), { recursive: true, force: true });
    return true;
  }

  saveChatLog(id: string, data: Record<string, unknown>): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    fs.mkdirSync(session.outDir, { recursive: true });
    fs.writeFileSync(path.join(session.outDir, "chat-log.json"), JSON.stringify({
      sessionId: id,
      segments: Array.isArray(data.segments) ? data.segments : [],
      status: data.status || session.status,
      savedAt: new Date().toISOString(),
    }, null, 2) + "\n", "utf8");
    return true;
  }

  async submitAskResult(id: string, askId: string, result: unknown): Promise<{ ok: boolean; reason?: string; askType?: string }> {
    if (askId.startsWith(AGENT_RUNTIME_PLAN_ASK_PREFIX) || askId.startsWith(AGENT_RUNTIME_QUESTION_ASK_PREFIX)) {
      return this.submitOpencodeAskResult(id, askId, result);
    }
    return { ok: false, reason: LEGACY_ASK_MCP_DISABLED_REASON };
  }

  /**
   * 列出某会话的 opencode todo。权威来源是 SSE `todo.updated` 投影。
   */
  listTasks(sessionId: string): Task[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    const latest = session.events
      .slice()
      .reverse()
      .find((event) => event.type === "todo_updated" && Array.isArray(event.todos));
    return (Array.isArray(latest?.todos) ? latest!.todos : []).map((todo, index) => {
      const item = asRecord(todo);
      return {
        id: asString(item.id) || `todo:${index + 1}`,
        content: asString(item.content),
        status: normalizeTaskStatus(asString(item.status)) as TaskStatus,
        priority: asString(item.priority) || "medium",
        updatedAt: asString(latest?.at) || new Date().toISOString(),
      } as unknown as Task;
    }).filter((task) => task.id && task.content);
  }

  /**
   * 人工回写任务：opencode 1.17.7 SDK 暂无直接 todo mutation API；
   * 这里更新本地投影，下一轮 todo.updated 会重新校正。
   */
  updateTask(
    sessionId: string,
    taskId: string,
    patch: { status?: TaskStatus; delete?: boolean },
  ): { ok: boolean; reason?: string; deleted?: boolean; task?: Task | null } {
    if (!sessionId || !taskId) return { ok: false, reason: "missing session or task id" };
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "session not found" };
    const tasks = this.listTasks(sessionId);
    const current = tasks.find((task) => task.id === taskId);
    if (!current) return { ok: false, reason: "task not found" };
    if (patch.delete) return { ok: true, deleted: true };
    if (patch.status) {
      const task = { ...current, status: patch.status } as Task;
      this.push(session, {
        type: "todo_updated",
        todos: tasks.map((item) => item.id === taskId ? task : item),
        at: new Date().toISOString(),
      });
      return { ok: true, task };
    }
    return { ok: false, reason: "no-op patch" };
  }

  getPlan(sessionId: string): SessionPlanSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session not found");
    const allocatedPath = this.resolveConversationPlanPath(session);
    const derived = deriveSessionPlan(sessionId, session.events, session.productLanguage);
    const snapshot = {
      ...derived,
      filePath: allocatedPath,
    };
    return hydrateSessionPlanFromFile(this.workflowRoot, session.project, snapshot);
  }

  listSubagents(sessionId: string): SessionSubagentSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session not found");
    return deriveSessionSubagents(sessionId, session.events, session.productLanguage);
  }

  stopSubagent(sessionId: string, taskId: string): { ok: boolean; reason?: string; requestId?: string; taskId?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "session not found" };
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) return { ok: false, reason: "missing task id" };
    const requestId = `stop:${normalizedTaskId}:${Date.now()}`;
    this.push(session, {
      type: "subagent_stop_requested",
      taskId: normalizedTaskId,
      requestId,
      at: new Date().toISOString(),
    });
    return { ok: true, requestId, taskId: normalizedTaskId };
  }

  /**
   * 把一条外部事件推进某会话的事件流，让后台工作流的进度/报告内嵌回原对话。
   * 即使会话已进入终态（agent 那一轮已结束），桌面仍订阅着该会话流，依然能收到。
   */
  pushExternalEvent(sessionId: string, event: AgentRuntimeEvent): { ok: boolean; reason?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "session not found" };
    if (event.type === "workflow_run" && event.phase === "start") {
      const proposalId = asString(event.proposalId);
      if (proposalId) this.reserveExternalWork(session, proposalId);
    }
    this.push(session, { ...event, at: typeof event.at === "string" ? event.at : new Date().toISOString() });
    if (event.type === "workflow_run" && event.phase === "done") {
      const proposalId = asString(event.proposalId);
      if (proposalId) {
        this.completeExternalWork(session, proposalId, {
          status: asString(event.status),
          reason: asString(event.reason),
          at: asString(event.at) || new Date().toISOString(),
        });
      }
    }
    return { ok: true };
  }

  waitForForegroundSettled(sessionId: string, signal?: AbortSignal): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.reject(new Error("session not found"));
    if (session.foregroundSettled) return Promise.resolve();
    if (signal?.aborted) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("workflow start aborted"));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: ForegroundWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          session.foregroundWaiters.delete(waiter);
          reject(signal.reason instanceof Error ? signal.reason : new Error("workflow start aborted"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      session.foregroundWaiters.add(waiter);
    });
  }

  attachExternalWorkCancellation(
    sessionId: string,
    workId: string,
    cancel: () => void,
  ): { ok: boolean; reason?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "session not found" };
    const normalized = String(workId || "").trim();
    if (!normalized) return { ok: false, reason: "missing work id" };
    const work = this.reserveExternalWork(session, normalized);
    work.cancel = cancel;
    return { ok: true };
  }

  subscribe(sessionId: string, subscriber: SessionSubscriber, lastSequence = 0): AgentRuntimeEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session not found");
    this.reconcilePendingWorkflowProposals(sessionId);
    const replay = session.events.filter((event) => Number(event.sequence || 0) > lastSequence);
    const subscribers = this.subscribers.get(sessionId) || new Map<string, SessionSubscriber>();
    subscribers.set(subscriber.id, subscriber);
    this.subscribers.set(sessionId, subscribers);
    for (const event of replay) subscriber.write(event);
    return replay;
  }

  /**
   * 用户已在权限审批环节点头后，由后端在 tool_result 到达时自动批准并异步跑工作流；
   * 不依赖前端实时订阅。已 running/completed 等终态幂等返回。
   */
  approveWorkflowProposal(
    proposalId: string,
    sessionIdHint?: string,
  ): { ok: boolean; reason?: string; status?: string; proposalId?: string } {
    const normalized = String(proposalId || "").trim();
    if (!normalized) return { ok: false, reason: "missing proposal id" };

    const proposal = this.readWorkflowProposalFn(this.workflowRoot, normalized);
    if (!proposal) return { ok: false, reason: "proposal not found" };
    if (proposal.status !== "pending") {
      return { ok: true, status: proposal.status, proposalId: normalized };
    }

    const sessionId = String(sessionIdHint || proposal.sessionId || "").trim();
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session?.startedWorkflowApprovals.has(normalized)) {
      const current = this.readWorkflowProposalFn(this.workflowRoot, normalized);
      const status = current?.status === "pending" ? "running" : (current?.status || proposal.status);
      return { ok: true, status, proposalId: normalized };
    }
    if (session && this.hasWorkflowRunLifecycle(session, normalized)) {
      session.startedWorkflowApprovals.add(normalized);
      return { ok: true, status: proposal.status, proposalId: normalized };
    }
    if (session) session.startedWorkflowApprovals.add(normalized);

    const controller = new AbortController();
    const push = (event: AgentRuntimeEvent): void => {
      if (sessionId) this.pushExternalEvent(sessionId, { ...event, proposalId: normalized });
    };

    if (sessionId) {
      const attached = this.attachExternalWorkCancellation(
        sessionId,
        normalized,
        () => controller.abort(new Error("session stopped")),
      );
      if (!attached.ok) {
        push({
          type: "workflow_run",
          phase: "done",
          status: "failed",
          reason: attached.reason || "无法把工作流绑定到会话",
        });
        return { ok: false, reason: attached.reason || "无法把工作流绑定到会话" };
      }
      if (session) this.reserveExternalWork(session, normalized);
    }

    push({
      type: "workflow_run",
      phase: "start",
      workflow: proposal.title,
      summary: proposal.summary,
    });

    void this.approveWorkflowProposalFn(this.workflowRoot, normalized, {
      signal: controller.signal,
      beforeExecute: sessionId
        ? () => this.waitForForegroundSettled(sessionId, controller.signal)
        : undefined,
      onEvent: (event: WorkflowEvent) => push({ type: "workflow_run", phase: "progress", event }),
    })
      .then(({ proposal: done, record }: { proposal: WorkflowProposal; record: WorkflowRunRecord }) => {
        push({
          type: "workflow_run",
          phase: "done",
          status: done.status,
          runId: done.runId,
          workflow: done.title,
          reason: done.reason ?? null,
          report: record?.report ?? null,
        });
      })
      .catch((error: unknown) => {
        const failed = this.readWorkflowProposalFn(this.workflowRoot, normalized);
        push({
          type: "workflow_run",
          phase: "done",
          status: failed?.status === "aborted" ? "aborted" : "failed",
          reason: failed?.reason || (error instanceof Error ? error.message : String(error)),
        });
      });

    return { ok: true, status: "running", proposalId: normalized };
  }

  reconcilePendingWorkflowProposals(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const cannotStart = TERMINAL.has(session.status);
    const proposalIds = new Set<string>();
    for (const event of session.events) {
      const proposalId = proposalIdFromWorkflowToolResult(event);
      if (proposalId) proposalIds.add(proposalId);
    }
    for (const proposalId of proposalIds) {
      if (session.startedWorkflowApprovals.has(proposalId)) continue;
      if (this.hasWorkflowRunLifecycle(session, proposalId)) {
        session.startedWorkflowApprovals.add(proposalId);
        continue;
      }
      const proposal = this.readWorkflowProposalFn(this.workflowRoot, proposalId);
      if (proposal && (proposal.status === "pending" || proposal.status === "running") && cannotStart) {
        this.failInterruptedWorkflowProposal(session, proposalId);
        continue;
      }
      if (proposal?.status === "running") {
        this.failInterruptedWorkflowProposal(session, proposalId);
        continue;
      }
      if (proposal?.status === "pending") {
        void this.approveWorkflowProposal(proposalId, sessionId);
      }
    }
  }

  private failRestoredWorkflowProposals(): void {
    const unfinished = [
      ...listWorkflowProposals(this.workflowRoot, { status: "pending" }),
      ...listWorkflowProposals(this.workflowRoot, { status: "running" }),
    ];
    for (const proposal of unfinished) {
      const session = proposal.sessionId ? this.sessions.get(proposal.sessionId) : undefined;
      if (!session) continue;
      this.failInterruptedWorkflowProposal(session, proposal.proposalId);
    }
  }

  private failInterruptedWorkflowProposal(session: AgentSession, proposalId: string): void {
    const reason = "应用中断：未完成的工作流不会自动重跑，请确认现有结果后重新发起。";
    const failed = failUnfinishedProposal(this.workflowRoot, proposalId, reason);
    if (!failed) return;
    session.startedWorkflowApprovals.add(proposalId);
    this.push(session, {
      type: "workflow_run",
      phase: "done",
      proposalId,
      status: "failed",
      workflow: failed.title,
      reason,
      at: failed.decidedAt || new Date().toISOString(),
    });
  }

  unsubscribe(sessionId: string, subscriberId: string): void {
    this.subscribers.get(sessionId)?.delete(subscriberId);
  }

  private async submitOpencodeAskResult(
    sessionId: string,
    askId: string,
    result: unknown,
  ): Promise<{ ok: boolean; reason?: string; askType?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "session not found" };
    const askType = askId.startsWith(AGENT_RUNTIME_PLAN_ASK_PREFIX) ? "plan-approval" : "multi-choice-clarify";
    const requestId = askId
      .replace(AGENT_RUNTIME_PLAN_ASK_PREFIX, "")
      .replace(AGENT_RUNTIME_QUESTION_ASK_PREFIX, "");
    if (!requestId) return { ok: false, reason: "missing opencode request id" };
    const requestEvent = session.events
      .slice()
      .reverse()
      .find((event) => isOpencodeAskRequestEvent(event, requestId));
    if (!requestEvent) {
      return { ok: false, reason: "opencode request not found" };
    }

    const request = asRecord(requestEvent.request);
    const response = askType === "plan-approval"
      ? buildPlanApprovalResponse(asRecord(request.input), result, session.productLanguage)
      : buildQuestionResponse(asRecord(request.input), result);

    const behavior = asString(response.behavior);
    const opencodeSessionId = session.opencodeSessionId;
    // opencode 会话已断（续链失败被清空等）：不能把答案送回，opencode 那侧会永久挂起。
    // 诚实返回失败，让前端把该 ASK 标记为 failedAt 并提示用户重开，不 push 伪造的 success。
    if (!opencodeSessionId) {
      return { ok: false, reason: "opencode session unavailable; please reopen the session", askType };
    }
    const directory = resolveSessionProjectDirectory(session, this.workflowRoot);
    let replyOk: boolean;
    if (asString(request.tool_name) === "AskUserQuestion") {
      replyOk = await this.replyQuestion(
        opencodeSessionId,
        requestId,
        buildQuestionReplyAnswers(asRecord(request.input), result),
        directory,
      );
    } else {
      replyOk = await this.replyPermission(
        opencodeSessionId,
        requestId,
        behavior === "deny" ? "reject" : "once",
        directory,
      );
    }
    // reply 在 singleton 已停 / permissionID 过期 / opencode 返回 error 时静默返回 false（不抛错）。
    // 不能在这种情况下 push 伪造的 success：否则 opencode 那侧 approvalHandler 永久挂起等回复，
    // 而前端被通知成功，会话无声卡死。诚实返回失败，让前端把该 ASK 标记为 failedAt。
    if (!replyOk) {
      return { ok: false, reason: "opencode reply failed; session may be stale", askType };
    }
    this.push(session, {
      type: askType === "plan-approval" ? "opencode_permission_response" : "opencode_question_response",
      request_id: requestId,
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
      success: true,
      at: new Date().toISOString(),
    });
    return { ok: true, askType };
  }

  private handleDispatchEvent(
    session: AgentSession,
    event: AgentRuntimeEvent,
  ): void {
    const workflowProposalId = proposalIdFromWorkflowToolResult(event);
    if (workflowProposalId) this.reserveExternalWork(session, workflowProposalId);
    if (event.type === "status" && typeof event.status === "string") {
      if (session.status === "stopped" && event.status !== "stopped") return;
      if (TERMINAL.has(session.status) && session.status !== event.status) return;
      if (TERMINAL.has(event.status) && session.externalWork.size > 0) {
        session.updatedAt = String(event.at || new Date().toISOString());
        this.persistMeta(session);
        return;
      }
      session.status = event.status;
      session.updatedAt = String(event.at || new Date().toISOString());
      if (event.status === "running") session.startedAt = session.updatedAt;
      if (TERMINAL.has(event.status)) session.finishedAt = session.updatedAt;
    }
    if (event.type === "opencode_session" && typeof event.sessionID === "string") {
      session.opencodeSessionId = event.sessionID;
      this.persistMeta(session);
    }
    if (event.type === "usage_summary") {
      session.inputTokens = finiteNumber(event.inputTokens);
      session.outputTokens = finiteNumber(event.outputTokens);
    }
    this.push(session, event);
    if (workflowProposalId) {
      void this.approveWorkflowProposal(workflowProposalId, session.id);
    }
  }

  private hasWorkflowRunLifecycle(session: AgentSession, proposalId: string): boolean {
    return session.events.some((event) => (
      event.type === "workflow_run"
      && asString(event.proposalId) === proposalId
      && (asString(event.phase) === "start" || asString(event.phase) === "done")
    ));
  }

  private async prepareAndStart(session: AgentSession, input: SessionCreateInput, parent?: AgentSession): Promise<void> {
    const controller = session.preparationController;
    if (!controller) return;
    // 运维：卡在 preparing 时查 runtime/sessions/<id>/agent-console/session-meta.json、
    // 卡在 preparing 时优先查 session-meta、stderr 事件、模型配置和 Agent 执行环境。
    let preparationTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (session.status !== "preparing") return;
      const seconds = Math.round(DEFAULT_PREPARATION_TIMEOUT_MS / 1000);
      const message = backendText(
        'session.preparationTimeout',
        session.productLanguage,
        { seconds },
      );
      controller.abort();
      void this.fail(session, new Error(message));
    }, DEFAULT_PREPARATION_TIMEOUT_MS);
    const clearPreparationTimer = (): void => {
      if (preparationTimer) {
        clearTimeout(preparationTimer);
        preparationTimer = null;
      }
    };
    try {
    const executionEngine = this.resolveExecutionEngine(input);
    const sessionBinding = this.resolveInputSessionBinding(input);
    await this.activateForSession(this.workflowRoot, executionEngine, sessionBinding);
    await this.refreshSecrets();
    if (controller.signal.aborted || session.status === "stopped") return;

    const conversationHistory = this.resolveConversationHistory(
      input.continuationOf,
      executionEngine,
      parent,
      input.completeConversationHistory,
    );
    const dispatch = await this.buildDispatch({
      workflowRoot: this.workflowRoot,
      sessionId: session.id,
      agentId: session.agentId,
      profileId: input.profileId,
      providerId: input.providerId,
      modelId: input.modelId,
      executionEngine,
      agentExecutionSettings: await this.getAgentExecutionSettingsForDispatch(),
      intent: session.intent,
      productLanguage: session.productLanguage,
      project: session.project,
      mapId: input.mapId ? String(input.mapId) : undefined,
      taskId: input.taskId,
      files: input.files || [],
      execute: true,
      timeoutMs: input.timeoutMs,
      thinkingLevel: input.thinkingLevel || undefined,
      opencodeSessionId: parent?.opencodeSessionId || undefined,
      alreadySurfaced: session.surfacedMemorySlugs,
      conversationHistory,
      currentProgressPreamble: this.resolveCurrentProgressPreamble(input, parent, conversationHistory),
      readOnlyTools: input.readOnlyTools,
      planFilePath: session.planFilePath || undefined,
      signal: controller.signal,
      askMcpGatewayPort: null,
    });
    clearPreparationTimer();
    if (controller.signal.aborted || session.status === "stopped") return;
    session.preparationController = null;
    session.dispatch = dispatch;
    // Fold this turn's newly-recalled slugs into the conversation's running surfaced set.
    const newlySurfaced = Array.isArray(dispatch.surfacedMemorySlugs) ? dispatch.surfacedMemorySlugs : [];
    if (newlySurfaced.length > 0) {
      session.surfacedMemorySlugs = [...new Set([...session.surfacedMemorySlugs, ...newlySurfaced])];
    }
    session.profileId = dispatch.profileId || input.profileId || "default";
    session.blocker = dispatch.blocker || null;
    session.updatedAt = new Date().toISOString();
    if (dispatch.status === "blocked") {
      session.status = "blocked";
      session.finishedAt = session.updatedAt;
      this.push(session, { type: "status", status: session.status, blocker: session.blocker, at: session.updatedAt });
      this.writeOutputs(dispatch, session.outDir);
      this.persistMeta(session);
      this.pushSummary(session);
      return;
    }
    session.status = "starting";
    this.push(session, { type: "status", status: session.status, at: session.updatedAt });
    this.persistMeta(session);
    await this.askGateway.initSession(session.id, (event) => this.push(session, event as AgentRuntimeEvent));
    if (session.status === "stopped") {
      await this.askGateway.destroySession(session.id);
      return;
    }
    session.runner = this.startDispatch(dispatch, {
      sessionId: session.id,
      timeoutMs: input.timeoutMs,
      outDir: session.outDir,
      opencodeSessionId: parent?.opencodeSessionId || session.opencodeSessionId || undefined,
      onOpencodeRunContext: (context) => {
        session.opencodeRunContext = context;
      },
    }, (event) => {
      this.handleDispatchEvent(session, event);
    });
    session.runner.promise
      .then((finalDispatch) => {
        this.markForegroundSettled(session);
        this.finalize(session, finalDispatch);
      })
      .catch((error: Error) => {
        this.markForegroundSettled(session);
        const dispatch = session.dispatch && typeof session.dispatch === "object"
          ? session.dispatch as Record<string, unknown>
          : { status: session.status };
        if (this.shouldPreservePassAfterFinalizeDefect(session, dispatch)) {
          this.finalizeAfterDispatchError(session, { ...dispatch, status: "pass" }, error);
          return;
        }
        this.fail(session, error);
      });
    } catch (error) {
      clearPreparationTimer();
      throw error;
    } finally {
      clearPreparationTimer();
    }
  }

  private finalize(session: AgentSession, finalDispatch: Record<string, any>): void {
    if (session.status !== "stopped" && session.externalWork.size > 0) {
      session.pendingFinalDispatch = finalDispatch;
      session.dispatch = finalDispatch;
      session.runner = null;
      session.updatedAt = finalDispatch.execution?.finishedAt || new Date().toISOString();
      session.finishedAt = null;
      session.status = "running";
      this.persistMeta(session);
      return;
    }
    try {
      this.finalizeDispatch(session, finalDispatch);
    } catch (error) {
      this.finalizeAfterDispatchError(session, finalDispatch, error);
    }
  }

  private shouldPreservePassAfterFinalizeDefect(
    session: AgentSession,
    finalDispatch: Record<string, unknown>,
  ): boolean {
    if (finalDispatch.status === "pass") return true;
    if (session.status === "pass") return true;
    return session.events.some((event) => event.type === "status" && event.status === "pass");
  }

  private finalizeDispatch(session: AgentSession, finalDispatch: Record<string, any>): void {
    const wasStopped = session.status === "stopped";
    if (!wasStopped) {
      this.maybeClearNativeSessionAfterResumeFailure(session, finalDispatch);
      const recovery = assessDispatchBackendOutput(finalDispatch);
      session.status = finalDispatch.status || "blocked";
      session.updatedAt = finalDispatch.execution?.finishedAt || new Date().toISOString();
      session.finishedAt = session.updatedAt;
      session.blocker = finalDispatch.blocker || null;
      if (recovery?.status === "blocked" && session.status === "pass") {
        session.status = "blocked";
        session.blocker = recovery.blocker || session.blocker;
      }
      try {
        this.applySubagentCompletionGuard(session);
      } catch (guardError) {
        if (!this.shouldPreservePassAfterFinalizeDefect(session, finalDispatch)) {
          throw guardError;
        }
      }
      finalDispatch.status = session.status;
      if (session.blocker) finalDispatch.blocker = session.blocker;
    }
    session.dispatch = finalDispatch;
    session.runner = null;
    this.writeOutputs(finalDispatch as Parameters<typeof writeAgentDispatchOutputs>[0], session.outDir);
    this.persistMeta(session);
    if (!wasStopped) {
      this.push(session, {
        type: "status",
        status: session.status,
        blocker: session.blocker,
        at: session.updatedAt,
      });
    }
    this.push(session, {
      type: "artifact",
      sessionId: session.id,
      outDir: session.outDir,
      status: session.status,
      at: session.updatedAt,
    });
    if (!wasStopped) this.pushSummary(session);
    this.maybeRunMemoryScribe(session, wasStopped);
    this.askGateway.destroySession(session.id).catch(() => {});
  }

  private finalizeAfterDispatchError(
    session: AgentSession,
    finalDispatch: Record<string, any>,
    error: unknown,
  ): void {
    if (this.shouldPreservePassAfterFinalizeDefect(session, finalDispatch)) {
      session.status = "pass";
      session.updatedAt = finalDispatch.execution?.finishedAt || new Date().toISOString();
      session.finishedAt = session.updatedAt;
      session.blocker = finalDispatch.blocker || null;
      session.dispatch = { ...finalDispatch, status: "pass" };
      session.runner = null;
      try {
        this.writeOutputs(finalDispatch as Parameters<typeof writeAgentDispatchOutputs>[0], session.outDir);
      } catch {
        // Dispatch already passed; output write defects must not downgrade session status.
      }
      this.persistMeta(session);
      this.push(session, {
        type: "status",
        status: session.status,
        blocker: session.blocker,
        at: session.updatedAt,
      });
      this.push(session, {
        type: "artifact",
        sessionId: session.id,
        outDir: session.outDir,
        status: session.status,
        at: session.updatedAt,
      });
      this.pushSummary(session);
      this.maybeRunMemoryScribe(session, false);
      this.askGateway.destroySession(session.id).catch(() => {});
      return;
    }
    this.fail(session, error instanceof Error ? error : new Error(String(error)));
  }

  private applySubagentCompletionGuard(session: AgentSession): void {
    if (session.status !== "pass" && session.status !== "blocked") return;
    let pendingForeground: ReturnType<typeof deriveSessionSubagents>["items"] = [];
    try {
      pendingForeground = deriveSessionSubagents(session.id, session.events, session.productLanguage)
        .items
        .filter((item): item is NonNullable<typeof item> => item != null)
        .filter((item) => PENDING_SUBAGENT_STATUSES.has(item.status) && item.background !== true);
    } catch {
      if (session.status === "pass") return;
      throw new Error(backendText('session.subagentParseFailed', session.productLanguage));
    }
    if (!pendingForeground.length) return;

    session.status = "blocked";
    const subagentBlockerZh = backendText('session.subagentIncompleteSingle', 'zh-CN');
    const subagentBlockerEn = backendText('session.subagentIncompleteSingle', 'en-US');
    if (
      session.blocker?.includes(subagentBlockerZh) ||
      session.blocker?.includes(subagentBlockerEn) ||
      session.blocker?.includes("foreground subagent")
    ) return;
    const message = pendingForeground.length === 1
      ? backendText('session.subagentIncompleteSingle', session.productLanguage)
      : backendText(
        'session.subagentIncompleteMultiple',
        session.productLanguage,
        { count: pendingForeground.length },
      );
    session.blocker = session.blocker ? `${session.blocker}; ${message}` : message;
  }

  private fail(session: AgentSession, error: Error): void {
    if (session.status === "stopped") {
      this.askGateway.destroySession(session.id).catch(() => {});
      return;
    }
    const dispatch = session.dispatch && typeof session.dispatch === "object"
      ? session.dispatch as Record<string, unknown>
      : null;
    if (dispatch && this.shouldPreservePassAfterFinalizeDefect(session, dispatch)) {
      this.finalizeAfterDispatchError(session, dispatch, error);
      return;
    }
    session.status = "error";
    session.updatedAt = new Date().toISOString();
    session.finishedAt = session.updatedAt;
    session.blocker = error.message;
    session.runner = null;
    session.preparationController = null;
    this.push(session, { type: "stderr", text: `${error.message}\n`, at: session.updatedAt });
    this.push(session, { type: "status", status: "error", blocker: error.message, at: session.updatedAt });
    this.persistMeta(session);
    this.pushSummary(session);
    this.askGateway.destroySession(session.id).catch(() => {});
  }

  private pushSummary(session: AgentSession): void {
    this.push(session, {
      type: "summary",
      sessionId: session.id,
      status: session.status,
      blocker: session.blocker,
      durationMs: session.startedAt && session.finishedAt
        ? Math.max(0, Date.parse(session.finishedAt) - Date.parse(session.startedAt))
        : null,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      outDir: session.outDir,
      at: session.updatedAt,
    });
  }

  private reserveExternalWork(session: AgentSession, workId: string): ExternalWorkState {
    const existing = session.externalWork.get(workId);
    if (existing) return existing;
    const work: ExternalWorkState = { cancel: null };
    session.externalWork.set(workId, work);
    return work;
  }

  private cancelExternalWork(session: AgentSession): void {
    for (const work of session.externalWork.values()) {
      try {
        work.cancel?.();
      } catch {
        // Cancellation is best effort; session shutdown still proceeds.
      }
    }
    session.externalWork.clear();
  }

  private completeExternalWork(
    session: AgentSession,
    workId: string,
    outcome: { status: string; reason: string; at: string },
  ): void {
    if (!session.externalWork.has(workId)) return;
    session.externalWork.delete(workId);
    if (outcome.status !== "completed") {
      session.externalWorkFailures.push(
        outcome.reason || `workflow ${workId} ended with status ${outcome.status || "failed"}`,
      );
    }
    if (session.status === "stopped" || session.externalWork.size > 0 || !session.pendingFinalDispatch) return;
    const finalDispatch = session.pendingFinalDispatch;
    session.pendingFinalDispatch = null;
    finalDispatch.execution = {
      ...(finalDispatch.execution || {}),
      finishedAt: outcome.at,
    };
    if (session.externalWorkFailures.length > 0) {
      const reason = session.externalWorkFailures.join("; ");
      finalDispatch.status = "blocked";
      finalDispatch.blocker = finalDispatch.blocker ? `${finalDispatch.blocker}; ${reason}` : reason;
    }
    this.finalize(session, finalDispatch);
  }

  private markForegroundSettled(session: AgentSession): void {
    if (session.foregroundSettled) return;
    session.foregroundSettled = true;
    for (const waiter of session.foregroundWaiters) {
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve();
    }
    session.foregroundWaiters.clear();
  }

  private maybeRunMemoryScribe(session: AgentSession, wasStopped: boolean): void {
    const context = session.opencodeRunContext;
    session.opencodeRunContext = null;
    if (wasStopped || session.status !== "pass") return;
    if (!session.opencodeSessionId?.trim() || !context) return;
    if (!context.providerId?.trim() || !context.modelId?.trim()) return;

    let settings: ReturnType<typeof readMemorySettings>;
    try {
      settings = readMemorySettings();
    } catch (err) {
      console.warn("[memory scribe] cannot read settings:", (err as Error).message);
      return;
    }
    if (!settings.enabled || !settings.autoExtractEnabled) return;

    this.runMemoryScribe({
      workflowRoot: context.workflowRoot,
      cwd: context.cwd,
      opencodeSessionId: session.opencodeSessionId,
      sourceSessionId: session.id,
      status: session.status,
      providerId: context.providerId,
      modelId: context.modelId,
      env: context.env,
      config: context.config,
      timeoutMs: context.timeoutMs,
    }).catch((err: unknown) => {
      console.warn("[memory scribe] background extraction failed:", (err as Error).message);
    });
  }

  private push(session: AgentSession, rawEvent: AgentRuntimeEvent): void {
    const event = this.redact(rawEvent) as AgentRuntimeEvent;
    event.sequence = ++session.seq;
    session.events.push(event);
    if (session.events.length > MAX_EVENTS) session.events.splice(0, session.events.length - MAX_EVENTS);
    this.persistEvents(session);
    for (const subscriber of this.subscribers.get(session.id)?.values() || []) subscriber.write(event);
  }

  private summarize(session: AgentSession): Record<string, unknown> {
    return {
      id: session.id,
      status: session.status,
      profileId: session.profileId,
      providerId: session.providerId,
      modelId: session.modelId,
      project: session.project,
      productLanguage: session.productLanguage,
      intent: session.intent.slice(0, 240),
      displayText: session.displayText,
      parentSessionId: session.parentSessionId,
      planFilePath: session.planFilePath,
      blocker: session.blocker,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      outDir: session.outDir,
      lastSequence: session.seq,
    };
  }

  private persistMeta(session: AgentSession): void {
    fs.mkdirSync(session.outDir, { recursive: true });
    fs.writeFileSync(path.join(session.outDir, "session-meta.json"), JSON.stringify({
      ...this.summarize(session),
      opencodeSessionId: session.opencodeSessionId,
      planFilePath: session.planFilePath,
    }, null, 2) + "\n", "utf8");
  }

  private loadChatLog(session: AgentSession): unknown {
    try {
      return JSON.parse(fs.readFileSync(path.join(session.outDir, "chat-log.json"), "utf8"));
    } catch {
      return null;
    }
  }

  private loadPersistedSessions(): Map<string, AgentSession> {
    const sessions = new Map<string, AgentSession>();
    const sessionsRoot = path.join(this.workflowRoot, "runtime", "sessions");
    if (fs.existsSync(sessionsRoot)) {
      for (const entry of fs.readdirSync(sessionsRoot)) {
        const outDir = path.join(sessionsRoot, entry, "agent-console");
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(outDir, "session-meta.json"), "utf8"));
          sessions.set(meta.id, this.restoreSession(meta, outDir));
        } catch {
          // Older artifact folders without metadata are intentionally skipped.
        }
      }
    }
    return sessions;
  }

  private restoreSession(meta: Record<string, any>, outDir: string): AgentSession {
    const previousStatus = String(meta.status || "interrupted");
    const status = TERMINAL.has(previousStatus) ? previousStatus : "interrupted";
    const productLanguage = normalizeProductLanguage(meta.productLanguage);
    const events = this.loadPersistedEvents(outDir);
    const seq = events.reduce((max, event) => Math.max(max, finiteNumber(event.sequence)), 0);
    return {
      id: String(meta.id),
      status,
      agentId: DEFAULT_AGENT_ID,
      profileId: String(meta.profileId || "default"),
      providerId: String(meta.providerId || ""),
      modelId: String(meta.modelId || ""),
      createdAt: String(meta.createdAt || new Date().toISOString()),
      updatedAt: String(meta.updatedAt || meta.createdAt || new Date().toISOString()),
      outDir,
      intent: String(meta.intent || ""),
      displayText: String(meta.displayText || meta.intent || "Interrupted session"),
      productLanguage,
      project: String(meta.project || "projects/Project"),
      parentSessionId: meta.parentSessionId || null,
      planFilePath: typeof meta.planFilePath === "string"
        ? meta.planFilePath
        : meta.parentSessionId
          ? null
          : buildConversationPlanRelativePath(String(meta.id)),
      opencodeSessionId: meta.opencodeSessionId || null,
      blocker: status === "interrupted"
        ? backendText('session.interrupted', productLanguage)
        : (meta.blocker || null),
      dispatch: null,
      events,
      seq,
      runner: null,
      preparationController: null,
      startedAt: meta.startedAt || null,
      finishedAt: meta.finishedAt || null,
      inputTokens: 0,
      outputTokens: 0,
      // Surfaced set is process-local (not persisted); a restored session restarts dedup empty.
      surfacedMemorySlugs: [],
      opencodeRunContext: null,
      externalWork: new Map(),
      externalWorkFailures: [],
      pendingFinalDispatch: null,
      foregroundSettled: true,
      foregroundWaiters: new Set(),
      startedWorkflowApprovals: new Set(),
    };
  }

  private persistEvents(session: AgentSession): void {
    fs.mkdirSync(session.outDir, { recursive: true });
    fs.writeFileSync(
      path.join(session.outDir, EVENTS_FILE),
      JSON.stringify({ sessionId: session.id, events: session.events }, null, 2) + "\n",
      "utf8",
    );
  }

  private loadPersistedEvents(outDir: string): AgentRuntimeEvent[] {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(outDir, EVENTS_FILE), "utf8"));
      const events = Array.isArray(payload.events) ? payload.events : [];
      return events
        .filter((event: unknown): event is AgentRuntimeEvent => Boolean(event) && typeof event === "object")
        .slice(-MAX_EVENTS);
    } catch {
      return [];
    }
  }

  private resolveInputSessionBinding(input: SessionCreateInput): EngineProviderBinding | null {
    const settings = this.getAgentExecutionSettings();
    const engine = input.executionEngine || settings.engine || defaultEngine();
    const bindings = settings.bindings as Record<string, EngineProviderBinding | undefined> | undefined;
    return resolveSessionBinding({
      providerId: input.providerId,
      modelId: input.modelId,
      profileId: input.profileId,
      settingsBinding: bindings?.[engine] || null,
    });
  }

  private getAgentExecutionSettings(): AgentExecutionSettingsLike {
    try {
      const stored = ConsoleSettingsDao.get("agentExecution");
      if (stored && typeof stored === "object") {
        return stored as AgentExecutionSettingsLike;
      }
    } catch {
      // Tests and cold-start paths may run before console_settings DB is ready.
    }
    return { engine: defaultEngine() };
  }

  private async getAgentExecutionSettingsForDispatch(): Promise<AgentExecutionSettingsLike> {
    return this.getAgentExecutionSettings();
  }

  private resolveExecutionEngine(input: SessionCreateInput): AgentExecutionEngine {
    return resolveExecutionEngineForProduct(input.executionEngine);
  }

  /** opencode 续链优先复用原生 session；无 id 时才把 chat-log 拼进 prompt。 */
  private resolveConversationHistory(
    continuationOf: string | undefined,
    executionEngine: AgentExecutionEngine,
    parent?: AgentSession,
    complete = false,
  ): string | undefined {
    if (!usesOpencodeProviderBinding(executionEngine) || !continuationOf) return undefined;
    if (parent?.opencodeSessionId?.trim()) return undefined;
    const chain = complete ? this.snapshot(continuationOf) : this.history(continuationOf);
    const formatted = buildConversationHistoryFromChain(chain);
    return formatted || undefined;
  }

  private resolveCurrentProgressPreamble(
    input: SessionCreateInput,
    parent: AgentSession | undefined,
    conversationHistory: string | undefined,
  ): string | undefined {
    if (!input.completeConversationHistory || !conversationHistory?.trim() || !parent) return undefined;
    const projectId = resolveActiveProjectId({ projectPath: parent.project || input.project || "" });
    if (!projectId) return undefined;
    try {
      const progress = readCurrentProgressEntry(this.workflowRoot, projectId, parent.id);
      if (!progress?.current.trim()) return undefined;
      const lines = [
        `Previous session: ${progress.sessionId}`,
        `Status: ${progress.status}`,
        `Updated: ${progress.updatedAt}`,
        `Current: ${progress.current}`,
      ];
      if (progress.next.trim()) lines.push(`Next: ${progress.next}`);
      if (progress.blockers.trim()) lines.push(`Blockers: ${progress.blockers}`);
      return capPromptBlock(lines.join("\n"), 2_500);
    } catch (err) {
      console.warn("[memory progress] cannot read current progress:", (err as Error).message);
      return undefined;
    }
  }

  private maybeClearNativeSessionAfterResumeFailure(
    session: AgentSession,
    finalDispatch: Record<string, any>,
  ): void {
    if (!usesOpencodeProviderBinding(finalDispatch.executionEngine) || !session.opencodeSessionId?.trim()) return;
    const exitCode = finalDispatch.execution?.exitCode;
    if (exitCode === 0) return;
    const log = [
      finalDispatch.backendOutput?.stderr,
      finalDispatch.backendOutput?.stdout,
      finalDispatch.backendOutput?.rawStdout,
    ].filter((chunk): chunk is string => typeof chunk === "string").join("\n");
    if (!containsNativeSessionResumeFailure(log)) return;
    this.clearNativeSessionChain(session);
  }

  private clearNativeSessionChain(session: AgentSession): void {
    let current: AgentSession | undefined = session;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.opencodeSessionId) {
        current.opencodeSessionId = null;
        this.persistMeta(current);
      }
      current = current.parentSessionId
        ? this.sessions.get(current.parentSessionId)
        : undefined;
    }
  }

  private resolveConversationPlanPath(session: AgentSession): string {
    if (session.planFilePath?.trim()) return session.planFilePath.trim();
    return resolveSessionPlanFilePath(
      session as ConversationPlanSessionRef,
      (id) => this.sessions.get(id) as ConversationPlanSessionRef | undefined,
    );
  }

  private async refreshSecrets(): Promise<void> {
    try {
      const document = await providerRegistry.loadDocument(this.workflowRoot);
      this.secrets = Object.values(document.providers || {})
        .map((provider) => provider.credentialValue)
        .filter((value): value is string => Boolean(value));
    } catch {
      this.secrets = [];
    }
  }

  private redact(value: unknown, key = ""): unknown {
    if (shouldRedactKey(key, value)) return "[REDACTED]";
    if (typeof value === "string") {
      return this.secrets.reduce((text, secret) => secret ? text.split(secret).join("[REDACTED]") : text, value);
    }
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, this.redact(entryValue, entryKey)]));
    }
    return value;
  }
}

function finiteNumber(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function capPromptBlock(value: string, maxChars: number): string {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n[truncated]`;
}

function isTokenCountKey(key: string): boolean {
  return /^(input|output|reasoning|cacheRead|cacheWrite|total)Tokens$/i.test(key);
}

function shouldRedactKey(key: string, value: unknown): boolean {
  if (!key) return false;
  if (isTokenCountKey(key) && (typeof value === "number" || typeof value === "string")) return false;
  return /token|secret|password|credential|api.?key/i.test(key);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function proposalIdFromWorkflowToolResult(event: AgentRuntimeEvent): string | null {
  if (event.type !== "tool_result") return null;
  const tool = asString(event.tool);
  if (tool && !/RmmvWorkflow$/i.test(tool)) return null;
  let output: unknown = event.output;
  if (typeof output === "string") {
    try {
      output = JSON.parse(output);
    } catch {
      return null;
    }
  }
  const data = asRecord(asRecord(output).data);
  if (asString(data.kind) !== "workflow-proposal") return null;
  return asString(data.proposalId) || null;
}

function resolveSessionProjectDirectory(session: AgentSession, workflowRoot: string): string {
  try {
    if (session.project && fs.statSync(session.project).isDirectory()) return session.project;
  } catch {
    // Fall back to workflow root.
  }
  return workflowRoot;
}

function normalizeTaskStatus(value: string): string {
  if (value === "in_progress" || value === "completed") return value;
  return "pending";
}

function isOpencodeAskRequestEvent(event: AgentRuntimeEvent, requestId: string): boolean {
  if (event.request_id !== requestId) return false;
  return event.type === "opencode_permission_request" || event.type === "opencode_question_request";
}

function buildPlanApprovalResponse(
  input: Record<string, unknown>,
  result: unknown,
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): Record<string, unknown> {
  language = normalizeProductLanguage(language)
  const data = asRecord(result);
  const decision = asString(data.decision);
  if (decision === "approve" || decision === "confirmed") {
    return {
      behavior: "allow",
      updatedInput: { ...input },
      decisionClassification: "user_temporary",
    };
  }
  const feedback = asString(data.feedback) || (decision === "reject"
    ? backendText('session.planRejected', language)
    : backendText('session.planModifyRequested', language));
  return {
    behavior: "deny",
    message: feedback,
    interrupt: false,
    decisionClassification: "user_reject",
  };
}


function buildQuestionResponse(
  input: Record<string, unknown>,
  result: unknown,
): Record<string, unknown> {
  const data = asRecord(result);
  const questions = Array.isArray(input.questions) ? input.questions.map(asRecord) : [];
  const replyAnswers = buildQuestionReplyAnswers(input, result);
  const answers: Record<string, string> = {};

  for (const [index, question] of questions.entries()) {
    const questionText = asString(question.question);
    if (!questionText) continue;
    const value = (replyAnswers[index] || []).join(", ");
    answers[questionText] = value || asString(data.answer);
  }

  if (!Object.keys(answers).length && asString(data.answer)) {
    const questionText = asString(questions[0]?.question) || "answer";
    answers[questionText] = asString(data.answer);
  }

  return {
    behavior: "allow",
    updatedInput: {
      ...input,
      answers,
    },
    decisionClassification: "user_temporary",
  };
}

function buildQuestionReplyAnswers(
  input: Record<string, unknown>,
  result: unknown,
): string[][] {
  const data = asRecord(result);
  const questions = Array.isArray(input.questions) ? input.questions.map(asRecord) : [];
  const rawAnswers = asRecord(data.answers);
  return questions.map((question) => {
    const questionText = asString(question.question);
    const header = asString(question.header);
    const rawAnswer = rawAnswers[questionText] ?? rawAnswers[header];
    const draft = asRecord(rawAnswer);
    const selected = Array.isArray(draft.selected) ? draft.selected.map(asString).filter(Boolean) : [];
    const normalSelected = selected.filter((item) => item !== "__other__");
    const other = asString(draft.other);
    const values = [...normalSelected, other].filter(Boolean);
    if (values.length) return values;
    const scalar = asString(rawAnswer) || asString(data.answer);
    return scalar ? [scalar] : [];
  });
}

function createDisabledAskGateway(): AgentAskGateway {
  return {
    port: 0,
    async initSession() {},
    registerPushEvent() {},
    async destroySession() {},
    resolveAnswer() {
      return { ok: false, reason: LEGACY_ASK_MCP_DISABLED_REASON };
    },
    async injectEvent() {
      throw new Error(LEGACY_ASK_MCP_DISABLED_REASON);
    },
    async close() {},
  };
}

function makeRuntimeSessionId(iso: string): string {
  const timestamp = iso.replace(/[-:.TZ]/g, "").slice(0, 17);
  return `${timestamp}-session-${randomUUID().slice(0, 8)}`;
}
