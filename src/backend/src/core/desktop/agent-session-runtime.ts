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
} from "../workflow/agent/agent-dispatch.ts";
import { KnowledgeContextAbortedError } from "../workflow/agent/knowledge-context.ts";
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

export interface AgentSession {
  id: string;
  status: string;
  agentId: string;
  profileId: string;
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

  constructor(workflowRoot: string, deps: RuntimeDependencies = {}) {
    this.workflowRoot = workflowRoot;
    this.deps = deps;
    this.buildDispatch = deps.buildDispatch || buildAgentDispatch;
    this.startDispatch = deps.startDispatch || startAgentDispatchProcess;
    this.writeOutputs = deps.writeOutputs || writeAgentDispatchOutputs;
    this.activateForSession = deps.activateForSession || activateForSession;
    this.loadRegistry = deps.loadRegistry || loadAgentRegistry;
  }

  async initialize(): Promise<void> {
    this.askGateway = this.deps.askGateway || createDisabledAskGateway();
    await this.refreshSecrets();
    this.sessions = this.loadPersistedSessions();
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.preparationController?.abort();
      if (session.runner) session.runner.stop();
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
      conversationHistory: this.resolveConversationHistory(
        input.continuationOf,
        executionEngine,
        parent,
        input.completeConversationHistory,
      ),
      readOnlyTools: input.readOnlyTools,
    });
    const knowledgeContext = dispatch.knowledgeContext
      ? (JSON.parse(JSON.stringify(dispatch.knowledgeContext)) as Record<string, unknown>)
      : null;
    return {
      status: dispatch.status,
      blocker: dispatch.blocker || null,
      profileId: dispatch.profileId || null,
      executionEngine: dispatch.executionEngine || executionEngine,
      command: dispatch.execution?.command?.display || null,
      knowledgeContext,
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
      this.push(session, { type: "status", status: "stopped", at: session.updatedAt });
      this.persistMeta(session);
      this.pushSummary(session);
      this.askGateway.destroySession(session.id).catch(() => {});
    }
    return this.summarize(session);
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

  subscribe(sessionId: string, subscriber: SessionSubscriber, lastSequence = 0): AgentRuntimeEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session not found");
    const replay = session.events.filter((event) => Number(event.sequence || 0) > lastSequence);
    const subscribers = this.subscribers.get(sessionId) || new Map<string, SessionSubscriber>();
    subscribers.set(subscriber.id, subscriber);
    this.subscribers.set(sessionId, subscribers);
    for (const event of replay) subscriber.write(event);
    return replay;
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
    if (!requestEvent) return { ok: false, reason: "opencode request not found" };

    const request = asRecord(requestEvent.request);
    const response = askType === "plan-approval"
      ? buildPlanApprovalResponse(asRecord(request.input), result, session.productLanguage)
      : buildQuestionResponse(asRecord(request.input), result);

    const behavior = asString(response.behavior);
    const opencodeSessionId = session.opencodeSessionId;
    if (opencodeSessionId) {
      const directory = resolveSessionProjectDirectory(session, this.workflowRoot);
      if (asString(request.tool_name) === "AskUserQuestion") {
        await replyOpencodeQuestion(
          opencodeSessionId,
          requestId,
          buildQuestionReplyAnswers(asRecord(request.input), result),
          directory,
        );
      } else {
        await replyOpencodePermission(
          opencodeSessionId,
          requestId,
          behavior === "deny" ? "reject" : "once",
          directory,
        );
      }
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
    if (event.type === "status" && typeof event.status === "string") {
      if (session.status === "stopped" && event.status !== "stopped") return;
      if (TERMINAL.has(session.status) && session.status !== event.status) return;
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
      conversationHistory: this.resolveConversationHistory(
        input.continuationOf,
        executionEngine,
        parent,
        input.completeConversationHistory,
      ),
      readOnlyTools: input.readOnlyTools,
      planFilePath: session.planFilePath || undefined,
      knowledgeContextOutDir: path.join(session.outDir, "knowledge-context"),
      skipKnowledgeRefresh: true,
      signal: controller.signal,
      preparationTaskId: session.id,
      onPreparationProgress: (progress) => {
        if (session.status !== "stopped") this.push(session, { type: "preparation", ...progress, at: new Date().toISOString() });
      },
      askMcpGatewayPort: null,
    });
    clearPreparationTimer();
    if (controller.signal.aborted || session.status === "stopped") return;
    session.preparationController = null;
    session.dispatch = dispatch;
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
    if (session.status === "stopped") {
      await this.askGateway.destroySession(session.id);
      return;
    }
    session.runner = this.startDispatch(dispatch, {
      sessionId: session.id,
      timeoutMs: input.timeoutMs,
      outDir: session.outDir,
      opencodeSessionId: parent?.opencodeSessionId || session.opencodeSessionId || undefined,
    }, (event) => {
      this.handleDispatchEvent(session, event);
    });
    session.runner.promise
      .then((finalDispatch) => {
        this.finalize(session, finalDispatch);
      })
      .catch((error: Error) => {
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
    if (session.status === "stopped" || error instanceof KnowledgeContextAbortedError) {
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
