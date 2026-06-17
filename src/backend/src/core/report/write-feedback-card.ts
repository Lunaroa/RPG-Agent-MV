// 反馈审阅卡片：每次 event-feedback record 后生成/刷新一张可读 md，
// 把「事件内容 + AI 那次的思考/工具调用 + 你的全部打分」拼到一处，落在
// `.opencode/logs/skills/feedback/<contractId>.md`，翻文件夹即可审阅（无需在 DB 与会话事件之间来回跳）。
//
// 数据各归其位、视图统一：打分仍在 SQLite（可聚合统计），会话事件仍留 `runtime/sessions/`，
// 本卡片只是把两者 join 后渲染成人读视图；每次 record 重生该事件的卡片（改分自动更新）。
import fs from "node:fs";
import path from "node:path";

import { stripNativeTaskBlocks } from "../../../../contract/native-task-blocks.ts";
import { EventContractDao } from "../db/dao/event-contract-dao.ts";
import { EventFeedbackDao, type EventFeedback } from "../db/dao/event-feedback-dao.ts";

interface SessionDigest {
  sessionId: string;
  eventsPath: string | null;
  thinking: string[];
  toolCalls: Array<{ name: string; brief: string }>;
  assistantText: string[];
}

const VERDICT_LABEL: Record<string, string> = {
  accept: "✅ 接受",
  revise: "✏️ 调整",
  reject: "❌ 拒绝",
};

function verdictLabel(verdict: string): string {
  return VERDICT_LABEL[verdict] ?? verdict;
}

function findSessionEvents(workflowRoot: string, sessionId: string): string | null {
  const candidate = path.join(workflowRoot, "runtime", "sessions", sessionId, "agent-console", "events.json");
  return fs.existsSync(candidate) ? candidate : null;
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

  let events: Array<Record<string, unknown>> = [];
  try {
    const payload = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
    events = Array.isArray(payload.events) ? payload.events : [];
  } catch {
    return digest;
  }

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

  lines.push(`# 反馈卡片：${contractId}`);
  lines.push("");
  lines.push(
    `> 当前评价：**${latest ? verdictLabel(latest.verdict) : "—"}** ｜ 共 ${feedbacks.length} 条反馈 ｜ 生成于 ${new Date().toISOString()}`,
  );
  lines.push("");

  lines.push("## 你的打分");
  lines.push("");
  lines.push("| # | 评价 | 标签 | 原因 | 时间 | 会话 |");
  lines.push("|---|------|------|------|------|------|");
  for (const f of feedbacks) {
    lines.push(
      `| ${f.rid} | ${verdictLabel(f.verdict)} | ${f.tags.join("、") || "—"} | ${escapeCell(f.note ?? "—")} | ${f.created_at} | ${f.session_id ?? "—"} |`,
    );
  }
  lines.push("");

  lines.push("## 事件内容（EventContract）");
  lines.push("");
  if (contract) {
    const purpose = typeof contract.purpose === "string" ? contract.purpose : "";
    if (purpose) {
      lines.push(`**目的**：${purpose}`);
      lines.push("");
    }
    const kinds = extractCommandKinds(contract);
    if (kinds.length) {
      lines.push(`**命令序列**（${kinds.length}）：${kinds.join(" → ")}`);
      lines.push("");
    }
    lines.push("<details><summary>完整契约 JSON</summary>");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(contract, null, 2));
    lines.push("```");
    lines.push("</details>");
  } else {
    lines.push("_（契约已不在注册表，可能被删除或改名）_");
  }
  lines.push("");

  lines.push("## AI 生成过程");
  lines.push("");
  if (!digest) {
    lines.push("_（最近一条反馈未带 --session；record 时带上会话 id 可拼出 AI 当时的思考与工具调用）_");
  } else if (!digest.eventsPath) {
    lines.push(`_（会话 \`${digest.sessionId}\` 的事件记录未找到，可能已被运行时清理）_`);
  } else {
    lines.push(`> 来源：\`${eventsRel ?? digest.eventsPath}\`（opencode 会话事件）`);
    lines.push("");
    if (digest.thinking.length) {
      lines.push("### 思考");
      lines.push("");
      lines.push("<details><summary>展开思考链</summary>");
      lines.push("");
      for (const t of digest.thinking) {
        lines.push(t);
        lines.push("");
      }
      lines.push("</details>");
      lines.push("");
    }
    if (digest.toolCalls.length) {
      lines.push("### 工具调用");
      lines.push("");
      for (const tc of digest.toolCalls) {
        lines.push(`- \`${tc.name}\`${tc.brief ? ` ${tc.brief}` : ""}`);
      }
      lines.push("");
    }
    if (digest.assistantText.length) {
      lines.push("### AI 对外说明");
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
 * 生成/刷新某事件的反馈审阅卡片，返回卡片文件绝对路径。
 * 对话摘要取「最近一条带 session 的反馈」对应的原生会话。
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
