import fs from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

import type { AgentRuntimeEvent } from "./agent-session-runtime.ts";
import type { AgentProjectBindingSnapshot } from "./agent-project-binding.ts";

const EVENT_LOG_VERSION = 1;
const EVENTS_JSONL = "events.jsonl";
const EVENTS_GZIP = "events.jsonl.gz";
const LEGACY_EVENTS = "events.json";
const DIAGNOSTIC_INDEX = "diagnostic-index.json";

interface JournalState {
  phases: Set<string>;
  inputCalls: Set<string>;
  outputCalls: Set<string>;
  startedAt: Map<string, number>;
}

export interface SessionEventLogContext {
  outDir: string;
  sessionId: string;
  conversationRootId: string;
  opencodeSessionId: string | null;
  binding: AgentProjectBindingSnapshot;
}

const journals = new Map<string, JournalState>();

export function appendSessionEvent(context: SessionEventLogContext, event: AgentRuntimeEvent): void {
  fs.mkdirSync(context.outDir, { recursive: true });
  const journal = journalFor(context.outDir);
  const callId = toolCallId(event);
  const phase = eventPhase(event);
  if (callId && journal.phases.has(`${callId}:${phase}`)) return;

  const persistedEvent = structuredClone(event);
  if (event.type === "tool_call" && !hasToolInput(persistedEvent)) removeToolInput(persistedEvent);
  let durationMs: number | undefined;
  if (callId) {
    journal.phases.add(`${callId}:${phase}`);
    if (phase === "pending" || phase === "running") {
      if (!journal.startedAt.has(callId)) journal.startedAt.set(callId, Date.parse(String(event.at || "")) || Date.now());
      if (hasToolInput(persistedEvent)) {
        if (journal.inputCalls.has(callId)) removeToolInput(persistedEvent);
        else journal.inputCalls.add(callId);
      }
    } else {
      const startedAt = journal.startedAt.get(callId);
      if (startedAt !== undefined) durationMs = Math.max(0, (Date.parse(String(event.at || "")) || Date.now()) - startedAt);
      if (hasToolOutput(persistedEvent)) {
        if (journal.outputCalls.has(callId)) removeToolOutput(persistedEvent);
        else journal.outputCalls.add(callId);
      }
    }
  }

  const binding = safeBinding(context.binding);
  const envelope = {
    version: EVENT_LOG_VERSION,
    sequence: event.sequence || 0,
    timestamp: event.at || new Date().toISOString(),
    conversationRootId: context.conversationRootId,
    turnId: context.sessionId,
    desktopSessionId: context.sessionId,
    opencodeSessionId: context.opencodeSessionId,
    projectId: binding.projectId,
    projectBindingVersion: binding.version,
    engine: binding.engine,
    runtimeAvailable: binding.runtimeAvailable,
    type: event.type,
    phase,
    ...(callId ? { callId } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    event: persistedEvent,
  };
  const plain = path.join(context.outDir, EVENTS_JSONL);
  if (fs.existsSync(path.join(context.outDir, EVENTS_GZIP)) && !fs.existsSync(plain)) {
    restoreCompressedLog(context.outDir);
  }
  fs.appendFileSync(plain, `${JSON.stringify(envelope)}\n`, "utf8");
}

export function readSessionEvents(outDir: string, maxEvents: number): AgentRuntimeEvent[] {
  const records = readJsonlRecords(outDir);
  if (records.length > 0) {
    return records
      .map((record) => record.event)
      .filter((event): event is AgentRuntimeEvent => Boolean(event) && typeof event === "object")
      .slice(-maxEvents);
  }
  try {
    const legacy = JSON.parse(fs.readFileSync(path.join(outDir, LEGACY_EVENTS), "utf8"));
    return (Array.isArray(legacy.events) ? legacy.events : [])
      .filter((event: unknown): event is AgentRuntimeEvent => Boolean(event) && typeof event === "object")
      .slice(-maxEvents);
  } catch {
    return [];
  }
}

export function finalizeSessionEventLog(
  context: SessionEventLogContext,
  status: string,
  blocker: string | null,
): void {
  const records = readJsonlRecords(context.outDir);
  const calls = new Map<string, {
    tool: string;
    action: string;
    startedAt?: string;
    durationMs?: number;
    completed: boolean;
    failed: boolean;
    errorCode?: string;
    stage?: string;
    diagnosticId?: string;
  }>();
  for (const record of records) {
    const event = asRecord(record.event);
    const callId = String(record.callId || toolCallId(event as AgentRuntimeEvent) || "");
    if (!callId) continue;
    const existing = calls.get(callId) || {
      tool: String(event.tool || event.name || "unknown"),
      action: toolAction(event),
      completed: false,
      failed: false,
    };
    existing.tool = String(event.tool || event.name || existing.tool || "unknown");
    existing.action = toolAction(event) || existing.action;
    if (record.phase === "pending" || record.phase === "running") existing.startedAt ||= String(record.timestamp || "");
    if (record.phase === "completed" || record.phase === "failed") {
      existing.completed = true;
      existing.failed = record.phase === "failed";
      existing.durationMs = finiteNumber(record.durationMs);
      const output = parseToolOutput(event.output ?? event.result);
      const outputData = asRecord(output.data);
      existing.errorCode = stringValue(output.code || outputData.code || event.errorCode) || undefined;
      existing.stage = stringValue(output.stage || outputData.stage || event.stage) || undefined;
      existing.diagnosticId = stringValue(output.diagnosticId || event.diagnosticId) || undefined;
    }
    calls.set(callId, existing);
  }
  const failedTools = [...calls.entries()]
    .filter(([, call]) => call.failed || call.errorCode)
    .map(([callId, call]) => ({ callId, ...call }));
  const incompleteTools = [...calls.entries()]
    .filter(([, call]) => !call.completed)
    .map(([callId, call]) => ({ callId, tool: call.tool, action: call.action, startedAt: call.startedAt }));
  const index = {
    version: 1,
    sessionId: context.sessionId,
    conversationRootId: context.conversationRootId,
    finalStatus: status,
    firstBlocker: blocker || failedTools[0]?.errorCode || null,
    project: safeBinding(context.binding),
    failedTools,
    incompleteTools,
    toolDurations: [...calls.entries()].map(([callId, call]) => ({
      callId,
      tool: call.tool,
      action: call.action,
      durationMs: call.durationMs ?? null,
    })),
    artifacts: {
      events: EVENTS_GZIP,
      toolInternal: fs.existsSync(path.join(context.outDir, "tool-internal.jsonl")) ? "tool-internal.jsonl" : null,
      stdout: fs.existsSync(path.join(context.outDir, "stdout.txt")) ? "stdout.txt" : null,
      stderr: fs.existsSync(path.join(context.outDir, "stderr.txt")) ? "stderr.txt" : null,
      prompt: fs.existsSync(path.join(context.outDir, "prompt.txt")) ? "prompt.txt" : null,
      dispatch: fs.existsSync(path.join(context.outDir, "agent-dispatch.json")) ? "agent-dispatch.json" : null,
    },
    generatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(context.outDir, DIAGNOSTIC_INDEX), index);
  compressPlainLog(context.outDir);
  journals.delete(context.outDir);
}

export function updateConversationTurnIndex(
  workflowRoot: string,
  conversationRootId: string,
  entry: {
    sessionId: string;
    createdAt: string;
    updatedAt: string;
    status: string;
    binding: AgentProjectBindingSnapshot;
  },
): void {
  const filePath = path.join(workflowRoot, "runtime", "sessions", conversationRootId, "conversation-index.json");
  let existing: { version: number; conversationRootId: string; turns: Array<Record<string, unknown>> } = {
    version: 1,
    conversationRootId,
    turns: [],
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(parsed.turns)) existing = parsed;
  } catch {
    // First turn.
  }
  const turn = {
    sessionId: entry.sessionId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    status: entry.status,
    projectId: entry.binding.projectId,
    bindingVersion: entry.binding.version,
    engine: entry.binding.engine,
    diagnosticIndex: path.relative(path.dirname(filePath), path.join(
      workflowRoot,
      "runtime",
      "sessions",
      entry.sessionId,
      "agent-console",
      DIAGNOSTIC_INDEX,
    )).replace(/\\/g, "/"),
  };
  const index = existing.turns.findIndex((candidate) => candidate.sessionId === entry.sessionId);
  if (index >= 0) existing.turns[index] = turn;
  else existing.turns.push(turn);
  writeJsonAtomic(filePath, existing);
}

