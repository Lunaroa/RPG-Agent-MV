import type { ProductLanguage } from "../../../../contract/i18n.ts";
import type {
  SessionPlanSnapshot,
  SessionSubagentActivity,
  SessionRuntimeEvent,
  SessionSubagentItem,
  SessionSubagentSnapshot,
  SessionSubagentStatus,
} from "../../../../contract/types.ts";
import { nativeTaskResultText } from "../../../../contract/native-task-blocks.ts";
import {
  planContentFromWriteInput,
  planPathFromToolInput,
} from "./session-plan-file.ts";
import {
  sessionPlanLabels,
  sessionSubagentLabels,
  sessionSubagentNotificationTitle,
  sessionSubagentResultTitle,
  sessionSubagentToolTitle,
} from "./sessionDerivedStateLocalization.ts";

export const AGENT_RUNTIME_PLAN_ASK_PREFIX = "agent-runtime-plan:";
export const AGENT_RUNTIME_QUESTION_ASK_PREFIX = "agent-runtime-ask:";

interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown> | null;
}

function toolCallInput(call: ToolCallRecord): Record<string, unknown> {
  return asRecord(call.input);
}

export function planAskIdForRequest(requestId: string): string {
  return `${AGENT_RUNTIME_PLAN_ASK_PREFIX}${requestId}`;
}

export function questionAskIdForRequest(requestId: string): string {
  return `${AGENT_RUNTIME_QUESTION_ASK_PREFIX}${requestId}`;
}

export function deriveSessionPlan(
  sessionId: string,
  events: SessionRuntimeEvent[],
  language?: ProductLanguage | null,
): SessionPlanSnapshot {
  const planLabels = sessionPlanLabels(language);
  const calls = new Map<string, ToolCallRecord>();
  const snapshot: SessionPlanSnapshot = {
    sessionId,
    mode: "idle",
    title: planLabels.idleTitle,
    planMarkdown: "",
    askId: null,
    requestId: null,
    filePath: null,
    feedback: null,
    error: null,
    updatedAt: null,
  };

  for (const event of ordered(events)) {
    const at = asString(event.at) || snapshot.updatedAt || null;

    if (event.type === "tool_call") {
      const callId = asString(event.call_id);
      const tool = asString(event.tool);
      const input = asRecord(event.input);
      if (callId && tool) calls.set(callId, { tool, input });
      if (tool === "EnterPlanMode" || tool === "plan_enter") {
        snapshot.mode = "planning";
        snapshot.title = planLabels.planningTitle;
        snapshot.updatedAt = at;
      } else if (tool === "ExitPlanMode" || tool === "plan_exit") {
        const plan = asString(input.plan);
        if (plan) snapshot.planMarkdown = plan;
        snapshot.mode = "approval_requested";
        snapshot.title = planLabels.approvalRequestedTitle;
        snapshot.updatedAt = at;
      } else if (isPlanFileTool(tool)) {
        applyPlanFileToolCall(snapshot, tool, input, at, planLabels);
      }
      continue;
    }

    if (event.type === "opencode_permission_request") {
      const request = asRecord(event.request);
      if (request.subtype !== "can_use_tool") continue;
      const toolName = asString(request.tool_name);
      if (toolName === "EnterPlanMode") {
        snapshot.mode = "planning";
        snapshot.title = planLabels.planningTitle;
        snapshot.updatedAt = at;
        continue;
      }
      if (toolName !== "ExitPlanMode") continue;
      const requestId = asString(event.request_id);
      const input = asRecord(request.input);
      snapshot.mode = "approval_requested";
      snapshot.title = planLabels.approvalRequestedTitle;
      snapshot.planMarkdown = asString(input.plan) || snapshot.planMarkdown;
      snapshot.filePath = asString(input.planFilePath) || snapshot.filePath || null;
      snapshot.requestId = requestId || snapshot.requestId || null;
      snapshot.askId = requestId ? planAskIdForRequest(requestId) : snapshot.askId || null;
      snapshot.feedback = null;
      snapshot.error = null;
      snapshot.updatedAt = at;
      continue;
    }

    if (event.type === "opencode_permission_response") {
      const response = asRecord(event.response);
      const requestId = asString(response.request_id) || asString(event.request_id);
      if (requestId && requestId === snapshot.requestId) {
        const payload = asRecord(response.response);
        const behavior = asString(payload.behavior);
        if (response.subtype === "error") {
          snapshot.mode = "error";
          snapshot.error = asString(response.error) || planLabels.responseFailed;
        } else if (behavior === "allow") {
          snapshot.mode = "approved";
          snapshot.feedback = null;
          snapshot.error = null;
        } else if (behavior === "deny") {
          snapshot.mode = "rejected";
          snapshot.feedback = asString(payload.message) || null;
          snapshot.error = null;
        }
        snapshot.updatedAt = at;
      }
      continue;
    }

    if (event.type === "tool_result") {
      const call = calls.get(asString(event.call_id));
      if (!call) continue;
      if (call.tool === "EnterPlanMode" || call.tool === "plan_enter") {
        snapshot.mode = event.success === false ? "error" : "planning";
        snapshot.error = event.success === false ? outputText(event.output) || planLabels.enterFailed : null;
        snapshot.updatedAt = at;
      } else if (isPlanFileTool(call.tool)) {
        const planPath = planPathFromToolInput(toolCallInput(call));
        if (planPath) {
          snapshot.filePath = planPath;
          snapshot.mode = snapshot.mode === "idle" ? "planning" : snapshot.mode;
          snapshot.title = snapshot.mode === "planning" ? planLabels.planningTitle : snapshot.title;
          snapshot.updatedAt = at;
        }
      } else if (call.tool === "ExitPlanMode" || call.tool === "plan_exit") {
        const parsed = parseJsonObject(event.output);
        const plan = asString(parsed?.plan) || extractPlanFromApprovedText(outputText(event.output));
        if (plan) snapshot.planMarkdown = plan;
        snapshot.filePath = asString(parsed?.filePath) || snapshot.filePath || null;
        snapshot.requestId = asString(parsed?.requestId) || snapshot.requestId || null;
        snapshot.askId = snapshot.requestId ? planAskIdForRequest(snapshot.requestId) : snapshot.askId || null;
        if (event.success === false) {
          snapshot.mode = "error";
          snapshot.error = outputText(event.output) || planLabels.exitFailed;
        } else if (parsed?.awaitingLeaderApproval === true) {
          snapshot.mode = "approval_requested";
        } else {
          snapshot.mode = "approved";
          snapshot.error = null;
        }
        snapshot.updatedAt = at;
      }
    }
  }

  return snapshot;
}

