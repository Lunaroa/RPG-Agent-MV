// Feedback review card renderer. Each event-feedback record refreshes a readable
// markdown card that joins the event contract, the relevant AI session trace,
// and all user verdicts in one file.
import fs from "node:fs";
import path from "node:path";

import { stripNativeTaskBlocks } from "../../../../contract/native-task-blocks.ts";
import { readSessionEvents } from "../desktop/session-event-log.ts";
import { EventContractDao } from "../db/dao/event-contract-dao.ts";
import { EventFeedbackDao, type EventFeedback } from "../db/dao/event-feedback-dao.ts";
import {
  feedbackCardCommandKinds,
  feedbackCardEventsSource,
  feedbackCardListSeparator,
  feedbackCardPurpose,
  feedbackCardScoreRow,
  feedbackCardSections,
  feedbackCardSessionEventsMissing,
  feedbackCardSummary,
  feedbackCardTitle,
  feedbackVerdictLabel,
} from "./feedbackCardLocalization.ts";

interface SessionDigest {
  sessionId: string;
  eventsPath: string | null;
  thinking: string[];
  toolCalls: Array<{ name: string; brief: string }>;
  assistantText: string[];
}

function verdictLabel(verdict: string): string {
  return feedbackVerdictLabel(verdict);
}

function findSessionEvents(workflowRoot: string, sessionId: string): string | null {
  const root = path.join(workflowRoot, "runtime", "sessions", sessionId, "agent-console");
  for (const name of ["events.jsonl.gz", "events.jsonl", "events.json"]) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function briefInput(input: unknown): string {
  if (input == null) return "";
  try {
    const s = JSON.stringify(input);
    return s.length > 200 ? `${s.slice(0, 197)}...` : s;
  } catch {
    return "";
  }
}

function digestSession(workflowRoot: string, sessionId: string): SessionDigest {
  const eventsPath = findSessionEvents(workflowRoot, sessionId);
  const digest: SessionDigest = { sessionId, eventsPath, thinking: [], toolCalls: [], assistantText: [] };
  if (!eventsPath) return digest;

  const events = readSessionEvents(path.dirname(eventsPath), 5_000) as Array<Record<string, unknown>>;

  const textByMessage = new Map<string, string[]>();
  const reasoningByMessage = new Map<string, string[]>();
  for (const event of events) {
    const type = String(event.type || "");
    if (type === "reasoning_delta") {
      const key = String(event.message_id || "default");
      const text = String(event.text || "").trim();
      if (text) reasoningByMessage.set(key, [...(reasoningByMessage.get(key) || []), text]);
    } else if (type === "text_delta") {
      const key = String(event.message_id || "default");
      const text = stripNativeTaskBlocks(String(event.text || ""));
      if (text) textByMessage.set(key, [...(textByMessage.get(key) || []), text]);
    } else if (type === "message") {
      const text = stripNativeTaskBlocks(String(event.text || "")).trim();
      if (text) digest.assistantText.push(text);
    } else if (type === "tool_call") {
      digest.toolCalls.push({ name: String(event.tool || "tool"), brief: briefInput(event.input) });
    }
  }
  for (const chunks of reasoningByMessage.values()) {
    const text = chunks.join("").trim();
    if (text) digest.thinking.push(text);
  }
  for (const chunks of textByMessage.values()) {
    const text = chunks.join("").trim();
    if (text) digest.assistantText.push(text);
  }
  return digest;
}

function extractCommandKinds(contract: Record<string, unknown>): string[] {
  const impl = contract.implementation as { commands?: unknown; pages?: unknown } | undefined;
  if (!impl) return [];
  const commands: unknown[] = Array.isArray(impl.commands)
    ? impl.commands
    : Array.isArray(impl.pages)
      ? (impl.pages as Array<{ commands?: unknown }>).flatMap((p) => (Array.isArray(p.commands) ? p.commands : []))
      : [];
  return commands.map((c) => String((c as { kind?: unknown })?.kind ?? "?"));
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderCard(
  contractId: string,
  feedbacks: EventFeedback[],
  contract: Record<string, unknown> | null,
  digest: SessionDigest | null,
  eventsRel: string | null,
): string {
  const latest = feedbacks[feedbacks.length - 1];
  const lines: string[] = [];
  const sections = feedbackCardSections();
  const listSeparator = feedbackCardListSeparator();

  lines.push(feedbackCardTitle(contractId));
  lines.push("");
  lines.push(feedbackCardSummary(latest ? verdictLabel(latest.verdict) : "—", feedbacks.length, new Date().toISOString()));
  lines.push("");

  lines.push(sections.scores);
  lines.push("");
  lines.push(sections.scoreTableHead);
  lines.push(sections.scoreTableRule);
  for (const f of feedbacks) {
    lines.push(feedbackCardScoreRow({
      id: f.rid,
      verdict: verdictLabel(f.verdict),
      tags: f.tags.join(listSeparator) || "—",
      note: escapeCell(f.note ?? "—"),
      createdAt: f.created_at,
      sessionId: f.session_id ?? "—",
    }));
  }
  lines.push("");

  lines.push(sections.eventContract);
  lines.push("");
  if (contract) {
    const purpose = typeof contract.purpose === "string" ? contract.purpose : "";
    if (purpose) {
      lines.push(feedbackCardPurpose(purpose));
      lines.push("");
    }
    const kinds = extractCommandKinds(contract);
    if (kinds.length) {
      lines.push(feedbackCardCommandKinds(kinds.length, kinds.join(" → ")));
      lines.push("");
    }
    lines.push(sections.fullContractSummary);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(contract, null, 2));
    lines.push("```");
    lines.push("</details>");
  } else {
    lines.push(sections.missingContract);
  }
  lines.push("");

  lines.push(sections.aiProcess);
  lines.push("");
  if (!digest) {
    lines.push(sections.missingSession);
  } else if (!digest.eventsPath) {
    lines.push(feedbackCardSessionEventsMissing(digest.sessionId));
  } else {
    lines.push(feedbackCardEventsSource(eventsRel ?? digest.eventsPath));
    lines.push("");
    if (digest.thinking.length) {
      lines.push(sections.thinking);
      lines.push("");
      lines.push(sections.thinkingSummary);
      lines.push("");
      for (const t of digest.thinking) {
        lines.push(t);
        lines.push("");
      }
      lines.push("</details>");
      lines.push("");
    }
    if (digest.toolCalls.length) {
      lines.push(sections.toolCalls);
      lines.push("");
      for (const tc of digest.toolCalls) {
        lines.push(`- \`${tc.name}\`${tc.brief ? ` ${tc.brief}` : ""}`);
      }
      lines.push("");
    }
    if (digest.assistantText.length) {
      lines.push(sections.assistantText);
      lines.push("");
      for (const t of digest.assistantText) {
        lines.push(t);
        lines.push("");
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Generate or refresh the feedback review card for one event contract.
 * The session digest uses the latest feedback row that has a session id.
 */
export function writeFeedbackCard(opts: {
  workflowRoot: string;
  projectId: string;
  contractId: string;
}): string {
  const { workflowRoot, projectId, contractId } = opts;
  const feedbacks = EventFeedbackDao.listByContract(projectId, contractId);
  const contract = EventContractDao.get(contractId);

  const withSession = [...feedbacks].reverse().find((f) => f.session_id);
  const digest = withSession?.session_id ? digestSession(workflowRoot, withSession.session_id) : null;
  const eventsRel = digest?.eventsPath ? path.relative(workflowRoot, digest.eventsPath).split(path.sep).join("/") : null;

  const md = renderCard(contractId, feedbacks, contract?.contract ?? null, digest, eventsRel);

  const dir = path.join(workflowRoot, ".opencode", "logs", "skills", "feedback");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${contractId}.md`);
  fs.writeFileSync(file, md, "utf8");
  return file;
}