function journalFor(outDir: string): JournalState {
  let journal = journals.get(outDir);
  if (!journal) {
    journal = { phases: new Set(), inputCalls: new Set(), outputCalls: new Set(), startedAt: new Map() };
    for (const record of readJsonlRecords(outDir)) {
      const event = record.event as AgentRuntimeEvent;
      const callId = String(record.callId || toolCallId(event) || "");
      if (!callId) continue;
      journal.phases.add(`${callId}:${String(record.phase || eventPhase(event))}`);
      if (hasToolInput(event)) journal.inputCalls.add(callId);
      if (hasToolOutput(event)) journal.outputCalls.add(callId);
      if (record.phase === "pending" || record.phase === "running") {
        journal.startedAt.set(callId, Date.parse(String(record.timestamp || "")) || Date.now());
      }
    }
    journals.set(outDir, journal);
  }
  return journal;
}

function readJsonlRecords(outDir: string): Array<Record<string, any>> {
  const plain = path.join(outDir, EVENTS_JSONL);
  const compressed = path.join(outDir, EVENTS_GZIP);
  let text = "";
  try {
    text = fs.existsSync(plain)
      ? fs.readFileSync(plain, "utf8")
      : fs.existsSync(compressed)
        ? gunzipSync(fs.readFileSync(compressed)).toString("utf8")
        : "";
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const records: Array<Record<string, any>> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") records.push(parsed);
    } catch {
      // A crash can leave only the final line incomplete. Earlier complete lines remain authoritative.
    }
  }
  return records;
}