export function deriveSessionSubagents(
  sessionId: string,
  events: SessionRuntimeEvent[],
  language?: ProductLanguage | null,
): SessionSubagentSnapshot {
  const subagentLabels = sessionSubagentLabels(language);
  const calls = new Map<string, ToolCallRecord>();
  const callToItemId = new Map<string, string>();
  const items = new Map<string, SessionSubagentItem>();
  let updatedAt: string | null = null;

  const upsert = (id: string, patch: Partial<SessionSubagentItem>) => {
    if (!id) return;
    const existing = items.get(id);
    const next: SessionSubagentItem = {
      id,
      description: patch.description ?? existing?.description ?? id,
      prompt: patch.prompt ?? existing?.prompt,
      status: patch.status ?? existing?.status ?? "unknown",
      taskType: patch.taskType ?? existing?.taskType ?? null,
      background: patch.background ?? existing?.background ?? false,
      output: patch.output ?? existing?.output ?? null,
      outputFile: patch.outputFile ?? existing?.outputFile ?? null,
      error: patch.error ?? existing?.error ?? null,
      sessionUrl: patch.sessionUrl ?? existing?.sessionUrl ?? null,
      callId: patch.callId ?? existing?.callId ?? null,
      updatedAt: patch.updatedAt ?? existing?.updatedAt ?? updatedAt,
      stopRequestId: patch.stopRequestId ?? existing?.stopRequestId ?? null,
      activity: patch.activity ?? existing?.activity ?? [],
    };
    items.set(id, next);
    updatedAt = next.updatedAt || updatedAt;
  };

  const appendActivity = (
    id: string,
    entry: Omit<SessionSubagentActivity, "id">,
  ): SessionSubagentActivity[] => {
    const existing = items.get(id)?.activity || [];
    return [
      ...existing,
      {
        id: `${entry.kind}-${existing.length + 1}`,
        ...entry,
      },
    ];
  };

  const rename = (fromId: string, toId: string): string => {
    if (!toId || fromId === toId) return fromId;
    const existing = items.get(fromId);
    if (existing) {
      items.delete(fromId);
      items.set(toId, { ...existing, id: toId });
    }
    return toId;
  };

  for (const event of ordered(events)) {
    const at = asString(event.at) || new Date(0).toISOString();
    updatedAt = at;

    if (event.type === "tool_call") {
      const callId = asString(event.call_id);
      const tool = asString(event.tool);
      const input = asRecord(event.input);
      if (callId && tool) calls.set(callId, { tool, input });

      if (tool === "Agent" && callId) {
        const id = `pending:${callId}`;
        callToItemId.set(callId, id);
        upsert(id, {
          description: asString(input.description) || subagentLabels.fallbackDescription,
          prompt: asString(input.prompt),
          status: "running",
          background: input.background === true,
          callId,
          updatedAt: at,
          activity: appendActivity(id, {
            kind: "started",
            title: subagentLabels.started,
            detail: asString(input.prompt) || asString(input.description) || null,
            status: "running",
            at,
          }),
        });
      } else if (tool === "TaskOutput") {
        const taskId = asString(input.task_id);
        if (taskId) upsert(taskId, {
          status: "running",
          callId,
          updatedAt: at,
          activity: appendActivity(taskId, {
            kind: "progress",
            title: subagentLabels.readOutput,
            status: "running",
            at,
          }),
        });
      } else if (tool === "TaskStop") {
        const taskId = asString(input.task_id) || asString(input.shell_id);
        if (taskId) upsert(taskId, {
          status: "running",
          callId,
          updatedAt: at,
          activity: appendActivity(taskId, {
            kind: "stop_requested",
            title: subagentLabels.stopRequested,
            status: "running",
            at,
          }),
        });
      }
      continue;
    }

    if (event.type === "tool_result") {
      const callId = asString(event.call_id);
      const call = calls.get(callId);
      if (!call) continue;

      if (call.tool === "Agent") {
        const currentId = callToItemId.get(callId) || `pending:${callId}`;
        const parsed = parseAgentOutput(event.output, event.success !== false, language);
        const nextId = rename(currentId, parsed.id || currentId);
        callToItemId.set(callId, nextId);
        const callInput = toolCallInput(call);
        upsert(nextId, {
          description: parsed.description || asString(callInput.description) || subagentLabels.fallbackDescription,
          prompt: parsed.prompt || asString(callInput.prompt),
          status: parsed.status,
          background: parsed.background || callInput.background === true,
          output: parsed.output || null,
          outputFile: parsed.outputFile,
          sessionUrl: parsed.sessionUrl,
          error: parsed.error,
          callId,
          updatedAt: at,
          activity: appendActivity(nextId, {
            kind: parsed.status === "failed" ? "failed" : parsed.status === "running" ? "progress" : "output",
            title: sessionSubagentResultTitle(parsed.status, language),
            detail: parsed.output || parsed.error || null,
            status: parsed.status,
            outputFile: parsed.outputFile,
            at,
          }),
        });
      } else if (call.tool === "TaskOutput") {
        const parsed = parseTaskOutput(event.output);
        const taskId = parsed.taskId || asString(toolCallInput(call).task_id);
        if (!taskId) continue;
        upsert(taskId, {
          description: parsed.description || undefined,
          status: parsed.status,
          taskType: parsed.taskType,
          output: parsed.output,
          error: parsed.error,
          callId,
          updatedAt: at,
          activity: appendActivity(taskId, {
            kind: parsed.status === "failed" ? "failed" : "output",
            title: parsed.status === "failed" ? subagentLabels.outputReadFailed : subagentLabels.outputRead,
            detail: parsed.output || parsed.error || null,
            status: parsed.status,
            at,
          }),
        });
      } else if (call.tool === "TaskStop") {
        const parsed = parseTaskStopOutput(event.output);
        const taskId = parsed.taskId || asString(toolCallInput(call).task_id) || asString(toolCallInput(call).shell_id);
        if (!taskId) continue;
        upsert(taskId, {
          status: event.success === false ? "failed" : "stopped",
          taskType: parsed.taskType,
          output: parsed.message,
          error: event.success === false ? outputText(event.output) : null,
          callId,
          updatedAt: at,
          activity: appendActivity(taskId, {
            kind: event.success === false ? "failed" : "stopped",
            title: event.success === false ? subagentLabels.stopFailed : subagentLabels.stopped,
            detail: parsed.message || (event.success === false ? outputText(event.output) : null),
            status: event.success === false ? "failed" : "stopped",
            at,
          }),
        });
      }
      continue;
    }

    if (event.type === "subagent_task_started" || event.type === "subagent_task_progress") {
      const callId = asString(event.callId);
      const taskId = asString(event.taskId);
      const currentId = callId ? callToItemId.get(callId) || `pending:${callId}` : "";
      const nextId = rename(currentId, taskId || currentId);
      if (callId && nextId) callToItemId.set(callId, nextId);
      const logType = asString(event.logType);
      const toolStatus = asString(event.toolStatus);
      const activityStatus = toolStatus === "failed"
        ? "failed"
        : toolStatus === "completed"
          ? "completed"
          : "running";
      upsert(nextId || taskId, {
        description: asString(event.description) || undefined,
        prompt: asString(event.prompt) || undefined,
        status: "running",
        taskType: asString(event.taskType) || undefined,
        background: event.background === true ? true : undefined,
        callId: callId || undefined,
        updatedAt: at,
        activity: appendActivity(nextId || taskId, {
          kind: logType ? "output" : event.type === "subagent_task_started" ? "started" : "progress",
          title: logType === "reasoning"
            ? subagentLabels.reasoning
            : logType === "text"
              ? subagentLabels.output
              : event.type === "subagent_task_started"
            ? subagentLabels.started
            : asString(event.lastToolName)
              ? sessionSubagentToolTitle(asString(event.lastToolName), language)
              : subagentLabels.running,
          detail: asString(event.detail) || asString(event.prompt) || asString(event.description) || null,
          status: activityStatus,
          tool: asString(event.lastToolName) || null,
          input: event.toolInput,
          output: event.toolOutput,
          at,
        }),
      });
      continue;
    }

    if (event.type === "subagent_task_notification") {
      const callId = asString(event.callId);
      const taskId = asString(event.taskId);
      const currentId = callId ? callToItemId.get(callId) || `pending:${callId}` : "";
      const nextId = rename(currentId, taskId || currentId);
      if (callId && nextId) callToItemId.set(callId, nextId);
      const status = mapTaskStatus(asString(event.status));
      const output = usefulSubagentOutput(asString(event.output));
      upsert(nextId || taskId, {
        status,
        output: output || null,
        outputFile: asString(event.outputFile) || null,
        error: status === "failed" || status === "timeout"
          ? asString(event.error) || output || subagentLabels.failed
          : undefined,
        callId: callId || undefined,
        updatedAt: at,
        activity: appendActivity(nextId || taskId, {
          kind: status === "failed" || status === "timeout" ? "failed" : "notification",
          title: sessionSubagentNotificationTitle(status, language),
          detail: output || asString(event.error) || null,
          status,
          outputFile: asString(event.outputFile) || null,
          at,
        }),
      });
      continue;
    }

    if (event.type === "subagent_stop_requested") {
      const taskId = asString(event.taskId);
      if (taskId) {
        upsert(taskId, {
          status: "running",
          stopRequestId: asString(event.requestId) || null,
          updatedAt: at,
          activity: appendActivity(taskId, {
            kind: "stop_requested",
            title: subagentLabels.stopRequested,
            status: "running",
            at,
          }),
        });
      }
      continue;
    }

    if (event.type === "opencode_permission_response") {
      const response = asRecord(event.response);
      const requestId = asString(response.request_id) || asString(event.request_id);
      if (!requestId) continue;
      for (const item of items.values()) {
        if (item.stopRequestId !== requestId) continue;
        upsert(item.id, {
          status: response.subtype === "error" ? "failed" : "stopped",
          error: response.subtype === "error" ? asString(response.error) || subagentLabels.stopSubagentFailed : null,
          updatedAt: at,
          activity: appendActivity(item.id, {
            kind: response.subtype === "error" ? "failed" : "stopped",
            title: response.subtype === "error" ? subagentLabels.stopFailed : subagentLabels.stopped,
            detail: response.subtype === "error" ? asString(response.error) || null : null,
            status: response.subtype === "error" ? "failed" : "stopped",
            at,
          }),
        });
      }
    }
  }

  return {
    sessionId,
    items: [...items.values()],
    updatedAt,
  };
}