function restoreCompressedLog(outDir: string): void {
  const compressed = path.join(outDir, EVENTS_GZIP);
  const plain = path.join(outDir, EVENTS_JSONL);
  if (!fs.existsSync(compressed)) return;
  fs.writeFileSync(plain, gunzipSync(fs.readFileSync(compressed)));
  fs.rmSync(compressed, { force: true });
}

function compressPlainLog(outDir: string): void {
  const plain = path.join(outDir, EVENTS_JSONL);
  if (!fs.existsSync(plain)) return;
  const target = path.join(outDir, EVENTS_GZIP);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, gzipSync(fs.readFileSync(plain), { level: 9 }));
  fs.renameSync(temporary, target);
  fs.rmSync(plain, { force: true });
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function eventPhase(event: AgentRuntimeEvent): "pending" | "running" | "completed" | "failed" | "event" {
  if (event.type === "tool_call") {
    const status = String(event.status || event.phase || "").toLowerCase();
    return status === "pending" ? "pending" : "running";
  }
  if (event.type === "tool_result") {
    return event.isError === true || event.success === false || event.error ? "failed" : "completed";
  }
  return "event";
}

function toolCallId(event: AgentRuntimeEvent): string | null {
  if (event.type !== "tool_call" && event.type !== "tool_result") return null;
  return stringValue(event.callId || event.call_id || event.toolCallId || event.id) || null;
}

function hasToolInput(event: AgentRuntimeEvent): boolean {
  const value = event.input ?? event.args ?? event.arguments;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function removeToolInput(event: AgentRuntimeEvent): void {
  delete event.input;
  delete event.args;
  delete event.arguments;
}

function hasToolOutput(event: AgentRuntimeEvent): boolean {
  return event.output !== undefined || event.result !== undefined;
}

function removeToolOutput(event: AgentRuntimeEvent): void {
  delete event.output;
  delete event.result;
}

function safeBinding(binding: AgentProjectBindingSnapshot): Record<string, unknown> {
  const { runtime: _runtime, ...safe } = binding;
  return safe;
}

function toolAction(event: Record<string, unknown>): string {
  const input = asRecord(event.input || event.args || event.arguments);
  return stringValue(input.action) || "";
}

function parseToolOutput(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return asRecord(JSON.parse(value)); } catch { return {}; }
  }
  return asRecord(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