function parseAgentOutput(
  output: unknown,
  success: boolean,
  language?: ProductLanguage | null,
): {
  id: string | null;
  status: SessionSubagentStatus;
  background: boolean;
  description: string;
  prompt: string;
  output: string | null;
  outputFile: string | null;
  error: string | null;
  sessionUrl: string | null;
} {
  const text = outputText(output);
  const parsed = parseJsonObject(output);
  const rawStatus = asString(parsed?.status);
  const agentId = asString(parsed?.agentId) || matchValue(text, /\bagentId:\s*([^\s(]+)/i) || matchValue(text, /\bagent_id:\s*([^\s]+)/i);
  const taskId = asString(parsed?.taskId) || matchValue(text, /\btaskId:\s*([^\s]+)/i);
  const background = isBackgroundAgentLaunch(success, parsed, text, rawStatus);
  const status: SessionSubagentStatus = !success
    ? "failed"
    : background
      ? "running"
      : "completed";
  return {
    id: taskId || agentId || null,
    status,
    background,
    description: asString(parsed?.description),
    prompt: asString(parsed?.prompt),
    output: status === "running" ? "" : usefulSubagentOutput(stripUsageTrailer(text)),
    outputFile: asString(parsed?.outputFile) || matchValue(text, /\boutput_file:\s*(.+)$/im),
    error: success ? null : text || sessionSubagentLabels(language).failed,
    sessionUrl: asString(parsed?.sessionUrl) || matchValue(text, /\bsession_url:\s*(\S+)/i),
  };
}

function isBackgroundAgentLaunch(
  success: boolean,
  parsed: Record<string, unknown> | null,
  text: string,
  rawStatus: string,
): boolean {
  if (!success) return false;
  if (parsed?.background === true) return true;
  if (rawStatus === "async_launched" || rawStatus === "remote_launched") return true;
  if (/Async agent launched|Remote agent launched/i.test(text)) return true;
  if (/<task\b[^>]*\bstate="running"/i.test(text)) return true;
  if (rawStatus === "running") return true;
  return false;
}

function parseTaskOutput(output: unknown): {
  taskId: string;
  taskType: string | null;
  description: string;
  status: SessionSubagentStatus;
  output: string | null;
  error: string | null;
} {
  const text = outputText(output);
  const retrievalStatus = extractTag(text, "retrieval_status");
  const rawStatus = extractTag(text, "status") || retrievalStatus;
  const error = extractTag(text, "error");
  return {
    taskId: extractTag(text, "task_id"),
    taskType: extractTag(text, "task_type") || null,
    description: extractTag(text, "description"),
    status: mapTaskStatus(rawStatus, retrievalStatus),
    output: extractTag(text, "output") || null,
    error: error || null,
  };
}

function parseTaskStopOutput(output: unknown): { taskId: string; taskType: string | null; message: string | null } {
  const text = outputText(output);
  const parsed = parseJsonObject(output);
  return {
    taskId: asString(parsed?.task_id) || matchValue(text, /"task_id"\s*:\s*"([^"]+)"/i),
    taskType: asString(parsed?.task_type) || null,
    message: asString(parsed?.message) || text || null,
  };
}

function mapTaskStatus(status: string, retrievalStatus = ""): SessionSubagentStatus {
  const value = (status || retrievalStatus || "").toLowerCase();
  if (value === "timeout") return "timeout";
  if (value === "not_ready") return "not_ready";
  if (["completed", "success", "done"].includes(value)) return "completed";
  if (["failed", "error"].includes(value)) return "failed";
  if (["stopped", "killed", "cancelled", "canceled"].includes(value)) return "stopped";
  if (["running", "pending"].includes(value)) return "running";
  return "unknown";
}

function ordered(events: SessionRuntimeEvent[]): SessionRuntimeEvent[] {
  return [...events].sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output == null) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  const text = outputText(value).trim();
  if (!text) return null;
  const candidates = [text];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function extractTag(text: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(text);
  return match ? match[1].trim() : "";
}

function matchValue(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  return match ? match[1].trim() : "";
}

function stripUsageTrailer(text: string): string {
  return text.replace(/\n?agentId:\s*[^\n]+[\s\S]*?<usage>[\s\S]*?<\/usage>\s*$/i, "").trim();
}

function usefulSubagentOutput(value: string): string {
  const text = nativeTaskResultText(value).trim();
  if (!text) return "";
  if (/^Agent(?:\s+"[^"]+")?\s+completed\.?$/i.test(text)) return "";
  return text;
}

function extractPlanFromApprovedText(text: string): string {
  const match = /<plan>([\s\S]*?)<\/plan>/i.exec(text);
  return match ? match[1].trim() : "";
}

function isPlanFileTool(tool: string): boolean {
  const normalized = tool.trim().toLowerCase();
  return normalized === "write" || normalized === "edit" || normalized === "apply_patch";
}

function applyPlanFileToolCall(
  snapshot: SessionPlanSnapshot,
  tool: string,
  input: Record<string, unknown>,
  at: string | null,
  planLabels: ReturnType<typeof sessionPlanLabels>,
): void {
  const planPath = planPathFromToolInput(input);
  if (!planPath) return;
  snapshot.filePath = planPath;
  snapshot.mode = "planning";
  snapshot.title = planLabels.planningTitle;
  snapshot.updatedAt = at;
  if (tool.trim().toLowerCase() === "write") {
    const content = planContentFromWriteInput(input);
    if (content) snapshot.planMarkdown = content;
  }
}
